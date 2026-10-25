import { createHash, randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { FinanceStore, Actor, DomainError } from "../domain";
import {
  resourceSchemas,
  Kind,
  Resource,
  defaults,
  eventSchema,
  Event,
  accounts,
  day,
} from "./types";
import { calculate, Input } from "./engine";
import { SubscriptionService } from "../subscriptions";
import { addDays, monthAfter } from "./types";

const readRoles = ["finance", "cfo", "auditor", "reconciler"];
const writeRoles = ["finance", "cfo"];
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const now = () => new Date().toISOString();
function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new DomainError(
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return result.data;
}
export class FinancialService {
  constructor(private s: FinanceStore) {}
  contract(a: Actor, entity: string) {
    this.access(a, entity);
    return {
      version: "1.0.0",
      currency: "NGN",
      money_unit: "integer kobo",
      max_rows: 5000,
      acceptance: "all-or-nothing",
      schema: z.toJSONSchema(eventSchema),
      notes: [
        "Coverage end is exclusive.",
        "Use a stable source_id/external_id pair and monotonically increasing revision.",
        "A linked invoice_payment_id must exactly match the existing receipt.",
        "The trusted server adapter uses the authenticated gateway; no unauthenticated provider is enabled.",
      ],
    };
  }
  access(a: Actor, entity: string, write = false) {
    if (entity !== "ng")
      throw new DomainError("The pilot model is NGN / GoJaye Nigeria Ltd", 400);
    this.s.authorize(a, entity, write ? writeRoles : readRoles);
  }
  initialize(entity: string) {
    this.s.tx(() => {
      if (
        this.s.get(
          "SELECT id FROM fm_resources WHERE entity_id=? AND kind='config'",
          entity,
        )
      )
        return;
      for (const r of defaults())
        this.s.run(
          "INSERT INTO fm_resources(id,entity_id,kind,data,updated_at) VALUES(?,?,?,?,?)",
          r.id,
          entity,
          r.kind,
          JSON.stringify(r.data),
          now(),
        );
    });
  }
  resources(entity: string): Resource[] {
    return this.s
      .all(
        "SELECT * FROM fm_resources WHERE entity_id=? ORDER BY kind,id",
        entity,
      )
      .map((r) => ({
        ...r,
        archived: !!r.archived,
        data: validated(
          resourceSchemas[r.kind as Kind] as z.ZodType<any>,
          JSON.parse(r.data),
        ),
      }));
  }
  private request<T>(
    entity: string,
    key: string,
    payload: unknown,
    fn: () => T,
  ): T {
    if (!z.string().uuid().safeParse(key).success)
      throw new DomainError("A UUID request_key is required");
    return this.s.tx(() => {
      const old = this.s.get(
        "SELECT * FROM fm_requests WHERE entity_id=? AND request_key=?",
        entity,
        key,
      );
      if (old) {
        if (old.payload_hash !== hash(payload))
          throw new DomainError(
            "Request key reused with different content",
            409,
          );
        return JSON.parse(old.response);
      }
      const out = fn();
      this.s.run(
        "INSERT INTO fm_requests VALUES(?,?,?,?)",
        entity,
        key,
        hash(payload),
        JSON.stringify(out),
      );
      return out;
    });
  }
  private refs(entity: string, kind: Kind, data: any) {
    const must = (id: string, k: Kind) => {
      const r = this.s.get(
        "SELECT * FROM fm_resources WHERE entity_id=? AND id=? AND kind=? AND archived=0",
        entity,
        id,
        k,
      );
      if (!r) throw new DomainError(`Unknown active ${k}: ${id}`);
      return JSON.parse(r.data);
    };
    if (["price", "assumption", "allocation"].includes(kind))
      must(data.service_id, "service");
    if (kind === "cost") {
      if (data.service_id) must(data.service_id, "service");
      if (data.scenario_id) must(data.scenario_id, "scenario");
    }
    if (kind === "assumption") {
      must(data.scenario_id, "scenario");
      const p = must(data.price_id, "price");
      if (p.service_id !== data.service_id)
        throw new DomainError("Price must belong to the selected service");
    }
    if (kind === "config") {
      const sum = Object.values(data.opening).reduce(
        (n: any, x: any) => n + x,
        0,
      );
      if (data.opening_confirmed && sum !== 0)
        throw new DomainError(
          "Confirmed opening adjustments must balance in debit-positive convention",
        );
    }
  }
  save(a: Actor, entity: string, input: any) {
    this.access(a, entity, true);
    this.initialize(entity);
    const v = validated(
      z.object({
        kind: z.enum(Object.keys(resourceSchemas) as [Kind, ...Kind[]]),
        id: z.string().max(180).optional(),
        revision: z.number().int().min(0),
        data: z.unknown(),
        request_key: z.string(),
      }),
      input,
    );
    const data = validated(resourceSchemas[v.kind] as z.ZodType<any>, v.data);
    return this.request(entity, v.request_key, v, () => {
      const id = v.id || randomUUID(),
        old = this.s.get(
          "SELECT * FROM fm_resources WHERE entity_id=? AND id=?",
          entity,
          id,
        );
      if (old && old.kind !== v.kind)
        throw new DomainError("Resource kind cannot change");
      if ((old?.revision || 0) !== v.revision)
        throw new DomainError("This record changed; reload before saving", 409);
      if (v.kind === "config" && id !== "pilot")
        throw new DomainError("Use the existing pilot configuration");
      if (
        old?.kind === "price" &&
        this.s.get(
          "SELECT id FROM fm_events WHERE entity_id=? AND json_extract(data,'$.price_id')=? LIMIT 1",
          entity,
          id,
        )
      )
        throw new DomainError(
          "This price is used by actuals. Clone a new effective-dated price; historical terms are preserved",
          409,
        );
      this.refs(entity, v.kind, data);
      if (
        v.kind === "assumption" &&
        this.resources(entity).some(
          (r) =>
            r.kind === "assumption" &&
            !r.archived &&
            r.id !== id &&
            r.data.scenario_id === data.scenario_id &&
            r.data.price_id === data.price_id,
        )
      )
        throw new DomainError(
          "This scenario already has a driver segment for this price. Edit that segment or use a distinct plan to avoid double counting.",
        );
      if (v.kind === "allocation") {
        const other = this.resources(entity)
          .filter(
            (r) =>
              !r.archived &&
              r.kind === "allocation" &&
              r.id !== id &&
              r.data.category === data.category,
          )
          .reduce((n, r) => n + r.data.share, 0);
        if (other + data.share > 1.00000001)
          throw new DomainError("Allocation shares cannot exceed 100%");
      }
      const revision = v.revision + 1,
        stamp = now();
      this.s.run(
        "INSERT INTO fm_resources VALUES(?,?,?,?,?,0,?) ON CONFLICT(entity_id,id) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at",
        id,
        entity,
        v.kind,
        JSON.stringify(data),
        revision,
        stamp,
      );
      this.s.run(
        "INSERT INTO fm_history(entity_id,resource_id,revision,data,actor_id,created_at) VALUES(?,?,?,?,?,?)",
        entity,
        id,
        revision,
        JSON.stringify(data),
        a.id,
        stamp,
      );
      this.s.audit(entity, a, "financial.resource_saved", id, {
        kind: v.kind,
        revision,
      });
      return {
        id,
        kind: v.kind,
        data,
        revision,
        archived: false,
        updated_at: stamp,
      };
    });
  }
  action(a: Actor, entity: string, id: string, input: any) {
    this.access(a, entity, true);
    const v = validated(
      z.object({
        action: z.enum(["archive", "restore", "delete", "clone"]),
        revision: z.number().int(),
        request_key: z.string(),
      }),
      input,
    );
    return this.request(entity, v.request_key, { id, ...v }, () => {
      const row = this.s.get(
        "SELECT * FROM fm_resources WHERE entity_id=? AND id=?",
        entity,
        id,
      );
      if (!row) throw new DomainError("Resource not found", 404);
      if (row.revision !== v.revision)
        throw new DomainError("Reload changed record", 409);
      if (row.kind === "config")
        throw new DomainError(
          "Pilot configuration cannot be removed or cloned",
        );
      if (
        row.kind === "scenario" &&
        ["archive", "delete"].includes(v.action) &&
        !row.archived &&
        this.resources(entity).filter(
          (r) => r.kind === "scenario" && !r.archived,
        ).length <= 1
      )
        throw new DomainError("Keep at least one active scenario.");
      if (v.action === "clone") {
        if (row.kind === "assumption")
          throw new DomainError(
            "Clone the scenario to copy its assumptions without duplicating paying drivers.",
          );
        const newId = randomUUID(),
          data = {
            ...JSON.parse(row.data),
            name: `${JSON.parse(row.data).name} copy`,
          };
        this.s.run(
          "INSERT INTO fm_resources VALUES(?,?,?,?,1,0,?)",
          newId,
          entity,
          row.kind,
          JSON.stringify(data),
          now(),
        );
        if (row.kind === "scenario")
          for (const r of this.resources(entity).filter(
            (r) =>
              ["assumption", "cost"].includes(r.kind) &&
              r.data.scenario_id === id &&
              !r.archived,
          )) {
            this.s.run(
              "INSERT INTO fm_resources VALUES(?,?,?,?,1,0,?)",
              randomUUID(),
              entity,
              r.kind,
              JSON.stringify({ ...r.data, scenario_id: newId }),
              now(),
            );
          }
        this.s.audit(entity, a, "financial.resource_cloned", newId, {
          from: id,
        });
        return { id: newId };
      }
      const referenced =
        this.resources(entity).some(
          (r) =>
            !r.archived &&
            r.id !== id &&
            Object.entries(r.data).some(
              ([k, value]) => k.endsWith("_id") && value === id,
            ),
        ) ||
        this.s.get(
          "SELECT id FROM fm_events WHERE entity_id=? AND (source_id=? OR json_extract(data,'$.price_id')=? OR json_extract(data,'$.service_id')=?)",
          entity,
          id,
          id,
          id,
        );
      if (v.action === "delete" && referenced)
        throw new DomainError(
          "Referenced records must be archived, not deleted",
        );
      if (v.action === "delete")
        this.s.run(
          "DELETE FROM fm_resources WHERE entity_id=? AND id=?",
          entity,
          id,
        );
      else
        this.s.run(
          "UPDATE fm_resources SET archived=?,revision=revision+1,updated_at=? WHERE entity_id=? AND id=?",
          v.action === "archive" ? 1 : 0,
          now(),
          entity,
          id,
        );
      this.s.audit(entity, a, `financial.${v.action}`, id, {
        before: JSON.parse(row.data),
      });
      return { ok: true };
    });
  }
  input(entity: string): Input {
    const resources = this.resources(entity),
      config = resources.find((r) => r.kind === "config")!.data;
    const subscriptions = new SubscriptionService(
      this.s,
      () => config.cutoff,
    ).list(this.s.actor("finance"), entity, 365);
    const vendorCosts = subscriptions.charges
      .filter(
        (c: any) =>
          !c.expense &&
          c.due_date > config.cutoff &&
          c.due_date <= addDays(config.start_date, 89),
      )
      .map((c: any) => {
        const sub = subscriptions.subscriptions.find(
          (s: any) => s.id === c.subscription_id,
        )!;
        return {
          id: `vendor:${c.subscription_id}:${c.due_date}`,
          name: c.subscription,
          date: c.due_date,
          amount_minor: c.outstanding_minor,
          coverage_end:
            sub.cadence === "annual"
              ? monthAfter(c.due_date, 12)
              : sub.cadence === "monthly"
                ? monthAfter(c.due_date)
                : addDays(c.due_date, sub.interval_count),
        };
      });
    const obligations = this.s
      .all(
        "SELECT r.id,r.due_date date,(r.amount_minor-COALESCE((SELECT SUM(p.amount_minor) FROM bookkeeping_payments p WHERE p.record_id=r.id AND p.voided=0 AND p.date<=?),0)) amount_minor FROM bookkeeping_records r WHERE r.entity_id=? AND r.voided=0 AND r.date<=?",
        config.cutoff,
        entity,
        config.cutoff,
      )
      .filter((r) => r.amount_minor > 0);
    return {
      resources,
      vendorCosts,
      obligations,
      events: this.s
        .all("SELECT * FROM fm_events WHERE entity_id=?", entity)
        .map((r) => ({
          ...JSON.parse(r.data),
          id: r.id,
          imported_at: r.imported_at,
        })),
      ledger: this.s.all(
        "SELECT j.date,l.account,a.type,(l.debit-l.credit) amount,j.id source,j.description FROM lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.entity_id=l.entity_id AND a.code=l.account WHERE j.entity_id=? AND j.status='posted' ORDER BY j.date,j.id,l.id",
        entity,
      ),
      pending: this.s.all(
        "SELECT id,description,amount_minor,date,status FROM spends WHERE entity_id=? AND status IN ('approved','scheduled','paid','reconciled') AND NOT EXISTS(SELECT 1 FROM journals WHERE source_id=spends.id AND status='posted')",
        entity,
      ),
      invoiceReceipts: this.s.all(
        "SELECT p.id,p.invoice_id,p.amount_minor,p.date FROM sales_invoice_payments p JOIN sales_invoices i ON i.id=p.invoice_id WHERE i.entity_id=? AND p.voided_at IS NULL",
        entity,
      ),
      captured_at: now(),
    };
  }
  workspace(a: Actor, entity: string, scenario = "base") {
    this.access(a, entity);
    this.initialize(entity);
    return this.s.tx(() => {
      const input = this.input(entity);
      if (
        !input.resources.some(
          (r) => r.id === scenario && r.kind === "scenario" && !r.archived,
        )
      )
        scenario = input.resources.find(
          (r) => r.kind === "scenario" && !r.archived,
        )!.id;
      const result = calculate(input, scenario);
      const snapshots = this.s.all(
        "SELECT id,name,kind,scenario_id,created_at FROM fm_snapshots WHERE entity_id=? ORDER BY created_at DESC",
        entity,
      );
      const original = this.s.get(
        "SELECT result_json FROM fm_snapshots WHERE entity_id=? AND kind='budget' ORDER BY created_at LIMIT 1",
        entity,
      );
      const comparison = input.resources
        .filter((r) => r.kind === "scenario" && !r.archived)
        .map((r) => {
          const out = calculate(input, r.id);
          return {
            id: r.id,
            name: r.data.name,
            ...out.summary,
            complete: out.complete,
          };
        });
      const sensitivities = [6000000000, 6500000000, 7000000000].map((f) => ({
        funding_minor: f,
        ...calculate(input, scenario, f).summary,
      }));
      const originalResult = original ? JSON.parse(original.result_json) : null;
      const comparable =
        originalResult &&
        originalResult.start === result.start &&
        originalResult.end === result.end;
      const sourceStatus = input.resources
        .filter((r) => r.kind === "source" && !r.archived)
        .map((r) => {
          const last =
            input.events
              .filter((e) => e.source_id === r.id)
              .map((e) => e.imported_at)
              .filter(Boolean)
              .sort()
              .at(-1) || null;
          return {
            id: r.id,
            name: r.data.name,
            method: r.data.method,
            status: r.data.status,
            last_success: last,
            coverage_through: r.data.coverage_through,
            stale:
              !last ||
              Date.parse(input.captured_at) - Date.parse(last) > 86400000,
          };
        });
      const thresholds = input.resources
        .filter((r) => r.kind === "threshold" && !r.archived)
        .map((r) => {
          let observed: number | null = null,
            sample = 0;
          if (r.data.metric === "customer_d30") {
            const c = result.pmf.cohorts as any[];
            sample = c.reduce((n, x) => n + x.d30.eligible, 0);
            observed = sample
              ? c.reduce((n, x) => n + x.d30.retained, 0) / sample
              : null;
          }
          if (r.data.metric === "driver_renewal") {
            sample = result.pmf.renewal.eligible;
            observed = result.pmf.renewal.rate;
          }
          if (r.data.metric === "fulfilment") {
            sample = input.events.filter(
              (e) =>
                e.type === "booking" &&
                e.status !== "void" &&
                e.date <= result.cutoff,
            ).length;
            observed = result.pmf.fulfilment;
          }
          if (r.data.metric === "contribution_margin") {
            const actual = result.daily.filter((d) => d.status === "actual");
            const revenue = actual.reduce((n, d) => n + d.revenue, 0);
            sample = result.pmf.completed_jobs;
            observed =
              revenue > 0
                ? actual.reduce((n, d) => n + d.gross_profit, 0) / revenue
                : null;
          }
          return {
            name: r.data.name,
            metric: r.data.metric,
            target: r.data.minimum,
            sample,
            observed,
            status:
              observed === null || sample < r.data.minimum_sample
                ? "Insufficient evidence"
                : observed >= r.data.minimum
                  ? "At or above target"
                  : "Below target",
          };
        });
      return {
        resources: input.resources,
        result,
        comparison,
        sensitivities,
        snapshots,
        source_status: sourceStatus,
        thresholds,
        variance_note:
          originalResult && !comparable
            ? "Original budget uses a different calendar; comparisons are unavailable until periods match."
            : null,
        variance: comparable
          ? {
              original: originalResult.summary,
              current: result.summary,
            }
          : null,
        imports: this.s
          .all(
            "SELECT id,status,created_at,accepted_at,errors_json FROM fm_imports WHERE entity_id=? ORDER BY created_at DESC LIMIT 30",
            entity,
          )
          .map((r) => ({ ...r, errors: JSON.parse(r.errors_json) })),
        events: input.events,
        source_revision: hash({ ...input, captured_at: undefined }),
        can_write: writeRoles.includes(a.role),
      };
    });
  }
  validateEvents(entity: string, rows: unknown[]) {
    const errors: { row: number; message: string }[] = [],
      valid: Event[] = [];
    const keys = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      try {
        const e: Event = validated(eventSchema, rows[i]);
        const key = `${e.source_id}:${e.external_id}`;
        if (keys.has(key))
          throw new DomainError("Duplicate source ID in batch");
        keys.add(key);
        const source = this.s.get(
          "SELECT id FROM fm_resources WHERE entity_id=? AND id=? AND kind='source' AND archived=0",
          entity,
          e.source_id,
        );
        if (!source) throw new DomainError("Configure an active source first");
        const old = this.s.get(
          "SELECT * FROM fm_events WHERE entity_id=? AND source_id=? AND external_id=?",
          entity,
          e.source_id,
          e.external_id,
        );
        if (old && e.revision < old.revision)
          throw new DomainError(
            "Out-of-order revision; use the latest source revision",
          );
        if (old && e.revision === old.revision) {
          const prior = validated(eventSchema, JSON.parse(old.data));
          if (hash(prior) !== hash(e))
            throw new DomainError("Same revision has conflicting content");
        }
        if (e.price_id) {
          const price = this.s.get(
            "SELECT data FROM fm_resources WHERE entity_id=? AND id=? AND kind='price'",
            entity,
            e.price_id,
          );
          if (!price) throw new DomainError("Unknown price");
          const p = JSON.parse(price.data);
          if (
            e.service_id !== p.service_id ||
            e.date < p.effective_from ||
            (p.effective_to && e.date > p.effective_to)
          )
            throw new DomainError("Price does not cover this service/date");
          if (p.mode === "percent" ? p.rate === null : p.amount_minor === null)
            throw new DomainError(
              "Configure the price value before importing activity",
            );
          e.price_snapshot =
            old && JSON.parse(old.data).price_id === e.price_id
              ? JSON.parse(old.data).price_snapshot
              : p;
        }
        if (
          e.type === "booking" &&
          e.price_snapshot?.mode === "fixed" &&
          e.price_snapshot.amount_minor > e.amount_minor
        )
          throw new DomainError(
            "Fixed platform fee cannot exceed eligible booking value",
          );
        if (
          e.service_id &&
          !this.s.get(
            "SELECT id FROM fm_resources WHERE entity_id=? AND id=? AND kind='service'",
            entity,
            e.service_id,
          )
        )
          throw new DomainError("Unknown service");
        valid.push(e);
      } catch (err) {
        errors.push({ row: i + 2, message: (err as Error).message });
      }
    }
    const all = this.s
      .all("SELECT data FROM fm_events WHERE entity_id=?", entity)
      .map((r) => JSON.parse(r.data) as Event)
      .filter(
        (e) =>
          !valid.some(
            (v) =>
              v.source_id === e.source_id && v.external_id === e.external_id,
          ),
      )
      .concat(valid)
      .filter((e) => e.status !== "void");
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e.status === "void") continue;
      const err = (message: string) =>
        errors.push({
          row:
            rows.findIndex(
              (r: any) =>
                r.external_id === e.external_id && r.source_id === e.source_id,
            ) + 2,
          message,
        });
      if (e.invoice_payment_id) {
        const receipt = this.s.get(
          "SELECT p.*,i.entity_id,i.document FROM sales_invoice_payments p JOIN sales_invoices i ON i.id=p.invoice_id WHERE p.id=? AND i.entity_id=? AND p.voided_at IS NULL",
          e.invoice_payment_id,
          entity,
        );
        if (
          !receipt ||
          receipt.amount_minor !== e.amount_minor ||
          receipt.date !== e.date ||
          JSON.parse(receipt.document).currency !== e.currency
        )
          err(
            "Invoice receipt link must match active receipt entity, date, currency and amount",
          );
        if (
          all.some(
            (x) => x !== e && x.invoice_payment_id === e.invoice_payment_id,
          )
        )
          err("Invoice receipt already linked to another event");
      }
      if (
        e.type === "subscription" &&
        all.some(
          (x) =>
            x !== e &&
            x.type === "subscription" &&
            x.driver_id === e.driver_id &&
            x.date < e.coverage_end! &&
            x.coverage_end! > e.date,
        )
      )
        err("Driver subscription coverage overlaps another entitlement");
      if (["collection", "refund", "settlement"].includes(e.type)) {
        const parent = all.find(
          (x) =>
            x.source_id === e.source_id &&
            x.external_id === e.related_id &&
            ["booking", "subscription"].includes(x.type),
        );
        if (!parent) err("Related booking/subscription is missing or voided");
        else {
          const sum = (type: string) =>
            all
              .filter(
                (x) =>
                  x.source_id === e.source_id &&
                  x.related_id === e.related_id &&
                  x.type === type &&
                  x.date <= e.date,
              )
              .reduce((n, x) => n + x.amount_minor, 0);
          if (e.date < parent.date)
            err("Cash event predates underlying service record");
          if (sum("collection") > parent.amount_minor)
            err("Collections exceed source booking/subscription amount");
          if (sum("refund") > sum("collection"))
            err("Refunds exceed recorded collections");
          const p = parent.price_snapshot;
          const fee =
            parent.type === "subscription"
              ? parent.amount_minor
              : p?.mode === "percent"
                ? Math.round(parent.amount_minor * p.rate)
                : p?.mode === "fixed"
                  ? p.amount_minor
                  : 0;
          if (
            sum("settlement") >
            Math.max(
              0,
              sum("collection") -
                fee -
                sum("refund") *
                  (1 - (parent.amount_minor ? fee / parent.amount_minor : 0)),
            )
          )
            err("Settlement exceeds driver funds remaining");
        }
      }
    }
    return { rows: valid, errors };
  }
  preview(a: Actor, entity: string, input: any) {
    this.access(a, entity, true);
    this.initialize(entity);
    const v = validated(
      z.object({
        csv: z.string().max(5000000).optional(),
        rows: z.array(z.unknown()).max(5000).optional(),
        mapping: z.record(z.string(), z.string()).default({}),
        request_key: z.string(),
      }),
      input,
    );
    return this.request(entity, v.request_key, v, () => {
      let rows: any[] = v.rows || [];
      if (v.csv) {
        try {
          rows = parse(v.csv, {
            columns: true,
            skip_empty_lines: true,
            bom: true,
          });
        } catch {
          throw new DomainError("CSV could not be parsed");
        }
      }
      if (!rows.length || rows.length > 5000)
        throw new DomainError("Supply 1–5,000 rows");
      rows = rows.map((row) => {
        const r: any = {};
        for (const [k, value] of Object.entries(row)) {
          const key = v.mapping[k] || k;
          r[key] = [
            "revision",
            "amount_minor",
            "available_hours",
            "job_hours",
            "match_minutes",
          ].includes(key)
            ? value === ""
              ? key === "amount_minor"
                ? 0
                : key === "revision"
                  ? 1
                  : null
              : Number(value)
            : [
                  "coverage_end",
                  "account",
                  "offset_account",
                  "audience",
                ].includes(key) && value === ""
              ? null
              : value;
        }
        return r;
      });
      const result = this.validateEvents(entity, rows),
        id = randomUUID();
      this.s.run(
        "INSERT INTO fm_imports VALUES(?,?,'draft',?,?,?,NULL,?)",
        id,
        entity,
        JSON.stringify(rows),
        JSON.stringify(result.errors),
        now(),
        a.id,
      );
      return {
        id,
        ...result,
        total_minor: result.rows.reduce((n, r) => n + r.amount_minor, 0),
        policy:
          "All-or-nothing acceptance; amounts span different event types and are not revenue totals.",
      };
    });
  }
  accept(a: Actor, entity: string, id: string, input: any) {
    this.access(a, entity, true);
    return this.request(entity, input.request_key, { id, ...input }, () => {
      const batch = this.s.get(
        "SELECT * FROM fm_imports WHERE id=? AND entity_id=?",
        id,
        entity,
      );
      if (!batch) throw new DomainError("Import not found", 404);
      if (batch.status === "accepted") return { accepted: true, id };
      if (batch.status !== "draft")
        throw new DomainError("Import is no longer a draft");
      const result = this.validateEvents(entity, JSON.parse(batch.rows_json));
      if (result.errors.length)
        throw new DomainError(
          result.errors.map((e) => `Row ${e.row}: ${e.message}`).join("; "),
        );
      let inserted = 0,
        duplicates = 0;
      for (const e of result.rows) {
        const existing = this.s.get(
          "SELECT * FROM fm_events WHERE entity_id=? AND source_id=? AND external_id=?",
          entity,
          e.source_id,
          e.external_id,
        );
        if (existing?.revision === e.revision) {
          duplicates++;
          continue;
        }
        const eventId = existing?.id || randomUUID();
        this.s.run(
          "INSERT INTO fm_events VALUES(?,?,?,?,?,?,?) ON CONFLICT(entity_id,source_id,external_id) DO UPDATE SET revision=excluded.revision,data=excluded.data,imported_at=excluded.imported_at",
          eventId,
          entity,
          e.source_id,
          e.external_id,
          e.revision,
          JSON.stringify(e),
          now(),
        );
        this.s.run(
          "INSERT INTO fm_event_history(entity_id,event_id,revision,data,actor_id,created_at) VALUES(?,?,?,?,?,?)",
          entity,
          eventId,
          e.revision,
          JSON.stringify(e),
          a.id,
          now(),
        );
        inserted++;
      }
      this.s.run(
        "UPDATE fm_imports SET status='accepted',accepted_at=? WHERE id=?",
        now(),
        id,
      );
      this.s.audit(entity, a, "financial.import_accepted", id, {
        inserted,
        duplicates,
      });
      return { accepted: true, id, inserted, duplicates };
    });
  }
  discard(a: Actor, entity: string, id: string) {
    this.access(a, entity, true);
    return this.s.tx(() => {
      const r = this.s.get(
        "SELECT status FROM fm_imports WHERE entity_id=? AND id=?",
        entity,
        id,
      );
      if (r?.status === "discarded") return { ok: true };
      if (!r || r.status !== "draft")
        throw new DomainError("Only draft imports can be discarded");
      this.s.run("UPDATE fm_imports SET status='discarded' WHERE id=?", id);
      this.s.audit(entity, a, "financial.import_discarded", id);
      return { ok: true };
    });
  }
  readImport(a: Actor, entity: string, id: string) {
    this.access(a, entity);
    const batch = this.s.get(
      "SELECT * FROM fm_imports WHERE id=? AND entity_id=?",
      id,
      entity,
    );
    if (!batch) throw new DomainError("Import not found", 404);
    return {
      id,
      status: batch.status,
      original_rows: JSON.parse(batch.rows_json),
      ...this.validateEvents(entity, JSON.parse(batch.rows_json)),
      policy:
        "Draft revisions create a replacement version; accepted source history is preserved.",
    };
  }
  replaceDraft(a: Actor, entity: string, id: string, input: any) {
    this.access(a, entity, true);
    return this.request(entity, input.request_key, { id, ...input }, () => {
      const batch = this.s.get(
        "SELECT status FROM fm_imports WHERE id=? AND entity_id=?",
        id,
        entity,
      );
      if (batch?.status !== "draft")
        throw new DomainError("Only draft imports can be revised");
      const next = this.preview(a, entity, {
        ...input,
        request_key: randomUUID(),
      });
      this.s.run("UPDATE fm_imports SET status='superseded' WHERE id=?", id);
      this.s.audit(entity, a, "financial.import_revised", id, {
        replacement: next.id,
      });
      return next;
    });
  }
  snapshot(a: Actor, entity: string, input: any) {
    this.access(a, entity, true);
    this.initialize(entity);
    const v = validated(
      z.object({
        name: z.string().min(1).max(180),
        kind: z.enum(["budget", "forecast", "checkpoint"]),
        scenario_id: z.string(),
        request_key: z.string(),
      }),
      input,
    );
    return this.request(entity, v.request_key, v, () => {
      const data = this.input(entity);
      if (
        !data.resources.some(
          (r) => r.id === v.scenario_id && r.kind === "scenario",
        )
      )
        throw new DomainError("Unknown scenario");
      const result = calculate(data, v.scenario_id),
        id = randomUUID();
      this.s.run(
        "INSERT INTO fm_snapshots VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        entity,
        v.name,
        v.kind,
        v.scenario_id,
        JSON.stringify(data),
        JSON.stringify(result),
        now(),
        a.id,
      );
      this.s.audit(entity, a, "financial.snapshot_created", id, {
        kind: v.kind,
      });
      return { id };
    });
  }
  snapshotData(a: Actor, entity: string, id: string) {
    this.access(a, entity);
    const r = this.s.get(
      "SELECT * FROM fm_snapshots WHERE entity_id=? AND id=?",
      entity,
      id,
    );
    if (!r) throw new DomainError("Snapshot not found", 404);
    return {
      ...r,
      input: JSON.parse(r.input_json),
      result: JSON.parse(r.result_json),
      input_json: undefined,
      result_json: undefined,
    };
  }
  history(a: Actor, entity: string, id: string) {
    this.access(a, entity);
    return {
      resources: this.s.all(
        "SELECT * FROM fm_history WHERE entity_id=? AND resource_id=? ORDER BY revision",
        entity,
        id,
      ),
      events: this.s.all(
        "SELECT * FROM fm_event_history WHERE entity_id=? AND event_id=? ORDER BY revision",
        entity,
        id,
      ),
    };
  }
}
