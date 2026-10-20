"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Select from "./select";
type Row = Record<string, any>;
function minor(value: FormDataEntryValue | null) {
  const text = String(value || "");
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw Error("Enter an amount with up to two decimal places");
  const [whole, fraction = ""] = text.split(".");
  const valueMinor = Number(
    BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")),
  );
  if (!Number.isSafeInteger(valueMinor) || valueMinor <= 0 || valueMinor > 1e12)
    throw Error("Enter a valid positive amount");
  return valueMinor;
}
export default function SubscriptionPayment({
  subscription,
  cycle,
  currency,
  request,
  onDone,
  onCancel,
}: {
  subscription: Row;
  cycle: Row;
  currency: string;
  request: (p: string, o?: RequestInit) => Promise<any>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [paid, setPaid] = useState("unpaid"),
    [mode, setMode] = useState("new"),
    [billingDate, setBillingDate] = useState(
      cycle.manual ? "" : cycle.due_date,
    ),
    [records, setRecords] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const requestKey = useRef("");
  const panel = useRef<HTMLFormElement>(null);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  useEffect(() => {
    requestKey.current = crypto.randomUUID();
    panel.current?.scrollIntoView({ block: "start" });
    panel.current?.focus();
    request(`/records?entity=${subscription.entity_id}`)
      .then(setRecords)
      .catch((e) => setError(e.message));
  }, [request, subscription.entity_id]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(event.currentTarget),
        amount = mode === "new" ? minor(f.get("amount")) : 0;
      await request(`/subscriptions/${subscription.id}/expenses`, {
        method: "POST",
        body: JSON.stringify({
          due_date: cycle.manual
            ? String(f.get("billing_date"))
            : cycle.due_date,
          actual_bill: !!cycle.manual,
          request_key: requestKey.current,
          ...(mode === "existing"
            ? { record_id: String(f.get("record_id")) }
            : {
                amount_minor: amount,
                date: String(f.get("date")),
                reference: String(f.get("reference") || ""),
                ...(paid !== "unpaid"
                  ? {
                      payment: {
                        amount_minor:
                          paid === "partial"
                            ? minor(f.get("paid_amount"))
                            : amount,
                        date: String(f.get("payment_date")),
                        reference: String(f.get("payment_reference")),
                        method: String(f.get("method")),
                      },
                    }
                  : {}),
              }),
        }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      ref={panel}
      tabIndex={-1}
      className="form subscription-invoice finance-detail"
      onSubmit={save}
      aria-label="Record subscription expense"
    >
      <h3>{subscription.name} · Record bill / payment</h3>
      <p>
        Save once. The expense and its payment will appear in Expenses and
        update this billing cycle.
      </p>
      {error && (
        <p role="alert" className="simple-notice">
          {error}
        </p>
      )}
      {cycle.manual && (
        <label>
          <span>
            Billing date{" "}
            <span className="required-asterisk" aria-hidden="true">
              *
            </span>
          </span>
          <input
            name="billing_date"
            type="date"
            required
            max={today}
            defaultValue=""
            onChange={(e) => setBillingDate(e.target.value)}
          />
          <small>
            Use the date on this bill. For a scheduled charge, use its billing
            date shown in the Billing history. Each billing date can be recorded
            only once.
          </small>
        </label>
      )}
      {!cycle.manual && <p className="micro">Billing date: {cycle.due_date}</p>}
      {subscription.charges?.some(
        (c: Row) => c.due_date === billingDate && (c.record_id || c.spend_id),
      ) && (
        <p role="alert" className="simple-notice">
          This bill is already recorded. Open it from Billing history to add or
          correct a payment.
        </p>
      )}
      <label>
        Is this bill already in Expenses?
        <Select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="new">No — record it now</option>
          <option value="existing">Yes — link the existing expense</option>
        </Select>
      </label>
      {mode === "existing" ? (
        <label>
          Existing expense
          <Select name="record_id" required defaultValue="">
            <option value="" disabled>
              Choose an expense for {subscription.vendor}
            </option>
            {records
              .filter(
                (r) =>
                  r.kind === "expense" &&
                  !r.voided &&
                  r.payee.trim().toLowerCase() ===
                    subscription.vendor.trim().toLowerCase(),
              )
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.description} · {r.date} ·{" "}
                  {new Intl.NumberFormat("en-NG", {
                    style: "currency",
                    currency,
                  }).format(r.amount_minor / 100)}
                </option>
              ))}
          </Select>
          <small>Linking adds no cost or payment.</small>
        </label>
      ) : (
        <>
          <div className="form-row">
            <label>
              <span className="required-field-label">
                Bill amount ({currency}){" "}
                <span className="required-asterisk" aria-hidden="true">
                  *
                </span>
              </span>
              <input
                name="amount"
                inputMode="decimal"
                required
                defaultValue={(cycle.expected_minor / 100).toFixed(2)}
              />
            </label>
            <label>
              <span className="required-field-label">
                Expense date{" "}
                <span className="required-asterisk" aria-hidden="true">
                  *
                </span>
              </span>
              <input
                name="date"
                type="date"
                required
                max={today}
                defaultValue={
                  cycle.manual || cycle.due_date > today
                    ? today
                    : cycle.due_date
                }
              />
            </label>
          </div>
          <label>
            Has Jaye paid the supplier?
            <Select value={paid} onChange={(e) => setPaid(e.target.value)}>
              <option value="paid">Paid in full</option>
              <option value="partial">Partly paid</option>
              <option value="unpaid">Not paid yet</option>
            </Select>
          </label>
          {paid !== "unpaid" && (
            <>
              <div className="form-row">
                {paid === "partial" && (
                  <label>
                    <span className="required-field-label">
                      Amount paid ({currency}){" "}
                      <span className="required-asterisk" aria-hidden="true">
                        *
                      </span>
                    </span>
                    <input
                      name="paid_amount"
                      inputMode="decimal"
                      required
                      placeholder="0.00"
                    />
                  </label>
                )}
                <label>
                  <span className="required-field-label">
                    Payment date{" "}
                    <span className="required-asterisk" aria-hidden="true">
                      *
                    </span>
                  </span>
                  <input
                    name="payment_date"
                    type="date"
                    max={today}
                    defaultValue={today}
                    required
                  />
                </label>
                <label>
                  Payment method
                  <Select name="method">
                    <option>Bank transfer</option>
                    <option>Debit card</option>
                    <option>Cash</option>
                  </Select>
                </label>
              </div>
              <label>
                <span className="required-field-label">
                  Payment reference{" "}
                  <span className="required-asterisk" aria-hidden="true">
                    *
                  </span>
                </span>
                <input
                  name="payment_reference"
                  required
                  maxLength={180}
                  placeholder="Bank reference or unique voucher number"
                />
              </label>
            </>
          )}
          <label>
            Invoice number (optional)
            <input name="reference" maxLength={180} />
          </label>
        </>
      )}
      <p className="micro">
        Only record payments that have already been made. This does not send
        money. Add receipts and any later payments from Expenses.
      </p>
      <div className="action-buttons">
        <button
          className="button primary"
          disabled={
            busy ||
            subscription.charges?.some(
              (c: Row) =>
                c.due_date === billingDate && (c.record_id || c.spend_id),
            )
          }
        >
          {busy
            ? "Saving…"
            : mode === "existing"
              ? "Link expense"
              : paid === "unpaid"
                ? "Save expense"
                : "Save expense & payment"}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
