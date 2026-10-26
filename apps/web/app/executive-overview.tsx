"use client";
import { useEffect, useState, useCallback, type FormEvent } from "react";
import {
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Wallet,
  Receipt,
  Users,
  CalendarDays,
} from "lucide-react";
type Row = Record<string, any>;
type Props = {
  entity: string;
  request: (p: string, o?: RequestInit) => Promise<any>;
  navigate: (p: string) => void;
  onRecord: () => void;
};
const now = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export default function ExecutiveOverview({
  entity,
  request,
  navigate,
  onRecord,
}: Props) {
  const [period, setPeriod] = useState(now().slice(0, 7)),
    [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [cashForm, setCashForm] = useState(false),
    [gate, setGate] = useState<Row | null>(null),
    [historical, setHistorical] = useState<Row | null>(null),
    [actionForm, setActionForm] = useState(false);
  const load = useCallback(async () => {
    setData(await request(`/executive?entity=${entity}&period=${period}`));
  }, [entity, period, request]);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    const read = () => {
      if (document.visibilityState === "hidden") return;
      request(`/executive?entity=${entity}&period=${period}`)
        .then((r) => {
          if (alive) {
            setData(r);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    };
    read();
    const timer = setInterval(read, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [entity, period, request]);
  async function mutate(path: string, body: any, done?: () => void) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await request(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await load();
      done?.();
      setNotice(
        response.applied !== undefined
          ? `${response.applied} budget source rows applied. ${response.conflicts.length} existing budget groups preserved; resolve any remaining matches before closing.`
          : "Saved with audit history.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const id = historical
      ? "exec-history"
      : gate
        ? "exec-gate"
        : actionForm
          ? "exec-action"
          : cashForm
            ? "exec-cash"
            : "";
    if (id)
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [historical, gate, actionForm, cashForm]);
  const money = (n: number | null) =>
    n == null
      ? "Not yet verified"
      : new Intl.NumberFormat("en-NG", {
          style: "currency",
          currency: data?.currency || "NGN",
          maximumFractionDigits: 0,
        }).format(n / 100);
  const pct = (n: number | null) =>
    n == null ? "Not measurable" : `${(n * 100).toFixed(1)}%`;
  const minor = (f: FormData, k: string) => Math.round(Number(f.get(k)) * 100);
  async function reviewHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!historical) return;
    const f = new FormData(event.currentTarget),
      submit = (event.nativeEvent as SubmitEvent)
        .submitter as HTMLButtonElement;
    const action = submit?.value || "save";
    await mutate(
      `/expenses/imports/${historical.id}/review?entity=${entity}`,
      {
        revision: historical.revision,
        action,
        reason: f.get("reason"),
        target_id: f.get("target_id") || undefined,
        data: {
          ...historical.data,
          original_minor: minor(f, "original_amount"),
          fx_rate: Number(f.get("fx_rate")),
          amount_minor: minor(f, "reporting_amount"),
          date: String(f.get("date") || ""),
          category: f.get("category"),
          department: f.get("department"),
          payment_status: f.get("payment_status") || "unknown",
          payment_date: String(f.get("payment_date") || ""),
          payment_reference: String(f.get("payment_reference") || ""),
        },
      },
      () => setHistorical(null),
    );
  }
  return (
    <div className="executive-overview finance-workspace">
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
      {!data ? (
        <div className="panel">Loading executive overview…</div>
      ) : (
        <>
          <section className="exec-intro">
            <div>
              <span className="exec-eyebrow">Lagos · founder briefing</span>
              <h2>Know what is real. Decide what is next.</h2>
              <p>
                Financial evidence, pilot progress and the decisions that need
                your attention.
              </p>
              <span className="exec-pilot">
                <CalendarDays size={15} /> Pilot plan: {data.pilot.start} –{" "}
                {data.pilot.end}
              </span>
            </div>
            <div className="exec-controls">
              <label>
                Spending month
                <input
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </label>
              <button
                className="button"
                disabled={busy}
                aria-label="Refresh executive overview"
                onClick={() => {
                  setBusy(true);
                  load()
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                <RefreshCw size={16} />
              </button>
              <button className="button primary" onClick={onRecord}>
                Record expense
              </button>
            </div>
          </section>
          <div className="exec-evidence-notice">
            <ShieldCheck size={20} />
            <div>
              <strong>
                {data.excluded.journals.length || data.excluded.budgets.length
                  ? "Sample data is isolated from management totals"
                  : "Management evidence comes first"}
              </strong>
              <p>
                {data.excluded.journals.length} sample journals and{" "}
                {data.excluded.budgets.length} legacy sample budgets excluded
                here, in monthly expenses and in new model exports. Original
                ledger records and earlier snapshots are retained.
              </p>
            </div>
          </div>
          <div className="exec-metrics">
            {[
              {
                title: "Reviewed operating cash",
                value: money(data.cash.operating_minor),
                note: data.cash.current
                  ? `Statement review: ${data.cash.review.as_of} · restricted funds excluded`
                  : "No current statement-backed review. Ledger balances alone are not confirmed cash.",
                icon: <Wallet size={19} />,
                click: () => setCashForm(true),
              },
              {
                title: "Posted expenses",
                value: money(data.monthly.actual_minor),
                note: `${period} · excludes sample records and unverified history`,
                icon: <Receipt size={19} />,
                click: () => navigate("Expenses"),
              },
              {
                title: "Recorded bills due in 30 days",
                value: money(data.cash.due_minor),
                note: "Includes overdue bills and payroll. Recorded obligations only; completeness is unverified.",
                icon: <CalendarDays size={19} />,
                click: () => navigate("Reports"),
              },
              {
                title: "Currently paying drivers",
                value: data.traction.paying_drivers ?? "Not measurable",
                note: data.traction.coverage
                  ? "Active paid coverage today"
                  : "Connect operational activity and establish current coverage.",
                icon: <Users size={19} />,
                click: () => navigate("Financial Model"),
              },
            ].map((m) => (
              <button
                className="panel exec-metric"
                key={m.title}
                onClick={m.click}
              >
                <span>
                  {m.icon}
                  {m.title}
                </span>
                <strong>{m.value}</strong>
                <small>{m.note}</small>
                <span className="exec-metric-link">
                  Review details <ArrowRight size={14} />
                </span>
              </button>
            ))}
          </div>
          <div className="exec-grid">
            <section className="panel exec-panel">
              <div className="panel-heading">
                <div>
                  <span className="exec-eyebrow">This week's priorities</span>
                  <h2>Decisions & evidence gaps</h2>
                </div>
                <button
                  className="button"
                  onClick={() => setActionForm((v) => !v)}
                  disabled={!data.can_write}
                >
                  Assign action
                </button>
              </div>
              {data.checks
                .filter((c: Row) => !c.met)
                .slice(0, 5)
                .map((c: Row, i: number) => (
                  <button
                    key={c.name}
                    className="exec-priority"
                    onClick={() =>
                      c.name === "Cash evidence current"
                        ? setCashForm(true)
                        : c.name === "Historical spending resolved" &&
                            data.history.length
                          ? (() => {
                              const element = document.getElementById(
                                "exec-history-list",
                              ) as HTMLDetailsElement;
                              if (element) {
                                element.open = true;
                                element.scrollIntoView({
                                  behavior: "smooth",
                                  block: "center",
                                });
                              }
                            })()
                          : navigate(c.page)
                    }
                  >
                    <span className="exec-priority-number">{i + 1}</span>
                    <span>
                      <strong>{c.name}</strong>
                      <small>{c.reason}</small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ))}
              {data.actions.length > 0 && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Owner</th>
                        <th>Due</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.actions.map((a: Row) => (
                        <tr key={a.id}>
                          <td>{a.name}</td>
                          <td>{a.owner || "Unassigned"}</td>
                          <td>{a.due_date}</td>
                          <td>{a.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="exec-note">
                Assignments are maintained in Financial Model → Review &
                actions. Missing evidence does not prove the work was never
                done.
              </p>
            </section>
            <aside className="panel exec-panel exec-score">
              <span className="exec-eyebrow">Decision evidence</span>
              <div className="exec-score-number">
                {data.score}
                <small>/100</small>
              </div>
              <h2>
                {data.score === 100
                  ? "Evidence checklist complete"
                  : "Not yet decision-ready"}
              </h2>
              <p>
                {data.checks.filter((c: Row) => c.met).length} of 10 evidence
                checks met.
              </p>
              <progress
                value={data.score}
                max={100}
                aria-label="Decision evidence coverage"
              />
              <details>
                <summary>How this score is calculated</summary>
                <p>{data.score_note}</p>
                {data.checks.map((c: Row) => (
                  <div className="exec-check" key={c.name}>
                    <span>
                      {c.met ? "✓" : "○"} {c.name}
                    </span>
                    <strong>{c.met ? 10 : 0}/10</strong>
                  </div>
                ))}
              </details>
              <p className="exec-note">
                This measures evidence coverage, not Jaye’s business value or
                product-market fit. No score authorizes a launch.
              </p>
            </aside>
          </div>
          <div className="exec-grid">
            <section className="panel exec-panel">
              <div className="panel-heading">
                <div>
                  <span className="exec-eyebrow">Spending discipline</span>
                  <h2>Budget & historical costs</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigate("Budgets")}
                >
                  Manage budgets <ArrowRight size={15} />
                </button>
              </div>
              <div className="exec-stat-pair">
                <div>
                  <span>Entered monthly budget</span>
                  <strong>
                    {data.monthly.budget_minor === null
                      ? "Not set"
                      : money(data.monthly.budget_minor)}
                  </strong>
                  <small>
                    Excludes legacy sample budgets; not an approval assertion.
                  </small>
                </div>
                <div>
                  <span>Historical costs awaiting evidence</span>
                  <strong>
                    {money(
                      data.history
                        .filter((r: Row) => r.kind === "expense")
                        .reduce(
                          (n: number, r: Row) => n + (r.data.amount_minor || 0),
                          0,
                        ),
                    )}
                  </strong>
                  <small>
                    All imported periods · excluded from actuals and cash.
                  </small>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Posted costs</th>
                      <th>Entered budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monthly.trend.map((r: Row) => (
                      <tr key={r.period}>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => setPeriod(r.period)}
                          >
                            {r.period}
                          </button>
                        </td>
                        <td>{money(r.actual_minor)}</td>
                        <td>
                          {r.budget_minor === null
                            ? "Not set"
                            : money(r.budget_minor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.history.length > 0 && (
                <details id="exec-history-list">
                  <summary>
                    {data.history.length} historical expense/budget records need
                    attention
                  </summary>
                  <p>
                    Confirm evidence or link an existing record. Saving a draft
                    does not post an expense. Missing dates and payment details
                    are never inferred.
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Record</th>
                          <th>Month</th>
                          <th>Amount</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.history.map((r: Row) => (
                          <tr key={r.id}>
                            <td>
                              {r.data.description}
                              <small>{r.kind}</small>
                            </td>
                            <td>{r.data.period}</td>
                            <td>{money(r.data.amount_minor)}</td>
                            <td>
                              <button
                                className="button small"
                                disabled={!data.can_write}
                                onClick={() => setHistorical(r)}
                              >
                                Resolve
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {data.can_write && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        mutate(`/expenses/imports/budgets?entity=${entity}`, {})
                      }
                    >
                      Apply resolved budget mappings
                    </button>
                  )}
                  <p>
                    {data.other_source_rows} additional money-in/reference rows
                    remain preserved in the source archive and are not expenses.
                  </p>
                </details>
              )}
            </section>
            <section className="panel exec-panel">
              <span className="exec-eyebrow">Pilot economics</span>
              <h2>Funding & scenarios</h2>
              <div className="exec-stat-pair">
                <div>
                  <span>Founder funding envelope</span>
                  <strong>{money(data.pilot.funding_envelope)}</strong>
                  <small>Planning amount · not a funding receipt</small>
                </div>
                <div>
                  <span>Runway</span>
                  <strong>Requires cash & cost review</strong>
                  <small>
                    Use the model after opening balances and schedules are
                    supported.
                  </small>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Revenue</th>
                      <th>EBITDA</th>
                      <th>Inputs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.scenarios.map((r: Row) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td>
                          {r.complete ? money(r.revenue) : "Not configured"}
                        </td>
                        <td>
                          {r.complete ? money(r.ebitda) : "Not configured"}
                        </td>
                        <td>
                          {r.assumptions} operating / {r.costs} cost plans
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="button"
                onClick={() => navigate("Financial Model")}
              >
                Open financial model <ArrowRight size={15} />
              </button>
              <p className="exec-note">
                Scenarios and funding are editable in the existing model. No
                driver volumes, funding receipts or operating costs have been
                invented.
              </p>
            </section>
          </div>
          <section className="panel exec-panel">
            <div className="panel-heading">
              <div>
                <span className="exec-eyebrow">Lagos · service by service</span>
                <h2>Pilot readiness</h2>
                <p>
                  Evidence is reviewed independently for each service. A target
                  date is not a launch approval.
                </p>
              </div>
            </div>
            <div className="exec-service-grid">
              {data.services.map((s: Row) => (
                <article className="exec-service" key={s.id}>
                  <h3>{s.name}</h3>
                  <p>Target {s.target}</p>
                  <span className="exec-status">{s.status}</span>
                  <p>
                    {s.verified}/{s.total} current gate reviews ·{" "}
                    {s.pricing_complete
                      ? "Pricing configured"
                      : "Pricing incomplete"}
                  </p>
                  <details>
                    <summary>Review readiness evidence</summary>
                    {s.checks.map((g: Row) => (
                      <button
                        className="exec-gate"
                        disabled={!data.can_write}
                        key={g.gate}
                        onClick={() => setGate({ ...g, service_name: s.name })}
                      >
                        <span>
                          <strong>{g.gate}</strong>
                          <small>
                            {g.owner || "Owner not assigned"} ·{" "}
                            {g.verified_on || "No verification date"}
                          </small>
                        </span>
                        <span>{g.status}</span>
                      </button>
                    ))}
                  </details>
                </article>
              ))}
            </div>
          </section>
          <section className="panel exec-panel">
            <div className="panel-heading">
              <div>
                <span className="exec-eyebrow">
                  Product-market fit evidence
                </span>
                <h2>Are drivers and customers getting value?</h2>
                <p>
                  Trailing 30 days: {data.traction.from} –{" "}
                  {data.traction.through}. Values remain unavailable without
                  current source coverage.
                </p>
              </div>
              <button
                className="button"
                onClick={() => navigate("Financial Model")}
              >
                View PMF & sources
              </button>
            </div>
            <div className="exec-stat-pair">
              <div>
                <span>Completed bookings</span>
                <strong>
                  {data.traction.completed_jobs ?? "Not measurable"}
                </strong>
              </div>
              <div>
                <span>Fulfilment</span>
                <strong>{pct(data.traction.fulfilment)}</strong>
              </div>
              <div>
                <span>Repeat customers</span>
                <strong>{pct(data.traction.repeat_rate)}</strong>
              </div>
              <div>
                <span>Operational source coverage</span>
                <strong>
                  {data.traction.coverage ? "Current" : "Not established"}
                </strong>
                <small>{data.traction.sources.length} sources configured</small>
              </div>
            </div>
            <p className="exec-note">
              Cars, bike and keke need renewal and driver-value evidence.
              Courier and chauffeur need repeat demand and contribution after
              direct costs. Shared drivers must not be counted as separate
              people across verticals.
            </p>
          </section>
          <section className="panel exec-panel exec-footer">
            <div>
              <h2>Investor reporting</h2>
              <p>
                {data.snapshot_count} saved snapshots · {data.submitted_reports}{" "}
                internal submissions. Investor publication is not implemented;
                drafts are not approved investor reports.
              </p>
            </div>
            <button
              className="button"
              onClick={() => navigate("Financial Model")}
            >
              Prepare a reviewed snapshot
            </button>
          </section>
          <p className="exec-note">
            Updated {new Date(data.generated_at).toLocaleTimeString()} ·
            refreshes every 30 seconds while visible. Source activity changes
            only after an import or API delivery. Spending uses {period}; cash
            evidence and operational indicators show their own dates.
          </p>
          {cashForm && (
            <section
              id="exec-cash"
              className="panel exec-panel"
              role="region"
              aria-label="Cash evidence review"
            >
              <div className="panel-heading">
                <h2>Review cash against a bank statement</h2>
                <button className="button" onClick={() => setCashForm(false)}>
                  Close
                </button>
              </div>
              <p>
                Enter combined statement cash and restricted funds. The balance
                must match the ledger after sample exclusions. This records your
                evidence review; it does not create funding or change bank
                balances.
              </p>
              {data.cash.review && (
                <p>
                  Last review: {data.cash.review.as_of} ·{" "}
                  {money(data.cash.review.bank_minor)} ·{" "}
                  {data.cash.review.evidence}
                </p>
              )}
              {data.can_write && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void mutate(
                      `/executive/cash-review?entity=${entity}`,
                      {
                        as_of: f.get("as_of"),
                        bank_minor: minor(f, "bank"),
                        restricted_minor: minor(f, "restricted"),
                        evidence: f.get("evidence"),
                      },
                      () => setCashForm(false),
                    );
                  }}
                >
                  <div className="exec-form">
                    <label>
                      Statement date
                      <input
                        type="date"
                        name="as_of"
                        max={data.today}
                        required
                      />
                    </label>
                    <label>
                      Total bank / cash balance
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="bank"
                        required
                      />
                    </label>
                    <label>
                      Restricted funds
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="restricted"
                        required
                      />
                    </label>
                    <label>
                      Statement reference and review evidence
                      <textarea name="evidence" required minLength={10} />
                    </label>
                  </div>
                  <button className="button primary" disabled={busy}>
                    Record cash review
                  </button>
                </form>
              )}
            </section>
          )}
          {gate && (
            <section id="exec-gate" className="panel exec-panel">
              <h2>
                {gate.service_name} · {gate.gate}
              </h2>
              <p>
                Verification records an accountable review, not automatic legal
                clearance or a launch decision.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void mutate(
                    `/executive/gates?entity=${entity}`,
                    {
                      service_id: gate.service_id,
                      gate: gate.gate,
                      revision: gate.revision,
                      ...Object.fromEntries(f),
                    },
                    () => setGate(null),
                  );
                }}
              >
                <div className="exec-form">
                  <label>
                    Status
                    <select name="status" defaultValue={gate.status}>
                      <option value="unverified">Unverified</option>
                      <option value="in_progress">In progress</option>
                      <option value="blocked">Blocked</option>
                      <option value="verified">Verified with evidence</option>
                    </select>
                  </label>
                  <label>
                    Accountable owner
                    <input
                      name="owner"
                      defaultValue={gate.owner}
                      maxLength={180}
                    />
                  </label>
                  <label>
                    Due date
                    <input
                      name="due_date"
                      type="date"
                      defaultValue={gate.due_date}
                    />
                  </label>
                  <label>
                    Verifier
                    <input
                      name="verifier"
                      defaultValue={gate.verifier}
                      maxLength={180}
                    />
                  </label>
                  <label>
                    Verification date
                    <input
                      name="verified_on"
                      type="date"
                      max={data.today}
                      defaultValue={gate.verified_on}
                    />
                  </label>
                  <label>
                    Evidence reference and acceptance notes
                    <textarea
                      name="evidence"
                      defaultValue={gate.evidence}
                      maxLength={2000}
                    />
                  </label>
                </div>
                <div className="action-buttons">
                  <button className="button primary" disabled={busy}>
                    Save readiness evidence
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setGate(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          )}
          {actionForm && (
            <section id="exec-action" className="panel exec-panel">
              <h2>Assign an executive action</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void mutate(
                    `/financial/resources?entity=${entity}`,
                    {
                      kind: "action_item",
                      revision: 0,
                      request_key: crypto.randomUUID(),
                      data: {
                        ...Object.fromEntries(f),
                        status: "open",
                        priority: "high",
                        evidence: "",
                        source: "Executive dashboard action",
                      },
                    },
                    () => setActionForm(false),
                  );
                }}
              >
                <div className="exec-form">
                  <label>
                    Decision / action
                    <input name="name" required maxLength={180} />
                  </label>
                  <label>
                    Owner
                    <input name="owner" required maxLength={180} />
                  </label>
                  <label>
                    Due date
                    <input name="due_date" type="date" required />
                  </label>
                  <label>
                    Context and acceptance criteria
                    <textarea name="description" required maxLength={2000} />
                  </label>
                </div>
                <div className="action-buttons">
                  <button className="button primary" disabled={busy}>
                    Assign action
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setActionForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          )}
          {historical && (
            <section id="exec-history" className="panel exec-panel">
              <h2>
                Resolve historical {historical.kind}:{" "}
                {historical.data.description}
              </h2>
              <p>
                {historical.data.period} · {historical.data.currency}{" "}
                {historical.data.original_minor / 100} · saved FX{" "}
                {historical.data.fx_rate} ·{" "}
                {money(historical.data.amount_minor)}. Verify source evidence
                before posting. Confirm the source amounts and conversion below
                before recording an expense.
              </p>
              <form onSubmit={reviewHistory}>
                <div className="exec-form">
                  <label>
                    Original amount
                    <input
                      name="original_amount"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={historical.data.original_minor / 100}
                    />
                  </label>
                  <label>
                    NGN per USD
                    <input
                      name="fx_rate"
                      type="number"
                      min="0.000001"
                      step="any"
                      defaultValue={historical.data.fx_rate}
                    />
                  </label>
                  <label>
                    Reporting amount
                    <input
                      name="reporting_amount"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={historical.data.amount_minor / 100}
                    />
                  </label>
                  <label>
                    Confirmed expense date
                    <input
                      type="date"
                      name="date"
                      defaultValue={historical.data.date}
                    />
                  </label>
                  <label>
                    Category
                    <select
                      name="category"
                      defaultValue={historical.data.category}
                    >
                      <option value="">Needs classification</option>
                      {[
                        "Operations",
                        "Cloud & software",
                        "Marketing",
                        "Professional fees",
                        "Travel",
                        "Government fees",
                        "Salaries",
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Department
                    <select
                      name="department"
                      defaultValue={historical.data.department}
                    >
                      {["Operations", "Product", "Marketing", "Finance"].map(
                        (v) => (
                          <option key={v}>{v}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Payment status
                    <select
                      name="payment_status"
                      defaultValue={historical.data.payment_status || "unknown"}
                    >
                      <option value="unknown">Unknown</option>
                      <option value="unpaid">Confirmed unpaid</option>
                      <option value="paid">Confirmed paid by company</option>
                    </select>
                  </label>
                  <label>
                    Payment date
                    <input type="date" name="payment_date" />
                  </label>
                  <label>
                    Payment reference
                    <input name="payment_reference" />
                  </label>
                  <label>
                    Existing record / budget ID
                    <input name="target_id" />
                  </label>
                  <label>
                    Evidence / reason
                    <textarea name="reason" required minLength={3} />
                  </label>
                </div>
                <div className="action-buttons">
                  <button className="button" disabled={busy} value="save">
                    Save evidence
                  </button>
                  {historical.kind === "expense" && (
                    <button
                      className="button primary"
                      disabled={busy}
                      value="post"
                    >
                      Record verified expense
                    </button>
                  )}
                  <button className="button" disabled={busy} value="link">
                    Link existing record
                  </button>
                  <button className="button" disabled={busy} value="exclude">
                    Exclude with reason
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setHistorical(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
