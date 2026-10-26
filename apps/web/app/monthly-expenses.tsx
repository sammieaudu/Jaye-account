"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
type Row = Record<string, any>;
type Props = {
  entity: string;
  currency: string;
  request: (p: string, o?: RequestInit) => Promise<any>;
  canWrite: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onChanged: () => Promise<void>;
  revision: string;
  navigate: (p: string) => void;
};
const cats = [
  "Operations",
  "Cloud & software",
  "Marketing",
  "Professional fees",
  "Travel",
  "Government fees",
  "Salaries",
];
const depts = ["Operations", "Product", "Marketing", "Finance"];
const currentMonth = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
const endOfMonth = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
export default function MonthlyExpenses({
  entity,
  currency,
  request,
  canWrite,
  onOpen,
  onCreate,
  onChanged,
  revision,
  navigate,
}: Props) {
  const [period, setPeriod] = useState(currentMonth),
    [from, setFrom] = useState(currentMonth() + "-01"),
    [to, setTo] = useState(endOfMonth(currentMonth())),
    [custom, setCustom] = useState(false),
    [category, setCategory] = useState(""),
    [department, setDepartment] = useState("");
  const [report, setReport] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const money = (n: number | null) =>
    n === null
      ? "Not set"
      : new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
          n / 100,
        );
  const params = new URLSearchParams({
    entity,
    from,
    to,
    category,
    department,
  }).toString();
  const reload = useCallback(async () => {
    setReport(await request(`/expenses/monthly?${params}`));
  }, [request, params, entity]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReport(null);
    request(`/expenses/monthly?${params}`)
      .then((r) => {
        if (active) {
          setReport(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request, params, entity, revision]);
  function monthChange(m: string) {
    if (!/^\d{4}-\d{2}$/.test(m)) return;
    setPeriod(m);
    setFrom(m + "-01");
    setTo(endOfMonth(m));
    setCustom(false);
  }
  function move(n: number) {
    const d = new Date(period + "-01T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + n);
    monthChange(d.toISOString().slice(0, 7));
  }
  async function run(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await reload();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel monthly-expense-review"
      aria-label="Monthly expense review"
    >
      <div className="section-heading">
        <div>
          <h2>Monthly expense review</h2>
          <p>Track monthly costs, payments and budgets in one place.</p>
        </div>
        {canWrite && (
          <button type="button" className="button primary" onClick={onCreate}>
            Record expense
          </button>
        )}
        <button
          className="button"
          type="button"
          disabled={busy || loading}
          onClick={() => run(reload)}
          aria-label="Refresh monthly expenses"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="simple-notice">
          {notice}
        </p>
      )}
      <>
        <div className="monthly-toolbar">
          <button
            className="button"
            aria-label="Previous month"
            onClick={() => move(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <label>
            Month
            <input
              type="month"
              value={period}
              onChange={(e) => monthChange(e.target.value)}
            />
          </label>
          <button
            className="button"
            aria-label="Next month"
            onClick={() => move(1)}
          >
            <ChevronRight size={16} />
          </button>
          <label>
            <input
              type="checkbox"
              checked={custom}
              onChange={(e) => {
                setCustom(e.target.checked);
                if (!e.target.checked) monthChange(period);
              }}
            />{" "}
            Custom range
          </label>
          {custom && (
            <>
              <label>
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Through
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </>
          )}
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Department
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">All departments</option>
              {depts.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {report && !loading && (
            <a className="button" href={`/api/expenses/monthly.xlsx?${params}`}>
              <Download size={16} /> Export Excel
            </a>
          )}
        </div>
        {loading && <p role="status">Loading monthly review…</p>}
        {report && !loading && (
          <>
            <div className="simple-totals monthly-metrics">
              {[
                ["Posted expenses", report.actual_minor],
                ["Bill & payroll cash paid", report.cash_paid_minor],
                ["Bills & payroll outstanding", report.outstanding_minor],
                ["Monthly budget", report.budget_minor],
                [
                  "Budget remaining",
                  report.budget_minor === null
                    ? null
                    : report.budget_minor - report.actual_minor,
                ],
                [
                  "Historical spend · review needed",
                  report.historical_review_minor,
                ],
              ].map(([name, n]) => (
                <div key={String(name)}>
                  <span>{name}</span>
                  <strong>{money(n as number | null)}</strong>
                </div>
              ))}
            </div>
            <p>
              {report.comparison.label} ({report.comparison.from} –{" "}
              {report.comparison.to}): {money(report.comparison.actual_minor)}.
              Change:{" "}
              {money(report.actual_minor - report.comparison.actual_minor)}
              {report.comparison.actual_minor > 0
                ? ` (${((report.actual_minor / report.comparison.actual_minor - 1) * 100).toFixed(1)}%)`
                : ""}
              .
            </p>
            <details>
              <summary>Reporting basis and limitations</summary>
              {report.notes.map((n: string) => (
                <p key={n}>{n}</p>
              ))}
            </details>
            <div className="monthly-table">
              <table>
                <caption>Monthly spending · click a month to review it</caption>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Posted expenses</th>
                    <th>Budget</th>
                    <th>Historical review</th>
                  </tr>
                </thead>
                <tbody>
                  {report.trend.map((r: Row) => (
                    <tr key={r.period}>
                      <td>
                        <button
                          className="button"
                          onClick={() => monthChange(r.period)}
                        >
                          {r.period}
                        </button>
                      </td>
                      <td>{money(r.actual_minor)}</td>
                      <td>{money(r.budget_minor)}</td>
                      <td>{money(r.historical_review_minor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="monthly-table">
              <table>
                <caption>
                  Budget versus actual · full calendar-month budgets
                </caption>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Budget</th>
                    <th>Actual</th>
                    <th>Remaining / overspend</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_category.map((r: Row) => (
                    <tr key={r.category}>
                      <td>
                        <button
                          className="button"
                          onClick={() =>
                            setCategory(
                              category === r.category ? "" : r.category,
                            )
                          }
                        >
                          {r.category}
                        </button>
                      </td>
                      <td>{money(r.budget_minor)}</td>
                      <td>{money(r.actual_minor)}</td>
                      <td>{money(r.variance_minor)}</td>
                    </tr>
                  ))}
                  {!report.by_category.length && (
                    <tr>
                      <td colSpan={4}>
                        No posted expenses or budgets in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <details open>
              <summary>
                Posted expense detail ({report.expenses.length})
              </summary>
              <div className="monthly-table">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th>Department</th>
                      <th>Amount</th>
                      <th>Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.expenses.map((r: Row) => (
                      <tr key={r.id + r.account}>
                        <td>{r.date}</td>
                        <td>{r.description}</td>
                        <td>{r.category}</td>
                        <td>{r.department}</td>
                        <td>{money(r.amount_minor)}</td>
                        <td>
                          {r.record_id ? (
                            <button
                              className="button"
                              onClick={() => onOpen(r.record_id)}
                            >
                              Open
                            </button>
                          ) : (
                            <button
                              className="button"
                              onClick={() => navigate("General ledger")}
                            >
                              Ledger
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <details>
              <summary>Payments and outstanding balances</summary>
              <div className="monthly-table">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Payee</th>
                      <th>Payment</th>
                      <th>Bank match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.payments.map((r: Row) => (
                      <tr key={r.id}>
                        <td>{r.date}</td>
                        <td>{r.payee}</td>
                        <td>{money(r.amount_minor)}</td>
                        <td>
                          {r.bank_transaction_id
                            ? "Matched"
                            : r.method === "Cash"
                              ? "Cash"
                              : "Unmatched"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table>
                  <thead>
                    <tr>
                      <th>Payee</th>
                      <th>Description</th>
                      <th>Outstanding at period end</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.outstanding.map((r: Row) => (
                      <tr key={r.id}>
                        <td>{r.payee}</td>
                        <td>
                          <button
                            className="button"
                            onClick={() => onOpen(r.id)}
                          >
                            {r.description}
                          </button>
                        </td>
                        <td>{money(r.outstanding_minor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="button" onClick={() => navigate("Reports")}>
                Open reconciliation
              </button>
            </details>
            <div className="monthly-toolbar">
              <button className="button" onClick={() => navigate("Budgets")}>
                Manage budgets
              </button>
              <button
                className="button"
                onClick={() => navigate("Subscriptions")}
              >
                Recurring commitments
              </button>
              <span>
                Month status:{" "}
                {custom
                  ? "Select a single month to review"
                  : report.review.status}
              </span>
            </div>
            {canWrite && !custom && (
              <form
                className="monthly-toolbar"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    await request(`/expenses/monthly/review?entity=${entity}`, {
                      method: "POST",
                      body: JSON.stringify({
                        period,
                        status: f.get("status"),
                        note: f.get("note"),
                      }),
                    });
                    setNotice("Month review saved.");
                  });
                }}
              >
                <label>
                  Review status
                  <select name="status">
                    <option value="reviewed">Reviewed</option>
                    <option value="closed">Closed</option>
                    <option value="open">Reopen</option>
                  </select>
                </label>
                <label>
                  Review / reopening explanation
                  <input name="note" required minLength={5} maxLength={2000} />
                </label>
                <button className="button" disabled={busy}>
                  Save month review
                </button>
              </form>
            )}
          </>
        )}
      </>
    </section>
  );
}
