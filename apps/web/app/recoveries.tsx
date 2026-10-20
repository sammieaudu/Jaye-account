"use client";
import Select from "./select";
import FinanceStatus from "./finance-status";
import { useEffect, useState, type FormEvent } from "react";
type Row = Record<string, any>;
export default function Recoveries({
  entity,
  currency,
  user,
  request,
  onExpense,
}: {
  entity: string;
  currency: string;
  user: Row;
  request: (p: string, o?: RequestInit) => Promise<any>;
  onExpense: (id: string) => void;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [refs, setRefs] = useState<Record<string, string>>({});
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
      n / 100,
    );
  async function reload() {
    setData(await request(`/recoveries?entity=${entity}`));
  }
  useEffect(() => {
    let active = true;
    setData(null);
    request(`/recoveries?entity=${entity}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [entity, user.id, request]);
  async function mutate(path: string, body: Row) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(path, { method: "POST", body: JSON.stringify(body) });
      await reload();
      setMessage("Saved. Recovery balances refreshed.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      v = String(f.get("amount"));
    if (!/^\d+(\.\d{1,2})?$/.test(v)) {
      setError("Enter a positive amount with up to two decimals");
      return;
    }
    const [whole, part = ""] = v.split(".");
    if (
      await mutate("/recoveries", {
        adjustment_id: selected,
        amount_minor: Number(
          BigInt(whole) * 100n + BigInt(part.padEnd(2, "0")),
        ),
        date: f.get("date"),
        reference: f.get("reference"),
        note: f.get("note"),
      })
    )
      setSelected("");
  }
  const [viewId, setViewId] = useState("");
  return (
    <div className="operational-reports finance-workspace recoveries">
      {error && (
        <p className="bank-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="bank-result" role="status">
          {message}
        </p>
      )}
      {!data ? (
        <p>Loading recovery balances…</p>
      ) : (
        <>
          {viewId && (
            <button
              className="button secondary record-back"
              onClick={() => {
                setViewId("");
                setSelected("");
              }}
            >
              ← Back to recoveries
            </button>
          )}
          <div hidden={!!viewId}>
            <div className="metrics reporting-metrics">
              {[
                ["Still owed to Jaye", "outstanding_minor"],
                ["Awaiting matching / posting", "pending_minor"],
                ["Recovered & posted", "recovered_minor"],
              ].map(([title, key]) => (
                <section className="metric" key={key}>
                  <span className="metric-label">{title}</span>
                  <strong className="metric-value">
                    {fmt(
                      data.people.reduce(
                        (sum: number, person: Row) => sum + person[key],
                        0,
                      ),
                    )}
                  </strong>
                </section>
              ))}
            </div>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Amounts due back to Jaye</h2>
                  <p>
                    Record transfers already made. No money moves through this
                    local app.
                  </p>
                </div>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => reload().catch((e) => setError(e.message))}
                >
                  Refresh recoveries
                </button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Employee / founder</th>
                      <th>Still owed</th>
                      <th>Awaiting matching / posting</th>
                      <th>Recovered & posted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.people.map((p: Row) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{fmt(p.outstanding_minor)}</td>
                        <td>{fmt(p.pending_minor)}</td>
                        <td>{fmt(p.recovered_minor)}</td>
                      </tr>
                    ))}
                    {!data.people.length && (
                      <tr>
                        <td colSpan={4}>No recoverable balances.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="report-explanation">
                Pending repayments reserve part of the debt; they do not clear
                it. A separate Reconciler matches a bank credit, then Finance
                posts cash against the recovery receivable. Expenses and
                reimbursement claims are not reduced again.
              </p>
            </section>
          </div>
          {data.obligations
            .filter((o: Row) => !viewId || o.id === viewId)
            .map((o: Row) => (
              <section className="panel recovery-detail" key={o.id}>
                <div className="panel-heading">
                  <div>
                    <h2>
                      <button
                        className="claim-link"
                        onClick={() => setViewId(o.id)}
                      >
                        {o.person} · {o.reference}
                      </button>
                    </h2>
                    <p>
                      <button
                        className="report-link"
                        onClick={() => onExpense(o.spend_id)}
                      >
                        {o.description}
                      </button>{" "}
                      <FinanceStatus
                        status={
                          o.outstanding_minor === 0 ? "cleared" : "pending"
                        }
                      />
                    </p>
                  </div>
                  {(user.role === "finance" ||
                    (["employee", "manager", "cfo"].includes(user.role) &&
                      user.id === o.person_id)) &&
                    o.available_minor > 0 && (
                      <button
                        className="button secondary small"
                        onClick={() => {
                          setViewId(o.id);
                          setSelected(selected === o.id ? "" : o.id);
                        }}
                      >
                        Record repayment
                      </button>
                    )}
                </div>
                <div className="recovery-totals">
                  <span>
                    Original debt <strong>{fmt(o.recoverable_minor)}</strong>
                  </span>
                  <span>
                    Still owed <strong>{fmt(o.outstanding_minor)}</strong>
                  </span>
                  <span>
                    Available to record{" "}
                    <strong>{fmt(o.available_minor)}</strong>
                  </span>
                </div>
                <div hidden={viewId !== o.id}>
                  {selected === o.id && (
                    <form
                      className="refund-form"
                      onSubmit={save}
                      aria-label="Record recovery repayment"
                    >
                      <div className="finance-form-heading">
                        <h3>Record repayment</h3>
                        <p>
                          Link the transfer to this recovery. You can record
                          part or all of the available balance.
                        </p>
                      </div>
                      <label>
                        Repayment amount ({currency})
                        <input
                          name="amount"
                          required
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                      </label>
                      <label>
                        Transfer date
                        <input
                          name="date"
                          type="date"
                          required
                          min={o.date}
                          max={data.today}
                          defaultValue={data.today}
                        />
                      </label>
                      <label>
                        Transfer reference
                        <input name="reference" required maxLength={120} />
                      </label>
                      <label>
                        Payment note
                        <input
                          name="note"
                          required
                          minLength={3}
                          maxLength={500}
                          placeholder="Transfer receipt or payment details"
                        />
                      </label>
                      <div className="finance-form-actions">
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy}
                          onClick={() => setSelected("")}
                        >
                          Cancel
                        </button>
                        <button className="button primary" disabled={busy}>
                          Save repayment
                        </button>
                      </div>
                    </form>
                  )}
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Transfer / note</th>
                          <th>Date</th>
                          <th>Amount</th>
                          <th>Status</th>
                          <th>Bank match / action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.payments.map((p: Row) => (
                          <tr key={p.id}>
                            <td>
                              {p.reference}
                              <small>{p.note}</small>
                            </td>
                            <td>{p.date}</td>
                            <td>{fmt(p.amount_minor)}</td>
                            <td>
                              <FinanceStatus status={p.status} />
                            </td>
                            <td className="finance-table-actions">
                              {p.bank_reference}
                              {p.status === "pending" &&
                                (user.role === "finance" ||
                                  user.id === p.created_by) && (
                                  <button
                                    className="button secondary small"
                                    disabled={busy}
                                    onClick={() =>
                                      mutate(`/recoveries/${p.id}/action`, {
                                        action: "cancel",
                                      })
                                    }
                                  >
                                    Cancel repayment
                                  </button>
                                )}
                              {p.status === "pending" &&
                                user.role === "reconciler" && (
                                  <>
                                    <Select
                                      aria-label={`Recovery credit for ${p.reference}`}
                                      value={refs[p.id] || ""}
                                      onChange={(e) =>
                                        setRefs({
                                          ...refs,
                                          [p.id]: e.target.value,
                                        })
                                      }
                                    >
                                      <option value="">
                                        Select matching credit
                                      </option>
                                      {data.banks
                                        .filter(
                                          (b: Row) =>
                                            b.amount_minor === p.amount_minor &&
                                            b.date === p.date &&
                                            b.currency === currency,
                                        )
                                        .map((b: Row) => (
                                          <option
                                            key={b.id}
                                            value={b.reference}
                                          >
                                            {b.reference}
                                          </option>
                                        ))}
                                    </Select>
                                    <button
                                      className="button secondary small"
                                      disabled={busy || !refs[p.id]}
                                      onClick={() =>
                                        mutate(`/recoveries/${p.id}/action`, {
                                          action: "reconcile",
                                          reference: refs[p.id],
                                        })
                                      }
                                    >
                                      Match recovery
                                    </button>
                                  </>
                                )}
                              {p.status === "reconciled" &&
                                user.role === "finance" && (
                                  <button
                                    className="button secondary small"
                                    disabled={busy}
                                    onClick={() =>
                                      mutate(`/recoveries/${p.id}/action`, {
                                        action: "post",
                                      })
                                    }
                                  >
                                    Post recovery
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                        {!o.payments.length && (
                          <tr>
                            <td colSpan={5}>
                              No recovery repayments recorded.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <details className="report-explanation">
                    <summary>Recovery history</summary>
                    {o.history.map((h: Row) => (
                      <p key={h.id}>
                        {h.created_at} · {h.actor} · {h.action}
                      </p>
                    ))}
                  </details>
                </div>
              </section>
            ))}
          <p className="report-explanation">
            Import bank credits in Payments with direction “credit”. Match exact
            entity, currency, date and amount. A bank row can be used once
            across recoveries and vendor refunds.
          </p>
        </>
      )}
    </div>
  );
}
