import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FinanceStore, DomainError, categories, type Actor } from "./domain";
import { localDate } from "./subscriptions";
const inputSchema = z
  .object({
    spend_id: z.string(),
    kind: z.enum(["credit_note", "personal_refund"]),
    amount_minor: z.number().int().positive().max(1e12),
    reference: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(5).max(500),
    evidence_reference: z.string().trim().min(3).max(300),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
      ),
  })
  .strict();
export class AdjustmentService {
  constructor(
    private store: FinanceStore,
    private today = localDate,
  ) {}
  private eligible(e: any, kind: string) {
    if (e.kind === "request" || !["approved", "posted"].includes(e.status))
      throw new DomainError(
        "Adjust an approved expense after finishing any payment in progress",
      );
    if (
      kind === "credit_note" &&
      (e.payment_source !== "company" ||
        e.original_paid_date ||
        e.settled_minor > 0)
    )
      throw new DomainError("Credit notes apply only to unpaid company bills");
    if (kind === "personal_refund" && e.payment_source === "company")
      throw new DomainError(
        "Personal refunds require an employee or founder as the original payer",
      );
    if (
      this.store.get(
        "SELECT p.id FROM reimbursement_payments p JOIN reimbursement_allocations a ON a.payment_id=p.id WHERE a.spend_id=? AND p.status IN ('scheduled','paid','reconciled')",
        e.id,
      )
    )
      throw new DomainError(
        "Cancel scheduled repayments or finish reconciliation and posting before recording an adjustment",
      );
  }
  create(a: Actor, input: unknown) {
    const p = inputSchema.safeParse(input);
    if (!p.success)
      throw new DomainError(
        "Provide the expense, adjustment type, positive amount, reference, evidence reference, reason and valid date",
      );
    return this.store.tx(() => {
      const s = this.store,
        v = p.data,
        e = s.spend(a, v.spend_id);
      s.authorize(a, e.entity_id, ["finance"]);
      const existing = s.get(
        "SELECT * FROM expense_adjustments WHERE entity_id=? AND reference=?",
        e.entity_id,
        v.reference,
      );
      if (existing) {
        if (Object.entries(v).every(([k, val]) => existing[k] === val))
          return existing;
        throw new DomainError(
          "Adjustment reference already used with different details",
          409,
        );
      }
      this.eligible(e, v.kind);
      if (
        v.date < e.date ||
        (v.kind === "personal_refund" && v.date < e.original_paid_date) ||
        v.date > this.today()
      )
        throw new DomainError(
          "Adjustment date must be on or after the expense and original personal payment dates, and no later than today",
        );
      if (
        s.get(
          "SELECT id FROM (SELECT id,entity_id,reference FROM refunds UNION ALL SELECT id,entity_id,reference FROM bookkeeping_refunds) WHERE entity_id=? AND reference=?",
          e.entity_id,
          v.reference,
        )
      )
        throw new DomainError(
          "This reference is already recorded as a cash refund",
          409,
        );
      const used = s.get(
        "SELECT (SELECT COALESCE(SUM(amount_minor),0) FROM expense_adjustments WHERE spend_id=? AND status<>'cancelled') + (SELECT COALESCE(SUM(amount_minor),0) FROM refunds WHERE spend_id=? AND status<>'cancelled') AS n",
        e.id,
        e.id,
      ).n;
      if (used + v.amount_minor > e.amount_minor)
        throw new DomainError(
          "Combined credits and refunds cannot exceed the original expense, including pending records",
        );
      const id = `AD-${randomUUID().slice(0, 8)}`;
      s.run(
        "INSERT INTO expense_adjustments(id,entity_id,spend_id,kind,amount_minor,reference,reason,evidence_reference,date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        id,
        e.entity_id,
        e.id,
        v.kind,
        v.amount_minor,
        v.reference,
        v.reason,
        v.evidence_reference,
        v.date,
        a.id,
        new Date().toISOString(),
      );
      s.audit(e.entity_id, a, "adjustment.created", e.id, { id, ...v });
      return s.get("SELECT * FROM expense_adjustments WHERE id=?", id);
    });
  }
  action(a: Actor, id: string, input: unknown) {
    const p = z
      .object({ action: z.enum(["cancel", "verify", "post"]) })
      .strict()
      .safeParse(input);
    if (!p.success) throw new DomainError("Invalid adjustment action");
    return this.store.tx(() => {
      const s = this.store,
        v = p.data,
        r = s.get("SELECT * FROM expense_adjustments WHERE id=?", id);
      if (!r) throw new DomainError("Adjustment not found", 404);
      s.authorize(
        a,
        r.entity_id,
        v.action === "verify" ? ["reconciler"] : ["finance"],
      );
      const e = s.spend(a, r.spend_id);
      if (v.action === "post" && r.status === "posted") return r;
      if (v.action === "cancel") {
        if (!["pending", "verified"].includes(r.status))
          throw new DomainError("Only unposted adjustments can be cancelled");
        s.run(
          "UPDATE expense_adjustments SET status='cancelled' WHERE id=?",
          id,
        );
      } else if (v.action === "verify") {
        if (r.status !== "pending")
          throw new DomainError("Adjustment is not awaiting verification");
        if (
          a.id === r.created_by ||
          a.id === e.paid_by_id ||
          a.id === e.requester_id
        )
          throw new DomainError(
            "Use a separate verifier who is not the claimant or requester",
            403,
          );
        s.run(
          "UPDATE expense_adjustments SET status='verified',verified_by=? WHERE id=?",
          a.id,
          id,
        );
      } else {
        if (r.status !== "verified")
          throw new DomainError(
            "Independent verification is required before posting",
          );
        if (a.id === r.verified_by || a.id === e.paid_by_id)
          throw new DomainError(
            "Verifier and beneficiary cannot post their own adjustment",
            403,
          );
        this.eligible(e, r.kind);
        const reduction = Math.min(r.amount_minor, e.outstanding_minor),
          recovery = r.amount_minor - reduction;
        if (recovery > 0 && r.kind !== "personal_refund")
          throw new DomainError("Credit exceeds the unpaid bill balance");
        // Recognize gross expense once; all credits use their own immutable journal keys.
        s.postJournal(a, {
          entity_id: e.entity_id,
          date: e.date,
          description: e.description,
          source_id: e.id,
          idempotency_key: `${e.id}:expense`,
          approved_by: e.finance_id,
          lines: [
            {
              account: categories[e.category],
              debit: e.amount_minor,
              credit: 0,
            },
            { account: "2100", debit: 0, credit: e.amount_minor },
          ],
        });
        if (recovery > 0)
          s.run(
            "INSERT OR IGNORE INTO accounts(entity_id,code,name,type) VALUES(?,'1200','Refunds recoverable from employees & founders','asset')",
            e.entity_id,
          );
        const lines = [];
        if (reduction > 0)
          lines.push({ account: "2100", debit: reduction, credit: 0 });
        if (recovery > 0)
          lines.push({ account: "1200", debit: recovery, credit: 0 });
        lines.push({
          account: categories[e.category],
          debit: 0,
          credit: r.amount_minor,
        });
        s.postJournal(a, {
          entity_id: e.entity_id,
          date: r.date,
          description: `${r.kind === "credit_note" ? "Credit note" : "Personal refund"} · ${r.reference}`,
          source_id: e.id,
          idempotency_key: `${id}:adjustment`,
          approved_by: r.verified_by,
          lines,
        });
        s.run(
          "UPDATE expense_adjustments SET status='posted',payable_reduction_minor=?,recoverable_minor=? WHERE id=?",
          reduction,
          recovery,
          id,
        );
        if (s.spend(a, e.id).outstanding_minor === 0 && e.status !== "posted")
          s.run(
            "UPDATE spends SET status='posted',payment_amount_minor=?,updated_at=? WHERE id=?",
            e.settled_minor,
            new Date().toISOString(),
            e.id,
          );
      }
      s.audit(r.entity_id, a, `adjustment.${v.action}`, e.id, {
        id,
        reference: r.reference,
        amount_minor: r.amount_minor,
      });
      return s.get("SELECT * FROM expense_adjustments WHERE id=?", id);
    });
  }
}
