"use client";
import Select from "./select";
import FinanceStatus from "./finance-status";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Row = Record<string, any>;
type Request = (path: string, options?: RequestInit) => Promise<any>;
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
    value / 100,
  );
const label = (value: string) => value.replaceAll("_", " ");
function minor(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Enter a positive amount with at most two decimals");
  const [whole, part = ""] = value.split(".");
  const amount = BigInt(whole) * 100n + BigInt(part.padEnd(2, "0"));
  if (amount <= 0n || amount > 1000000000000n)
    throw new Error("Amount is outside the supported range");
  return Number(amount);
}
export default function Reimbursements({
  entity,
  currency,
  user,
  request,
  onExpense,
}: {
  entity: string;
  currency: string;
  user: Row;
  request: Request;
  onExpense: (id: string) => void;
}) {
  const detailPanel = useRef<HTMLElement>(null);
  const [data, setData] = useState<Row | null>(null);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [banks, setBanks] = useState<Row[]>([]);
  const [references, setReferences] = useState<Record<string, string>>({});
  const [person, setPerson] = useState("");
  const [message, setMessage] = useState("");
  async function reload() {
    const result = await request(`/reimbursements?entity=${entity}`);
    setData(result);
    if (user.role === "reconciler")
      setBanks(await request(`/banking/transactions?entity=${entity}`));
  }
  useEffect(() => {
    let active = true;
    request(`/reimbursements?entity=${entity}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    if (user.role === "reconciler")
      request(`/banking/transactions?entity=${entity}`)
        .then((rows) => {
          if (active) setBanks(rows);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [entity, user.id, request]);
  useEffect(() => {
    if (selected || editing) {
      detailPanel.current?.scrollIntoView({ block: "start" });
      detailPanel.current?.focus({ preventScroll: true });
    }
  }, [selected, editing]);
  const claim = data?.claims.find((c: Row) => c.id === selected);
  async function mutate(path: string, body: Row) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const c = await request(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await reload();
      setSelected(c.id);
      setEditing(false);
      setAmount("");
      setComment("");
      setMessage("Saved. The claim balances and audit trail are up to date.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function startEdit(c?: Row) {
    setSelected(c?.id || "");
    setTitle(c?.title || "");
    setIds(c?.items.map((s: Row) => s.id) || []);
    setEditing(true);
    setError("");
  }
  const eligible: Row[] = data
    ? [...data.eligible, ...(editing && claim ? claim.items : [])].filter(
        (s, i, all) => all.findIndex((x) => x.id === s.id) === i,
      )
    : [];
  const first = eligible.find((s) => ids.includes(s.id));
  const canCreate = ["employee", "manager", "finance", "cfo"].includes(
    user.role,
  );
  const canManage =
    claim &&
    claim.requester_id === user.id &&
    ["draft", "returned"].includes(claim.status);
  const reviewRole: Record<string, string> = {
    manager_review: "manager",
    finance_review: "finance",
    cfo_review: "cfo",
  };
  const canReview =
    claim &&
    reviewRole[claim.status] === user.role &&
    user.id !== claim.claimant_id &&
    user.id !== claim.requester_id;
  const canSchedule =
    claim &&
    claim.status === "approved" &&
    user.role === "finance" &&
    user.id !== claim.claimant_id &&
    user.id !== claim.requester_id;
  const balances: Row[] = data?.balances || [];
  const total = (key: string) => balances.reduce((sum, b) => sum + b[key], 0);
  if (!data)
    return (
      <section className="panel reimbursement-panel">
        <p role={error ? "alert" : "status"}>
          {error || "Loading reimbursements…"}
        </p>
        <button
          className="button secondary"
          onClick={() => reload().catch((e) => setError(e.message))}
        >
          Retry
        </button>
      </section>
    );
  return (
    <div className="reimbursements finance-workspace">
      <div hidden={!!claim || editing}>
        <div className="metrics reimbursement-metrics">
          {[
            ["Awaiting approval", "pending_minor"],
            ["Still owed · approved", "owed_minor"],
            ["Scheduled · included in owed", "scheduled_minor"],
            ["Reimbursed · confirmed", "reimbursed_minor"],
          ].map(([name, key]) => (
            <section className="metric" key={key}>
              <div className="metric-top">{name}</div>
              <strong className="metric-value">
                {money(total(key), currency)}
              </strong>
            </section>
          ))}
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {message && (
          <p role="status" className="success-text">
            {message}
          </p>
        )}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>What we owe each person</h2>
              <p>
                Includes grouped and individual personal expenses. Scheduled
                amounts remain owed until payment is confirmed.
              </p>
            </div>
          </div>
          {balances.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Employee / founder</th>
                    <th>Pending approval</th>
                    <th>Approved outstanding</th>
                    <th>Scheduled</th>
                    <th>Reimbursed</th>
                    <th>Due back to Jaye</th>
                    <th>Oldest unpaid expense</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.person_id}>
                      <td>
                        <button
                          className="button secondary small"
                          onClick={() =>
                            setPerson(person === b.person_id ? "" : b.person_id)
                          }
                        >
                          {b.name}
                        </button>
                      </td>
                      <td>{money(b.pending_minor, currency)}</td>
                      <td>
                        <strong>{money(b.owed_minor, currency)}</strong>
                      </td>
                      <td>{money(b.scheduled_minor, currency)}</td>
                      <td>{money(b.reimbursed_minor, currency)}</td>
                      <td>{money(b.recoverable_minor, currency)}</td>
                      <td>{b.oldest_date || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <h3>No personal expenses yet</h3>
              <p>
                Create an expense and choose employee-paid or founder-paid to
                start tracking what is owed.
              </p>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Reimbursement claims</h2>
              <p>
                Group your draft expenses for one person, entity and currency.
                Review receipts before approving.
              </p>
            </div>
            <div className="action-buttons">
              {person && (
                <button
                  className="button secondary small"
                  onClick={() => setPerson("")}
                >
                  Show all people
                </button>
              )}
              {canCreate && (
                <button
                  disabled={busy}
                  className="button primary"
                  onClick={() => startEdit()}
                >
                  New claim
                </button>
              )}
            </div>
          </div>
          {data.claims.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Person</th>
                    <th>Approval</th>
                    <th>Settlement</th>
                    <th>Total</th>
                    <th>Still owed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.claims
                    .filter((c: Row) => !person || c.claimant_id === person)
                    .map((c: Row) => (
                      <tr key={c.id}>
                        <td>
                          <button
                            className="claim-link"
                            onClick={() => {
                              setSelected(c.id);
                              setEditing(false);
                              setError("");
                              setComment("");
                              setAmount("");
                            }}
                          >
                            {c.title}
                          </button>
                          <small className="expense-subline">
                            {c.items.length} expense(s) · {c.id}
                          </small>
                        </td>
                        <td>{c.claimant}</td>
                        <td>
                          <FinanceStatus status={c.status} />
                        </td>
                        <td>{c.settlement_status}</td>
                        <td>{money(c.total_minor, currency)}</td>
                        <td>
                          {money(c.outstanding_minor, currency)}
                          {c.status !== "approved" && (
                            <small className="expense-subline">
                              {c.status === "rejected"
                                ? "Rejected"
                                : "Subject to approval"}
                            </small>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <p>
                No grouped claims yet. Create personal expense drafts in Spend,
                attach receipts, then add them to a claim here.
              </p>
            </div>
          )}
        </section>
      </div>
      {(claim || editing) && error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {(claim || editing) && message && <p role="status">{message}</p>}
      {editing && (
        <section
          className="panel reimbursement-panel finance-detail"
          ref={detailPanel}
          tabIndex={-1}
          aria-label={claim ? "Edit claim" : "New claim"}
        >
          <div className="finance-form-heading">
            <h2>{claim ? "Edit claim" : "New claim"}</h2>
            <p>
              Choose expenses for one employee or founder. Save a draft before
              submitting for approval.
            </p>
          </div>
          <form
            className="form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              mutate(`/reimbursements${claim ? `/${claim.id}/edit` : ""}`, {
                entity_id: entity,
                title,
                spend_ids: ids,
                ...(claim ? { expected_revision: claim.revision } : {}),
              });
            }}
          >
            <label>
              Claim title
              <input
                required
                minLength={3}
                maxLength={180}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. October field visits"
              />
            </label>
            <fieldset className="claim-items">
              <legend>Select your draft or returned expenses</legend>
              {eligible.map((s) => {
                const incompatible =
                  first &&
                  (s.paid_by_id !== first.paid_by_id ||
                    s.payment_source !== first.payment_source);
                return (
                  <label className="claim-checkbox" key={s.id}>
                    <input
                      type="checkbox"
                      checked={ids.includes(s.id)}
                      disabled={busy || !!incompatible}
                      onChange={(e) =>
                        setIds(
                          e.target.checked
                            ? [...ids, s.id]
                            : ids.filter((id) => id !== s.id),
                        )
                      }
                    />
                    <span>
                      <strong>{s.description}</strong>
                      <small>
                        {s.payment_source} · {money(s.amount_minor, currency)} ·{" "}
                        {s.date}
                      </small>
                    </span>
                  </label>
                );
              })}
              {!eligible.length && (
                <p>
                  No eligible drafts. Create personal expenses first using New
                  expense.
                </p>
              )}
            </fieldset>
            <p className="micro">
              Each expense can belong to one claim. Missing receipts will block
              submission.
            </p>
            <div className="action-buttons">
              <button className="button primary" disabled={busy || !ids.length}>
                Save claim
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      {claim && !editing && (
        <section
          className="panel reimbursement-panel finance-detail"
          ref={detailPanel}
          tabIndex={-1}
          aria-label="Claim details"
        >
          <div className="panel-heading">
            <div>
              <span className="kicker">{claim.id}</span>
              <h2>{claim.title}</h2>
              <FinanceStatus status={claim.status} />
              <p>
                {claim.claimant} · {claim.settlement_status}
              </p>
            </div>
            <button
              className="button secondary small"
              onClick={() => setSelected("")}
            >
              ← Back to reimbursements
            </button>
          </div>
          <div className="claim-totals">
            <span>
              Original total{" "}
              <strong>{money(claim.total_minor, currency)}</strong>
              <small>
                Credits / personal refunds:{" "}
                {money(claim.adjustment_minor, currency)} · Due back to Jaye:{" "}
                {money(claim.recoverable_minor, currency)}
              </small>
            </span>
            <span>
              Reimbursed{" "}
              <strong>{money(claim.reimbursed_minor, currency)}</strong>
            </span>
            <span>
              Still owed{" "}
              <strong>{money(claim.outstanding_minor, currency)}</strong>
            </span>
            <span>
              Available to schedule{" "}
              <strong>{money(claim.available_minor, currency)}</strong>
            </span>
          </div>
          <h3>Expenses & evidence</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Expense</th>
                  <th>Original payment</th>
                  <th>Amount</th>
                  <th>Reimbursed</th>
                  <th>Balance</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {claim.items.map((s: Row) => (
                  <tr key={s.id}>
                    <td>
                      {s.description}
                      <small className="expense-subline">
                        {s.vendor} · {s.category}
                      </small>
                    </td>
                    <td>{s.original_paid_date}</td>
                    <td>{money(s.amount_minor, currency)}</td>
                    <td>{money(s.reimbursed_minor, currency)}</td>
                    <td>{money(s.outstanding_minor, currency)}</td>
                    <td>
                      <button
                        className="button secondary small"
                        onClick={() => onExpense(s.id)}
                      >
                        View expense & receipts
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage && (
            <div className="action-buttons">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => startEdit(claim)}
              >
                Edit claim
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  mutate(`/reimbursements/${claim.id}/action`, {
                    action: "submit",
                  })
                }
              >
                Submit claim for approval
              </button>
            </div>
          )}
          {canReview && (
            <div className="form finance-action-form">
              <h3>Review claim</h3>
              <label>
                Review comment
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={1000}
                  placeholder="Required to return or reject"
                />
              </label>
              <div className="action-buttons">
                {["approve", "return", "reject"].map((action) => (
                  <button
                    className={
                      action === "approve"
                        ? "button primary"
                        : "button secondary"
                    }
                    disabled={busy || (action !== "approve" && !comment.trim())}
                    key={action}
                    onClick={() =>
                      mutate(`/reimbursements/${claim.id}/action`, {
                        action,
                        comment,
                      })
                    }
                  >
                    {action === "approve"
                      ? "Approve claim"
                      : action === "return"
                        ? "Return for changes"
                        : "Reject claim"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {canSchedule && claim.available_minor > 0 && (
            <form
              className="form repayment-form finance-action-form"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  mutate(`/reimbursements/${claim.id}/repayments`, {
                    amount_minor: minor(amount),
                    date,
                  });
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <h3>Schedule a partial or full repayment</h3>
              <p className="micro">
                The first scheduled repayment records the full approved expense
                liability once. Reconciled repayments reduce that liability when
                posted. Allocations follow oldest expense first.
              </p>
              <div className="form-row">
                <label>
                  Repayment amount ({currency})
                  <input
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder={(claim.available_minor / 100).toFixed(2)}
                  />
                </label>
                <label>
                  Payment date
                  <input
                    required
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              </div>
              <button className="button primary" disabled={busy}>
                Schedule repayment
              </button>
            </form>
          )}
          <h3>Repayment history</h3>
          {!claim.payments.length && (
            <p className="muted">No repayments scheduled yet.</p>
          )}
          {claim.payments.map((p: Row) => {
            const reviewers = claim.items.flatMap((s: Row) => [
              s.manager_id,
              s.finance_id,
              s.cfo_id,
              s.requester_id,
            ]);
            const independent = ![
              claim.claimant_id,
              claim.requester_id,
              p.scheduled_by,
              p.payer_id,
              ...reviewers,
            ].includes(user.id);
            const action =
              p.status === "scheduled" && user.role === "payer" && independent
                ? "confirm"
                : p.status === "paid" &&
                    user.role === "reconciler" &&
                    independent
                  ? "reconcile"
                  : p.status === "reconciled" && canSchedule
                    ? "post"
                    : null;
            return (
              <div className="repayment-card" key={p.id}>
                <div>
                  <strong>{money(p.amount_minor, currency)}</strong>
                  <FinanceStatus status={p.status} />
                  <small>
                    {p.date} · {p.id}
                  </small>
                  <small>
                    Bank reference: {p.reference || "Not confirmed"}
                    {p.statement_reference
                      ? ` · Statement: ${p.statement_reference}`
                      : ""}
                  </small>
                </div>
                {action && (
                  <div className="repayment-actions">
                    {action === "confirm" && (
                      <label>
                        Bank reference
                        <input
                          aria-label={`Bank reference ${p.id}`}
                          value={references[p.id] || ""}
                          onChange={(e) =>
                            setReferences({
                              ...references,
                              [p.id]: e.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    {action === "reconcile" && (
                      <label>
                        Imported statement row
                        <Select
                          aria-label={`Statement row ${p.id}`}
                          value={references[p.id] || ""}
                          onChange={(e) =>
                            setReferences({
                              ...references,
                              [p.id]: e.target.value,
                            })
                          }
                        >
                          <option value="">Select matching debit</option>
                          {banks
                            .filter(
                              (b) =>
                                !b.matched_spend_id &&
                                !b.matched_repayment_id &&
                                b.direction === "debit" &&
                                b.amount_minor === p.amount_minor &&
                                b.currency === currency,
                            )
                            .map((b) => (
                              <option key={b.id} value={b.reference}>
                                {b.reference} · {b.date}
                              </option>
                            ))}
                        </Select>
                      </label>
                    )}
                    <button
                      className="button primary small"
                      disabled={
                        busy || (action !== "post" && !references[p.id]?.trim())
                      }
                      onClick={() =>
                        mutate(`/repayments/${p.id}/action`, {
                          action,
                          ...(action !== "post"
                            ? { reference: references[p.id] }
                            : {}),
                        })
                      }
                    >
                      {action === "confirm"
                        ? "Record repayment confirmation"
                        : action === "reconcile"
                          ? "Reconcile repayment"
                          : "Post repayment journal"}
                    </button>
                  </div>
                )}
                {p.status === "scheduled" && canSchedule && (
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() =>
                      mutate(`/repayments/${p.id}/action`, { action: "cancel" })
                    }
                  >
                    Cancel scheduled repayment
                  </button>
                )}
              </div>
            );
          })}
          {user.role === "reconciler" && (
            <p className="micro">
              Import statement CSVs in Payments, then return here to match each
              repayment.
            </p>
          )}
          <p className="micro">
            Record repayments made outside Jaye. This does not transfer money.
          </p>
          <details className="claim-history">
            <summary>Claim activity & approval history</summary>
            {claim.history.map((h: Row) => (
              <p key={h.id}>
                <strong>{label(h.action.replace("claim.", ""))}</strong> ·{" "}
                {h.actor} · {new Date(h.created_at).toLocaleString()}
                {JSON.parse(h.details).comment && (
                  <span> — {JSON.parse(h.details).comment}</span>
                )}
              </p>
            ))}
          </details>
        </section>
      )}
    </div>
  );
}
