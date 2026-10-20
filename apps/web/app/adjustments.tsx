"use client";
import Select from "./select";
import FinanceStatus from "./finance-status";
import { useState, type FormEvent } from "react";
type Row = Record<string, any>;
export default function Adjustments({
  data,
  user,
  currency,
  busy,
  mutate,
  onExpense,
}: {
  data: Row;
  user: Row;
  currency: string;
  busy: boolean;
  mutate: (p: string, b: Row) => Promise<boolean>;
  onExpense: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [expense, setExpense] = useState(""),
    [error, setError] = useState("");
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
      n / 100,
    );
  const selected = data.adjustment_eligible.find((e: Row) => e.id === expense);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const f = new FormData(event.currentTarget),
      value = String(f.get("amount"));
    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      setError("Enter a positive amount with up to two decimals");
      return;
    }
    const [whole, part = ""] = value.split(".");
    const amount = Number(BigInt(whole) * 100n + BigInt(part.padEnd(2, "0")));
    if (
      await mutate("/adjustments", {
        spend_id: expense,
        kind:
          selected.payment_source === "company"
            ? "credit_note"
            : "personal_refund",
        amount_minor: amount,
        date: f.get("date"),
        reference: f.get("reference"),
        evidence_reference: f.get("evidence"),
        reason: f.get("reason"),
      })
    ) {
      setOpen(false);
      setExpense("");
    }
  }
  return (
    <>
      <div className="report-explanation forecast-controls">
        <strong>
          {fmt(data.totals.posted_adjustments_minor)} credits & personal refunds
          posted
        </strong>
        <span>{fmt(data.totals.recoverable_minor)} due back to Jaye</span>
        {user.role === "finance" && (
          <button
            className="button secondary small"
            onClick={() => setOpen(!open)}
          >
            {open
              ? "Close adjustment form"
              : "Record credit or personal refund"}
          </button>
        )}
      </div>
      <p className="report-explanation">
        Finance records the credit note or refund received by the original
        employee/founder. Reconciler verifies the supporting document, then
        Finance posts it. Pending adjustments hold further payment scheduling.
        Any excess above that expense’s unpaid balance is shown as due back to
        Jaye; other claims are kept separate.
      </p>
      {error && (
        <p role="alert" className="bank-error">
          {error}
        </p>
      )}
      {open && (
        <form
          className="refund-form"
          onSubmit={save}
          aria-label="Record credit or personal refund"
        >
          <div className="finance-form-heading">
            <h3>Record credit or personal refund</h3>
            <p>Choose the original expense and add the supporting reference.</p>
          </div>
          <label>
            Expense to adjust
            <Select
              required
              value={expense}
              onChange={(e) => setExpense(e.target.value)}
            >
              <option value="">Select an approved expense</option>
              {data.adjustment_eligible.map((e: Row) => (
                <option key={e.id} value={e.id}>
                  {e.description} ·{" "}
                  {e.payment_source === "company"
                    ? "Vendor credit"
                    : "Personal refund"}{" "}
                  · available {fmt(e.refundable_minor)}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Adjustment amount ({currency})
            <input
              name="amount"
              required
              inputMode="decimal"
              placeholder="0.00"
            />
          </label>
          <label>
            Credit / refund date
            <input
              type="date"
              name="date"
              required
              max={data.today}
              min={selected?.date}
              defaultValue={data.today}
            />
          </label>
          <label>
            Credit note / refund reference
            <input name="reference" required maxLength={120} />
          </label>
          <label>
            Supporting document reference
            <input
              name="evidence"
              required
              minLength={3}
              maxLength={300}
              placeholder="Credit note number or refund receipt location"
            />
          </label>
          <label>
            Adjustment reason
            <input name="reason" required minLength={5} maxLength={500} />
          </label>
          {selected && (
            <p>
              {selected.payment_source === "company"
                ? "Unpaid vendor bill credit"
                : "Refund received by the original employee or founder"}{" "}
              · currently owed {fmt(selected.outstanding_minor)}.{" "}
              {selected.payment_source !== "company" &&
                "Any excess becomes an amount recoverable by Jaye."}
            </p>
          )}
          <div className="finance-form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy || !selected}>
              Save adjustment
            </button>
          </div>
        </form>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Adjustment / expense</th>
              <th>Type / recipient</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Balance impact</th>
              <th>Status / action</th>
            </tr>
          </thead>
          <tbody>
            {data.adjustments.map((r: Row) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.reference}</strong>
                  <small>
                    <button
                      className="report-link"
                      onClick={() => onExpense(r.spend_id)}
                    >
                      {r.description}
                    </button>
                  </small>
                  <small>{r.reason}</small>
                  <small>Evidence: {r.evidence_reference}</small>
                </td>
                <td>
                  {r.kind === "credit_note"
                    ? "Vendor credit note"
                    : "Personal refund"}
                  <small>{r.recipient}</small>
                </td>
                <td>{r.date}</td>
                <td>{fmt(r.amount_minor)}</td>
                <td>
                  {r.status === "posted" ? (
                    <>
                      {fmt(r.payable_reduction_minor)} less owed
                      <small>
                        {fmt(r.recoverable_minor)} originally recoverable
                      </small>
                      {r.recoverable_minor > 0 && (
                        <small>
                          {fmt(r.outstanding_recovery_minor)} still due ·{" "}
                          {fmt(r.recovered_minor)} recovered
                        </small>
                      )}
                    </>
                  ) : (
                    "No posted impact"
                  )}
                </td>
                <td>
                  <FinanceStatus status={r.status} />
                  <div className="subscription-actions">
                    {["pending", "verified"].includes(r.status) &&
                      user.role === "finance" && (
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() =>
                            mutate(`/adjustments/${r.id}/action`, {
                              action: "cancel",
                            })
                          }
                        >
                          Cancel adjustment
                        </button>
                      )}
                    {r.status === "pending" && user.role === "reconciler" && (
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() =>
                          mutate(`/adjustments/${r.id}/action`, {
                            action: "verify",
                          })
                        }
                      >
                        Verify document
                      </button>
                    )}
                    {r.status === "verified" && user.role === "finance" && (
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() =>
                          mutate(`/adjustments/${r.id}/action`, {
                            action: "post",
                          })
                        }
                      >
                        Post adjustment
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!data.adjustments.length && (
              <tr>
                <td colSpan={6}>
                  No credit notes or personal refunds recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="report-explanation">
        Verification confirms that the supporting document matches the expense,
        amount and recipient. This workflow records no cash movement in Jaye’s
        bank account. If the original expense is not yet booked, posting records
        that expense and its adjustment together. Use Recoveries to record
        repayments, match bank credits and clear balances. Other claims stay
        separate.
      </p>
    </>
  );
}
