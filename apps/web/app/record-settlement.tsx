"use client";
import { useRef, useState, type FormEvent } from "react";
import Select from "./select";
type Row = Record<string, any>;
export default function RecordSettlement({
  record,
  currency,
  user,
  request,
  onSaved,
}: {
  record: Row;
  currency: string;
  user: Row;
  request: (path: string, options?: RequestInit) => Promise<any>;
  onSaved: (r: Row) => void;
}) {
  const [form, setForm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [action, setAction] = useState<Row | null>(null);
  const key = useRef("");
  const finance = user.role === "finance",
    canMatch = ["finance", "reconciler"].includes(user.role);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const money = (n: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
      n / 100,
    );
  async function mutate(path: string, body: Row, notice: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await request(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onSaved(r);
      setForm(false);
      setAction(null);
      setMessage(notice);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      v = String(f.get("amount"));
    if (!/^\d+(\.\d{1,2})?$/.test(v)) {
      setError("Enter an amount with up to two decimal places");
      return;
    }
    const [w, d = ""] = v.split(".");
    const amount = Number(BigInt(w) * 100n + BigInt(d.padEnd(2, "0")));
    await mutate(
      `/records/${record.id}/refunds`,
      {
        amount_minor: amount,
        date: f.get("date"),
        reference: f.get("reference"),
        reason: f.get("reason"),
        method: f.get("method"),
        request_key: key.current,
      },
      "Refund recorded. Net cost and money paid have been updated once.",
    );
  }
  const movements = [
    ...record.payments.map((p: Row) => ({ ...p, movement: "payment" })),
    ...record.refunds.map((p: Row) => ({ ...p, movement: "refund" })),
  ].filter((p: Row) => !p.voided);
  return (
    <section className="simple-evidence record-settlement">
      <div className="action-buttons">
        <h3>Refunds & money returned</h3>
        {finance && !record.voided && record.paid_minor > 0 && !form && (
          <button
            className="button secondary"
            onClick={() => {
              key.current = crypto.randomUUID();
              setForm(true);
              setError("");
            }}
          >
            Record refund
          </button>
        )}
      </div>
      <p>
        Record money actually returned to Jaye by the supplier or employee. This
        reduces the cost and net money paid; it does not change any unpaid
        balance.
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-banner" role="status">
          {message}
        </p>
      )}
      {form && (
        <form className="simple-form" onSubmit={refund}>
          <label>
            <span>
              Amount returned ({currency}){" "}
              <b className="required-asterisk" aria-hidden="true">
                *
              </b>
            </span>
            <input
              name="amount"
              inputMode="decimal"
              required
              placeholder="0.00"
            />
            <small>
              Up to {money(Math.min(record.amount_minor, record.paid_minor))}
            </small>
          </label>
          <label>
            <span>
              Date received{" "}
              <b className="required-asterisk" aria-hidden="true">
                *
              </b>
            </span>
            <input
              type="date"
              name="date"
              required
              min={record.date}
              max={today}
              defaultValue={today}
            />
          </label>
          <label>
            <span>
              Refund reference{" "}
              <b className="required-asterisk" aria-hidden="true">
                *
              </b>
            </span>
            <input
              name="reference"
              required
              maxLength={180}
              placeholder="Bank reference or cash receipt number"
            />
          </label>
          <label>
            Received into
            <Select name="method">
              <option>Bank transfer</option>
              <option>Cash</option>
            </Select>
          </label>
          <label className="full-width">
            <span>
              Reason for refund{" "}
              <b className="required-asterisk" aria-hidden="true">
                *
              </b>
            </span>
            <textarea name="reason" required minLength={3} maxLength={500} />
          </label>
          <div className="action-buttons full-width">
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save refund"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {record.refunds.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference / reason</th>
                <th>Amount returned</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {record.refunds.map((f: Row) => (
                <tr key={f.id}>
                  <td>{f.date}</td>
                  <td>
                    {f.reference}
                    <small>{f.reason}</small>
                  </td>
                  <td>{money(f.amount_minor)}</td>
                  <td>
                    {f.voided
                      ? "Reversed"
                      : f.bank_transaction_id
                        ? "Bank matched"
                        : "Recorded"}
                  </td>
                  <td>
                    {finance && !f.voided && !f.bank_transaction_id && (
                      <button
                        className="button small"
                        onClick={() =>
                          setAction({
                            kind: "refund",
                            target_id: f.id,
                            reverse: true,
                          })
                        }
                      >
                        Reverse mistaken refund
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No refunds recorded.</p>
      )}
      <h3>Bank reconciliation</h3>
      <p>
        Match each payment to money out and each refund to money in. Matching
        confirms the bank entry; it does not record another cost or payment. The
        date and amount must match.
      </p>
      {canMatch && (
        <details className="report-explanation">
          <summary>Import bank statement</summary>
          <p>
            Upload a CSV with columns:
            reference,date,currency,amount_minor,description,direction. Use
            YYYY-MM-DD dates, {currency}, positive amounts in minor units (100 =
            1 {currency}), and debit for money out or credit for money in.
          </p>
          <label>
            Statement CSV
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setError("");
                try {
                  if (file.size > 1024 * 1024)
                    throw Error("Statement must be under 1 MB");
                  await request("/banking/import", {
                    method: "POST",
                    body: JSON.stringify({
                      entity_id: record.entity_id,
                      csv: await file.text(),
                    }),
                  });
                  onSaved(await request(`/records/${record.id}`));
                  setMessage(
                    `Statement imported. Choose the matching entry below.`,
                  );
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
        </details>
      )}
      {movements.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Entry</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Bank match</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((p: Row) => {
                const candidates = record.bank_candidates.filter(
                  (b: Row) =>
                    b.amount_minor === p.amount_minor &&
                    b.date === p.date &&
                    b.direction ===
                      (p.movement === "payment" ? "debit" : "credit"),
                );
                return (
                  <tr key={p.id}>
                    <td>
                      {p.movement === "payment" ? "Payment" : "Refund"}
                      <small>{p.reference}</small>
                    </td>
                    <td>{p.date}</td>
                    <td>{money(p.amount_minor)}</td>
                    <td>
                      {p.method === "Cash" ? (
                        "Cash · no bank match needed"
                      ) : p.bank_transaction_id ? (
                        <>
                          <span>Matched · {p.bank_reference}</span>
                          {canMatch && (
                            <button
                              className="text-button"
                              onClick={() =>
                                setAction({
                                  kind: p.movement,
                                  target_id: p.id,
                                  remove: true,
                                })
                              }
                            >
                              Remove match
                            </button>
                          )}
                        </>
                      ) : canMatch ? (
                        <div className="action-buttons">
                          <Select
                            aria-label={`Bank entry for ${p.reference}`}
                            value={choices[p.id] || ""}
                            onChange={(e) =>
                              setChoices({ ...choices, [p.id]: e.target.value })
                            }
                          >
                            <option value="">
                              {candidates.length
                                ? "Choose bank entry"
                                : "No matching entry imported"}
                            </option>
                            {candidates.map((b: Row) => (
                              <option key={b.id} value={b.id}>
                                {b.reference} · {b.description}
                              </option>
                            ))}
                          </Select>
                          <button
                            className="button secondary small"
                            disabled={busy || !choices[p.id]}
                            onClick={() =>
                              mutate(
                                `/records/${record.id}/bank-match`,
                                {
                                  kind: p.movement,
                                  target_id: p.id,
                                  bank_transaction_id: choices[p.id],
                                },
                                "Bank entry matched. Balances are unchanged.",
                              )
                            }
                          >
                            Match
                          </button>
                        </div>
                      ) : (
                        "Not matched"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Record a payment first, then match it to the bank statement.</p>
      )}
      {action && (
        <form
          className="simple-form"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get("reason");
            void mutate(
              action.reverse
                ? `/records/${record.id}/refunds/${action.target_id}/reverse`
                : `/records/${record.id}/bank-match`,
              action.reverse
                ? { reason }
                : {
                    kind: action.kind,
                    target_id: action.target_id,
                    remove: true,
                    reason,
                  },
              action.reverse
                ? "Mistaken refund reversed. History is retained."
                : "Match removed. The bank entry is available again; balances are unchanged.",
            );
          }}
        >
          <label className="full-width">
            {action.reverse
              ? "Why was this refund entered by mistake?"
              : "Why are you removing this match?"}
            <textarea name="reason" minLength={3} maxLength={500} required />
          </label>
          <div className="action-buttons">
            <button className="button" disabled={busy}>
              {action.reverse ? "Reverse refund" : "Remove match"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setAction(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
