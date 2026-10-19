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
};
const spendInput = z
  .object({
    entity_id: z.enum(["inc", "ng"]),
    kind: z.enum(["expense", "bill", "request"]),
    vendor_id: z.string().min(1),
    description: z.string().trim().min(3).max(180),
    purpose: z.string().trim().min(5).max(1000),
    amount_minor: int,
    currency: z.enum(["USD", "NGN"]),
    department: z.enum(["Engineering", "Marketing", "Operations", "Finance"]),
    category: z.enum([
      "Cloud & software",
      "Marketing",
      "Operations",
      "Professional fees",
      "Travel",
      "Government fees",
    ]),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
        "Invalid date",
      ),
    invoice_number: z.string().max(100).optional(),
    parent_id: z.string().optional(),
  })
  .strict();
export class FinanceStore {
  db: DatabaseSync;
  dir: string;
  key: Buffer;
  private inTransaction = false;
  constructor(
    filename = resolve(process.cwd(), "../../data/jaye.db"),
    seed = true,
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
    const keyPath = join(this.dir, ".evidence-key");
    if (!existsSync(keyPath))
      writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
    this.key = readFileSync(keyPath);
    if (seed && !this.get("SELECT id FROM entities LIMIT 1")) this.seed();
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
    if (!row)
      throw new DomainError("Choose a local test identity to begin", 401);
    return this.actor(row.user_id);
  }
  logout(token: string) {
    this.run("DELETE FROM sessions WHERE token_hash=?", hash(token));
  }
  entities(a: Actor) {
    return this.all("SELECT * FROM entities").filter((e) =>
      a.entities.includes(e.id),
    );
  }
  list(a: Actor, entity: string) {
    this.authorize(a, entity);
    const own = a.role === "employee" ? " AND s.requester_id=?" : "";
    return this.all(
      `SELECT s.*,v.name AS vendor,u.name AS requester,(SELECT COUNT(*) FROM receipts r WHERE r.spend_id=s.id) AS receipt_count FROM spends s JOIN vendors v ON v.id=s.vendor_id JOIN users u ON u.id=s.requester_id WHERE s.entity_id=?${own} ORDER BY s.created_at DESC`,
      ...[entity, ...(own ? [a.id] : [])],
    );
  }
  spend(a: Actor, spendId: string) {
    const s = this.get(
      "SELECT s.*,v.name AS vendor FROM spends s JOIN vendors v ON v.id=s.vendor_id WHERE s.id=?",
      spendId,
    );
    if (!s) throw new DomainError("Spend record not found", 404);
    this.authorize(a, s.entity_id);
    if (a.role === "employee" && s.requester_id !== a.id)
      throw new DomainError(
        "Employees can only access their own expenses",
        403,
      );
    return s;
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
              "SELECT reference,amount_minor,date FROM bank_transactions WHERE entity_id=? AND amount_minor=? AND matched_spend_id IS NULL",
              s.entity_id,
              s.amount_minor,
            )
          : [],
    };
  }
  createSpend(a: Actor, input: unknown) {
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
      this.audit(s.entity_id, a, "spend.created", key, {
        amount_minor: s.amount_minor,
        currency: s.currency,
        kind: s.kind,
      });
      return this.spend(a, key);
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
    const attached=this.get('SELECT id FROM receipts WHERE spend_id=? AND hash=?',s.id,hash(b));
    if(attached)return {id:attached.id};
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
  ) {
    return this.tx(() => {
      const s = this.spend(a, spendId);
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
        s.manager_id,
        s.finance_id,
        s.cfo_id,
        s.payer_id,
        s.reconciler_id,
      ].filter(Boolean);
      if (
        action !== "submit" &&
        allActors.includes(a.id) &&
        !(["post", "schedule"].includes(action) && a.id === s.finance_id)
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
          row.matched_spend_id ||
          row.currency !== s.currency ||
          row.amount_minor !== s.amount_minor
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
        const account = categories[s.category];
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
            { account: "2100", debit: s.amount_minor, credit: 0 },
            { account: "1100", debit: 0, credit: s.amount_minor },
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
  budgetsRaw(entity: string) {
    return this.all(
      `SELECT b.*,COALESCE((SELECT SUM(s.amount_minor) FROM spends s WHERE s.entity_id=b.entity_id AND s.department=b.department AND s.category=b.category AND substr(s.date,1,7)=b.period AND s.status IN ('approved','scheduled','paid','reconciled') AND NOT EXISTS(SELECT 1 FROM spends child WHERE child.parent_id=s.id AND child.status IN ('approved','scheduled','paid','reconciled','posted'))),0) AS committed_minor,COALESCE((SELECT SUM(s.amount_minor) FROM spends s WHERE s.entity_id=b.entity_id AND s.department=b.department AND s.category=b.category AND substr(s.date,1,7)=b.period AND s.status='posted'),0) AS actual_minor FROM budgets b WHERE b.entity_id=?`,
      entity,
    ).map((b) => ({
      ...b,
      remaining_minor: b.amount_minor - b.committed_minor - b.actual_minor,
    }));
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
      "SELECT COALESCE(SUM(CASE WHEN account='1100' THEN debit-credit ELSE 0 END),0) AS cash_minor,COALESCE(SUM(CASE WHEN account LIKE '6%' THEN debit-credit ELSE 0 END),0) AS spend_minor FROM lines WHERE entity_id=? AND journal_id IN (SELECT id FROM journals WHERE status='posted')",
      entity,
    );
    const budgets = this.budgetsRaw(entity);
    return {
      ...totals,
      pending: spends.filter((s) =>
        ["manager_review", "finance_review", "cfo_review"].includes(s.status),
      ).length,
      committed_minor: budgets.reduce((n, b) => n + b.committed_minor, 0),
      budget_minor: budgets.reduce((n, b) => n + b.amount_minor, 0),
      unreconciled: spends.filter((s) => s.status === "paid").length,
      recent: spends.slice(0, 6),
      by_category: Object.keys(categories).map((category) => ({
        category,
        amount_minor: spends
          .filter((s) => s.category === category && s.status === "posted")
          .reduce((n, s) => n + s.amount_minor, 0),
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
      "SELECT * FROM bank_transactions WHERE entity_id=? ORDER BY date DESC",
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
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            currency: z.literal(currency),
            amount_minor: z.string().regex(/^[1-9]\d{0,11}$/),
            description: z.string().max(300),
          })
          .strict()
          .safeParse(row);
        if (!p.success)
          throw new DomainError(
            "CSV columns: reference,date,currency,amount_minor,description. Use positive integer minor units for debit amounts in entity currency.",
          );
        const r = p.data,
          existing = this.get(
            "SELECT * FROM bank_transactions WHERE entity_id=? AND reference=?",
            entity,
            r.reference,
          );
        if (existing) {
          if (
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
          "INSERT INTO bank_transactions VALUES(?,?,?,?,?,?,?,?,?,?)",
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
      "SELECT s.id,s.currency,s.amount_minor,s.description,v.name AS payee FROM spends s JOIN vendors v ON v.id=s.vendor_id WHERE s.entity_id=? AND s.status='scheduled'",
      entity,
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
              "INSERT OR IGNORE INTO bank_transactions VALUES(?,?,?,?,?,?,?,?,?,?)",
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
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
