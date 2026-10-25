import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { z } from "zod";
import { parse } from "csv-parse/sync";

export type Actor = {
  id: string;
  name: string;
  role: string;
  entities: string[];
};
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const now = () => new Date().toISOString();
const id = (p: string) => `${p}-${randomUUID().slice(0, 8)}`;
const int = z.number().int().positive().max(1_000_000_000_000);
export const categories: Record<string, string> = {
  "Cloud & software": "6100",
  Marketing: "6200",
  Operations: "6300",
  "Professional fees": "6400",
  Travel: "6500",
  "Government fees": "6600",
  Salaries: "6700",
};
const optionalDate = z
  .string()
  .refine(
    (v) =>
      v === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v),
    "Invalid date",
  )
  .default("");
const expenseFields = [
  "payment_source",
  "paid_by_id",
  "original_paid_date",
  "original_payment_reference",
  "payment_method",
  "payment_account",
  "invoice_date",
  "due_date",
] as const;
export function expensePosition(s: any) {
  const personal = s.payment_source !== "company";
  const settled = ["paid", "reconciled", "posted"].includes(s.status);
  return {
    approval_status: ["scheduled", "paid", "reconciled", "posted"].includes(
      s.status,
    )
      ? "approved"
      : s.status,
    settlement_status:
      s.status === "rejected"
        ? "Not approved"
        : s.kind === "request"
          ? "Not payable yet"
          : settled
            ? personal
              ? "Reimbursed"
              : "Paid by Jaye"
            : personal
              ? s.status === "approved" || s.status === "scheduled"
                ? "Reimbursement due"
                : "Reimbursement pending approval"
              : s.original_paid_date
                ? "Company payment recorded · verification pending"
                : "Unpaid",
    outstanding_minor:
      s.kind === "request" ||
      settled ||
      s.status === "rejected" ||
      (!personal && s.original_paid_date)
        ? 0
        : s.amount_minor,
  };
}
const spendInput = z
  .object({
    entity_id: z.enum(["inc", "ng"]),
    kind: z.enum(["expense", "bill", "request"]),
    vendor_id: z.string().min(1),
    description: z.string().trim().min(3).max(180),
    purpose: z.string().trim().min(5).max(1000),
    amount_minor: int,
    currency: z.enum(["USD", "NGN"]),
    department: z.enum([
      "Product",
      "Engineering",
      "Marketing",
      "Operations",
      "Finance",
    ]),
    category: z.string().trim().min(1).max(60),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
        "Invalid date",
      ),
    invoice_number: z.string().trim().max(100).default(""),
    parent_id: z.string().optional(),
    payment_source: z
      .enum(["company", "employee", "founder"])
      .default("company"),
    paid_by_id: z.string().max(100).default(""),
    original_paid_date: optionalDate,
    original_payment_reference: z.string().trim().max(120).default(""),
    payment_method: z
      .enum(["", "bank_transfer", "card", "cash", "other"])
      .default(""),
    payment_account: z.string().trim().max(100).default(""),
    invoice_date: optionalDate,
    due_date: optionalDate,
  })
  .strict();
