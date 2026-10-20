import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import { localDate } from "./subscriptions";
import { FinanceStore, DomainError, categories, type Actor } from "./domain";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Enter a valid date",
  );
const amount = z.number().int().positive().max(1e12);
const department = z.enum([
  "Product",
  "Engineering",
  "Marketing",
  "Operations",
  "Finance",
]);
const text = z.string().trim().min(1).max(180);
const note = z.string().trim().max(2000).default("");
const entity = z.enum(["ng", "inc"]);
const key = z.string().uuid();
const parsed = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const p = schema.safeParse(input);
  if (!p.success)
    throw new DomainError(
      p.error.issues.map((i) => `${i.path.join(" ")}: ${i.message}`).join("; "),
    );
  return p.data;
};
export class BookkeepingService {
  constructor(private s: FinanceStore) {}
  access(a: Actor, e: string, write = false) {
    this.s.authorize(
      a,
      e,
      write ? ["finance"] : ["finance", "cfo", "auditor", "reconciler"],
    );
  }
  employees(a: Actor, e: string) {
    this.access(a, e);
    return this.s.all(
      "SELECT * FROM employees WHERE entity_id=? ORDER BY active DESC,name",
      e,
    );
  }
  saveEmployee(a: Actor, input: unknown, id?: string) {
    const p = parsed(
      z.object({
        entity_id: entity,
        name: text,
        employee_code: text.optional(),
        department,
        job_title: z.string().trim().max(180).default(""),
        kind: z.enum(["employee", "founder"]),
        salary_minor: z.number().int().min(0).max(1e12),
        start_date: date,
        active: z.boolean().default(true),
        revision: z.number().int().min(0).default(0),
      }),
      input,
    );
    this.access(a, p.entity_id, true);
    return this.s.tx(() => {
      if (id) {
        const old = this.s.get(
          "SELECT * FROM employees WHERE id=? AND entity_id=?",
          id,
          p.entity_id,
        );
        if (!old) throw new DomainError("Employee not found", 404);
        if (old.revision !== p.revision)
          throw new DomainError(
            "This employee was updated. Reload and try again.",
            409,
          );
      }
      // Allocate inside the write transaction; never recycle existing staff IDs.
      let code = id
        ? this.s.get("SELECT employee_code FROM employees WHERE id=?", id)
            .employee_code
        : "";
      if (!id) {
        let sequence =
          this.s.get(
            "SELECT COALESCE(MAX(CAST(substr(employee_code,6) AS INTEGER)),0) AS n FROM employees WHERE entity_id=? AND upper(employee_code) GLOB 'JAYE-[0-9]*'",
            p.entity_id,
          ).n + 1;
        do {
          code = `JAYE-${String(sequence++).padStart(4, "0")}`;
        } while (
          this.s.get(
            "SELECT id FROM employees WHERE entity_id=? AND employee_code=?",
            p.entity_id,
            code,
          )
        );
      }
      const eid = id || randomUUID();
      if (id)
        this.s.run(
          "UPDATE employees SET name=?,employee_code=?,department=?,job_title=?,kind=?,salary_minor=?,start_date=?,active=?,revision=revision+1 WHERE id=?",
          p.name,
          code,
          p.department,
          p.job_title,
          p.kind,
          p.salary_minor,
          p.start_date,
          Number(p.active),
          eid,
        );
      else
        this.s.run(
          "INSERT INTO employees(id,entity_id,name,employee_code,department,job_title,kind,salary_minor,start_date,active) VALUES(?,?,?,?,?,?,?,?,?,?)",
          eid,
          p.entity_id,
          p.name,
          code,
          p.department,
          p.job_title,
          p.kind,
          p.salary_minor,
          p.start_date,
          Number(p.active),
        );
      this.s.audit(
        p.entity_id,
        a,
        id ? "employee.updated" : "employee.created",
        eid,
        { name: p.name, active: p.active },
      );
      return this.s.get("SELECT * FROM employees WHERE id=?", eid);
    });
  }
  list(a: Actor, e: string) {
    this.access(a, e);
    return this.s
      .all(
        "SELECT r.*,r.amount_minor AS original_amount_minor,COALESCE((SELECT SUM(p.amount_minor) FROM bookkeeping_payments p WHERE p.record_id=r.id AND p.voided=0),0) AS gross_paid_minor,COALESCE((SELECT SUM(f.amount_minor) FROM bookkeeping_refunds f WHERE f.record_id=r.id AND f.voided=0),0) AS refunded_minor FROM bookkeeping_records r WHERE r.entity_id=? ORDER BY r.date DESC,r.created_at DESC",
        e,
      )
      .map((r) => ({
        ...r,
        amount_minor: r.voided ? 0 : r.amount_minor - r.refunded_minor,
        paid_minor: r.gross_paid_minor - r.refunded_minor,
        outstanding_minor: r.voided ? 0 : r.amount_minor - r.gross_paid_minor,
        status: r.voided
          ? "Voided"
          : r.refunded_minor === r.amount_minor
            ? "Refunded"
            : r.gross_paid_minor === r.amount_minor
              ? "Paid"
              : r.gross_paid_minor
                ? "Part paid"
                : "Unpaid",
      }));
  }
  detail(a: Actor, id: string) {
    const r = this.s.get("SELECT * FROM bookkeeping_records WHERE id=?", id);
    if (!r) throw new DomainError("Record not found", 404);
    this.access(a, r.entity_id);
    return {
      ...this.list(a, r.entity_id).find((x) => x.id === id),
      refunds: this.s.all(
        "SELECT f.*,m.bank_transaction_id,b.reference AS bank_reference FROM bookkeeping_refunds f LEFT JOIN bookkeeping_bank_matches m ON m.refund_id=f.id LEFT JOIN bank_transactions b ON b.id=m.bank_transaction_id WHERE f.record_id=? ORDER BY f.date,f.created_at",
        id,
      ),
      bank_candidates: this.s
        .bankTransactions(a, r.entity_id)
        .filter(
          (b) =>
            !b.matched_spend_id &&
            !b.matched_repayment_id &&
            !b.matched_refund_id &&
            !b.matched_recovery_id &&
            !b.matched_record_payment_id &&
            !b.matched_record_refund_id,
        ),
      corrections: this.s
        .all(
          "SELECT c.*,u.name AS actor FROM bookkeeping_corrections c LEFT JOIN users u ON u.id=c.actor_id WHERE c.entity_id=? AND (c.target_id=? OR c.target_id IN (SELECT id FROM bookkeeping_payments WHERE record_id=?)) ORDER BY c.created_at,c.revision",
          r.entity_id,
          id,
          id,
        )
        .map((c) => ({
          ...c,
          before: JSON.parse(c.before_json),
          after: JSON.parse(c.after_json),
        })),
      attachments: this.s.all(
        "SELECT id,filename,mime,created_at FROM record_attachments WHERE record_id=?",
        id,
      ),
      payments: this.s.all(
        "SELECT p.*,m.bank_transaction_id,b.reference AS bank_reference FROM bookkeeping_payments p LEFT JOIN bookkeeping_bank_matches m ON m.payment_id=p.id LEFT JOIN bank_transactions b ON b.id=m.bank_transaction_id WHERE p.record_id=? ORDER BY p.date,p.created_at",
        id,
      ),
    };
  }
  record(a: Actor, input: unknown) {
    const p = parsed(
      z.object({
        entity_id: entity,
        kind: z.enum(["expense", "salary"]),
        description: text,
        payee: z.string().trim().max(180).default(""),
        employee_id: z.string().default(""),
        category: z.string(),
        department,
        amount_minor: amount,
        date,
        due_date: date,
        payroll_month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
        reference: z.string().trim().max(180).default(""),
        note,
        request_key: key,
        payment: z
          .object({
            amount_minor: amount,
            date,
            reference: text,
            method: z.enum(["Bank transfer", "Cash", "Debit card"]),
            note,
          })
          .optional(),
      }),
      input,
    );
    this.access(a, p.entity_id, true);
    return this.s.tx(() => {
      const previous = this.s.get(
        "SELECT id,entity_id FROM bookkeeping_records WHERE request_key=?",
        p.request_key,
      );
      if (previous) {
        if (previous.entity_id !== p.entity_id)
          throw new DomainError("Request key belongs to another entity", 409);
        return this.detail(a, previous.id);
      }
      let payee = p.payee,
        dept = p.department;
      if (p.employee_id) {
        const employee = this.s.get(
          "SELECT * FROM employees WHERE id=? AND entity_id=? AND active=1",
          p.employee_id,
          p.entity_id,
        );
        if (!employee)
          throw new DomainError("Choose an active employee in this entity");
        payee = employee.name;
        if (p.kind === "salary") dept = employee.department;
        if (p.date < employee.start_date)
          throw new DomainError(
            "The record date is before this person's start date",
          );
      }
      if (p.kind === "salary") {
        if (!p.employee_id || !p.payroll_month)
          throw new DomainError("Choose an employee and salary month");
        if (
          this.s.get(
            "SELECT id FROM bookkeeping_records WHERE entity_id=? AND employee_id=? AND payroll_month=? AND kind='salary' AND voided=0",
            p.entity_id,
            p.employee_id,
            p.payroll_month,
          )
        )
          throw new DomainError(
            "Salary for this employee and month is already recorded. Open it to add a payment.",
          );
      } else if (!categories[p.category])
        throw new DomainError("Choose an expense category");
      if (!payee) throw new DomainError("Enter who is owed this money");
      if (p.due_date < p.date)
        throw new DomainError("Due date cannot be before the record date");
      if (
        p.reference &&
        this.s.get(
          "SELECT id FROM bookkeeping_records WHERE entity_id=? AND lower(trim(payee))=lower(trim(?)) AND lower(trim(reference))=lower(trim(?)) AND kind='expense' AND voided=0",
          p.entity_id,
          payee,
          p.reference,
        )
      )
        throw new DomainError(
          "This invoice reference is already recorded for this payee",
        );
      if (p.date > localDate())
        throw new DomainError("Record dates cannot be in the future");
      this.s.run(
        "INSERT OR IGNORE INTO periods VALUES(?,?,'open')",
        p.entity_id,
        p.date.slice(0, 7),
      );
      const rid = randomUUID(),
        category = p.kind === "salary" ? "Salaries" : p.category;
      this.s.run(
        "INSERT OR IGNORE INTO accounts(entity_id,code,name,type) VALUES(?,'6700','Salaries','expense')",
        p.entity_id,
      );
      this.s.run(
        "INSERT INTO bookkeeping_records(id,entity_id,kind,description,payee,employee_id,category,department,amount_minor,date,due_date,payroll_month,reference,note,created_by,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rid,
        p.entity_id,
        p.kind,
        p.description,
        payee,
        p.employee_id || null,
        category,
        dept,
        p.amount_minor,
        p.date,
        p.due_date,
        p.kind === "salary" ? p.payroll_month : null,
        p.reference,
        p.note,
        a.id,
        new Date().toISOString(),
        p.request_key,
      );
      this.s.postJournal(a, {
        entity_id: p.entity_id,
        date: p.date,
        description: p.description,
        idempotency_key: `record:${rid}:cost`,
        approved_by: a.id,
        lines: [
          {
            account: p.kind === "salary" ? "6700" : categories[p.category],
            debit: p.amount_minor,
            credit: 0,
          },
          { account: "2100", debit: 0, credit: p.amount_minor },
        ],
      });
      this.s.audit(p.entity_id, a, "bookkeeping.recorded", rid, {
        kind: p.kind,
        amount_minor: p.amount_minor,
        mode: "accountant_documentation",
      });
      if (p.payment)
        this.pay(a, rid, { ...p.payment, request_key: randomUUID() });
      return this.detail(a, rid);
    });
  }
  correct(a: Actor, kind: "record" | "payment", id: string, input: unknown) {
    const p = parsed(
      z.object({
        revision: z.number().int().min(0),
        request_key: key,
        reason: z.string().trim().min(3).max(500),
        amount_minor: z.number().int().min(0).max(1e12),
        date,
        description: text.optional(),
        payee: text.optional(),
        employee_id: z.string().optional(),
        category: text.optional(),
        department: department.optional(),
        due_date: date.optional(),
        payroll_month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
        reference: z.string().trim().max(180).optional(),
        method: z.enum(["Bank transfer", "Cash", "Debit card"]).optional(),
        note,
      }),
      input,
    );
    return this.s.tx(() => {
      const table =
        kind === "record" ? "bookkeeping_records" : "bookkeeping_payments";
      const old = this.s.get(`SELECT * FROM ${table} WHERE id=?`, id);
      if (!old) throw new DomainError("Record not found", 404);
      this.access(a, old.entity_id, true);
      const rid = kind === "record" ? id : old.record_id;
      const retry = this.s.get(
        "SELECT * FROM bookkeeping_corrections WHERE request_key=?",
        p.request_key,
      );
      if (retry) {
        if (retry.target_id !== id || retry.kind !== kind)
          throw new DomainError("Correction key already used", 409);
        return this.detail(a, rid);
      }
      if (
        this.s.get(
          "SELECT id FROM bookkeeping_refunds WHERE record_id=? AND voided=0",
          rid,
        )
      )
        throw new DomainError(
          "Reverse the recorded refund before correcting this record or its payments",
        );
      if (
        kind === "payment" &&
        this.s.get(
          "SELECT bank_transaction_id FROM bookkeeping_bank_matches WHERE payment_id=?",
          id,
        )
      )
        throw new DomainError(
          "Remove the bank match before correcting this payment",
        );
      if (old.voided)
        throw new DomainError("A voided entry cannot be corrected again");
      if (old.revision !== p.revision)
        throw new DomainError(
          "This entry has changed. Reopen it before correcting.",
          409,
        );
      if (p.date > localDate())
        throw new DomainError("The date cannot be in the future");
      const record = this.detail(a, rid),
        next = {
          ...old,
          ...p,
          revision: old.revision + 1,
          voided: p.amount_minor === 0 ? 1 : 0,
        };
      if (kind === "record") {
        if (p.amount_minor < record.paid_minor)
          throw new DomainError(
            "Correct or void the payment first: the cost cannot be less than the payments recorded",
          );
        if (record.payments.some((x: any) => !x.voided && x.date < p.date))
          throw new DomainError(
            "The expense date cannot be after its payments",
          );
        if (next.due_date < p.date)
          throw new DomainError("Due date cannot be before the record date");
        if (old.kind === "salary") next.category = "Salaries";
        if (!categories[next.category])
          throw new DomainError("Choose an expense category");
        if (next.employee_id) {
          const person = this.s.get(
            "SELECT * FROM employees WHERE id=? AND entity_id=?",
            next.employee_id,
            old.entity_id,
          );
          if (!person) throw new DomainError("Choose a person in this company");
          next.payee = person.name;
          if (old.kind === "salary") next.department = person.department;
          if (next.date < person.start_date)
            throw new DomainError("Date is before this person's start date");
        }
        if (old.kind === "salary" && (!next.employee_id || !next.payroll_month))
          throw new DomainError("Employee and salary month are required");
      } else {
        if (record.voided) throw new DomainError("The expense was voided");
        if (p.amount_minor > record.outstanding_minor + old.amount_minor)
          throw new DomainError("Payment exceeds the cost still owed");
        if (p.date < record.date)
          throw new DomainError(
            "Payment date cannot be before the expense date",
          );
        if (!next.reference)
          throw new DomainError("Payment reference is required");
        if (
          this.s.get(
            "SELECT id FROM spends WHERE entity_id=? AND (payment_reference=? OR original_payment_reference=?)",
            old.entity_id,
            next.reference,
            next.reference,
          )
        )
          throw new DomainError("Payment reference is already recorded");
        for (const t of ["reimbursement_payments", "recovery_payments"])
          if (
            this.s.get(
              `SELECT id FROM ${t} WHERE entity_id=? AND reference=?`,
              old.entity_id,
              next.reference,
            )
          )
            throw new DomainError("Payment reference is already recorded");
      }
      if (!next.voided) {
        if (
          kind === "record" &&
          old.kind === "salary" &&
          this.s.get(
            "SELECT id FROM bookkeeping_records WHERE entity_id=? AND employee_id=? AND payroll_month=? AND kind='salary' AND voided=0 AND id<>?",
            old.entity_id,
            next.employee_id,
            next.payroll_month,
            id,
          )
        )
          throw new DomainError(
            "A salary is already recorded for this employee and month",
          );
        if (
          kind === "record" &&
          old.kind === "expense" &&
          next.reference &&
          this.s.get(
            "SELECT id FROM bookkeeping_records WHERE entity_id=? AND lower(trim(payee))=lower(trim(?)) AND lower(trim(reference))=lower(trim(?)) AND kind='expense' AND voided=0 AND id<>?",
            old.entity_id,
            next.payee,
            next.reference,
            id,
          )
        )
          throw new DomainError("This invoice reference is already recorded");
        if (
          kind === "payment" &&
          this.s.get(
            "SELECT id FROM bookkeeping_payments WHERE entity_id=? AND reference=? AND id<>?",
            old.entity_id,
            next.reference,
            id,
          )
        )
          throw new DomainError("Payment reference is already recorded");
      }
      // Never reopen a closed period, including the original posting period.
      for (const d of [old.date, p.date]) {
        this.s.run(
          "INSERT OR IGNORE INTO periods VALUES(?,?,'open')",
          old.entity_id,
          d.slice(0, 7),
        );
        if (
          this.s.get(
            "SELECT status FROM periods WHERE entity_id=? AND period=?",
            old.entity_id,
            d.slice(0, 7),
          ).status !== "open"
        )
          throw new DomainError(
            "The original and corrected periods must both be open",
          );
      }
      const cid = randomUUID();
      this.s.run(
        "INSERT INTO bookkeeping_corrections VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        cid,
        old.entity_id,
        kind,
        id,
        next.revision,
        JSON.stringify(old),
        JSON.stringify(next),
        p.reason,
        p.request_key,
        a.id,
        new Date().toISOString(),
      );
      const previousKey = old.revision
        ? `correction:${kind}:${id}:${old.revision}:replacement`
        : `record:${id}:${kind === "record" ? "cost" : "payment"}`;
      const previous = this.s.get(
        "SELECT * FROM journals WHERE entity_id=? AND idempotency_key=?",
        old.entity_id,
        previousKey,
      );
      if (!previous)
        throw new DomainError("Original posting could not be found");
      const lines = this.s.all(
        "SELECT account,debit,credit FROM lines WHERE journal_id=?",
        previous.id,
      );
      this.s.postJournal(a, {
        entity_id: old.entity_id,
        date: old.date,
        description: `Correction reversal · ${p.reason}`,
        idempotency_key: `correction:${kind}:${id}:${next.revision}:reversal`,
        approved_by: a.id,
        reversal_of: previous.id,
        lines: lines.map((l) => ({
          account: l.account,
          debit: l.credit,
          credit: l.debit,
        })),
      });
      if (!next.voided) {
        const account =
          kind === "record"
            ? categories[next.category]
            : next.method === "Cash"
              ? "1010"
              : "1100";
        if (account === "1010")
          this.s.run(
            "INSERT OR IGNORE INTO accounts(entity_id,code,name,type) VALUES(?,'1010','Cash on hand','asset')",
            old.entity_id,
          );
        this.s.postJournal(a, {
          entity_id: old.entity_id,
          date: p.date,
          description: `Corrected ${kind} · ${p.reason}`,
          idempotency_key: `correction:${kind}:${id}:${next.revision}:replacement`,
          approved_by: a.id,
          lines:
            kind === "record"
              ? [
                  { account, debit: p.amount_minor, credit: 0 },
                  { account: "2100", debit: 0, credit: p.amount_minor },
                ]
              : [
                  { account: "2100", debit: p.amount_minor, credit: 0 },
                  { account, debit: 0, credit: p.amount_minor },
                ],
        });
      }
      const fields =
        kind === "record"
          ? [
              "description",
              "payee",
              "employee_id",
              "category",
              "department",
              "amount_minor",
              "date",
              "due_date",
              "payroll_month",
              "reference",
              "note",
              "revision",
              "voided",
            ]
          : [
              "amount_minor",
              "date",
              "reference",
              "method",
              "note",
              "revision",
              "voided",
            ];
      this.s.run(
        `UPDATE ${table} SET ${fields.map((f) => `${f}=?`).join(",")} WHERE id=?`,
        ...fields.map((f) =>
          f === "amount_minor" && next.voided
            ? old.amount_minor
            : (next[f] ?? null),
        ),
        id,
      );
      this.s.audit(old.entity_id, a, `bookkeeping.${kind}_corrected`, id, {
        correction_id: cid,
        reason: p.reason,
        revision: next.revision,
        voided: next.voided,
      });
      return this.detail(a, rid);
    });
  }
  attach(
    a: Actor,
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    const r = this.detail(a, id);
    this.access(a, r.entity_id, true);
    if (!file?.buffer?.length || file.buffer.length > 8 * 1024 * 1024)
      throw new DomainError("Choose a PDF, PNG or JPEG under 8 MB");
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
      throw new DomainError("The file must be a valid PDF, PNG or JPEG");
    const hash = createHash("sha256").update(b).digest("hex");
    const existing = this.s.get(
      "SELECT id FROM record_attachments WHERE record_id=? AND hash=?",
      id,
      hash,
    );
    if (existing) return existing;
    return this.s.tx(() => {
      const aid = randomUUID(),
        iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", this.s.key, iv);
      const encrypted = Buffer.concat([cipher.update(b), cipher.final()]);
      this.s.run(
        "INSERT INTO record_attachments VALUES(?,?,?,?,?,?,?)",
        aid,
        id,
        file.originalname.replace(/[^\w. -]/g, "_").slice(0, 100),
        mime,
        hash,
        Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
        new Date().toISOString(),
      );
      this.s.audit(r.entity_id, a, "bookkeeping.evidence_attached", id, {
        attachment_id: aid,
      });
      return { id: aid };
    });
  }
  attachment(a: Actor, id: string) {
    const f = this.s.get("SELECT * FROM record_attachments WHERE id=?", id);
    if (!f) throw new DomainError("Attachment not found", 404);
    this.detail(a, f.record_id);
    const b = Buffer.from(f.encrypted),
      decipher = createDecipheriv("aes-256-gcm", this.s.key, b.subarray(0, 12));
    decipher.setAuthTag(b.subarray(12, 28));
    return {
      filename: f.filename,
      mime: f.mime,
      content: Buffer.concat([
        decipher.update(b.subarray(28)),
        decipher.final(),
      ]),
    };
  }
  pay(a: Actor, id: string, input: unknown) {
    const p = parsed(
      z.object({
        amount_minor: amount,
        date,
        reference: text,
        method: z.enum(["Bank transfer", "Cash", "Debit card"]),
        note,
        request_key: key,
      }),
      input,
    );
    return this.s.tx(() => {
      const r = this.detail(a, id);
      this.access(a, r.entity_id, true);
      const previous = this.s.get(
        "SELECT * FROM bookkeeping_payments WHERE request_key=?",
        p.request_key,
      );
      if (previous) {
        if (previous.record_id !== id)
          throw new DomainError("Request key already used", 409);
        return this.detail(a, id);
      }
      if (r.voided) throw new DomainError("This record was voided");
      if (p.amount_minor > r.outstanding_minor)
        throw new DomainError("Payment exceeds the amount still owed");
      if (p.date > localDate())
        throw new DomainError(
          "Only record payments that have already been made",
        );
      this.s.run(
        "INSERT OR IGNORE INTO periods VALUES(?,?,'open')",
        r.entity_id,
        p.date.slice(0, 7),
      );
      if (p.date < r.date)
        throw new DomainError("Payment date cannot be before the expense date");
      for (const table of [
        "bookkeeping_payments",
        "bookkeeping_refunds",
        "reimbursement_payments",
        "recovery_payments",
      ])
        if (
          this.s.get(
            `SELECT id FROM ${table} WHERE entity_id=? AND reference=?`,
            r.entity_id,
            p.reference,
          )
        )
          throw new DomainError("Payment reference is already recorded");
      if (
        this.s.get(
          "SELECT id FROM spends WHERE entity_id=? AND (payment_reference=? OR original_payment_reference=?)",
          r.entity_id,
          p.reference,
          p.reference,
        )
      )
        throw new DomainError("Payment reference is already recorded");
      this.s.run(
        "INSERT OR IGNORE INTO accounts(entity_id,code,name,type) VALUES(?,'1010','Cash on hand','asset')",
        r.entity_id,
      );
      const pid = randomUUID();
      this.s.run(
        "INSERT INTO bookkeeping_payments(id,record_id,entity_id,amount_minor,date,reference,method,note,created_by,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        pid,
        id,
        r.entity_id,
        p.amount_minor,
        p.date,
        p.reference,
        p.method,
        p.note,
        a.id,
        new Date().toISOString(),
        p.request_key,
      );
      this.s.postJournal(a, {
        entity_id: r.entity_id,
        date: p.date,
        description: `Payment · ${r.description}`,
        idempotency_key: `record:${pid}:payment`,
        approved_by: a.id,
        lines: [
          { account: "2100", debit: p.amount_minor, credit: 0 },
          {
            account: p.method === "Cash" ? "1010" : "1100",
            debit: 0,
            credit: p.amount_minor,
          },
        ],
      });
      this.s.audit(r.entity_id, a, "bookkeeping.payment_recorded", pid, {
        record_id: id,
        amount_minor: p.amount_minor,
        reference: p.reference,
      });
      return this.detail(a, id);
    });
  }
  refund(a: Actor, id: string, input: unknown) {
    const p = parsed(
      z
        .object({
          amount_minor: amount,
          date,
          reference: text,
          method: z.enum(["Bank transfer", "Cash"]),
          reason: z.string().trim().min(3).max(500),
          request_key: key,
        })
        .strict(),
      input,
    );
    return this.s.tx(() => {
      const r = this.detail(a, id);
      this.access(a, r.entity_id, true);
      const previous = this.s.get(
        "SELECT record_id FROM bookkeeping_refunds WHERE request_key=?",
        p.request_key,
      );
      if (previous) {
        if (previous.record_id !== id)
          throw new DomainError("Request key already used", 409);
        return this.detail(a, id);
      }
      if (r.voided || p.amount_minor > Math.min(r.amount_minor, r.paid_minor))
        throw new DomainError(
          "Refund cannot exceed the cost or money already paid, less earlier refunds",
        );
      const paidAtDate = r.payments
        .filter((x: any) => !x.voided && x.date <= p.date)
        .reduce((n: number, x: any) => n + x.amount_minor, 0);
      if (
        p.date < r.date ||
        p.date > localDate() ||
        p.amount_minor + r.refunded_minor > paidAtDate
      )
        throw new DomainError(
          "Use a date on or after the original payment, and no later than today",
        );
      for (const table of [
        "bookkeeping_refunds",
        "bookkeeping_payments",
        "refunds",
        "recovery_payments",
        "reimbursement_payments",
        "expense_adjustments",
      ])
        if (
          this.s.get(
            `SELECT id FROM ${table} WHERE entity_id=? AND lower(reference)=lower(?)`,
            r.entity_id,
            p.reference,
          )
        )
          throw new DomainError(
            "This money movement reference is already recorded",
          );
      if (
        this.s.get(
          "SELECT id FROM spends WHERE entity_id=? AND (payment_reference=? OR original_payment_reference=?)",
          r.entity_id,
          p.reference,
          p.reference,
        )
      )
        throw new DomainError("This reference is already recorded");
      this.s.run(
        "INSERT OR IGNORE INTO periods VALUES(?,?,'open')",
        r.entity_id,
        p.date.slice(0, 7),
      );
      const fid = randomUUID();
      this.s.run(
        "INSERT INTO bookkeeping_refunds(id,record_id,entity_id,amount_minor,date,reference,method,reason,created_by,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        fid,
        id,
        r.entity_id,
        p.amount_minor,
        p.date,
        p.reference,
        p.method,
        p.reason,
        a.id,
        new Date().toISOString(),
        p.request_key,
      );
      this.s.postJournal(a, {
        entity_id: r.entity_id,
        date: p.date,
        description: `Refund · ${r.description}`,
        idempotency_key: `record:${fid}:refund`,
        approved_by: a.id,
        lines: [
          {
            account: p.method === "Cash" ? "1010" : "1100",
            debit: p.amount_minor,
            credit: 0,
          },
          { account: categories[r.category], debit: 0, credit: p.amount_minor },
        ],
      });
      this.s.audit(r.entity_id, a, "bookkeeping.refund_recorded", id, {
        refund_id: fid,
        amount_minor: p.amount_minor,
        reason: p.reason,
      });
      return this.detail(a, id);
    });
  }
  reverseRefund(a: Actor, id: string, fid: string, input: unknown) {
    const p = parsed(
      z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
      input,
    );
    return this.s.tx(() => {
      const r = this.detail(a, id);
      this.access(a, r.entity_id, true);
      const f = this.s.get(
        "SELECT * FROM bookkeeping_refunds WHERE id=? AND record_id=?",
        fid,
        id,
      );
      if (!f) throw new DomainError("Refund not found", 404);
      if (f.voided) return r;
      if (
        this.s.get(
          "SELECT bank_transaction_id FROM bookkeeping_bank_matches WHERE refund_id=?",
          fid,
        )
      )
        throw new DomainError(
          "Remove the bank match before reversing this refund",
        );
      this.s.postJournal(a, {
        entity_id: r.entity_id,
        date: f.date,
        description: `Reverse mistaken refund · ${p.reason}`,
        idempotency_key: `record:${fid}:refund-reversal`,
        approved_by: a.id,
        lines: [
          { account: categories[r.category], debit: f.amount_minor, credit: 0 },
          {
            account: f.method === "Cash" ? "1010" : "1100",
            debit: 0,
            credit: f.amount_minor,
          },
        ],
      });
      this.s.run("UPDATE bookkeeping_refunds SET voided=1 WHERE id=?", fid);
      this.s.audit(r.entity_id, a, "bookkeeping.refund_reversed", id, {
        refund_id: fid,
        reason: p.reason,
      });
      return this.detail(a, id);
    });
  }
  matchBank(a: Actor, id: string, input: unknown) {
    const p = parsed(
      z
        .object({
          kind: z.enum(["payment", "refund"]),
          target_id: z.string(),
          bank_transaction_id: z.string().optional(),
          remove: z.boolean().default(false),
          reason: z.string().trim().max(500).optional(),
        })
        .strict(),
      input,
    );
    return this.s.tx(() => {
      const r = this.detail(a, id);
      this.s.authorize(a, r.entity_id, ["finance", "reconciler"]);
      const target = this.s.get(
        `SELECT * FROM bookkeeping_${p.kind === "payment" ? "payments" : "refunds"} WHERE id=? AND record_id=?`,
        p.target_id,
        id,
      );
      if (!target || target.voided || r.voided)
        throw new DomainError("Choose an active payment or refund");
      const column = p.kind === "payment" ? "payment_id" : "refund_id";
      const existing = this.s.get(
        `SELECT * FROM bookkeeping_bank_matches WHERE ${column}=?`,
        target.id,
      );
      if (p.remove) {
        if (!p.reason || p.reason.length < 3)
          throw new DomainError("Explain why you are removing this bank match");
        if (existing) {
          this.s.run(
            `DELETE FROM bookkeeping_bank_matches WHERE ${column}=?`,
            target.id,
          );
          this.s.audit(r.entity_id, a, "bookkeeping.bank_unmatched", id, {
            ...p,
            previous_bank_id: existing.bank_transaction_id,
          });
        }
        return this.detail(a, id);
      }
      if (existing) {
        if (existing.bank_transaction_id === p.bank_transaction_id) return r;
        throw new DomainError("This entry is already matched", 409);
      }
      if (target.method === "Cash")
        throw new DomainError("Cash entries do not match bank statements");
      const bank = this.s
        .bankTransactions(a, r.entity_id)
        .find((b) => b.id === p.bank_transaction_id);
      if (
        !bank ||
        bank.matched_spend_id ||
        bank.matched_repayment_id ||
        bank.matched_refund_id ||
        bank.matched_recovery_id ||
        bank.matched_record_payment_id ||
        bank.matched_record_refund_id ||
        bank.amount_minor !== target.amount_minor ||
        bank.currency !==
          this.s.get("SELECT currency FROM entities WHERE id=?", r.entity_id)
            .currency ||
        bank.direction !== (p.kind === "payment" ? "debit" : "credit") ||
        bank.date !== target.date
      )
        throw new DomainError(
          "Choose an unused bank entry with the same company, currency, date, amount and direction",
        );
      this.s.run(
        `INSERT INTO bookkeeping_bank_matches(bank_transaction_id,${column},matched_by,created_at) VALUES(?,?,?,?)`,
        bank.id,
        target.id,
        a.id,
        new Date().toISOString(),
      );
      this.s.audit(r.entity_id, a, "bookkeeping.bank_matched", id, {
        ...p,
        bank_reference: bank.reference,
      });
      return this.detail(a, id);
    });
  }
}
