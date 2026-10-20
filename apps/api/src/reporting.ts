import { BookkeepingService } from "./bookkeeping";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FinanceStore, DomainError, categories, type Actor } from "./domain";
import { SubscriptionService, localDate } from "./subscriptions";
const sum = (rows: any[], field: string) =>
  rows.reduce((n, r) => n + r[field], 0);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
  );
export class ReportingService {
  constructor(
    private store: FinanceStore,
    private today = localDate,
  ) {}
  report(a: Actor, entity: string, days = 90) {
    const s = this.store;
    s.authorize(a, entity, ["finance", "cfo", "reconciler", "auditor"]);
    const today = this.today();
    const subscriptions = new SubscriptionService(s, this.today).list(
      a,
      entity,
      days,
    );
    const expenses = s
      .list(a, entity)
      .filter((e: any) => e.kind !== "request" && e.status !== "rejected");
    const outstanding = expenses
      .filter((e: any) => e.outstanding_minor > 0)
      .map((e: any) => {
        const basis =
          e.payment_source === "company"
            ? e.due_date
            : e.original_paid_date || e.date;
        const age = basis
          ? Math.max(
              0,
              Math.floor((Date.parse(today) - Date.parse(basis)) / 86400000),
            )
          : null;
        return {
          ...e,
          age_days: age,
          age_basis: basis,
          bucket:
            age === null
              ? "No due date"
              : age === 0
                ? "Current"
                : age <= 30
                  ? "1–30 days"
                  : age <= 60
                    ? "31–60 days"
                    : age <= 90
                      ? "61–90 days"
                      : "90+ days",
          approved: e.approval_status === "approved",
        };
      });
    const bills = outstanding.filter(
      (e: any) => e.payment_source === "company",
    );
    const reimbursements = outstanding.filter(
      (e: any) => e.payment_source !== "company",
    );
    const people = [
      ...new Set(
        expenses
          .filter(
            (e: any) =>
              e.payment_source !== "company" &&
              (e.outstanding_minor > 0 || e.recoverable_minor > 0),
          )
          .map((e: any) => e.paid_by_id),
      ),
    ].map((id) => {
      const rows = reimbursements.filter((e: any) => e.paid_by_id === id);
      const approved = rows.filter((e: any) => e.approved);
      return {
        id,
        name: s.get("SELECT name FROM users WHERE id=?", id)?.name || "Unknown",
        recoverable_minor: sum(
          expenses.filter((e: any) => e.paid_by_id === id),
          "recoverable_minor",
        ),
        owed_minor: sum(approved, "outstanding_minor"),
        pending_minor: sum(
          rows.filter((e: any) => !e.approved),
          "outstanding_minor",
        ),
        buckets: Object.fromEntries(
          ["Current", "1–30 days", "31–60 days", "61–90 days", "90+ days"].map(
            (b) => [
              b,
              sum(
                approved.filter((e: any) => e.bucket === b),
                "outstanding_minor",
              ),
            ],
          ),
        ),
      };
    });
    // A linked invoice replaces its estimate. Personal invoices enter reimbursements, never vendor bills.
    const forecasts = subscriptions.charges
      .filter(
        (c: any) =>
          c.payment_due >= today &&
          c.payment_due <= subscriptions.through &&
          c.outstanding_minor > 0,
      )
      .map((c: any) => ({
        ...c,
        basis:
          c.expense && c.expense.status !== "rejected"
            ? "Recorded invoice"
            : "Estimate",
        forecast_minor: c.outstanding_minor,
      }));
    const refunds = s.all(
      "SELECT r.*,e.description,e.currency,b.reference AS bank_reference FROM refunds r JOIN spends e ON e.id=r.spend_id LEFT JOIN bank_transactions b ON b.id=r.bank_transaction_id WHERE r.entity_id=? ORDER BY r.created_at DESC",
      entity,
    );
    const adjustments = s.all(
      "SELECT r.*,e.description,e.currency,u.name AS recipient, (SELECT COALESCE(SUM(p.amount_minor),0) FROM recovery_payments p WHERE p.adjustment_id=r.id AND p.status='posted') AS recovered_minor, r.recoverable_minor-(SELECT COALESCE(SUM(p.amount_minor),0) FROM recovery_payments p WHERE p.adjustment_id=r.id AND p.status='posted') AS outstanding_recovery_minor FROM expense_adjustments r JOIN spends e ON e.id=r.spend_id LEFT JOIN users u ON u.id=e.paid_by_id WHERE r.entity_id=? ORDER BY r.created_at DESC",
      entity,
    );
    const documentedRefunds = s
      .all(
        "SELECT f.*,r.description,r.kind,b.reference AS bank_reference FROM bookkeeping_refunds f JOIN bookkeeping_records r ON r.id=f.record_id LEFT JOIN bookkeeping_bank_matches m ON m.refund_id=f.id LEFT JOIN bank_transactions b ON b.id=m.bank_transaction_id WHERE f.entity_id=? ORDER BY f.date DESC",
        entity,
      )
      .map((f) => ({ ...f, status: f.voided ? "Voided" : "posted" }));
    refunds.push(...documentedRefunds);
    const adjustmentTotal = sum(
      adjustments.filter((r) => r.status === "posted"),
      "amount_minor",
    );
    const bank = s.bankTransactions(a, entity);
    const unmatched = bank.filter(
      (b) =>
        !b.matched_spend_id &&
        !b.matched_repayment_id &&
        !b.matched_refund_id &&
        !b.matched_recovery_id &&
        !b.matched_record_payment_id &&
        !b.matched_record_refund_id,
    );
    const unposted = expenses
      .filter(
        (e: any) => ["paid", "reconciled"].includes(e.status) && !e.claim_id,
      )
      .map((e: any) => ({
        id: e.id,
        description: e.description,
        status: e.status,
        amount_minor: e.payment_amount_minor ?? e.effective_amount_minor,
      }));
    unposted.push(
      ...s.all(
        "SELECT id,'Grouped reimbursement' AS description,status,amount_minor FROM reimbursement_payments WHERE entity_id=? AND status IN ('paid','reconciled')",
        entity,
      ),
    );
    unposted.push(
      ...s.all(
        "SELECT id,'Recovery repayment' AS description,status,amount_minor FROM recovery_payments WHERE entity_id=? AND status IN ('pending','reconciled')",
        entity,
      ),
    );
    const documentation = new BookkeepingService(s).list(a, entity);
    const documentedReimbursements = documentation
      .filter(
        (r) => r.kind === "expense" && r.employee_id && r.outstanding_minor > 0,
      )
      .map((r) => {
        const age = Math.max(
          0,
          Math.floor((Date.parse(today) - Date.parse(r.date)) / 86400000),
        );
        return {
          ...r,
          age_days: age,
          bucket:
            age === 0
              ? "Current"
              : age <= 30
                ? "1–30 days"
                : age <= 60
                  ? "31–60 days"
                  : age <= 90
                    ? "61–90 days"
                    : "90+ days",
        };
      });
    const documentedPeople = [
      ...new Set(documentedReimbursements.map((r) => r.employee_id)),
    ].map((id) => {
      const rows = documentedReimbursements.filter((r) => r.employee_id === id);
      return {
        id: `employee:${id}`,
        name: rows[0].payee,
        owed_minor: sum(rows, "outstanding_minor"),
        pending_minor: 0,
        recoverable_minor: 0,
        buckets: Object.fromEntries(
          ["Current", "1–30 days", "31–60 days", "61–90 days", "90+ days"].map(
            (bucket) => [
              bucket,
              sum(
                rows.filter((r) => r.bucket === bucket),
                "outstanding_minor",
              ),
            ],
          ),
        ),
      };
    });
    const trial = s.trialBalance(a, entity);
    const postedRefunds = sum(
      refunds.filter((r) => r.status === "posted"),
      "amount_minor",
    );
    const netCost = sum(
      trial.filter((r) => r.type === "expense"),
      "balance",
    );
    return {
      documentation,
      documented_unmatched: s.all(
        "SELECT p.id,p.record_id,r.kind,r.description,p.amount_minor,p.date,p.reference,'payment' AS movement FROM bookkeeping_payments p JOIN bookkeeping_records r ON r.id=p.record_id LEFT JOIN bookkeeping_bank_matches m ON m.payment_id=p.id WHERE p.entity_id=? AND p.voided=0 AND p.method<>'Cash' AND m.bank_transaction_id IS NULL UNION ALL SELECT f.id,f.record_id,r.kind,r.description,f.amount_minor,f.date,f.reference,'refund' AS movement FROM bookkeeping_refunds f JOIN bookkeeping_records r ON r.id=f.record_id LEFT JOIN bookkeeping_bank_matches m ON m.refund_id=f.id WHERE f.entity_id=? AND f.voided=0 AND f.method<>'Cash' AND m.bank_transaction_id IS NULL",
        entity,
        entity,
      ),
      documented_bills: documentation
        .filter(
          (r) =>
            r.kind === "expense" && !r.employee_id && r.outstanding_minor > 0,
        )
        .map((r) => {
          const age = Math.max(
            0,
            Math.floor((Date.parse(today) - Date.parse(r.due_date)) / 86400000),
          );
          return {
            ...r,
            record_id: r.id,
            vendor: r.payee,
            approved: true,
            age_days: age,
            bucket:
              age === 0
                ? "Current"
                : age <= 30
                  ? "1–30 days"
                  : age <= 60
                    ? "31–60 days"
                    : age <= 90
                      ? "61–90 days"
                      : "90+ days",
          };
        }),
      documented_reimbursements: documentedReimbursements,
      documented_people: documentedPeople,
      documentation_totals: {
        cost_minor: sum(documentation, "amount_minor"),
        paid_minor: sum(documentation, "paid_minor"),
        outstanding_minor: sum(documentation, "outstanding_minor"),
        salary_owed_minor: sum(
          documentation.filter((r) => r.kind === "salary"),
          "outstanding_minor",
        ),
      },
      today,
      through: subscriptions.through,
      bills,
      reimbursements,
      people,
      forecasts,
      refunds,
      adjustments,
      adjustment_eligible: expenses
        .filter(
          (e: any) =>
            ["approved", "posted"].includes(e.status) &&
            (e.payment_source !== "company" ||
              (!e.original_paid_date && e.settled_minor === 0)),
        )
        .map((e: any) => ({
          ...e,
          refundable_minor:
            e.amount_minor -
            sum(
              refunds.filter(
                (r) => r.spend_id === e.id && r.status !== "cancelled",
              ),
              "amount_minor",
            ) -
            sum(
              adjustments.filter(
                (r) => r.spend_id === e.id && r.status !== "cancelled",
              ),
              "amount_minor",
            ),
        }))
        .filter((e: any) => e.refundable_minor > 0),
      unmatched,
      unposted,
      refund_eligible: expenses
        .filter((e: any) => e.status === "posted")
        .map((e: any) => ({
          ...e,
          refundable_minor:
            e.effective_amount_minor -
            sum(
              adjustments.filter(
                (r) =>
                  r.spend_id === e.id &&
                  ["pending", "verified"].includes(r.status),
              ),
              "amount_minor",
            ) -
            sum(
              refunds.filter(
                (r) => r.spend_id === e.id && r.status !== "cancelled",
              ),
              "amount_minor",
            ),
        }))
        .filter((e: any) => e.refundable_minor > 0),
      totals: {
        bills_minor: sum(
          bills.filter((e: any) => e.approved),
          "outstanding_minor",
        ),
        pending_minor: sum(
          outstanding.filter((e: any) => !e.approved),
          "outstanding_minor",
        ),
        reimbursements_minor: sum(people, "owed_minor"),
        recoverable_minor: sum(people, "recoverable_minor"),
        posted_adjustments_minor: adjustmentTotal,
        overdue_bills_minor: sum(
          bills.filter((e: any) => e.approved && e.age_days > 0),
          "outstanding_minor",
        ),
        forecast_minor: sum(forecasts, "forecast_minor"),
        forecast_estimates_minor: sum(
          forecasts.filter((c: any) => c.basis === "Estimate"),
          "forecast_minor",
        ),
        posted_refunds_minor: postedRefunds,
        pending_refunds_minor: sum(
          refunds.filter((r) => ["pending", "reconciled"].includes(r.status)),
          "amount_minor",
        ),
        gross_posted_cost_minor: netCost + postedRefunds + adjustmentTotal,
        net_posted_cost_minor: netCost,
        unmatched_debits_minor: sum(
          unmatched.filter((b) => b.direction === "debit"),
          "amount_minor",
        ),
        unmatched_credits_minor: sum(
          unmatched.filter((b) => b.direction === "credit"),
          "amount_minor",
        ),
      },
    };
  }
  createRefund(a: Actor, input: unknown) {
    const p = z
      .object({
        spend_id: z.string(),
        amount_minor: z.number().int().positive().max(1e12),
        reference: z.string().trim().min(1).max(120),
        reason: z.string().trim().min(5).max(500),
        date,
      })
      .strict()
      .safeParse(input);
    if (!p.success)
      throw new DomainError(
        "Enter an expense, positive refund amount, reference, reason and valid date",
      );
    return this.store.tx(() => {
      const s = this.store,
        v = p.data,
        expense = s.spend(a, v.spend_id);
      s.authorize(a, expense.entity_id, ["finance"]);
      const existing = s.get(
        "SELECT * FROM refunds WHERE entity_id=? AND reference=?",
        expense.entity_id,
        v.reference,
      );
      if (existing) {
        if (Object.entries(v).every(([k, val]) => existing[k] === val))
          return existing;
        throw new DomainError(
          "Refund reference already used with different details",
          409,
        );
      }
      if (
        s.get(
          "SELECT id FROM bookkeeping_refunds WHERE entity_id=? AND lower(reference)=lower(?)",
          expense.entity_id,
          v.reference,
        )
      )
        throw new DomainError(
          "Reference already recorded as a documented refund",
          409,
        );
      if (
        s.get(
          "SELECT id FROM expense_adjustments WHERE entity_id=? AND reference=?",
          expense.entity_id,
          v.reference,
        )
      )
        throw new DomainError(
          "This reference is already recorded as a credit or personal refund",
          409,
        );
      if (
        s.get(
          "SELECT id FROM recovery_payments WHERE entity_id=? AND reference=?",
          expense.entity_id,
          v.reference,
        )
      )
        throw new DomainError(
          "Reference already recorded as a recovery repayment",
          409,
        );
      if (expense.status !== "posted")
        throw new DomainError(
          "Refunds to Jaye require a fully settled and posted expense. Finish settlement first.",
        );
      if (v.date < expense.date || v.date > this.today())
        throw new DomainError(
          "Refund date must be between the expense date and today",
        );
      const used = s.get(
        "SELECT COALESCE(SUM(amount_minor),0) AS n FROM refunds WHERE spend_id=? AND status<>'cancelled'",
        expense.id,
      ).n;
      const adjusted = s.get(
        "SELECT COALESCE(SUM(amount_minor),0) AS n FROM expense_adjustments WHERE spend_id=? AND status<>'cancelled'",
        expense.id,
      ).n;
      if (used + adjusted + v.amount_minor > expense.amount_minor)
        throw new DomainError(
          "Refunds cannot exceed the original expense, including pending refunds",
        );
      const id = `RF-${randomUUID().slice(0, 8)}`;
      s.run(
        "INSERT INTO refunds(id,entity_id,spend_id,amount_minor,reference,reason,date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        expense.entity_id,
        expense.id,
        v.amount_minor,
        v.reference,
        v.reason,
        v.date,
        a.id,
        new Date().toISOString(),
      );
      s.audit(expense.entity_id, a, "refund.created", id, v);
      return s.get("SELECT * FROM refunds WHERE id=?", id);
    });
  }
  refundAction(a: Actor, id: string, input: unknown) {
    const p = z
      .object({
        action: z.enum(["cancel", "reconcile", "post"]),
        reference: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .safeParse(input);
    if (!p.success) throw new DomainError("Invalid refund action");
    return this.store.tx(() => {
      const s = this.store,
        r = s.get("SELECT * FROM refunds WHERE id=?", id),
        v = p.data;
      if (!r) throw new DomainError("Refund not found", 404);
      s.authorize(
        a,
        r.entity_id,
        v.action === "reconcile" ? ["reconciler"] : ["finance"],
      );
      if (v.action === "post" && r.status === "posted") return r;
      if (r.status !== (v.action === "post" ? "reconciled" : "pending"))
        throw new DomainError(
          "Refund is no longer available for this action",
          409,
        );
      let status = "cancelled";
      if (v.action === "reconcile") {
        const bank = s.get(
          "SELECT * FROM bank_transactions WHERE entity_id=? AND reference=?",
          r.entity_id,
          v.reference || "",
        );
        const expense = s.spend(a, r.spend_id);
        if (a.id === r.created_by || a.id === expense.paid_by_id)
          throw new DomainError("Use a separate reconciler", 403);
        if (
          !bank ||
          bank.direction !== "credit" ||
          bank.amount_minor !== r.amount_minor ||
          bank.currency !== expense.currency ||
          bank.date !== r.date ||
          bank.matched_spend_id ||
          s.get(
            "SELECT bank_transaction_id FROM bookkeeping_bank_matches WHERE bank_transaction_id=?",
            bank.id,
          ) ||
          s.get(
            "SELECT id FROM recovery_payments WHERE bank_transaction_id=?",
            bank.id,
          ) ||
          s.get(
            "SELECT id FROM refunds WHERE bank_transaction_id=?",
            bank.id,
          ) ||
          s.get(
            "SELECT payment_id FROM reimbursement_matches WHERE bank_transaction_id=?",
            bank.id,
          )
        )
          throw new DomainError(
            "Choose an unmatched bank credit with the same entity, currency, amount and refund date",
          );
        s.run(
          "UPDATE refunds SET bank_transaction_id=?,reconciler_id=? WHERE id=?",
          bank.id,
          a.id,
          id,
        );
        status = "reconciled";
      }
      if (v.action === "post") {
        const expense = s.spend(a, r.spend_id);
        s.postJournal(a, {
          entity_id: r.entity_id,
          date: r.date,
          description: `Refund · ${expense.description}`,
          source_id: expense.id,
          idempotency_key: `${id}:refund`,
          approved_by: r.reconciler_id,
          lines: [
            { account: "1100", debit: r.amount_minor, credit: 0 },
            {
              account: s.categoryAccount(expense.entity_id, expense.category),
              debit: 0,
              credit: r.amount_minor,
            },
          ],
        });
        status = "posted";
      }
      s.run("UPDATE refunds SET status=? WHERE id=?", status, id);
      s.audit(r.entity_id, a, `refund.${v.action}`, id, v);
      return s.get("SELECT * FROM refunds WHERE id=?", id);
    });
  }
}
