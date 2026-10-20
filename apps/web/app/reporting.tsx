"use client";
import Select from "./select";
import FinanceStatus from "./finance-status";
import Adjustments from "./adjustments";
import { useEffect, useState, type FormEvent } from "react";
type Row = Record<string, any>;
const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
    n / 100,
  );
const tabs = [
  "Bills awaiting approval or payment",
  "Reimbursement ageing",
  "Recurring forecast",
  "Refunds",
  "Reconciliation",
  "Credits & personal refunds",
  "Recorded expenses & payroll",
];
export default function Reporting({
  entity,
  currency,
  user,
  request,
  onExpense,
  onRecord,
  onChanged,
}: {
  entity: string;
  currency: string;
  user: Row;
  request: (p: string, o?: RequestInit) => Promise<any>;
  onExpense: (id: string) => void;
  onRecord: (id?: string, kind?: string) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState(tabs[6]),
    [days, setDays] = useState("90"),
    [busy, setBusy] = useState(false),
    [references, setReferences] = useState<Record<string, string>>({}),
    [showForm, setShowForm] = useState(false);
  async function reload() {
    setData(await request(`/reports/operations?entity=${entity}&days=${days}`));
  }
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    request(`/reports/operations?entity=${entity}&days=${days}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [entity, user.id, days, request]);
  async function mutate(path: string, body: Row) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(path, { method: "POST", body: JSON.stringify(body) });
      await reload();
      onChanged();
      setMessage("Saved. Reports have been refreshed.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function refund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = String(f.get("amount"));
    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      setError("Enter an amount with up to two decimals");
      return;
    }
    const [whole, part = ""] = value.split(".");
    const amount = Number(BigInt(whole) * 100n + BigInt(part.padEnd(2, "0")));
    if (
      await mutate("/refunds", {
        spend_id: f.get("spend"),
        amount_minor: amount,
        reference: f.get("reference"),
        reason: f.get("reason"),
        date: f.get("date"),
      })
    )
      setShowForm(false);
  }
  function download() {
    if (!data) return;
    const rows: any[][] = [
      ["Report", tab, "As of", data.today, "Currency", currency],
    ];
    if (tab === tabs[6])
      rows.push(
        [
          "Description",
          "Payee",
          "Kind",
          "Date",
          "Net cost minor units",
          "Net paid minor units",
          "Outstanding minor units",
        ],
        ...data.documentation.map((r: Row) => [
          r.description,
          r.payee,
          r.kind,
          r.date,
          r.amount_minor,
          r.paid_minor,
          r.outstanding_minor,
        ]),
      );
    if (tab === tabs[0])
      rows.push(
        [
          "Expense",
          "Description",
          "Due",
          "Approval",
          "Outstanding minor units",
        ],
        ...[...data.bills, ...data.documented_bills].map((r: Row) => [
          r.id,
          r.description,
          r.due_date,
          r.record_id ? "Recorded" : r.approved ? "Approved" : "Pending",
          r.outstanding_minor,
        ]),
      );
    if (tab === tabs[1])
      rows.push(
        [
          "Person",
          "Recorded / approved owed minor units",
          "Pending minor units",
          "Recoverable minor units",
          "Current",
          "1–30",
          "31–60",
          "61–90",
          "90+",
        ],
        ...[...data.people, ...data.documented_people].map((r: Row) => [
          r.name,
          r.owed_minor,
          r.pending_minor,
          ...Object.values(r.buckets),
        ]),
      );
    if (tab === tabs[2])
      rows.push(
        ["Through", data.through],
        ["Subscription", "Owner", "Due", "Basis", "Amount minor units"],
        ...data.forecasts.map((r: Row) => [
          r.subscription,
          r.owner,
          r.payment_due,
          r.basis,
          r.forecast_minor,
        ]),
      );
    if (tab === tabs[3])
      rows.push(
        [
          "Refund",
          "Expense",
          "Reference",
          "Date",
          "Status",
          "Amount minor units",
        ],
        ...data.refunds.map((r: Row) => [
          r.id,
          r.record_id || r.spend_id,
          r.reference,
          r.date,
          r.status,
          r.amount_minor,
        ]),
      );
    if (tab === tabs[4])
      rows.push(
        [
          "Record",
          "Description",
          "Date",
          "Status or direction",
          "Amount minor units",
        ],
        ...data.unmatched.map((r: Row) => [
          r.reference,
          r.description,
          r.date,
          r.direction,
          r.amount_minor,
        ]),
        ...data.documented_unmatched.map((r: Row) => [
          r.reference,
          r.description,
          r.date,
          `${r.movement} awaiting bank match`,
          r.amount_minor,
        ]),
        ...data.unposted.map((r: Row) => [
          r.id,
          r.description,
          "",
          r.status,
          r.amount_minor,
        ]),
      );
    if (tab === tabs[5])
      rows.push(
        [
          "Adjustment",
          "Expense",
          "Type",
          "Reference",
          "Date",
          "Status",
          "Amount minor units",
          "Payable reduction minor units",
          "Recoverable minor units",
        ],
        ...data.adjustments.map((r: Row) => [
          r.id,
          r.spend_id,
          r.kind,
          r.reference,
          r.date,
          r.status,
          r.amount_minor,
          r.payable_reduction_minor,
          r.recoverable_minor,
        ]),
      );
    const csv = rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v ?? "")
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `jaye-${entity}-${tab.toLowerCase().replaceAll(" ", "-")}-${data.today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const fmt = (n: number) => money(n, currency);
  return (
    <div className="operational-reports finance-workspace">
      {error && (
        <p role="alert" className="bank-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="bank-result">
          {message}
        </p>
      )}
      {!data ? (
        <p>Loading operational reports…</p>
      ) : (
        <>
          <div className="metrics reporting-metrics">
            {[
              [
                "Total still owed",
                data.totals.bills_minor +
                  data.totals.reimbursements_minor +
                  data.documentation_totals.outstanding_minor,
                "Recorded costs and approved workflow balances",
              ],
              [
                "Salary payments due",
                data.documentation_totals.salary_owed_minor,
                "Included in total still owed",
              ],
              [
                "Net posted costs",
                data.totals.net_posted_cost_minor,
                `${fmt(data.totals.posted_refunds_minor + data.totals.posted_adjustments_minor)} refunds & credits deducted`,
              ],
            ].map(([label, value, note]) => (
              <div className="metric" key={String(label)}>
                <span className="metric-label">{label}</span>
                <strong className="metric-value">{fmt(Number(value))}</strong>
                <span className="metric-note">{note}</span>
              </div>
            ))}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Reporting & reconciliation</h2>
                <p>
                  As of {data.today} · {currency} · current balances
                </p>
              </div>
              <button className="button secondary small" onClick={download}>
                Export this report
              </button>
            </div>
            <div
              className="report-tabs finance-tabs"
              aria-label="Operational reports"
            >
              {[tabs[6], ...tabs.slice(0, 6)].map((t) => (
                <button
                  key={t}
                  aria-pressed={t === tab}
                  className={t === tab ? "selected" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="report-explanation">
              {tab === tabs[6]
                ? "These costs are already included in net posted costs above. Payments reduce what is owed; they are not counted as another cost. Costs and payments shown here are net of received refunds."
                : tab === tabs[0]
                  ? `Recorded expenses and approved bills show what Jaye still owes suppliers. ${fmt(data.totals.pending_minor)} across bills and reimbursements is awaiting approval and excluded from approved balances. Company payments already recorded are excluded from amounts owed.`
                  : tab === tabs[1]
                    ? "Documented expenses age from their record date; approval-workflow claims age from the person’s original payment date. Only outstanding recorded or approved amounts enter ageing. Salaries are shown separately."
                    : tab === tabs[2]
                      ? "Forecasts show recurring cash needs within the selected horizon. A recorded invoice replaces its estimate. These amounts overlap outstanding bills and reimbursements: do not add the totals together."
                      : tab === tabs[3]
                        ? "Record cash returned to Jaye against a fully settled, posted expense. A separate reconciler matches the bank credit, then Finance posts it once. Pending refunds do not reduce costs or balances owed."
                        : tab === tabs[5]
                          ? "Credit notes reduce vendor bills. Personal refunds reduce reimbursements, with any excess tracked as recoverable from the recipient."
                          : "Each bank row can match one payment or refund. Simple expense and salary entries are already posted; matching them never posts again. Approval-workflow entries may still require posting."}
            </div>
            {tab === tabs[6] && (
              <>
                <div className="simple-totals">
                  <div>
                    <span>Documented costs</span>
                    <strong>{fmt(data.documentation_totals.cost_minor)}</strong>
                  </div>
                  <div>
                    <span>Payments recorded</span>
                    <strong>{fmt(data.documentation_totals.paid_minor)}</strong>
                  </div>
                  <div>
                    <span>Still owed</span>
                    <strong>
                      {fmt(data.documentation_totals.outstanding_minor)}
                    </strong>
                  </div>
                </div>
                {data.documentation.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Payee</th>
                          <th>Kind</th>
                          <th>Cost</th>
                          <th>Paid</th>
                          <th>Still owed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.documentation.map((r: Row) => (
                          <tr key={r.id}>
                            <td>
                              <button
                                className="report-link"
                                onClick={() => onRecord(r.id, r.kind)}
                              >
                                {r.description}
                              </button>
                              <small>{r.date}</small>
                            </td>
                            <td>{r.payee}</td>
                            <td>
                              {r.kind === "salary"
                                ? "Salary"
                                : r.employee_id
                                  ? "Reimbursement"
                                  : "Expense"}
                            </td>
                            <td>{fmt(r.amount_minor)}</td>
                            <td>{fmt(r.paid_minor)}</td>
                            <td>{fmt(r.outstanding_minor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="simple-loading">
                    No expense or salary records yet. Start in Expenses or
                    Payroll.
                  </p>
                )}
              </>
            )}
            {tab === tabs[5] && (
              <Adjustments
                data={data}
                user={user}
                currency={currency}
                busy={busy}
                mutate={mutate}
                onExpense={onExpense}
              />
            )}
            {tab === tabs[0] && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Expense / vendor</th>
                      <th>Due date</th>
                      <th>Age</th>
                      <th>Status</th>
                      <th className="number">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.bills, ...data.documented_bills].map((r: Row) => (
                      <tr key={r.id}>
                        <td>
                          <button
                            className="report-link"
                            onClick={() =>
                              r.record_id
                                ? onRecord(r.record_id)
                                : onExpense(r.id)
                            }
                          >
                            {r.description}
                          </button>
                          <small>{r.vendor}</small>
                        </td>
                        <td>{r.due_date || "Not set"}</td>
                        <td>{r.bucket}</td>
                        <td>
                          {r.record_id ? (
                            <FinanceStatus status={r.status} />
                          ) : (
                            <FinanceStatus
                              status={r.approved ? "approved" : "pending"}
                            />
                          )}
                        </td>
                        <td className="number">{fmt(r.outstanding_minor)}</td>
                      </tr>
                    ))}
                    {!data.bills.length && !data.documented_bills.length && (
                      <tr>
                        <td colSpan={5}>No outstanding vendor bills.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {tab === tabs[1] && (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Amount owed</th>
                        <th>Pending approval</th>
                        <th>Due back to Jaye</th>
                        {["Current", "1–30", "31–60", "61–90", "90+"].map(
                          (b) => (
                            <th key={b}>{b} days</th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.people, ...data.documented_people].map(
                        (p: Row) => (
                          <tr key={p.id}>
                            <td>{p.name}</td>
                            <td>{fmt(p.owed_minor)}</td>
                            <td>{fmt(p.pending_minor)}</td>
                            <td>{fmt(p.recoverable_minor)}</td>
                            {Object.entries(p.buckets).map(([b, n]) => (
                              <td key={b}>{fmt(Number(n))}</td>
                            ))}
                          </tr>
                        ),
                      )}
                      {!data.people.length &&
                        !data.documented_people.length && (
                          <tr>
                            <td colSpan={9}>No outstanding reimbursements.</td>
                          </tr>
                        )}
                    </tbody>
                  </table>
                </div>
                <details className="report-explanation">
                  <summary>View individual expenses</summary>
                  <p>
                    Documented employee expenses age from their record date.
                    Salary balances appear under Recorded expenses & payroll.
                  </p>
                  {data.documented_reimbursements.map((r: Row) => (
                    <p key={r.id}>
                      <button
                        className="report-link"
                        onClick={() => onRecord(r.id)}
                      >
                        {r.description}
                      </button>{" "}
                      · {r.age_days} days · {fmt(r.outstanding_minor)} ·
                      Recorded
                    </p>
                  ))}
                  {data.reimbursements.map((r: Row) => (
                    <p key={r.id}>
                      <button
                        className="report-link"
                        onClick={() => onExpense(r.id)}
                      >
                        {r.description}
                      </button>{" "}
                      · {r.age_days} days · {fmt(r.outstanding_minor)} ·{" "}
                      {r.approved ? "Approved" : "Pending approval"}
                    </p>
                  ))}
                </details>
              </>
            )}
            {tab === tabs[2] && (
              <>
                <div className="report-explanation forecast-controls">
                  <label>
                    Forecast horizon{" "}
                    <Select
                      aria-label="Forecast horizon"
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                    >
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="365">365 days</option>
                    </Select>
                  </label>
                  <strong>
                    {fmt(data.totals.forecast_minor)} through {data.through}
                  </strong>
                  <span>
                    {fmt(data.totals.forecast_estimates_minor)} estimated ·{" "}
                    {fmt(
                      data.totals.forecast_minor -
                        data.totals.forecast_estimates_minor,
                    )}{" "}
                    recorded
                  </span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Subscription</th>
                        <th>Owner</th>
                        <th>Payment due</th>
                        <th>Basis</th>
                        <th className="number">Expected outflow</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.forecasts.map((r: Row) => (
                        <tr key={`${r.subscription_id}:${r.due_date}`}>
                          <td>{r.subscription}</td>
                          <td>{r.owner}</td>
                          <td>{r.payment_due}</td>
                          <td>
                            {r.basis}
                            {r.expense && r.basis === "Recorded invoice" && (
                              <button
                                className="report-link"
                                onClick={() =>
                                  r.record_id
                                    ? onRecord(r.record_id)
                                    : onExpense(r.expense.id)
                                }
                              >
                                {" "}
                                · Open expense
                              </button>
                            )}
                          </td>
                          <td className="number">{fmt(r.forecast_minor)}</td>
                        </tr>
                      ))}
                      {!data.forecasts.length && (
                        <tr>
                          <td colSpan={5}>
                            No recurring payments in this horizon.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {tab === tabs[3] && (
              <>
                <div className="report-explanation forecast-controls">
                  <span>
                    {fmt(data.totals.pending_refunds_minor)} pending ·{" "}
                    {fmt(data.totals.posted_refunds_minor)} posted
                  </span>
                  {user.role === "finance" && (
                    <button
                      className="button secondary small"
                      onClick={() => setShowForm(!showForm)}
                    >
                      {showForm ? "Close form" : "Record refund"}
                    </button>
                  )}
                </div>
                {showForm && (
                  <form
                    className="refund-form"
                    onSubmit={refund}
                    aria-label="Record vendor refund"
                  >
                    <div className="finance-form-heading">
                      <h3>Record vendor refund</h3>
                      <p>
                        Record money received by Jaye against a settled expense.
                      </p>
                    </div>
                    <label>
                      Original expense
                      <Select name="spend" required>
                        <option value="">Select a settled expense</option>
                        {data.refund_eligible.map((r: Row) => (
                          <option key={r.id} value={r.id}>
                            {r.description} · available{" "}
                            {fmt(r.refundable_minor)}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label>
                      Amount ({currency})
                      <input
                        name="amount"
                        inputMode="decimal"
                        required
                        placeholder="0.00"
                      />
                    </label>
                    <label>
                      Refund received date
                      <input
                        name="date"
                        type="date"
                        required
                        max={data.today}
                        defaultValue={data.today}
                      />
                    </label>
                    <label>
                      Refund reference
                      <input name="reference" required maxLength={120} />
                    </label>
                    <label>
                      Reason
                      <input
                        name="reason"
                        required
                        minLength={5}
                        maxLength={500}
                      />
                    </label>
                    <div className="finance-form-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setShowForm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="button primary"
                        disabled={busy || !data.refund_eligible.length}
                      >
                        Save refund
                      </button>
                    </div>
                    <p>
                      For cash received by Jaye. Use Credits & personal refunds
                      for unpaid vendor credit notes or refunds received by
                      employees and founders.
                    </p>
                  </form>
                )}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Refund / expense</th>
                        <th>Received</th>
                        <th>Status</th>
                        <th className="number">Amount</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.refunds.map((r: Row) => (
                        <tr key={r.id}>
                          <td>
                            {r.reference}
                            <small>
                              <button
                                className="report-link"
                                onClick={() =>
                                  r.record_id
                                    ? onRecord(r.record_id, r.kind)
                                    : onExpense(r.spend_id)
                                }
                              >
                                {r.description}
                              </button>
                            </small>
                            <small>{r.reason}</small>
                          </td>
                          <td>{r.date}</td>
                          <td>
                            <FinanceStatus status={r.status} />
                          </td>
                          <td className="number">{fmt(r.amount_minor)}</td>
                          <td>
                            {r.status === "pending" &&
                              user.role === "finance" && (
                                <button
                                  className="button secondary small"
                                  disabled={busy}
                                  onClick={() =>
                                    mutate(`/refunds/${r.id}/action`, {
                                      action: "cancel",
                                    })
                                  }
                                >
                                  Cancel refund
                                </button>
                              )}
                            {r.status === "pending" &&
                              user.role === "reconciler" && (
                                <>
                                  <Select
                                    aria-label={`Bank credit for ${r.reference}`}
                                    value={references[r.id] || ""}
                                    onChange={(e) =>
                                      setReferences({
                                        ...references,
                                        [r.id]: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="">
                                      Select matching credit
                                    </option>
                                    {data.unmatched
                                      .filter(
                                        (b: Row) =>
                                          b.direction === "credit" &&
                                          b.amount_minor === r.amount_minor &&
                                          b.date === r.date,
                                      )
                                      .map((b: Row) => (
                                        <option key={b.id} value={b.reference}>
                                          {b.reference}
                                        </option>
                                      ))}
                                  </Select>
                                  <button
                                    className="button secondary small"
                                    disabled={busy || !references[r.id]}
                                    onClick={() =>
                                      mutate(`/refunds/${r.id}/action`, {
                                        action: "reconcile",
                                        reference: references[r.id],
                                      })
                                    }
                                  >
                                    Match credit
                                  </button>
                                </>
                              )}
                            {r.status === "reconciled" &&
                              user.role === "finance" && (
                                <button
                                  className="button secondary small"
                                  disabled={busy}
                                  onClick={() =>
                                    mutate(`/refunds/${r.id}/action`, {
                                      action: "post",
                                    })
                                  }
                                >
                                  Post refund
                                </button>
                              )}
                            {r.status === "posted" && r.bank_reference}
                          </td>
                        </tr>
                      ))}
                      {!data.refunds.length && (
                        <tr>
                          <td colSpan={5}>No refunds recorded.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {tab === tabs[4] && (
              <>
                <div className="report-explanation">
                  <h3>Recorded payments & refunds awaiting bank match</h3>
                  <p>
                    These entries are already in the books. Matching them does
                    not post money again.
                  </p>
                  {data.documented_unmatched?.length ? (
                    data.documented_unmatched.map((r: Row) => (
                      <p key={r.id}>
                        <button
                          className="report-link"
                          onClick={() => onRecord(r.record_id, r.kind)}
                        >
                          {r.description} · {r.reference}
                        </button>{" "}
                        · {r.movement} · {fmt(r.amount_minor)}
                      </p>
                    ))
                  ) : (
                    <p>No documented bank entries awaiting matching.</p>
                  )}
                </div>

                <div className="report-explanation">
                  Unmatched debits:{" "}
                  <strong>{fmt(data.totals.unmatched_debits_minor)}</strong> ·
                  Unmatched credits:{" "}
                  <strong>{fmt(data.totals.unmatched_credits_minor)}</strong>.
                  Import statements in Payments. Match expense payments from
                  Spend, grouped repayments from Reimbursements, and credits
                  from Refunds, and recovery repayments from Recoveries.
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Bank reference</th>
                        <th>Date</th>
                        <th>Direction</th>
                        <th className="number">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.unmatched.map((r: Row) => (
                        <tr key={r.id}>
                          <td>{r.reference}</td>
                          <td>{r.date}</td>
                          <td>{r.direction}</td>
                          <td className="number">{fmt(r.amount_minor)}</td>
                        </tr>
                      ))}
                      {!data.unmatched.length && (
                        <tr>
                          <td colSpan={4}>
                            All imported statement rows are matched.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="report-explanation">
                  <h3>Payments awaiting reconciliation or posting</h3>
                  {data.unposted.map((r: Row) => (
                    <p key={r.id}>
                      {r.id} · {r.description} · {r.status} ·{" "}
                      {fmt(r.amount_minor)}
                    </p>
                  ))}
                  {!data.unposted.length && (
                    <p>
                      No confirmed payments awaiting reconciliation or posting.
                    </p>
                  )}
                  <h3>Refunds awaiting posting</h3>
                  {data.refunds
                    .filter((r: Row) => r.status === "reconciled")
                    .map((r: Row) => (
                      <p key={r.id}>
                        {r.reference} · {fmt(r.amount_minor)} · Post from
                        Refunds
                      </p>
                    ))}
                </div>
              </>
            )}
            <div className="report-note">
              Posted costs come from expense ledger accounts. Repayments settle
              liabilities; estimates do not create expenses. Refunds reduce
              costs only when posted. Reports use current balances, not
              historical snapshots.
            </div>
          </section>
        </>
      )}
    </div>
  );
}