export class FinanceStore {
  db: DatabaseSync;
  dir: string;
  key: Buffer;
  private inTransaction = false;
  constructor(
    filename = resolve(process.cwd(), "../../data/jaye.db"),
    seed: boolean | "empty" = true,
    private readonly workspaceEntity?: "ng" | "inc",
  ) {
    this.dir =
      filename === ":memory:"
        ? resolve(process.cwd(), "../../data/test-evidence")
        : resolve(filename, "..");
    mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(filename);
    if (
      this.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='journals'",
      ) &&
      !this.all("PRAGMA table_info(journals)").some((c) => c.name === "status")
    ) {
      this.db.exec(
        "BEGIN; ALTER TABLE journals ADD COLUMN status TEXT NOT NULL DEFAULT 'posted'; DROP TRIGGER IF EXISTS journal_immutable_update; DROP TRIGGER IF EXISTS journal_immutable_delete; DROP TRIGGER IF EXISTS line_immutable_update; DROP TRIGGER IF EXISTS line_immutable_delete; COMMIT;",
      );
    }
    this.db.exec(readFileSync(resolve(__dirname, "schema.sql"), "utf8"));
    this.db.exec(
      "INSERT OR IGNORE INTO workspace_categories(entity_id,name,accounting_category) SELECT entity_id,name,accounting_category FROM subscription_categories",
    );
    if (!this.get("SELECT version FROM migrations WHERE version=4"))
      this.tx(() => {
        for (const field of expenseFields)
          this.db.exec(
            `ALTER TABLE spends ADD COLUMN ${field} TEXT NOT NULL DEFAULT '${field === "payment_source" ? "company" : ""}'`,
          );
        this.db.exec(
          "ALTER TABLE spends ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
        );
        this.run("INSERT INTO migrations VALUES(4,?)", now());
      });
    if (!this.get("SELECT version FROM migrations WHERE version=7"))
      this.tx(() => {
        this.db.exec(
          "ALTER TABLE bank_transactions ADD COLUMN direction TEXT NOT NULL DEFAULT 'debit' CHECK(direction IN ('debit','credit'))",
        );
        this.run("INSERT INTO migrations VALUES(7,?)", now());
      });
    if (!this.get("SELECT version FROM migrations WHERE version=8"))
      this.tx(() => {
        this.db.exec(
          "ALTER TABLE spends ADD COLUMN payment_amount_minor INTEGER",
        );
        this.run("INSERT INTO migrations VALUES(8,?)", now());
      });
    if (!this.get("SELECT version FROM migrations WHERE version=10"))
      this.tx(() => {
        this.db.exec(
          "DROP TRIGGER IF EXISTS bookkeeping_record_no_update; DROP TRIGGER IF EXISTS bookkeeping_payment_no_update;",
        );
        for (const table of ["bookkeeping_records", "bookkeeping_payments"])
          this.db.exec(
            `ALTER TABLE ${table} ADD COLUMN revision INTEGER NOT NULL DEFAULT 0; ALTER TABLE ${table} ADD COLUMN voided INTEGER NOT NULL DEFAULT 0;`,
          );
        this.db.exec(
          "DROP INDEX IF EXISTS payroll_month_unique; DROP INDEX IF EXISTS bookkeeping_invoice_unique; CREATE UNIQUE INDEX payroll_month_unique ON bookkeeping_records(entity_id,employee_id,payroll_month) WHERE kind='salary' AND voided=0; CREATE UNIQUE INDEX bookkeeping_invoice_unique ON bookkeeping_records(entity_id,payee,reference) WHERE reference<>'' AND kind='expense' AND voided=0;",
        );
        for (const table of [
          "employees",
          "spends",
          "subscriptions",
          "budgets",
          "bookkeeping_records",
        ])
          this.run(
            `UPDATE ${table} SET department='Product' WHERE department='Engineering'`,
          );
        this.run(
          "INSERT INTO migrations VALUES(10,?)",
          new Date().toISOString(),
        );
      });
    for (const [table, kind] of [
      ["bookkeeping_records", "record"],
      ["bookkeeping_payments", "payment"],
    ])
      this.db.exec(
        `CREATE TRIGGER IF NOT EXISTS ${table}_correction_only BEFORE UPDATE ON ${table} WHEN NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM bookkeeping_corrections WHERE kind='${kind}' AND target_id=OLD.id AND revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'Use an audited correction'); END;`,
      );
    const keyPath = join(this.dir, ".evidence-key");
    if (!existsSync(keyPath))
      writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
    this.key = readFileSync(keyPath);
    if (seed && !this.get("SELECT id FROM entities LIMIT 1")) {
      if (seed === "empty") this.seedEmpty();
      else this.seed();
    }
  }
  get(sql: string, ...args: any[]): any {
    return this.db.prepare(sql).get(...args);
  }
  all(sql: string, ...args: any[]): any[] {
    return this.db.prepare(sql).all(...args);
  }
  run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  tx<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.inTransaction = false;
    }
  }
  actor(userId: string): Actor {
    const u = this.get("SELECT * FROM users WHERE id=?", userId);
    if (!u) throw new DomainError("Unknown local test user", 401);
    return { ...u, entities: JSON.parse(u.entities) };
  }
  authorize(a: Actor, entity: string, roles?: string[]) {
    if (this.workspaceEntity && entity !== this.workspaceEntity)
      throw new DomainError("This workspace uses GoJaye Nigeria Ltd only", 403);
    if (!a.entities.includes(entity))
      throw new DomainError("You do not have access to this legal entity", 403);
    if (a.role === "investor")
      throw new DomainError(
        "Investors can only access approved snapshots",
        403,
      );
    if (a.role === "admin")
      throw new DomainError(
        "Technical administrators cannot access financial records",
        403,
      );
    if (roles && !roles.includes(a.role))
      throw new DomainError("Your role cannot perform this action", 403);
  }
  audit(
    entity: string,
    a: Actor,
    action: string,
    resource: string,
    details: unknown = {},
  ) {
    const previous =
      this.get("SELECT hash FROM audit ORDER BY id DESC LIMIT 1")?.hash ||
      "GENESIS";
    const time = now(),
      d = JSON.stringify(details);
    const digest = hash(
      JSON.stringify([entity, a.id, action, resource, d, time, previous]),
    );
    this.run(
      "INSERT INTO audit(entity_id,actor_id,action,resource_id,details,created_at,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?)",
      entity,
      a.id,
      action,
      resource,
      d,
      time,
      previous,
      digest,
    );
  }
  verifyAudit() {
    let previous = "GENESIS";
    for (const row of this.all("SELECT * FROM audit ORDER BY id")) {
      if (
        row.previous_hash !== previous ||
        row.hash !==
          hash(
            JSON.stringify([
              row.entity_id,
              row.actor_id,
              row.action,
              row.resource_id,
              row.details,
              row.created_at,
              row.previous_hash,
            ]),
          )
      )
        return false;
      previous = row.hash;
    }
    return true;
  }
  users() {
    return this.all("SELECT * FROM users").map((u) => ({
      ...u,
      entities: JSON.parse(u.entities),
    }));
  }
  login(userId: string) {
    const a = this.actor(userId),
      token = randomBytes(32).toString("hex");
    this.run(
      "INSERT INTO sessions VALUES(?,?,?)",
      hash(token),
      a.id,
      Date.now() + 8 * 60 * 60 * 1000,
    );
    return { token, user: a };
  }
  session(token: string) {
    const row = this.get(
      "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?",
      hash(token),
      Date.now(),
    );
    if (!row) throw new DomainError("Workspace access is required", 401);
    return this.actor(row.user_id);
  }
  logout(token: string) {
    this.run("DELETE FROM sessions WHERE token_hash=?", hash(token));
  }
  entities(a: Actor) {
    return this.all("SELECT * FROM entities").filter(
      (e) =>
        a.entities.includes(e.id) &&
        (!this.workspaceEntity || e.id === this.workspaceEntity),
    );
  }
  list(a: Actor, entity: string) {
    this.authorize(a, entity);
    const own =
      a.role === "employee"
        ? " AND (s.requester_id=? OR s.paid_by_id=? OR EXISTS(SELECT 1 FROM subscription_charges sc JOIN subscriptions sub ON sub.id=sc.subscription_id WHERE sc.spend_id=s.id AND (sub.owner_id=? OR sub.created_by=?)))"
        : "";
    return this.all(
      `SELECT s.*,v.name AS vendor,u.name AS requester,(SELECT COUNT(*) FROM receipts r WHERE r.spend_id=s.id) AS receipt_count FROM spends s JOIN vendors v ON v.id=s.vendor_id JOIN users u ON u.id=s.requester_id WHERE s.entity_id=?${own} ORDER BY s.created_at DESC`,
      ...[entity, ...(own ? [a.id, a.id, a.id, a.id] : [])],
    ).map((s) => this.position(s));
  }
  spend(a: Actor, spendId: string) {
    const s = this.get(
      "SELECT s.*,v.name AS vendor FROM spends s JOIN vendors v ON v.id=s.vendor_id WHERE s.id=?",
      spendId,
    );
    if (!s) throw new DomainError("Spend record not found", 404);
    this.authorize(a, s.entity_id);
    if (
      a.role === "employee" &&
      s.requester_id !== a.id &&
      s.paid_by_id !== a.id &&
      !this.get(
        "SELECT sc.id FROM subscription_charges sc JOIN subscriptions sub ON sub.id=sc.subscription_id WHERE sc.spend_id=? AND (sub.owner_id=? OR sub.created_by=?)",
        s.id,
        a.id,
        a.id,
      )
    )
      throw new DomainError(
        "Employees can only access their own expenses",
        403,
      );
    return this.position(s);
  }
  details(a: Actor, spendId: string) {
    const s = this.spend(a, spendId);
    return {
      ...s,
      warnings: this.warnings(s),
      receipts: this.all(
        "SELECT id,filename,mime,synthetic,created_at FROM receipts WHERE spend_id=?",
        s.id,
      ),
      history: this.all(
        "SELECT audit.*,users.name AS actor FROM audit LEFT JOIN users ON users.id=audit.actor_id WHERE resource_id=? AND entity_id=? ORDER BY audit.id",
        s.id,
        s.entity_id,
      ),
      journals: this.all("SELECT * FROM journals WHERE source_id=?", s.id),
      statement_rows:
        a.role === "reconciler"
          ? this.all(
              "SELECT reference,amount_minor,date FROM bank_transactions WHERE entity_id=? AND direction='debit' AND amount_minor=? AND matched_spend_id IS NULL AND id NOT IN (SELECT bank_transaction_id FROM bookkeeping_bank_matches) AND id NOT IN (SELECT bank_transaction_id FROM reimbursement_matches)",
              s.entity_id,
              s.payment_amount_minor ?? s.effective_amount_minor,
            )
          : [],
    };
  }
  validateSpend(a: Actor, input: unknown) {
    const p = spendInput.safeParse(input);
    if (!p.success)
      throw new DomainError(
        p.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    const s = p.data;
    this.authorize(a, s.entity_id, ["employee", "manager", "finance", "cfo"]);
    if (
      this.get("SELECT currency FROM entities WHERE id=?", s.entity_id)
        .currency !== s.currency
    )
      throw new DomainError(
        "Cross-currency spend is gated until an FX policy and rate source are approved",
      );
    if (
      !this.get(
        "SELECT id FROM vendors WHERE id=? AND entity_id=?",
        s.vendor_id,
        s.entity_id,
      )
    )
      throw new DomainError("Vendor does not belong to this entity");
    this.categoryAccount(s.entity_id, s.category);
    if (s.kind === "bill" && !s.invoice_number)
      throw new DomainError("Bills require an invoice number");
    if (s.parent_id) {
      const p = this.spend(a, s.parent_id);
      if (
        p.kind !== "request" ||
        p.status !== "approved" ||
        s.kind !== "bill" ||
        p.entity_id !== s.entity_id ||
        p.vendor_id !== s.vendor_id ||
        p.department !== s.department ||
        p.category !== s.category ||
        p.amount_minor < s.amount_minor
      )
        throw new DomainError(
          "Bill must match an approved request, vendor, dimensions and amount",
        );
    }
    if (s.due_date && s.invoice_date && s.due_date < s.invoice_date)
      throw new DomainError("Due date cannot precede invoice date");
    if (
      s.kind === "request" &&
      (s.payment_source !== "company" || s.original_paid_date)
    )
      throw new DomainError("Spend requests must be unpaid company purchases");
    if (s.payment_source !== "company") {
      const payer = this.actor(s.paid_by_id);
      this.authorize(payer, s.entity_id);
      if (a.role === "employee" && payer.id !== a.id)
        throw new DomainError(
          "Employees may only claim their own personal purchases",
          403,
        );
      if (!s.original_paid_date || !s.payment_method)
        throw new DomainError(
          "Personal purchases require the original payment date and method",
        );
    } else if (s.paid_by_id)
      throw new DomainError(
        "Company purchases cannot have a personal reimbursement recipient",
      );
    if (s.original_paid_date && !s.payment_method)
      throw new DomainError("Select the original payment method");
    if (
      s.payment_source === "company" &&
      s.original_paid_date &&
      !s.original_payment_reference
    )
      throw new DomainError(
        "Already-paid company expenses require a payment reference",
      );
    return s;
  }
  categoryAccount(entity: string, name: string): string {
    const base = this.get(
      "SELECT accounting_category FROM workspace_categories WHERE entity_id=? AND name=? COLLATE NOCASE",
      entity,
      name,
    )?.accounting_category;
    const code = Object.hasOwn(categories,name) ? categories[name] : Object.hasOwn(categories,base) ? categories[base] : undefined;
    if (!code) throw new DomainError("Choose a saved expense category");
    return code;
  }
  categoryList(a: Actor, entity: string) {
    this.authorize(a, entity, [
      "finance",
      "cfo",
      "auditor",
      "reconciler",
      "employee",
      "manager",
      "payer",
    ]);
    return [
      ...Object.keys(categories).map((name) => ({
        name,
        accounting_category: name,
      })),
      ...this.all(
        "SELECT name,accounting_category FROM workspace_categories WHERE entity_id=? ORDER BY name",
        entity,
      ),
    ];
  }
  addCategory(a: Actor, input: any) {
    const p = z
      .object({
        entity_id: z.enum(["ng", "inc"]),
        name: z.string().trim().min(2).max(60),
        accounting_category: z.string(),
      })
      .safeParse(input);
    if (!p.success)
      throw new DomainError("Enter a category name and accounting group");
    const v = p.data;
    this.authorize(a, v.entity_id, ["finance"]);
    if (!Object.hasOwn(categories,v.accounting_category))
      throw new DomainError("Choose an accounting group");
    if (
      Object.keys(categories).some(
        (n) => n.toLowerCase() === v.name.toLowerCase(),
      )
    )
      throw new DomainError("That category already exists", 409);
    return this.tx(() => {
      if (
        this.get(
          "SELECT name FROM workspace_categories WHERE entity_id=? AND name=? COLLATE NOCASE",
          v.entity_id,
          v.name,
        )
      )
        throw new DomainError("That category already exists", 409);
      this.run(
        "INSERT INTO workspace_categories VALUES(?,?,?)",
        v.entity_id,
        v.name,
        v.accounting_category,
      );
      this.audit(v.entity_id, a, "category.created", v.name, {
        accounting_category: v.accounting_category,
      });
      return v;
    });
  }
  createSpend(a: Actor, input: unknown) {
    const s = this.validateSpend(a, input);
    return this.tx(() => {
      const key = id("SP"),
        t = now();
      this.run(
        "INSERT INTO spends(id,entity_id,kind,vendor_id,description,purpose,amount_minor,currency,department,category,date,invoice_number,parent_id,status,requester_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        key,
        s.entity_id,
        s.kind,
        s.vendor_id,
        s.description,
        s.purpose,
        s.amount_minor,
        s.currency,
        s.department,
        s.category,
        s.date,
        s.invoice_number || null,
        s.parent_id || null,
        "draft",
        a.id,
        t,
        t,
      );
      this.run(
        `UPDATE spends SET ${expenseFields.map((k) => `${k}=?`).join(",")} WHERE id=?`,
        ...expenseFields.map((k) => s[k]),
        key,
      );
      this.audit(s.entity_id, a, "spend.created", key, {
        payment_source: s.payment_source,
        paid_by_id: s.paid_by_id,
        amount_minor: s.amount_minor,
        currency: s.currency,
        kind: s.kind,
      });
      return this.spend(a, key);
    });
  }
  updateSpend(a: Actor, spendId: string, input: any) {
    return this.tx(() => {
      const before = this.spend(a, spendId);
      if (
        before.requester_id !== a.id ||
        !["draft", "returned"].includes(before.status)
      )
        throw new DomainError(
          "Only the requester may edit a draft or returned expense",
          403,
        );
      const { expected_revision, ...values } = input;
      if (expected_revision !== before.revision)
        throw new DomainError(
          "This expense changed. Reopen it before editing again.",
          409,
        );
      const s = this.validateSpend(a, values);
      if (before.subscription_id && s.vendor_id !== before.vendor_id)
        throw new DomainError(
          "A linked subscription expense must retain its vendor",
        );
      if (
        before.claim_id &&
        (s.paid_by_id !== before.paid_by_id ||
          s.payment_source !== before.payment_source)
      )
        throw new DomainError(
          "Remove the expense from its draft claim before changing its payer",
        );
      if (
        s.entity_id !== before.entity_id ||
        s.kind !== before.kind ||
        (s.parent_id || null) !== before.parent_id
      )
        throw new DomainError(
          "Entity, record type and linked request cannot change",
        );
      const keys = Object.keys(s);
      const changes = Object.fromEntries(
        keys
          .filter((k) => (before[k] || "") !== ((s as any)[k] || ""))
          .map((k) => [k, { before: before[k], after: (s as any)[k] }]),
      );
      this.run(
        `UPDATE spends SET ${keys.map((k) => `${k}=?`).join(",")},revision=revision+1,updated_at=? WHERE id=?`,
        ...keys.map(
          (k) =>
            (s as any)[k] ||
            (k === "parent_id" || k === "invoice_number" ? null : ""),
        ),
        now(),
        spendId,
      );
      this.audit(s.entity_id, a, "spend.edited", spendId, { changes });
      return this.spend(a, spendId);
    });
  }
  private position(s: any) {
    const item = this.get(
      "SELECT claim_id FROM reimbursement_items WHERE spend_id=?",
      s.id,
    );
    const subscription = this.get(
      "SELECT sc.subscription_id,sc.due_date AS billing_date,sub.name AS subscription_name FROM subscription_charges sc JOIN subscriptions sub ON sub.id=sc.subscription_id WHERE sc.spend_id=?",
      s.id,
    );
    const adjusted = this.get(
      "SELECT COALESCE(SUM(amount_minor),0) AS n FROM expense_adjustments WHERE spend_id=? AND status='posted'",
      s.id,
    ).n;
    const pending = this.get(
      "SELECT COUNT(*) AS n FROM expense_adjustments WHERE spend_id=? AND status IN ('pending','verified')",
      s.id,
    ).n;
    const recovered = this.get(
      "SELECT COALESCE(SUM(p.amount_minor),0) AS n FROM recovery_payments p JOIN expense_adjustments ad ON ad.id=p.adjustment_id WHERE ad.spend_id=? AND p.status='posted'",
      s.id,
    ).n;
    const effective = s.amount_minor - adjusted;
    const totals = item
      ? this.get(
          `SELECT COALESCE(SUM(CASE WHEN p.status IN ('paid','reconciled','posted') THEN a.amount_minor ELSE 0 END),0) AS paid, COALESCE(SUM(CASE WHEN p.status='scheduled' THEN a.amount_minor ELSE 0 END),0) AS scheduled FROM reimbursement_allocations a JOIN reimbursement_payments p ON p.id=a.payment_id WHERE a.spend_id=?`,
          s.id,
        )
      : {
          paid: ["paid", "reconciled", "posted"].includes(s.status)
            ? (s.payment_amount_minor ?? s.amount_minor)
            : 0,
          scheduled: s.status === "scheduled" ? effective : 0,
        };
    // A fully credited unpaid item can be posted with zero cash movement.
    const paid = totals.paid;
    const position = expensePosition(s);
    const outstanding =
      s.status === "rejected" ||
      s.kind === "request" ||
      (s.payment_source === "company" && s.original_paid_date)
        ? 0
        : Math.max(0, effective - paid);
    return {
      ...s,
      ...position,
      ...subscription,
      ...(item ? { claim_id: item.claim_id } : {}),
      adjustment_minor: adjusted,
      pending_adjustments: pending,
      effective_amount_minor: effective,
      reimbursed_minor: s.payment_source !== "company" ? paid : 0,
      settled_minor: paid,
      recovered_minor: recovered,
      scheduled_minor: totals.scheduled,
      outstanding_minor: outstanding,
      recoverable_minor:
        s.payment_source !== "company"
          ? Math.max(0, paid - effective - recovered)
          : 0,
      settlement_status:
        adjusted > 0
          ? paid > effective + recovered
            ? "Refund due back to Jaye"
            : outstanding === 0
              ? "Settled after adjustment"
              : "Partially credited / refunded"
          : item && paid > 0
            ? outstanding === 0
              ? "Reimbursed"
              : "Partially reimbursed"
            : position.settlement_status,
    };
  }
  pendingAdjustment(spendId: string) {
    return this.get(
      "SELECT id FROM expense_adjustments WHERE spend_id=? AND status IN ('pending','verified')",
      spendId,
    );
  }

  claim(a: Actor, claimId: string) {
    const c = this.get(
      "SELECT c.*,u.name AS claimant FROM reimbursement_claims c JOIN users u ON u.id=c.claimant_id WHERE c.id=?",
      claimId,
    );
    if (!c) throw new DomainError("Claim not found", 404);
    this.authorize(a, c.entity_id);
    if (
      a.role === "employee" &&
      c.requester_id !== a.id &&
      c.claimant_id !== a.id
    )
      throw new DomainError("You may only view your own claims", 403);
    const items = this.all(
      "SELECT s.*,v.name AS vendor FROM spends s JOIN reimbursement_items i ON i.spend_id=s.id JOIN vendors v ON v.id=s.vendor_id WHERE i.claim_id=? ORDER BY s.date,s.id",
      c.id,
    ).map((s) => this.position(s));
    const payments = this.all(
      "SELECT p.*,m.bank_transaction_id,b.reference AS statement_reference FROM reimbursement_payments p LEFT JOIN reimbursement_matches m ON m.payment_id=p.id LEFT JOIN bank_transactions b ON b.id=m.bank_transaction_id WHERE p.claim_id=? ORDER BY p.created_at,p.id",
      c.id,
    );
    const total = items.reduce((n, s) => n + s.amount_minor, 0);
    const paid = payments
      .filter((p) => ["paid", "reconciled", "posted"].includes(p.status))
      .reduce((n, p) => n + p.amount_minor, 0);
    const scheduled = payments
      .filter((p) => p.status === "scheduled")
      .reduce((n, p) => n + p.amount_minor, 0);
    return {
      ...c,
      items,
      payments,
      currency: items[0]?.currency,
      total_minor: total,
      reimbursed_minor: paid,
      scheduled_minor: scheduled,
      adjustment_minor: items.reduce((n, s) => n + s.adjustment_minor, 0),
      effective_amount_minor: items.reduce(
        (n, s) => n + s.effective_amount_minor,
        0,
      ),
      recoverable_minor: items.reduce((n, s) => n + s.recoverable_minor, 0),
      pending_adjustments: items.some((s) => s.pending_adjustments),
      outstanding_minor:
        c.status === "rejected"
          ? 0
          : items.reduce((n, s) => n + s.outstanding_minor, 0),
      available_minor:
        c.status === "approved" && !items.some((s) => s.pending_adjustments)
          ? Math.max(
              0,
              items.reduce((n, s) => n + s.outstanding_minor, 0) - scheduled,
            )
          : 0,
      settlement_status: items.every((s) => s.outstanding_minor === 0)
        ? items.some((s) => s.adjustment_minor > 0)
          ? "Settled after adjustment"
          : "Reimbursed"
        : paid > 0
          ? "Partially reimbursed"
          : c.status === "approved"
            ? "Awaiting reimbursement"
            : "Not yet approved",
      history: this.all(
        "SELECT a.*,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE resource_id=? ORDER BY a.id",
        c.id,
      ),
    };
  }
  reimbursements(a: Actor, entity: string) {
    this.authorize(a, entity);
    const claims = this.all(
      "SELECT id,requester_id,claimant_id FROM reimbursement_claims WHERE entity_id=? ORDER BY created_at DESC",
      entity,
    )
      .filter(
        (c) =>
          a.role !== "employee" ||
          c.requester_id === a.id ||
          c.claimant_id === a.id,
      )
      .map((c) => this.claim(a, c.id));
    const personal = this.list(a, entity).filter(
      (s) => s.payment_source !== "company" && s.kind !== "request",
    );
    const balances: Record<string, any> = {};
    for (const s of personal) {
      const person = (balances[s.paid_by_id] ||= {
        person_id: s.paid_by_id,
        name: this.actor(s.paid_by_id).name,
        pending_minor: 0,
        owed_minor: 0,
        scheduled_minor: 0,
        reimbursed_minor: 0,
        recoverable_minor: 0,
        oldest_date: null,
      });
      person.recoverable_minor += s.recoverable_minor;
      const approved = [
        "approved",
        "scheduled",
        "paid",
        "reconciled",
        "posted",
      ].includes(s.status);
      if (approved) {
        person.owed_minor += s.outstanding_minor;
        person.scheduled_minor += s.scheduled_minor || 0;
        if (
          s.outstanding_minor > 0 &&
          (!person.oldest_date || s.date < person.oldest_date)
        )
          person.oldest_date = s.date;
      } else if (s.status !== "rejected")
        person.pending_minor += s.amount_minor;
      person.reimbursed_minor += s.reimbursed_minor;
    }
    return {
      claims,
      balances: Object.values(balances),
      eligible: personal.filter(
        (s) =>
          s.requester_id === a.id &&
          !s.claim_id &&
          ["draft", "returned"].includes(s.status),
      ),
    };
  }
  saveClaim(a: Actor, input: unknown, claimId?: string) {
    const parsed = z
      .object({
        entity_id: z.enum(["ng", "inc"]),
        title: z.string().trim().min(3).max(180),
        spend_ids: z.array(z.string()).min(1).max(100),
        expected_revision: z.number().int().optional(),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new DomainError("Provide a title and 1–100 expense IDs");
    const v = parsed.data;
    this.authorize(a, v.entity_id, ["employee", "manager", "finance", "cfo"]);
    return this.tx(() => {
      const existing = claimId ? this.claim(a, claimId) : null;
      if (
        existing &&
        (existing.requester_id !== a.id ||
          !["draft", "returned"].includes(existing.status))
      )
        throw new DomainError(
          "Only the requester can edit draft or returned claims",
          403,
        );
      if (
        existing &&
        (existing.revision !== v.expected_revision ||
          existing.entity_id !== v.entity_id)
      )
        throw new DomainError("Claim changed. Reload before saving.", 409);
      if (new Set(v.spend_ids).size !== v.spend_ids.length)
        throw new DomainError("Each expense can appear only once");
      const items = v.spend_ids.map((id) => this.spend(a, id));
      const first = items[0];
      for (const s of items) {
        if (
          s.entity_id !== v.entity_id ||
          s.currency !== first.currency ||
          s.paid_by_id !== first.paid_by_id ||
          s.payment_source !== first.payment_source ||
          s.payment_source === "company" ||
          s.kind === "request" ||
          s.requester_id !== a.id ||
          !["draft", "returned"].includes(s.status)
        )
          throw new DomainError(
            "Choose your draft personal expenses for one person, payment source, entity and currency",
          );
        if (s.claim_id && s.claim_id !== claimId)
          throw new DomainError("An expense already belongs to another claim");
      }
      const key = claimId || id("CL");
      if (existing) {
        this.run(
          "UPDATE reimbursement_claims SET title=?,claimant_id=?,revision=revision+1,updated_at=? WHERE id=?",
          v.title,
          first.paid_by_id,
          now(),
          key,
        );
        this.run("DELETE FROM reimbursement_items WHERE claim_id=?", key);
      } else
        this.run(
          "INSERT INTO reimbursement_claims(id,entity_id,claimant_id,requester_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
          key,
          v.entity_id,
          first.paid_by_id,
          a.id,
          v.title,
          now(),
          now(),
        );
      for (const s of items)
        this.run("INSERT INTO reimbursement_items VALUES(?,?)", key, s.id);
      this.audit(
        v.entity_id,
        a,
        existing ? "claim.edited" : "claim.created",
        key,
        {
          title: v.title,
          spend_ids: v.spend_ids,
          previous_spend_ids: existing?.items.map((s: any) => s.id),
        },
      );
      return this.claim(a, key);
    });
  }
  claimAction(a: Actor, claimId: string, input: any) {
    const p = z
      .object({
        action: z.enum(["submit", "approve", "return", "reject"]),
        comment: z.string().max(1000).optional(),
      })
      .strict()
      .safeParse(input);
    if (!p.success) throw new DomainError("Invalid claim action");
    return this.tx(() => {
      const c = this.claim(a, claimId),
        { action, comment } = p.data;
      if (
        ["submit"].includes(action) &&
        !["draft", "returned"].includes(c.status)
      )
        throw new DomainError("Only draft or returned claims can be submitted");
      if (
        action !== "submit" &&
        !["manager_review", "finance_review", "cfo_review"].includes(c.status)
      )
        throw new DomainError("Claim is not awaiting review");
      for (const s of c.items) this.action(a, s.id, action, { comment }, c.id);
      let status = this.spend(a, c.items[0].id).status;
      if (action === "approve" && c.status === "finance_review") {
        const threshold = this.get(
          "SELECT cfo_threshold FROM policies WHERE entity_id=?",
          c.entity_id,
        ).cfo_threshold;
        if (
          c.total_minor >= threshold ||
          c.items.some((s: any) => this.spend(a, s.id).status === "cfo_review")
        ) {
          status = "cfo_review";
          for (const s of c.items)
            this.run("UPDATE spends SET status='cfo_review' WHERE id=?", s.id);
        }
      }
      this.run(
        "UPDATE reimbursement_claims SET status=?,revision=revision+1,updated_at=? WHERE id=?",
        status,
        now(),
        c.id,
      );
      this.audit(c.entity_id, a, `claim.${action}`, c.id, {
        from: c.status,
        to: status,
        comment,
        total_minor: c.total_minor,
      });
      return this.claim(a, c.id);
    });
  }
  scheduleRepayment(a: Actor, claimId: string, input: unknown) {
    const p = z
      .object({
        amount_minor: int,
        date: optionalDate.refine((v) => !!v, "Payment date required"),
      })
      .strict()
      .safeParse(input);
    if (!p.success)
      throw new DomainError(
        "Enter a positive repayment amount and valid payment date",
      );
    return this.tx(() => {
      const c = this.claim(a, claimId),
        v = p.data;
      this.authorize(a, c.entity_id, ["finance"]);
      if (a.id === c.claimant_id || a.id === c.requester_id)
        throw new DomainError(
          "A separate finance person must schedule the reimbursement",
          403,
        );
      if (
        c.pending_adjustments ||
        c.status !== "approved" ||
        v.amount_minor > c.available_minor
      )
        throw new DomainError(
          "Amount exceeds the approved, unscheduled balance",
        );
      // Recognize each approved expense once. Later repayments only reduce the payable.
      for (const s of c.items)
        this.postJournal(a, {
          entity_id: c.entity_id,
          date: s.date,
          description: s.description,
          source_id: s.id,
          idempotency_key: `${s.id}:expense`,
          approved_by: s.finance_id,
          lines: [
            {
              account: this.categoryAccount(s.entity_id, s.category),
              debit: s.amount_minor,
              credit: 0,
            },
            { account: "2100", debit: 0, credit: s.amount_minor },
          ],
        });
      const key = id("RP");
      this.run(
        "INSERT INTO reimbursement_payments(id,claim_id,entity_id,amount_minor,date,scheduled_by,created_at) VALUES(?,?,?,?,?,?,?)",
        key,
        c.id,
        c.entity_id,
        v.amount_minor,
        v.date,
        a.id,
        now(),
      );
      let remaining = v.amount_minor;
      for (const s of c.items) {
        const reserved = this.get(
          "SELECT COALESCE(SUM(a.amount_minor),0) AS total FROM reimbursement_allocations a JOIN reimbursement_payments p ON p.id=a.payment_id WHERE a.spend_id=? AND p.status<>'cancelled'",
          s.id,
        ).total;
        const amount = Math.min(
          remaining,
          Math.max(0, s.effective_amount_minor - reserved),
        );
        if (amount > 0) {
          this.run(
            "INSERT INTO reimbursement_allocations VALUES(?,?,?)",
            key,
            s.id,
            amount,
          );
          remaining -= amount;
        }
      }
      if (remaining !== 0) throw new DomainError("Repayment allocation failed");
      this.audit(c.entity_id, a, "claim.repayment_scheduled", c.id, {
        payment_id: key,
        ...v,
      });
      return this.claim(a, c.id);
    });
  }
  repaymentAction(a: Actor, paymentId: string, input: unknown) {
    const p = z
      .object({
        action: z.enum(["cancel", "confirm", "reconcile", "post"]),
        reference: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .safeParse(input);
    if (!p.success) throw new DomainError("Invalid repayment action");
    return this.tx(() => {
      const pay = this.get(
        "SELECT * FROM reimbursement_payments WHERE id=?",
        paymentId,
      );
      if (!pay) throw new DomainError("Repayment not found", 404);
      const c = this.claim(a, pay.claim_id),
        { action, reference } = p.data;
      this.authorize(
        a,
        c.entity_id,
        action === "confirm"
          ? ["payer"]
          : action === "reconcile"
            ? ["reconciler"]
            : ["finance"],
      );
      const reviewers = c.items.flatMap((s: any) => [
        s.requester_id,
        s.manager_id,
        s.finance_id,
        s.cfo_id,
      ]);
      if (
        a.id === c.claimant_id ||
        a.id === c.requester_id ||
        (["confirm", "reconcile"].includes(action) &&
          [...reviewers, pay.scheduled_by, pay.payer_id].includes(a.id))
      )
        throw new DomainError(
          "Separation of duties: beneficiary, reviewers, releaser and reconciler must differ",
          403,
        );
      const expected = {
        cancel: "scheduled",
        confirm: "scheduled",
        reconcile: "paid",
        post: "reconciled",
      }[action];
      if (pay.status !== expected)
        throw new DomainError("Repayment is not ready for this action");
      let status = "";
      if (action === "cancel") status = "cancelled";
      if (action === "confirm") {
        if (!reference) throw new DomainError("Provide the bank reference");
        if (
          this.get(
            "SELECT id FROM spends WHERE entity_id=? AND payment_reference=?",
            c.entity_id,
            reference,
          ) ||
          this.get(
            "SELECT id FROM reimbursement_payments WHERE entity_id=? AND reference=?",
            c.entity_id,
            reference,
          )
        )
          throw new DomainError("Payment reference has already been used");
        if (
          this.get(
            "SELECT id FROM (SELECT id,entity_id,reference FROM bookkeeping_payments UNION ALL SELECT id,entity_id,reference FROM bookkeeping_refunds) WHERE entity_id=? AND reference=?",
            c.entity_id,
            reference,
          )
        )
          throw new DomainError("Payment reference has already been used");
        this.run(
          "UPDATE reimbursement_payments SET payer_id=?,reference=? WHERE id=?",
          a.id,
          reference,
          pay.id,
        );
        status = "paid";
      }
      if (action === "reconcile") {
        if (!reference)
          throw new DomainError("Select an imported statement reference");
        const bank = this.get(
          "SELECT * FROM bank_transactions WHERE entity_id=? AND reference=?",
          c.entity_id,
          reference,
        );
        if (
          !bank ||
          bank.direction !== "debit" ||
          bank.matched_spend_id ||
          this.get(
            "SELECT bank_transaction_id FROM bookkeeping_bank_matches WHERE bank_transaction_id=?",
            bank.id,
          ) ||
          bank.currency !== c.currency ||
          bank.amount_minor !== pay.amount_minor ||
          this.get(
            "SELECT payment_id FROM reimbursement_matches WHERE bank_transaction_id=?",
            bank.id,
          )
        )
          throw new DomainError(
            "Use an unmatched statement debit with the exact entity, currency and repayment amount",
          );
        this.run(
          "INSERT INTO reimbursement_matches VALUES(?,?)",
          bank.id,
          pay.id,
        );
        this.run(
          "UPDATE reimbursement_payments SET reconciler_id=? WHERE id=?",
          a.id,
          pay.id,
        );
        status = "reconciled";
      }
      if (action === "post") {
        const allocations = this.all(
          "SELECT * FROM reimbursement_allocations WHERE payment_id=?",
          pay.id,
        );
        for (const row of allocations) {
          const s = c.items.find((s: any) => s.id === row.spend_id)!;
          this.postJournal(a, {
            entity_id: c.entity_id,
            date: pay.date,
            description: `Reimbursement · ${c.title}`,
            source_id: s.id,
            idempotency_key: `${pay.id}:${s.id}:settlement`,
            approved_by: s.finance_id,
            lines: [
              { account: "2100", debit: row.amount_minor, credit: 0 },
              { account: "1100", debit: 0, credit: row.amount_minor },
            ],
          });
        }
        status = "posted";
      }
      this.run(
        "UPDATE reimbursement_payments SET status=? WHERE id=?",
        status,
        pay.id,
      );
      if (status === "posted")
        for (const s of c.items) {
          const total = this.get(
            "SELECT COALESCE(SUM(a.amount_minor),0) AS total FROM reimbursement_allocations a JOIN reimbursement_payments p ON p.id=a.payment_id WHERE a.spend_id=? AND p.status='posted'",
            s.id,
          ).total;
          if (total >= s.effective_amount_minor)
            this.run(
              "UPDATE spends SET status='posted',updated_at=? WHERE id=?",
              now(),
              s.id,
            );
        }
      this.audit(c.entity_id, a, `claim.repayment_${action}`, c.id, {
        payment_id: pay.id,
        amount_minor: pay.amount_minor,
        reference,
      });
      return this.claim(a, c.id);
    });
  }

  warnings(s: any) {
    const out: string[] = [];
    if (
      s.kind !== "request" &&
      !this.get("SELECT id FROM receipts WHERE spend_id=?", s.id)
    )
      out.push("Receipt or invoice required before submission");
    if (
      this.get(
        "SELECT id FROM spends WHERE entity_id=? AND vendor_id=? AND amount_minor=? AND date=? AND id<>? AND status<>'rejected'",
        s.entity_id,
        s.vendor_id,
        s.amount_minor,
        s.date,
        s.id,
      )
    )
      out.push("Possible duplicate: same vendor, amount and date");
    const sameReceipt = this.get(
      "SELECT r.id FROM receipts r JOIN receipts other ON other.hash=r.hash AND other.spend_id<>r.spend_id AND other.entity_id=r.entity_id WHERE r.spend_id=?",
      s.id,
    );
    if (sameReceipt) out.push("Duplicate receipt content detected");
    if ([0, 6].includes(new Date(`${s.date}T12:00:00Z`).getUTCDay()))
      out.push("Weekend transaction — confirm business purpose");
    if (
      this.get("SELECT related_party FROM vendors WHERE id=?", s.vendor_id)
        ?.related_party
    )
      out.push("Related-party vendor — independent review required");
    if (s.category === "Government fees")
      out.push(
        "Government payment gated: legal basis and official-payment control pack not configured",
      );
    const budget = this.budgetsRaw(s.entity_id).find(
      (b) =>
        b.department === s.department &&
        b.category === s.category &&
        b.period === s.date.slice(0, 7),
    );
    if (!budget) out.push("No matching budget line — CFO approval required");
    else if (
      budget.remaining_minor < s.amount_minor &&
      ![
        "approved",
        "scheduled",
        "paid",
        "reconciled",
        "posted",
        "closed",
      ].includes(s.status)
    )
      out.push("Budget exceeded — CFO approval required");
    return out;
  }
  upload(
    a: Actor,
    spendId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    const s = this.spend(a, spendId);
    if (s.requester_id !== a.id || !["draft", "returned"].includes(s.status))
      throw new DomainError(
        "Only the requester can add evidence to a draft or returned spend",
        403,
      );
    if (
      !file ||
      file.buffer.length > 8 * 1024 * 1024 ||
      file.buffer.length === 0
    )
      throw new DomainError("Upload a PDF, PNG or JPEG under 8 MB");
    const b = file.buffer;
    const mime =
      b.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : b
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "image/png"
          : b[0] === 255 && b[1] === 216 && b[2] === 255
            ? "image/jpeg"
            : null;
    if (!mime || mime !== file.mimetype)
      throw new DomainError(
        "File signature must match PDF, PNG or JPEG MIME type",
      );
    const attached = this.get(
      "SELECT id FROM receipts WHERE spend_id=? AND hash=?",
      s.id,
      hash(b),
    );
    if (attached) return { id: attached.id };
    return this.tx(() => {
      const rid = id("RC"),
        path = join(this.dir, `${rid}.enc`),
        iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", this.key, iv);
      const encrypted = Buffer.concat([cipher.update(b), cipher.final()]);
      writeFileSync(path, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), {
        mode: 0o600,
      });
      this.run(
        "INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?)",
        rid,
        s.entity_id,
        s.id,
        file.originalname.replace(/[^\w. -]/g, "_").slice(0, 100),
        mime,
        hash(b),
        path,
        0,
        now(),
      );
      this.audit(s.entity_id, a, "evidence.attached", s.id, {
        receipt_id: rid,
        sha256: hash(b),
      });
      return { id: rid };
    });
  }
  receipt(a: Actor, receiptId: string) {
    const r = this.get("SELECT * FROM receipts WHERE id=?", receiptId);
    if (!r) throw new DomainError("Receipt not found", 404);
    this.spend(a, r.spend_id);
    const b = readFileSync(r.storage_path),
      decipher = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    decipher.setAuthTag(b.subarray(12, 28));
    const content = Buffer.concat([
      decipher.update(b.subarray(28)),
      decipher.final(),
    ]);
    this.audit(r.entity_id, a, "evidence.downloaded", r.spend_id, {
      receipt_id: r.id,
    });
    return {
      ...r,
      ...(r.synthetic &&
      content.subarray(0, 20).toString().startsWith("%PDF-1.4\n% SYNTHETIC")
        ? {
            mime: "text/plain",
            filename: r.filename.replace(".pdf", ".fixture.txt"),
          }
        : {}),
      content,
    };
  }
  action(
    a: Actor,
    spendId: string,
    action: string,
    input: { comment?: string; reference?: string } = {},
    claimContext?: string,
  ) {
    return this.tx(() => {
      const s = this.spend(a, spendId);
      if (s.claim_id && s.claim_id !== claimContext)
        throw new DomainError(
          "Manage this expense through its reimbursement claim",
        );
      const roles: Record<string, string[]> = {
        submit: ["employee", "manager", "finance", "cfo"],
        approve: ["manager", "finance", "cfo"],
        return: ["manager", "finance", "cfo"],
        reject: ["manager", "finance", "cfo"],
        schedule: ["finance"],
        confirm: ["payer"],
        reconcile: ["reconciler"],
        post: ["finance"],
      };
      if (!roles[action]) throw new DomainError("Unknown workflow action");
      this.authorize(a, s.entity_id, roles[action]);
      let next = s.status;
      const updates: Record<string, any> = {};
      const allActors = [
        s.requester_id,
        s.paid_by_id,
        s.manager_id,
        s.finance_id,
        s.cfo_id,
        s.payer_id,
        s.reconciler_id,
      ].filter(Boolean);
      if (
        action !== "submit" &&
        allActors.includes(a.id) &&
        !(
          ["post", "schedule"].includes(action) &&
          a.id === s.finance_id &&
          a.id !== s.paid_by_id
        )
      )
        throw new DomainError(
          "Separation of duties: requester, reviewers, payer and reconciler must be different people",
          403,
        );
      if (action === "submit") {
        if (
          s.requester_id !== a.id ||
          !["draft", "returned"].includes(s.status)
        )
          throw new DomainError("Only the requester may submit a draft");
        const w = this.warnings(s);
        if (
          w.some(
            (v) =>
              v.startsWith("Receipt") ||
              v.startsWith("Duplicate receipt") ||
              v.startsWith("Possible duplicate") ||
              v.startsWith("Government payment"),
          )
        )
          throw new DomainError(w.join("; "));
        updates.manager_id = null;
        updates.finance_id = null;
        updates.cfo_id = null;
        next = "manager_review";
      } else if (action === "approve") {
        const expected: Record<string, string> = {
          manager_review: "manager",
          finance_review: "finance",
          cfo_review: "cfo",
        };
        if (expected[s.status] !== a.role)
          throw new DomainError("This item is not waiting for your approval");
        if (s.status === "manager_review") {
          next = "finance_review";
          updates.manager_id = a.id;
        } else if (s.status === "finance_review") {
          const threshold = this.get(
            "SELECT cfo_threshold FROM policies WHERE entity_id=?",
            s.entity_id,
          ).cfo_threshold;
          next =
            s.amount_minor >= threshold ||
            this.warnings(s).some(
              (w) => w.includes("CFO") || w.includes("Related-party"),
            )
              ? "cfo_review"
              : "approved";
          updates.finance_id = a.id;
        } else {
          next = "approved";
          updates.cfo_id = a.id;
        }
      } else if (action === "return" || action === "reject") {
        const expected: Record<string, string> = {
          manager_review: "manager",
          finance_review: "finance",
          cfo_review: "cfo",
        };
        if (expected[s.status] !== a.role)
          throw new DomainError("This item is not awaiting your review");
        if (!input.comment?.trim())
          throw new DomainError("A reason is required");
        next = action === "return" ? "returned" : "rejected";
      } else if (action === "schedule") {
        if (s.status !== "approved" || s.kind === "request")
          throw new DomainError(
            "Only approved expenses or bills can enter a payment run",
          );
        if (this.pendingAdjustment(s.id))
          throw new DomainError(
            "Resolve the pending credit note or personal refund before scheduling payment",
          );
        if (s.effective_amount_minor <= 0)
          throw new DomainError("This expense has no amount left to pay");
        if (!this.get("SELECT id FROM receipts WHERE spend_id=?", s.id))
          throw new DomainError("Evidence is required");
        next = "scheduled";
      } else if (action === "confirm") {
        if (s.status !== "scheduled")
          throw new DomainError(
            "Schedule an approved payment before confirming",
          );
        if (!input.reference?.trim() || input.reference.length > 120)
          throw new DomainError(
            "A synthetic bank confirmation reference is required",
          );
        if (
          s.payment_source === "company" &&
          s.original_paid_date &&
          input.reference.trim() !== s.original_payment_reference
        )
          throw new DomainError(
            "Verify the recorded company payment using its original reference; do not pay it again",
          );
        if (
          this.get(
            "SELECT id FROM reimbursement_payments WHERE entity_id=? AND reference=?",
            s.entity_id,
            input.reference.trim(),
          )
        )
          throw new DomainError("Payment reference has already been used");
        if (
          this.get(
            "SELECT id FROM (SELECT id,entity_id,reference FROM bookkeeping_payments UNION ALL SELECT id,entity_id,reference FROM bookkeeping_refunds) WHERE entity_id=? AND reference=?",
            s.entity_id,
            input.reference.trim(),
          )
        )
          throw new DomainError("Payment reference has already been used");
        updates.payment_amount_minor = s.effective_amount_minor;
        updates.payment_reference = input.reference.trim();
        updates.payer_id = a.id;
        next = "paid";
      } else if (action === "reconcile") {
        if (s.status !== "paid")
          throw new DomainError("Only confirmed payments can be reconciled");
        if (!input.reference?.trim() || input.reference.length > 120)
          throw new DomainError("Enter the synthetic statement row reference");
        const row = this.get(
          "SELECT * FROM bank_transactions WHERE entity_id=? AND reference=?",
          s.entity_id,
          input.reference.trim(),
        );
        if (
          !row ||
          row.direction !== "debit" ||
          row.matched_spend_id ||
          this.get(
            "SELECT bank_transaction_id FROM bookkeeping_bank_matches WHERE bank_transaction_id=?",
            row.id,
          ) ||
          this.get(
            "SELECT payment_id FROM reimbursement_matches WHERE bank_transaction_id=?",
            row.id,
          ) ||
          row.currency !== s.currency ||
          row.amount_minor !==
            (s.payment_amount_minor ?? s.effective_amount_minor)
        )
          throw new DomainError(
            "Import an unmatched statement debit with the same entity, currency and amount before reconciling",
          );
        this.run(
          "UPDATE bank_transactions SET matched_spend_id=? WHERE id=?",
          s.id,
          row.id,
        );
        updates.reconciliation_reference = input.reference.trim();
        updates.reconciler_id = a.id;
        next = "reconciled";
      } else if (action === "post") {
        if (s.status !== "reconciled")
          throw new DomainError("Reconcile the payment before final posting");
        const account = this.categoryAccount(s.entity_id, s.category);
        this.postJournal(a, {
          entity_id: s.entity_id,
          date: s.date,
          description: s.description,
          source_id: s.id,
          idempotency_key: `${s.id}:expense`,
          approved_by: s.finance_id,
          lines: [
            { account, debit: s.amount_minor, credit: 0 },
            { account: "2100", debit: 0, credit: s.amount_minor },
          ],
        });
        this.postJournal(a, {
          entity_id: s.entity_id,
          date: s.date,
          description: `Settlement · ${s.description}`,
          source_id: s.id,
          idempotency_key: `${s.id}:settlement`,
          approved_by: s.finance_id,
          lines: [
            {
              account: "2100",
              debit: s.payment_amount_minor ?? s.effective_amount_minor,
              credit: 0,
            },
            {
              account: "1100",
              debit: 0,
              credit: s.payment_amount_minor ?? s.effective_amount_minor,
            },
          ],
        });
        next = "posted";
      }
      if (next === s.status) throw new DomainError("Invalid transition");
      const cols = Object.keys(updates);
      this.run(
        `UPDATE spends SET status=?,updated_at=?${cols.map((k) => `,${k}=?`).join("")} WHERE id=?`,
        next,
        now(),
        ...Object.values(updates),
        s.id,
      );
      this.audit(s.entity_id, a, `spend.${action}`, s.id, {
        from: s.status,
        to: next,
        ...input,
      });
      return this.spend(a, s.id);
    });
  }
  postJournal(a: Actor, j: any): any {
    return this.tx(() => this.postJournalInternal(a, j));
  }
  private postJournalInternal(a: Actor, j: any) {
    this.authorize(a, j.entity_id, ["finance"]);
    const existing = this.get(
      "SELECT * FROM journals WHERE entity_id=? AND idempotency_key=?",
      j.entity_id,
      j.idempotency_key,
    );
    if (existing) return existing;
    if (!j.approved_by || j.lines.length < 2)
      throw new DomainError("An approved journal requires at least two lines");
    if (
      this.get(
        "SELECT status FROM periods WHERE entity_id=? AND period=?",
        j.entity_id,
        j.date.slice(0, 7),
      )?.status !== "open"
    )
      throw new DomainError("Posting period is not open");
    let debit = 0n,
      credit = 0n;
    for (const l of j.lines) {
      if (
        !Number.isSafeInteger(l.debit) ||
        !Number.isSafeInteger(l.credit) ||
        l.debit < 0 ||
        l.credit < 0 ||
        (l.debit === 0) === (l.credit === 0)
      )
        throw new DomainError(
          "Journal lines require positive integer minor units on exactly one side",
        );
      if (
        !this.get(
          "SELECT code FROM accounts WHERE entity_id=? AND code=? AND active=1",
          j.entity_id,
          l.account,
        )
      )
        throw new DomainError(
          "Account is inactive or belongs to another entity",
        );
      debit += BigInt(l.debit);
      credit += BigInt(l.credit);
    }
    if (debit !== credit || debit > BigInt(Number.MAX_SAFE_INTEGER))
      throw new DomainError(
        "Journal is unbalanced or exceeds safe minor-unit limits",
      );
    const year = j.date.slice(0, 4),
      num =
        (this.get(
          "SELECT MAX(number) AS n FROM journals WHERE entity_id=? AND year=?",
          j.entity_id,
          year,
        )?.n || 0) + 1;
    const jid = id("JE");
    this.run(
      "INSERT INTO journals(id,entity_id,number,year,date,description,source_id,idempotency_key,posted_by,approved_by,reversal_of,posted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      jid,
      j.entity_id,
      num,
      year,
      j.date,
      j.description,
      j.source_id || null,
      j.idempotency_key,
      a.id,
      j.approved_by,
      j.reversal_of || null,
      now(),
    );
    for (const l of j.lines)
      this.run(
        "INSERT INTO lines(journal_id,entity_id,account,debit,credit) VALUES(?,?,?,?,?)",
        jid,
        j.entity_id,
        l.account,
        l.debit,
        l.credit,
      );
    this.run("UPDATE journals SET status='posted' WHERE id=?", jid);
    this.audit(j.entity_id, a, "journal.posted", j.source_id || jid, {
      journal_id: jid,
      number: num,
    });
    return this.get("SELECT * FROM journals WHERE id=?", jid);
  }
  journals(a: Actor, entity: string) {
    this.authorize(a, entity, ["finance", "cfo", "auditor", "reconciler"]);
    return this.all(
      "SELECT * FROM journals WHERE entity_id=? AND status='posted' ORDER BY number DESC",
      entity,
    ).map((j) => ({
      ...j,
      lines: this.all(
        "SELECT lines.*,accounts.name AS account_name FROM lines JOIN accounts ON accounts.entity_id=lines.entity_id AND accounts.code=lines.account WHERE journal_id=?",
        j.id,
      ),
    }));
  }
  trialBalance(a: Actor, entity: string) {
    this.authorize(a, entity, ["finance", "cfo", "auditor", "reconciler"]);
    return this.all(
      "SELECT a.code,a.name,a.type,COALESCE(SUM(l.debit),0) AS debit,COALESCE(SUM(l.credit),0) AS credit,COALESCE(SUM(l.debit-l.credit),0) AS balance FROM accounts a LEFT JOIN lines l ON l.entity_id=a.entity_id AND l.account=a.code AND l.journal_id IN (SELECT id FROM journals WHERE status='posted') WHERE a.entity_id=? GROUP BY a.code ORDER BY a.code",
      entity,
    );
  }
  budgetsRaw(entity: string, includeArchived = false) {
    return this.all(
      `SELECT b.*,COALESCE(m.revision,0) revision,COALESCE(m.archived,0) archived,m.updated_at,COALESCE((SELECT SUM(s.amount_minor) FROM spends s WHERE s.entity_id=b.entity_id AND s.department=b.department AND s.category=b.category AND substr(s.date,1,7)=b.period AND s.status IN ('approved','scheduled','paid','reconciled') AND NOT EXISTS(SELECT 1 FROM journals j WHERE j.source_id=s.id AND j.idempotency_key=s.id||':expense' AND j.status='posted') AND NOT EXISTS(SELECT 1 FROM spends child WHERE child.parent_id=s.id AND child.status IN ('approved','scheduled','paid','reconciled','posted'))),0) AS committed_minor,COALESCE((SELECT SUM(l.debit-l.credit) FROM lines l JOIN journals j ON j.id=l.journal_id JOIN spends s ON s.id=j.source_id JOIN accounts a ON a.entity_id=l.entity_id AND a.code=l.account WHERE s.entity_id=b.entity_id AND s.department=b.department AND s.category=b.category AND substr(j.date,1,7)=b.period AND j.status='posted' AND a.type='expense'),0) AS actual_minor FROM budgets b LEFT JOIN budget_meta m ON m.budget_id=b.id WHERE b.entity_id=? AND (?=1 OR COALESCE(m.archived,0)=0) ORDER BY b.period DESC,b.department,b.category`,
      entity,
      includeArchived ? 1 : 0,
    ).map((b) => {
      const recorded = this.get(
        "SELECT COALESCE(SUM(amount_minor),0) AS total FROM bookkeeping_records WHERE entity_id=? AND department=? AND category=? AND substr(date,1,7)=? AND voided=0",
        entity,
        b.department,
        b.category,
        b.period,
      ).total;
      const refunded = this.get(
        "SELECT COALESCE(SUM(f.amount_minor),0) AS total FROM bookkeeping_refunds f JOIN bookkeeping_records r ON r.id=f.record_id WHERE f.entity_id=? AND r.department=? AND r.category=? AND substr(f.date,1,7)=? AND f.voided=0",
        entity,
        b.department,
        b.category,
        b.period,
      ).total;
      return {
        ...b,
        actual_minor: b.actual_minor + recorded - refunded,
        remaining_minor:
          b.amount_minor -
          b.committed_minor -
          b.actual_minor -
          recorded +
          refunded,
      };
    });
  }
  budgets(a: Actor, entity: string) {
    this.authorize(a, entity, ["manager", "finance", "cfo", "auditor"]);
    return this.budgetsRaw(entity);
  }
  vendors(a: Actor, entity: string) {
    this.authorize(a, entity);
    return this.all(
      "SELECT * FROM vendors WHERE entity_id=? ORDER BY name",
      entity,
    );
  }
  createVendor(a: Actor, input: any) {
    this.authorize(a, input.entity_id, ["finance"]);
    const p = z
      .object({
        entity_id: z.enum(["inc", "ng"]),
        name: z.string().trim().min(2).max(120),
        category: z.string().max(60),
        related_party: z.boolean().default(false),
      })
      .strict()
      .safeParse(input);
    if (!p.success)
      throw new DomainError("Provide a valid vendor name, entity and category");
    return this.tx(() => {
      const v = p.data,
        vid = id("VN");
      if (
        this.get(
          "SELECT id FROM vendors WHERE entity_id=? AND lower(trim(name))=lower(?)",
          v.entity_id,
          v.name,
        )
      )
        throw new DomainError(
          "This vendor is already saved. Select the existing vendor in Expenses.",
        );
      this.run(
        "INSERT INTO vendors VALUES(?,?,?,?,?,?)",
        vid,
        v.entity_id,
        v.name,
        v.category,
        v.related_party ? 1 : 0,
        "review_required",
      );
      this.audit(v.entity_id, a, "vendor.created", vid);
      return this.get("SELECT * FROM vendors WHERE id=?", vid);
    });
  }
  dashboard(a: Actor, entity: string) {
    this.authorize(a, entity, [
      "manager",
      "finance",
      "cfo",
      "auditor",
      "payer",
      "reconciler",
    ]);
    const spends = this.list(a, entity);
    const totals = this.get(
      "SELECT COALESCE(SUM(CASE WHEN account IN ('1100','1010') THEN debit-credit ELSE 0 END),0) AS cash_minor,COALESCE(SUM(CASE WHEN account LIKE '6%' THEN debit-credit ELSE 0 END),0) AS spend_minor FROM lines WHERE entity_id=? AND journal_id IN (SELECT id FROM journals WHERE status='posted')",
      entity,
    );
    const budgets = this.budgetsRaw(entity);
    const documented = this.all(
      "SELECT r.*,r.amount_minor-COALESCE((SELECT SUM(f.amount_minor) FROM bookkeeping_refunds f WHERE f.record_id=r.id AND f.voided=0),0) AS amount_minor,r.amount_minor-COALESCE((SELECT SUM(p.amount_minor) FROM bookkeeping_payments p WHERE p.record_id=r.id AND p.voided=0),0) AS outstanding_minor FROM bookkeeping_records r WHERE r.entity_id=? AND r.voided=0 ORDER BY r.date DESC,r.created_at DESC",
      entity,
    );
    return {
      documented_recent: documented.slice(0, 6),
      record_summary: {
        owed_minor: documented.reduce((n, r) => n + r.outstanding_minor, 0),
        salary_owed_minor: documented
          .filter((r) => r.kind === "salary")
          .reduce((n, r) => n + r.outstanding_minor, 0),
      },
      ...totals,
      pending: spends.filter((s) =>
        ["manager_review", "finance_review", "cfo_review"].includes(s.status),
      ).length,
      committed_minor: budgets.reduce((n, b) => n + b.committed_minor, 0),
      budget_minor: budgets.reduce((n, b) => n + b.amount_minor, 0),
      unreconciled:
        spends.filter((s) => s.status === "paid").length +
        this.get(
          "SELECT COUNT(*) AS n FROM reimbursement_payments WHERE entity_id=? AND status='paid'",
          entity,
        ).n,
      recent: spends.slice(0, 6),
      by_category: Object.keys(categories).map((category) => ({
        category,
        amount_minor: this.get(
          "SELECT COALESCE(SUM(debit-credit),0) AS total FROM lines WHERE entity_id=? AND account=? AND journal_id IN (SELECT id FROM journals WHERE status='posted')",
          entity,
          categories[category],
        ).total,
      })),
      activity: this.all(
        "SELECT a.*,u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id WHERE entity_id=? ORDER BY a.id DESC LIMIT 6",
        entity,
      ),
    };
  }
  auditLog(a: Actor, entity: string) {
    this.authorize(a, entity, ["finance", "cfo", "auditor"]);
    return {
      valid: this.verifyAudit(),
      events: this.all(
        "SELECT a.*,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE entity_id=? ORDER BY a.id DESC LIMIT 200",
        entity,
      ),
    };
  }
  bankTransactions(a: Actor, entity: string) {
    this.authorize(a, entity, ["finance", "reconciler", "auditor", "cfo"]);
    return this.all(
      "SELECT b.*,m.payment_id AS matched_repayment_id,r.id AS matched_refund_id,rc.id AS matched_recovery_id,bm.payment_id AS matched_record_payment_id,bm.refund_id AS matched_record_refund_id FROM bank_transactions b LEFT JOIN reimbursement_matches m ON m.bank_transaction_id=b.id LEFT JOIN refunds r ON r.bank_transaction_id=b.id LEFT JOIN recovery_payments rc ON rc.bank_transaction_id=b.id LEFT JOIN bookkeeping_bank_matches bm ON bm.bank_transaction_id=b.id WHERE b.entity_id=? ORDER BY b.date DESC",
      entity,
    );
  }
  importStatement(a: Actor, entity: string, content: string) {
    this.authorize(a, entity, ["finance", "reconciler"]);
    if (typeof content !== "string" || content.length > 1024 * 1024)
      throw new DomainError("Statement CSV must be under 1 MB");
    let rows: any[];
    try {
      rows = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } catch {
      throw new DomainError("Invalid CSV");
    }
    if (rows.length === 0 || rows.length > 1000)
      throw new DomainError("Import between 1 and 1,000 statement rows");
    const currency = this.get(
      "SELECT currency FROM entities WHERE id=?",
      entity,
    ).currency;
    return this.tx(() => {
      let added = 0;
      for (const row of rows) {
        const p = z
          .object({
            reference: z.string().min(1).max(120),
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .refine(
                (v) =>
                  !isNaN(Date.parse(v)) &&
                  new Date(v).toISOString().slice(0, 10) === v,
              ),
            currency: z.literal(currency),
            amount_minor: z.string().regex(/^[1-9]\d{0,11}$/),
            description: z.string().max(300),
            direction: z.enum(["debit", "credit"]).default("debit"),
          })
          .strict()
          .safeParse(row);
        if (!p.success)
          throw new DomainError(
            "CSV columns: reference,date,currency,amount_minor,description. Optional direction: debit or credit (defaults to debit). Use positive integer minor units in entity currency.",
          );
        const r = p.data,
          existing = this.get(
            "SELECT * FROM bank_transactions WHERE entity_id=? AND reference=?",
            entity,
            r.reference,
          );
        if (existing) {
          if (
            existing.direction !== r.direction ||
            existing.amount_minor !== Number(r.amount_minor) ||
            existing.currency !== r.currency ||
            existing.date !== r.date ||
            existing.description !== r.description
          )
            throw new DomainError(
              "An existing statement reference has different contents",
            );
          continue;
        }
        this.run(
          "INSERT INTO bank_transactions(id,entity_id,reference,date,currency,amount_minor,description,matched_spend_id,imported_by,created_at,direction) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          id("BT"),
          entity,
          r.reference,
          r.date,
          r.currency,
          Number(r.amount_minor),
          r.description,
          null,
          a.id,
          now(),
          r.direction,
        );
        added++;
      }
      this.audit(entity, a, "bank.statement_imported", entity, {
        added,
        rows: rows.length,
        synthetic: true,
      });
      return { added, skipped: rows.length - added };
    });
  }
  paymentFile(a: Actor, entity: string) {
    this.authorize(a, entity, ["finance", "payer"]);
    const rows = this.all(
      "SELECT s.id,s.currency,(s.amount_minor-COALESCE((SELECT SUM(amount_minor) FROM expense_adjustments WHERE spend_id=s.id AND status='posted'),0)) AS amount_minor,s.description,CASE WHEN s.payment_source='company' THEN v.name ELSE u.name END AS payee FROM spends s JOIN vendors v ON v.id=s.vendor_id LEFT JOIN users u ON u.id=s.paid_by_id WHERE s.entity_id=? AND s.status='scheduled' AND NOT EXISTS(SELECT 1 FROM reimbursement_items i WHERE i.spend_id=s.id) AND NOT(s.payment_source='company' AND s.original_paid_date<>'')",
      entity,
    );
    rows.push(
      ...this.all(
        "SELECT p.id,e.currency,p.amount_minor,c.title AS description,u.name AS payee FROM reimbursement_payments p JOIN reimbursement_claims c ON c.id=p.claim_id JOIN users u ON u.id=c.claimant_id JOIN entities e ON e.id=p.entity_id WHERE p.entity_id=? AND p.status='scheduled'",
        entity,
      ),
    );
    this.audit(entity, a, "payment.test_file_exported", entity, {
      count: rows.length,
    });
    return csv(
      ["mode", "id", "currency", "amount_minor", "payee", "description"],
      rows.map((r) => [
        "SYNTHETIC_NOT_BANK_EXECUTABLE",
        r.id,
        r.currency,
        r.amount_minor,
        r.payee,
        r.description,
      ]),
    );
  }
  seedEmpty() {
    this.tx(() => {
      for (const entity of [
        ["inc", "GoJaye Inc.", "USD", "United States"],
        ["ng", "GoJaye Nigeria Ltd", "NGN", "Nigeria"],
      ].filter((e) => !this.workspaceEntity || e[0] === this.workspaceEntity)) {
        this.run("INSERT INTO entities VALUES(?,?,?,?)", ...entity);
        this.run("INSERT INTO policies VALUES(?,?,80)", entity[0], 1);
        this.run(
          "INSERT INTO periods VALUES(?,?,'open')",
          entity[0],
          new Date().toISOString().slice(0, 7),
        );
        for (const account of [
          ["1100", "Bank · operating", "asset"],
          ["1200", "Refunds recoverable from employees & founders", "asset"],
          ["2100", "Employee & vendor payables", "liability"],
          ["3100", "Opening capital", "equity"],
          ...Object.entries(categories).map(([name, code]) => [
            code,
            name,
            "expense",
          ]),
        ])
          this.run(
            "INSERT INTO accounts(entity_id,code,name,type) VALUES(?,?,?,?)",
            entity[0],
            ...account,
          );
      }
      this.run(
        "INSERT INTO users VALUES(?,?,?,?)",
        "finance",
        "Workspace owner",
        "finance",
        JSON.stringify(
          this.workspaceEntity ? [this.workspaceEntity] : ["inc", "ng"],
        ),
      );
    });
  }
  seed() {
    this.tx(() => {
      for (const e of [
        ["inc", "GoJaye Inc.", "USD", "United States"],
        ["ng", "GoJaye Nigeria Ltd", "NGN", "Nigeria"],
      ]) {
        this.run("INSERT INTO entities VALUES(?,?,?,?)", ...e);
        this.run(
          "INSERT INTO policies VALUES(?,?,80)",
          e[0],
          e[0] === "inc" ? 100000 : 50000000,
        );
        this.run("INSERT INTO periods VALUES(?,?,'open')", e[0], "2026-10");
        for (const a of [
          ["1100", "Bank · operating", "asset"],
          ["2100", "Employee & vendor payables", "liability"],
          ["3100", "Opening capital · synthetic", "equity"],
          ...Object.entries(categories).map(([name, code]) => [
            code,
            name,
            "expense",
          ]),
        ])
          this.run(
            "INSERT INTO accounts(entity_id,code,name,type) VALUES(?,?,?,?)",
            e[0],
            ...a,
          );
      }
      const people = [
        ["employee", "Ada Okafor", "employee"],
        ["manager", "Tunde Bakare", "manager"],
        ["finance", "Amara Eze", "finance"],
        ["cfo", "Sam Adeyemi", "cfo"],
        ["payer", "David Chen", "payer"],
        ["reconciler", "Zainab Bello", "reconciler"],
        ["auditor", "Jordan Lee", "auditor"],
        ["investor", "Investor preview", "investor"],
        ["admin", "Technical administrator", "admin"],
      ];
      for (const p of people)
        this.run(
          "INSERT INTO users VALUES(?,?,?,?)",
          ...p,
          JSON.stringify(["inc", "ng"]),
        );
      for (const e of ["inc", "ng"]) {
        const mult = e === "ng" ? 1500 : 1;
        const names =
          e === "ng"
            ? [
                "TotalEnergies · sample",
                "Printivo · sample",
                "MainOne · sample",
                "S.P.A. Ajibade · sample",
                "Lagos workspace · sample",
              ]
            : [
                "Amazon Web Services · sample",
                "Google Workspace · sample",
                "Linear · sample",
                "Mercury services · sample",
                "Counsel LLP · sample",
              ];
        names.forEach((name, i) =>
          this.run(
            "INSERT INTO vendors VALUES(?,?,?,?,?,?)",
            `${e}-v${i}`,
            e,
            name,
            Object.keys(categories)[i % 5],
            0,
            "sample_only",
          ),
        );
        for (const [i, cat] of Object.keys(categories).slice(0, 5).entries())
          this.run(
            "INSERT INTO budgets VALUES(?,?,?,?,?,?)",
            `${e}-b${i}`,
            e,
            ["Engineering", "Marketing", "Operations", "Finance", "Operations"][
              i
            ],
            cat,
            "2026-10",
            [1800000, 1200000, 800000, 500000, 400000][i] * mult,
          );
        const finance = this.actor("finance");
        this.postJournal(finance, {
          entity_id: e,
          date: "2026-10-01",
          description: "Synthetic opening capital — local testing only",
          idempotency_key: "seed-opening",
          approved_by: "cfo",
          lines: [
            {
              account: "1100",
              debit: e === "ng" ? 4800000000 : 8000000,
              credit: 0,
            },
            {
              account: "3100",
              debit: 0,
              credit: e === "ng" ? 4800000000 : 8000000,
            },
          ],
        });
        const examples = [
          [
            "Cloud infrastructure · October",
            0,
            "Cloud & software",
            "Engineering",
            32000,
            "posted",
          ],
          [
            "Lagos launch materials",
            1,
            "Marketing",
            "Marketing",
            45000,
            "finance_review",
          ],
          [
            "Field team transport",
            0,
            "Operations",
            "Operations",
            8500,
            "manager_review",
          ],
          [
            "Legal advisory · entity setup",
            3,
            "Professional fees",
            "Finance",
            180000,
            "cfo_review",
          ],
          [
            "Workspace internet",
            2,
            "Operations",
            "Operations",
            12000,
            "approved",
          ],
          [
            "Driver acquisition campaign",
            1,
            "Marketing",
            "Marketing",
            90000,
            "draft",
          ],
          [
            "Team travel · site visit",
            4,
            "Travel",
            "Operations",
            24000,
            "paid",
          ],
          [
            "Community launch activation",
            1,
            "Marketing",
            "Marketing",
            150000,
            "approved",
          ],
        ];
        examples.forEach((row, i) => {
          const [desc, v, cat, dept, amount, status] = row as [
              string,
              number,
              string,
              string,
              number,
              string,
            ],
            sid = `${e}-SP-${String(i + 1).padStart(4, "0")}`,
            date = `2026-10-${String(i + 5).padStart(2, "0")}`;
          const kind = i === 7 ? "request" : "expense";
          this.run(
            "INSERT INTO spends(id,entity_id,kind,vendor_id,description,purpose,amount_minor,currency,department,category,date,status,requester_id,manager_id,finance_id,cfo_id,payer_id,payment_reference,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            sid,
            e,
            kind,
            `${e}-v${v}`,
            desc,
            "Synthetic scenario for local workflow testing",
            amount * mult,
            e === "ng" ? "NGN" : "USD",
            dept,
            cat,
            date,
            status,
            "employee",
            ["draft", "manager_review"].includes(status) ? null : "manager",
            ["draft", "manager_review", "finance_review"].includes(status)
              ? null
              : "finance",
            status === "approved" ? "cfo" : null,
            ["paid", "posted"].includes(status) ? "payer" : null,
            ["paid", "posted"].includes(status) ? `SYNTH-${sid}` : null,
            `${date}T10:00:00Z`,
            `${date}T10:00:00Z`,
          );
          if (kind !== "request") {
            const bytes = Buffer.concat([
                Buffer.from(
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1EAAAAASUVORK5CYII=",
                  "base64",
                ),
                Buffer.from(`SYNTHETIC FIXTURE ${sid}`),
              ]),
              rid = `receipt-${sid}`,
              path = join(this.dir, `${rid}.enc`),
              iv = randomBytes(12),
              cipher = createCipheriv("aes-256-gcm", this.key, iv);
            const encrypted = Buffer.concat([
              cipher.update(bytes),
              cipher.final(),
            ]);
            writeFileSync(
              path,
              Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
              { mode: 0o600 },
            );
            this.run(
              "INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?)",
              rid,
              e,
              sid,
              `SYNTHETIC-${sid}.png`,
              "image/png",
              hash(bytes),
              path,
              1,
              now(),
            );
          }
          if (status === "paid")
            this.run(
              "INSERT OR IGNORE INTO bank_transactions(id,entity_id,reference,date,currency,amount_minor,description,matched_spend_id,imported_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
              `BT-${sid}`,
              e,
              `SYNTH-STMT-${sid}`,
              date,
              e === "ng" ? "NGN" : "USD",
              amount * mult,
              desc,
              null,
              "finance",
              now(),
            );
          this.audit(e, this.actor("employee"), "spend.seeded", sid, {
            synthetic: true,
            status,
          });
          if (status === "posted") {
            this.postJournal(finance, {
              entity_id: e,
              date,
              description: desc,
              source_id: sid,
              idempotency_key: `${sid}:expense`,
              approved_by: "manager",
              lines: [
                { account: categories[cat], debit: amount * mult, credit: 0 },
                { account: "2100", debit: 0, credit: amount * mult },
              ],
            });
            this.postJournal(finance, {
              entity_id: e,
              date,
              description: `Settlement · ${desc}`,
              source_id: sid,
              idempotency_key: `${sid}:settlement`,
              approved_by: "manager",
              lines: [
                { account: "2100", debit: amount * mult, credit: 0 },
                { account: "1100", debit: 0, credit: amount * mult },
              ],
            });
          }
        });
      }
    });
  }
}
export function csv(headers: string[], rows: any[][]) {
  const cell = (v: any) => {
    let s = String(v ?? "");
    // Finite numbers are safe numeric cells; keep credit balances usable in spreadsheets.
    // Text retains formula protection even when it starts with a minus sign.
    if (
      !(typeof v === "number" && Number.isFinite(v)) &&
      /^[=+@\-\t\r]/.test(s)
    )
      s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
