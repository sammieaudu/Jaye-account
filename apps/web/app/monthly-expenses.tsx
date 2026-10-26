"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Download,
  Upload,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
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
    [rows, setRows] = useState<Row[]>([]),
    [tab, setTab] = useState("Monthly review"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null),
    [year, setYear] = useState(new Date().getFullYear()),
    [preview, setPreview] = useState<Row | null>(null),
    [edit, setEdit] = useState<Row | null>(null),
    [showAll, setShowAll] = useState(false),
    [query, setQuery] = useState("");
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
    const [r, i] = await Promise.all([
      request(`/expenses/monthly?${params}`),
      request(`/expenses/imports?entity=${entity}`),
    ]);
    setReport(r);
    setRows(i);
  }, [request, params, entity]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReport(null);
    Promise.all([
      request(`/expenses/monthly?${params}`),
      request(`/expenses/imports?entity=${entity}`),
    ])
      .then(([r, i]) => {
        if (active) {
          setReport(r);
          setRows(i);
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
  async function upload(stage: boolean) {
    if (!file) return;
    await run(async () => {
      const body = new FormData();
      body.set("file", file);
      const result = await request(
        `/expenses/imports/${stage ? "stage" : "preview"}?entity=${entity}&year=${year}`,
        { method: "POST", body },
      );
      if (stage) {
        setNotice(
          `${result.added} source rows imported for review${result.duplicate ? " · this workbook was already imported" : ""}.`,
        );
        setPreview(null);
        setFile(null);
      } else setPreview(result);
    });
  }
  async function saveRow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    const form = event.currentTarget;
    const f = new FormData(form);
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement;
    const action = submitter?.value || "save";
    const data: Row = { ...edit.data };
    for (const key of [
      "description",
      "payee",
      "period",
      "date",
      "category",
      "department",
      "currency",
      "payment_status",
      "payment_date",
      "payment_reference",
      "paid_from",
      "note",
    ])
      if (f.has(key)) data[key] = String(f.get(key));
    for (const key of ["original_minor", "amount_minor"])
      if (f.has(key))
        data[key] =
          f.get(key) === "" ? null : Math.round(Number(f.get(key)) * 100);
    if (f.has("fx_rate")) data.fx_rate = Number(f.get("fx_rate"));
    await run(async () => {
      await request(`/expenses/imports/${edit.id}/review?entity=${entity}`, {
        method: "POST",
        body: JSON.stringify({
          revision: edit.revision,
          action,
          reason: f.get("reason"),
          target_id: f.get("target_id") || undefined,
          data,
        }),
      });
      setEdit(null);
      setNotice(
        action === "post"
          ? "Expense recorded. Open its record to attach receipts or record corrections."
          : "Import review saved.",
      );
    });
  }
  const visibleRows = rows.filter(
    (r) =>
      (showAll || r.status === "review") &&
      (!query ||
        `${r.data.description} ${r.data.period} ${r.kind} ${r.filename}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <section
      className="panel monthly-expense-review"
      aria-label="Monthly expense review"
    >
      <div className="section-heading">
        <div>
          <h2>Monthly expense review</h2>
          <p>
            Posted costs, monthly budgets and historical imports in one place.
          </p>
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
      <div className="monthly-toolbar">
        {["Monthly review", "Import review"].map((t) => (
          <button
            className="button"
            type="button"
            key={t}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
            {t === "Import review"
              ? ` (${rows.filter((r) => r.status === "review").length})`
              : ""}
          </button>
        ))}
      </div>
      {tab === "Monthly review" && (
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
              <a
                className="button"
                href={`/api/expenses/monthly.xlsx?${params}`}
              >
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
                {report.comparison.to}): {money(report.comparison.actual_minor)}
                . Change:{" "}
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
                  <caption>
                    Monthly spending · click a month to review it
                  </caption>
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
                      await request(
                        `/expenses/monthly/review?entity=${entity}`,
                        {
                          method: "POST",
                          body: JSON.stringify({
                            period,
                            status: f.get("status"),
                            note: f.get("note"),
                          }),
                        },
                      );
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
                    <input
                      name="note"
                      required
                      minLength={5}
                      maxLength={2000}
                    />
                  </label>
                  <button className="button" disabled={busy}>
                    Save month review
                  </button>
                </form>
              )}
            </>
          )}
        </>
      )}
      {tab === "Import review" && (
        <>
          <p>
            Source rows are retained here until verified, linked to an existing
            record or excluded with a reason. Historical amounts are not posted
            expenses or confirmed cash balances.
          </p>
          <details>
            <summary>Preserved source files</summary>
            <p>
              Original cell values and formulas, including Summary and Settings,
              are retained for traceability. The Contributions sheet is
              excluded.
            </p>
            {[...new Map(rows.map((r) => [r.batch_id, r])).values()].map(
              (r) => (
                <p key={r.batch_id}>
                  <a
                    className="button"
                    href={`/api/expenses/imports/source/${r.batch_id}?entity=${entity}`}
                  >
                    <Download size={16} /> {r.filename} · source archive
                  </a>
                </p>
              ),
            )}
          </details>
          {canWrite && (
            <div className="monthly-toolbar">
              <label>
                Workbook
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    setPreview(null);
                  }}
                />
              </label>
              <label>
                Source year
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  value={year}
                  onChange={(e) => {
                    setYear(Number(e.target.value));
                    setPreview(null);
                  }}
                />
              </label>
              <button
                className="button"
                disabled={!file || busy}
                onClick={() => upload(false)}
              >
                <Upload size={16} /> Preview import
              </button>
            </div>
          )}
          {preview && (
            <div className="simple-guide">
              <div>
                <h3>
                  {preview.filename} · {preview.rows.length} candidate rows
                </h3>
                <p>
                  {preview.rows.filter((r: Row) => r.duplicate).length} existing
                  source rows. Contributions excluded. Currency:{" "}
                  {preview.currency}; workbook NGN/USD rate: {preview.fx_rate}.
                </p>
                {preview.warnings.map((w: string) => (
                  <p key={w}>{w}</p>
                ))}
                <div className="monthly-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Month</th>
                        <th>Description</th>
                        <th>Reporting amount</th>
                        <th>Existing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r: Row) => (
                        <tr key={r.source_key}>
                          <td>{r.kind}</td>
                          <td>{r.data.period}</td>
                          <td>{r.data.description}</td>
                          <td>{money(r.data.amount_minor ?? null)}</td>
                          <td>{r.duplicate ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => upload(true)}
                >
                  Import source rows for review
                </button>
              </div>
            </div>
          )}
          <div className="monthly-toolbar">
            <label>
              Search imports
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Month, supplier or description"
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />{" "}
              Include posted and excluded rows
            </label>
            {canWrite && (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await request(
                      `/expenses/imports/budgets?entity=${entity}`,
                      { method: "POST" },
                    );
                    setNotice(
                      `${r.applied} source budget lines applied. ${r.conflicts.length ? `Existing budgets preserved: ${r.conflicts.join("; ")}. Review and link these rows.` : "Uncategorized or incomplete rows remain in review."}`,
                    );
                  })
                }
              >
                Apply mapped budgets
              </button>
            )}
          </div>
          <div className="monthly-table">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Type / month</th>
                  <th>Description</th>
                  <th>Original</th>
                  <th>Reporting amount</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.filename}
                      <small className="expense-subline">
                        {r.data.source_sheet} · row {r.data.source_row}
                      </small>
                    </td>
                    <td>
                      {r.kind}
                      <small className="expense-subline">
                        {r.data.period || "Not set"}
                      </small>
                    </td>
                    <td>{r.data.description}</td>
                    <td>
                      {r.data.original_minor == null
                        ? "Not supplied"
                        : `${r.data.currency} ${(r.data.original_minor / 100).toLocaleString()}`}
                    </td>
                    <td>{money(r.data.amount_minor ?? null)}</td>
                    <td>{r.status}</td>
                    <td>
                      {["posted", "linked"].includes(r.status) ? (
                        r.kind === "expense" ? (
                          <button
                            className="button"
                            onClick={() => onOpen(r.target_id)}
                          >
                            Open record
                          </button>
                        ) : (
                          <button
                            className="button"
                            onClick={() => navigate("Budgets")}
                          >
                            Budget
                          </button>
                        )
                      ) : canWrite ? (
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() => setEdit(r)}
                        >
                          Review
                        </button>
                      ) : (
                        "Read only"
                      )}
                    </td>
                  </tr>
                ))}
                {!visibleRows.length && (
                  <tr>
                    <td colSpan={7}>No import rows matching this view.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {edit && (
            <form
              key={edit.id}
              className="panel monthly-import-editor"
              onSubmit={saveRow}
            >
              <h3>Review {edit.data.description}</h3>
              <p>
                {edit.data.source_sheet} row {edit.data.source_row} · original
                source is retained in the import batch.
              </p>
              <div className="monthly-editor-grid">
                {[
                  ["description", "Description", "text"],
                  ["payee", "Payee", "text"],
                  ["period", "Accounting month", "month"],
                  ["date", "Confirmed expense date", "date"],
                  ["payment_date", "Confirmed payment date", "date"],
                  ["payment_reference", "Payment reference", "text"],
                ].map(([name, label, type]) => (
                  <label key={name}>
                    {label}
                    <input
                      name={name}
                      type={type}
                      defaultValue={edit.data[name] || ""}
                    />
                  </label>
                ))}
                <label>
                  Category
                  <select
                    name="category"
                    defaultValue={edit.data.category || ""}
                  >
                    <option value="">Needs mapping</option>
                    {cats.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Department
                  <select
                    name="department"
                    defaultValue={edit.data.department || "Operations"}
                  >
                    {depts.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Currency
                  <select
                    name="currency"
                    defaultValue={edit.data.currency || "NGN"}
                  >
                    <option>NGN</option>
                    <option>USD</option>
                  </select>
                </label>
                <label>
                  Original amount
                  <input
                    name="original_minor"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={
                      edit.data.original_minor == null
                        ? ""
                        : edit.data.original_minor / 100
                    }
                  />
                </label>
                <label>
                  NGN per USD
                  <input
                    name="fx_rate"
                    type="number"
                    min="0.000001"
                    step="any"
                    defaultValue={edit.data.fx_rate || ""}
                  />
                </label>
                <label>
                  Reporting amount · {currency}
                  <input
                    name="amount_minor"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={
                      edit.data.amount_minor == null
                        ? ""
                        : edit.data.amount_minor / 100
                    }
                  />
                </label>
                <label>
                  Payment status
                  <select
                    name="payment_status"
                    defaultValue={edit.data.payment_status || "unknown"}
                  >
                    <option value="unknown">Unknown — requires review</option>
                    <option value="unpaid">Confirmed unpaid</option>
                    <option value="paid">Confirmed paid by company</option>
                  </select>
                </label>
                <label>
                  Paid from
                  <input
                    name="paid_from"
                    defaultValue={edit.data.paid_from || ""}
                  />
                </label>
                <label>
                  Existing expense / budget ID
                  <input
                    name="target_id"
                    placeholder="For linking an existing record"
                  />
                </label>
                <label>
                  Notes
                  <textarea name="note" defaultValue={edit.data.note || ""} />
                </label>
                <label>
                  Review reason
                  <textarea
                    name="reason"
                    required
                    minLength={3}
                    maxLength={2000}
                  />
                </label>
              </div>
              <div className="monthly-toolbar">
                <button className="button" disabled={busy} value="save">
                  Save draft
                </button>
                {edit.kind === "expense" && (
                  <button className="button" disabled={busy} value="post">
                    Record verified expense
                  </button>
                )}
                {["expense", "budget"].includes(edit.kind) && (
                  <button className="button" disabled={busy} value="link">
                    Link existing record
                  </button>
                )}
                <button
                  className="button"
                  disabled={busy}
                  value={edit.status === "excluded" ? "restore" : "exclude"}
                >
                  {edit.status === "excluded"
                    ? "Restore to review"
                    : "Exclude with reason"}
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => setEdit(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
