import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FinanceStore, DomainError, type Actor } from "./domain";
import { localDate } from "./subscriptions";
const financeRoles = ["finance", "cfo", "auditor", "reconciler"];
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
  );
export class RecoveryService {
  constructor(
    private store: FinanceStore,
    private today = localDate,
  ) {}
  private obligation(a: Actor, id: string) {
    const s = this.store;
    const r = s.get(
      "SELECT ad.*,e.paid_by_id AS person_id,e.currency,e.description,u.name AS person FROM expense_adjustments ad JOIN spends e ON e.id=ad.spend_id JOIN users u ON u.id=e.paid_by_id WHERE ad.id=?",
      id,
    );
    if (!r) throw new DomainError("Recovery balance not found", 404);
    s.authorize(a, r.entity_id);
    if (!financeRoles.includes(a.role) && r.person_id !== a.id)
      throw new DomainError(
        "You may only view your own recovery balances",
        403,
      );
    return r;
  }
  list(a: Actor, entity: string) {
    const s = this.store;
    s.authorize(a, entity);
    const obligations = s
      .all(
        "SELECT id FROM expense_adjustments WHERE entity_id=? AND status='posted' AND recoverable_minor>0 ORDER BY date,id",
        entity,
      )
      .map((r) => this.obligationForList(a, r.id))
      .filter(Boolean)
      .map((r: any) => {
        const payments = s.all(
          "SELECT p.*,b.reference AS bank_reference FROM recovery_payments p LEFT JOIN bank_transactions b ON b.id=p.bank_transaction_id WHERE p.adjustment_id=? ORDER BY p.created_at,p.id",
          r.id,
        );
        const recovered = payments
            .filter((p) => p.status === "posted")
            .reduce((n, p) => n + p.amount_minor, 0),
          pending = payments
            .filter((p) => ["pending", "reconciled"].includes(p.status))
            .reduce((n, p) => n + p.amount_minor, 0);
        return {
          ...r,
          payments,
          recovered_minor: recovered,
          pending_minor: pending,
          outstanding_minor: r.recoverable_minor - recovered,
          available_minor: r.recoverable_minor - recovered - pending,
          history: s.all(
            "SELECT a.*,u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.resource_id=? AND a.action LIKE 'recovery.%' ORDER BY a.id",
            r.id,
          ),
        };
      });
    const people = [...new Set(obligations.map((r) => r.person_id))].map(
      (id) => {
        const rows = obligations.filter((r) => r.person_id === id);
        return {
          id,
          name: rows[0].person,
          outstanding_minor: rows.reduce((n, r) => n + r.outstanding_minor, 0),
          pending_minor: rows.reduce((n, r) => n + r.pending_minor, 0),
          recovered_minor: rows.reduce((n, r) => n + r.recovered_minor, 0),
        };
      },
    );
    return {
      today: this.today(),
      obligations,
      people,
      banks:
        a.role === "reconciler"
          ? s
              .bankTransactions(a, entity)
              .filter(
                (b) =>
                  b.direction === "credit" &&
                  !b.matched_spend_id &&
                  !b.matched_repayment_id &&
                  !b.matched_refund_id &&
                  !b.matched_recovery_id &&
                  !b.matched_record_payment_id &&
                  !b.matched_record_refund_id,
              )
          : [],
    };
  }
  private obligationForList(a: Actor, id: string) {
    const r = this.store.get(
      "SELECT e.paid_by_id FROM expense_adjustments ad JOIN spends e ON e.id=ad.spend_id WHERE ad.id=?",
      id,
    );
    return financeRoles.includes(a.role) || r.paid_by_id === a.id
      ? this.obligation(a, id)
      : null;
  }
  create(a: Actor, input: unknown) {
    const p = z
      .object({
        adjustment_id: z.string(),
        amount_minor: z.number().int().positive().max(1e12),
        date,
        reference: z.string().trim().min(1).max(120),
        note: z.string().trim().min(3).max(500),
      })
      .strict()
      .safeParse(input);
    if (!p.success)
      throw new DomainError(
        "Provide a recovery balance, positive amount, date, transfer reference and note",
      );
    return this.store.tx(() => {
      const s = this.store,
        v = p.data,
        r = this.obligation(a, v.adjustment_id);
      s.authorize(a, r.entity_id, ["employee", "manager", "finance", "cfo"]);
      if (a.role !== "finance" && a.id !== r.person_id)
        throw new DomainError(
          "Only Finance can record another person's repayment",
          403,
        );
      const existing = s.get(
        "SELECT * FROM recovery_payments WHERE entity_id=? AND reference=?",
        r.entity_id,
        v.reference,
      );
      if (existing) {
        if (Object.entries(v).every(([k, val]) => existing[k] === val))
          return existing;
        throw new DomainError(
          "Recovery reference already used with different details",
          409,
        );
      }
      if (r.status !== "posted" || r.recoverable_minor <= 0)
        throw new DomainError("Select a posted recoverable balance");
      if (v.date < r.date || v.date > this.today())
        throw new DomainError(
          "Repayment date must be between the refund date and today",
        );
      if (
        s.get(
          "SELECT id FROM (SELECT id,entity_id,reference FROM refunds UNION ALL SELECT id,entity_id,reference FROM bookkeeping_refunds) WHERE entity_id=? AND reference=?",
          r.entity_id,
          v.reference,
        )
      )
        throw new DomainError(
          "Reference already recorded as a vendor refund",
          409,
        );
      const used = s.get(
        "SELECT COALESCE(SUM(amount_minor),0) n FROM recovery_payments WHERE adjustment_id=? AND status<>'cancelled'",
        r.id,
      ).n;
      if (v.amount_minor > r.recoverable_minor - used)
        throw new DomainError("Amount exceeds the unreserved recovery balance");
      const id = `RC-${randomUUID().slice(0, 8)}`;
      s.run(
        "INSERT INTO recovery_payments(id,adjustment_id,entity_id,person_id,amount_minor,date,reference,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        id,
        r.id,
        r.entity_id,
        r.person_id,
        v.amount_minor,
        v.date,
        v.reference,
        v.note,
        a.id,
        new Date().toISOString(),
      );
      s.audit(r.entity_id, a, "recovery.recorded", r.id, { id, ...v });
      return s.get("SELECT * FROM recovery_payments WHERE id=?", id);
    });
  }
  action(a: Actor, id: string, input: unknown) {
    const p = z
      .object({
        action: z.enum(["cancel", "reconcile", "post"]),
        reference: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .safeParse(input);
    if (!p.success) throw new DomainError("Invalid recovery action");
    return this.store.tx(() => {
      const s = this.store,
        v = p.data,
        pay = s.get("SELECT * FROM recovery_payments WHERE id=?", id);
      if (!pay) throw new DomainError("Recovery payment not found", 404);
      const r = this.obligation(a, pay.adjustment_id);
      if (v.action === "cancel") {
        if (a.role !== "finance" && a.id !== pay.created_by)
          throw new DomainError("Only Finance or the recorder can cancel", 403);
        if (pay.status !== "pending")
          throw new DomainError(
            "Only unmatched pending repayments can be cancelled",
          );
        s.run("UPDATE recovery_payments SET status='cancelled' WHERE id=?", id);
      } else {
        s.authorize(
          a,
          r.entity_id,
          v.action === "reconcile" ? ["reconciler"] : ["finance"],
        );
        if (
          a.id === pay.person_id ||
          a.id ===
            (v.action === "reconcile" ? pay.created_by : pay.reconciler_id)
        )
          throw new DomainError(
            "Debtor, recorder and reconciler must be separate; the reconciler cannot post",
            403,
          );
        if (v.action === "post" && pay.status === "posted") return pay;
        if (pay.status !== (v.action === "post" ? "reconciled" : "pending"))
          throw new DomainError("Repayment is not ready for this action", 409);
        if (v.action === "reconcile") {
          const bank = s
            .bankTransactions(a, r.entity_id)
            .find((b) => b.reference === v.reference);
          if (
            !bank ||
            bank.direction !== "credit" ||
            bank.currency !== r.currency ||
            bank.amount_minor !== pay.amount_minor ||
            bank.date !== pay.date ||
            bank.matched_spend_id ||
            bank.matched_repayment_id ||
            bank.matched_refund_id ||
            bank.matched_recovery_id ||
            bank.matched_record_payment_id ||
            bank.matched_record_refund_id
          )
            throw new DomainError(
              "Select an unmatched bank credit with the exact entity, currency, amount and repayment date",
            );
          s.run(
            "UPDATE recovery_payments SET status='reconciled',bank_transaction_id=?,reconciler_id=? WHERE id=?",
            bank.id,
            a.id,
            id,
          );
        } else {
          s.postJournal(a, {
            entity_id: r.entity_id,
            date: pay.date,
            description: `Recovery · ${r.person} · ${pay.reference}`,
            source_id: r.spend_id,
            idempotency_key: `${id}:recovery`,
            approved_by: pay.reconciler_id,
            lines: [
              { account: "1100", debit: pay.amount_minor, credit: 0 },
              { account: "1200", debit: 0, credit: pay.amount_minor },
            ],
          });
          s.run("UPDATE recovery_payments SET status='posted' WHERE id=?", id);
        }
      }
      s.audit(r.entity_id, a, `recovery.${v.action}`, r.id, {
        id,
        amount_minor: pay.amount_minor,
        reference: v.reference || pay.reference,
      });
      return s.get("SELECT * FROM recovery_payments WHERE id=?", id);
    });
  }
}
