import { managementExclusions } from "./provenance";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { FinanceStore, DomainError, categories, type Actor } from "./domain";
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
const common = {
  entity_id: z.enum(["ng", "inc"]),
  request_key: z.string().uuid(),
  revision: z.number().int().min(0).default(0),
};
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new DomainError(result.error.issues.map((i) => i.message).join("; "));
  return result.data;
}
export class BudgetService {
  constructor(private s: FinanceStore) {}
  private access(a: Actor, entity: string, write = false) {
    this.s.authorize(
      a,
      entity,
      write ? ["finance", "cfo"] : ["manager", "finance", "cfo", "auditor"],
    );
  }
  private request<T>(a: Actor, p: any, fn: () => T): T {
    this.access(a, p.entity_id, true);
    const hash = createHash("sha256").update(JSON.stringify(p)).digest("hex");
    return this.s.tx(() => {
      const existing = this.s.get(
        "SELECT * FROM budget_requests WHERE entity_id=? AND request_key=?",
        p.entity_id,
        p.request_key,
      );
      if (existing) {
        if (existing.payload_hash !== hash)
          throw new DomainError(
            "Request key already used for a different change",
            409,
          );
        return JSON.parse(existing.response);
      }
      const response = fn();
      this.s.run(
        "INSERT INTO budget_requests VALUES(?,?,?,?)",
        p.entity_id,
        p.request_key,
        hash,
        JSON.stringify(response),
      );
      return response;
    });
  }
  list(a: Actor, entity: string, archived = false) {
    this.access(a, entity);
    const samples = managementExclusions(this.s, entity).budgets;
    return this.s
      .budgetsRaw(entity, archived)
      .map((row) => ({ ...row, sample_only: samples.includes(row.id) }));
  }
  history(a: Actor, entity: string, id: string) {
    this.access(a, entity);
    return this.s
      .all(
        "SELECT revision,action,data,actor_id,created_at FROM budget_history WHERE entity_id=? AND budget_id=? ORDER BY revision DESC",
        entity,
        id,
      )
      .map((row) => ({ ...row, data: JSON.parse(row.data) }));
  }
  private used(row: any) {
    return (
      !!this.s.get(
        "SELECT id FROM spends WHERE entity_id=? AND department=? AND category=? AND substr(date,1,7)=? LIMIT 1",
        row.entity_id,
        row.department,
        row.category,
        row.period,
      ) ||
      !!this.s.get(
        "SELECT id FROM bookkeeping_records WHERE entity_id=? AND department=? AND category=? AND substr(date,1,7)=? LIMIT 1",
        row.entity_id,
        row.department,
        row.category,
        row.period,
      )
    );
  }
  private record(a: Actor, row: any, action: string, revision: number) {
    const recorded = new Date().toISOString();
    this.s.run(
      "INSERT INTO budget_meta(budget_id,revision,archived,updated_at) VALUES(?,?,?,?) ON CONFLICT(budget_id) DO UPDATE SET revision=excluded.revision,archived=excluded.archived,updated_at=excluded.updated_at",
      row.id,
      revision,
      row.archived || 0,
      recorded,
    );
    this.s.run(
      "INSERT INTO budget_history(entity_id,budget_id,revision,action,data,actor_id,created_at) VALUES(?,?,?,?,?,?,?)",
      row.entity_id,
      row.id,
      revision,
      action,
      JSON.stringify(row),
      a.id,
      recorded,
    );
    this.s.audit(row.entity_id, a, `budget.${action}`, row.id, {
      revision,
      record: row,
    });
  }
  save(a: Actor, input: unknown, id?: string) {
    const p = parse(
      z.object({
        ...common,
        department: z.enum(["Product", "Marketing", "Operations", "Finance"]),
        category: z
          .string()
          .refine(
            (v) => Object.hasOwn(categories, v),
            "Choose an accounting category",
          ),
        period: month,
        amount_minor: z.number().int().min(0).max(1e12),
      }),
      input,
    );
    return this.request(a, { ...p, id: id || null }, () => {
      const old = id
        ? this.s.get(
            "SELECT b.*,COALESCE(m.revision,0) revision,COALESCE(m.archived,0) archived FROM budgets b LEFT JOIN budget_meta m ON m.budget_id=b.id WHERE b.id=? AND b.entity_id=?",
            id,
            p.entity_id,
          )
        : null;
      if (id && !old) throw new DomainError("Budget not found", 404);
      if (old && old.revision !== p.revision)
        throw new DomainError("Budget changed. Reload before editing.", 409);
      if (old?.archived)
        throw new DomainError("Restore this budget before editing");
      if (
        old &&
        this.used(old) &&
        ["department", "category", "period"].some(
          (k) => old[k] !== p[k as keyof typeof p],
        )
      )
        throw new DomainError(
          "A budget with recorded activity must keep its department, category and month. Create a separate line instead.",
        );
      const duplicate = this.s.get(
        "SELECT id FROM budgets WHERE entity_id=? AND department=? AND category=? AND period=? AND id<>?",
        p.entity_id,
        p.department,
        p.category,
        p.period,
        id || "",
      );
      if (duplicate)
        throw new DomainError(
          "This budget line already exists. Edit it or restore it from archived budgets.",
          409,
        );
      const budgetId = id || randomUUID();
      if (old)
        this.s.run(
          "UPDATE budgets SET amount_minor=?,department=?,category=?,period=? WHERE id=?",
          p.amount_minor,
          p.department,
          p.category,
          p.period,
          budgetId,
        );
      else
        this.s.run(
          "INSERT INTO budgets(id,entity_id,department,category,period,amount_minor) VALUES(?,?,?,?,?,?)",
          budgetId,
          p.entity_id,
          p.department,
          p.category,
          p.period,
          p.amount_minor,
        );
      if (old && !this.history(a, p.entity_id, budgetId).length)
        this.record(a, old, "original", old.revision);
      const row = {
        id: budgetId,
        entity_id: p.entity_id,
        department: p.department,
        category: p.category,
        period: p.period,
        amount_minor: p.amount_minor,
        archived: 0,
      };
      const revision = (old?.revision || 0) + 1;
      this.record(a, row, old ? "updated" : "created", revision);
      return { ...row, revision };
    });
  }
  action(a: Actor, id: string, input: unknown) {
    const p = parse(
      z.object({ ...common, action: z.enum(["archive", "restore", "delete"]) }),
      input,
    );
    return this.request(a, { ...p, id }, () => {
      const old = this.s.get(
        "SELECT b.*,COALESCE(m.revision,0) revision,COALESCE(m.archived,0) archived FROM budgets b LEFT JOIN budget_meta m ON m.budget_id=b.id WHERE b.id=? AND b.entity_id=?",
        id,
        p.entity_id,
      );
      if (!old) throw new DomainError("Budget not found", 404);
      if (old.revision !== p.revision)
        throw new DomainError("Budget changed. Reload before editing.", 409);
      if (p.action === "delete" && this.used(old))
        throw new DomainError(
          "Budget has recorded activity. Archive it to preserve its history.",
        );
      if (!this.history(a, p.entity_id, id).length)
        this.record(a, old, "original", old.revision);
      const revision = old.revision + 1;
      this.record(
        a,
        { ...old, archived: p.action === "restore" ? 0 : 1 },
        p.action,
        revision,
      );
      if (p.action === "delete")
        this.s.run(
          "DELETE FROM budgets WHERE id=? AND entity_id=?",
          id,
          p.entity_id,
        );
      return { id, revision, ok: true };
    });
  }
}
