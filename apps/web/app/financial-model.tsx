"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Plus,
  Download,
  RefreshCw,
  Copy,
  Archive,
  Pencil,
  Trash2,
  RotateCcw,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
type Row = Record<string, any>;
const money = (v: number | null | undefined) =>
  v == null
    ? "Not available"
    : new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2,
      }).format(v / 100);
const percent = (v: number | null) =>
  v == null ? "Not yet measurable" : `${(v * 100).toFixed(1)}%`;
const label = (s: string) =>
  s
    .replace(/_minor$/, " (NGN)")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
const tabs = [
  "Overview",
  "Services & pricing",
  "Scenarios",
  "Costs & funding",
  "Statements",
  "Product-market fit",
  "Data & reconciliation",
  "Exports",
];
const accountNames = [
  "cash",
  "restricted_cash",
  "receivables",
  "prepayments",
  "deposits",
  "fixed_assets",
  "accumulated_depreciation",
  "payables",
  "deferred_revenue",
  "settlements",
  "tax_payable",
  "debt",
  "equity",
  "retained_earnings",
  "subscription_revenue",
  "commission_revenue",
  "direct_cost",
  "marketing",
  "payroll",
  "overhead",
  "depreciation",
  "tax",
  "interest",
];
const numeric = [
  "initial_paying",
  "new_drivers_daily",
  "activation",
  "paid_conversion",
  "renewal",
  "daily_purchase_rate",
  "jobs_per_driver",
  "available_hours",
  "hours_per_job",
  "average_booking_minor",
  "direct_cost_per_job_minor",
  "collection_delay",
  "launch_delay",
  "amount_minor",
  "rate",
  "share",
  "minimum",
  "minimum_sample",
  "useful_life_months",
  "planned_funding_minor",
  "minimum_cash_minor",
  "quantity",
];
const nullable = [
  "initial_paying",
  "new_drivers_daily",
  "activation",
  "paid_conversion",
  "renewal",
  "daily_purchase_rate",
  "jobs_per_driver",
  "available_hours",
  "hours_per_job",
  "average_booking_minor",
  "direct_cost_per_job_minor",
  "amount_minor",
  "rate",
  "actual_launch",
  "effective_to",
  "operating_data_complete_through",
  "coverage_through",
];
const fractions = [
  "activation",
  "paid_conversion",
  "renewal",
  "daily_purchase_rate",
  "rate",
  "share",
  "minimum",
];
const enums: Record<string, string[]> = {
  vehicle: ["car", "keke", "bike", "shared"],
  mode: ["daily", "weekly", "monthly", "percent", "fixed"],
  basis: ["coverage", "eligible_net_booking"],
  confidence: ["unconfirmed", "estimate", "observed"],
  category: [
    "direct_cost",
    "marketing",
    "payroll",
    "overhead",
    "capex",
    "prepayment",
    "deposit",
    "tax",
    "interest",
  ],
  cadence: ["once", "monthly"],
  kind: ["equity", "debt"],
  status: ["planned", "confirmed"],
  metric: [
    "customer_d30",
    "driver_renewal",
    "fulfilment",
    "contribution_margin",
  ],
  method: ["csv", "api"],
  model_account: accountNames,
};
const csvColumns = [
  "source_id",
  "external_id",
  "revision",
  "type",
  "date",
  "service_id",
  "driver_id",
  "customer_id",
  "price_id",
  "status",
  "amount_minor",
  "currency",
  "coverage_end",
  "related_id",
  "reference",
  "account",
  "offset_account",
  "available_hours",
  "job_hours",
  "match_minutes",
  "campaign_id",
  "audience",
  "invoice_payment_id",
  "note",
];
function fresh(kind: string, start: string, scenario: string): Row {
  const shared = { name: "", source: "" };
  const values: Record<string, Row> = {
    service: {
      ...shared,
      vehicle: "car",
      city: "Lagos",
      start_date: start,
      actual_launch: null,
      eligibility: "",
      subscription_eligible: true,
      active: true,
    },
    price: {
      ...shared,
      service_id: "car",
      effective_from: start,
      effective_to: null,
      mode: "monthly",
      amount_minor: null,
      rate: null,
      basis: "coverage",
      refund_policy: "",
    },
    scenario: { ...shared, description: "" },
    assumption: {
      ...shared,
      scenario_id: scenario,
      service_id: "car",
      price_id: "car-month",
      initial_paying: null,
      new_drivers_daily: null,
      activation: null,
      paid_conversion: null,
      renewal: null,
      daily_purchase_rate: null,
      jobs_per_driver: null,
      available_hours: null,
      hours_per_job: null,
      average_booking_minor: null,
      direct_cost_per_job_minor: null,
      collection_delay: 0,
      launch_delay: 0,
      confidence: "unconfirmed",
    },
    cost: {
      ...shared,
      scenario_id: scenario,
      service_id: "",
      category: "overhead",
      amount_minor: 0,
      quantity: 1,
      department: "Operations",
      start_date: start,
      end_date: start,
      pay_date: start,
      cadence: "once",
      useful_life_months: 36,
      owner: "",
    },
    funding: {
      ...shared,
      date: start,
      amount_minor: 0,
      kind: "equity",
      status: "planned",
      reference: "",
    },
    allocation: {
      ...shared,
      category: "overhead",
      service_id: "car",
      share: 0,
    },
    threshold: {
      ...shared,
      metric: "customer_d30",
      minimum: 0,
      minimum_sample: 30,
    },
    mapping: { ...shared, source_account: "", model_account: "overhead" },
    source: {
      ...shared,
      method: "csv",
      coverage_through: null,
      status: "unconfigured",
      cursor: "",
    },
  };
  return values[kind] || shared;
}
function downloadText(name: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function DataTable({ headers, rows }: { headers: string[]; rows: any[][] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>
                No records yet. Add a plan or import observed activity to begin.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function FinancialModel({
  entity,
  request,
}: {
  entity: string;
  request: (path: string, options?: RequestInit) => Promise<any>;
}) {
  const [data, setData] = useState<Row | null>(null),
    [scenario, setScenario] = useState("base"),
    [tab, setTab] = useState(tabs[0]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [editor, setEditor] = useState<Row | null>(null),
    [showArchived, setShowArchived] = useState(false),
    [csv, setCsv] = useState(""),
    [preview, setPreview] = useState<Row | null>(null),
    [draftToReplace, setDraftToReplace] = useState<string | null>(null),
    [mapping, setMapping] = useState<Row>({}),
    [detail, setDetail] = useState<Row | null>(null),
    [search, setSearch] = useState(""),
    [sourceFilter, setSourceFilter] = useState(""),
    [confirmAction, setConfirmAction] = useState<Row | null>(null);
  const inflight = useRef(false),
    sequence = useRef(0),
    requestController = useRef<AbortController | null>(null),
    mutationKeys = useRef(new Map<string, string>()),
    editorHeading = useRef<HTMLHeadingElement>(null);
  const endpoint = useCallback(
    (path: string) =>
      `/financial/${path}${path.includes("?") ? "&" : "?"}entity=${entity}`,
    [entity],
  );
  const reload = useCallback(
    async (force = false) => {
      if (inflight.current && !force) return;
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      inflight.current = true;
      const seq = ++sequence.current;
      try {
        const result = await request(
          endpoint(`workspace?scenario=${encodeURIComponent(scenario)}`),
          { signal: controller.signal },
        );
        if (sequence.current === seq) {
          setData(result);
          if (result.result.scenario_id !== scenario)
            setScenario(result.result.scenario_id);
          setError("");
        }
      } catch (e) {
        if (sequence.current === seq && !controller.signal.aborted)
          setError((e as Error).message);
      } finally {
        if (sequence.current === seq) inflight.current = false;
      }
    },
    [request, endpoint, scenario],
  );
  useEffect(() => {
    sequence.current++;
    setData(null);
    inflight.current = false;
    void reload();
    const refresh = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      sequence.current++;
      requestController.current?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [reload]);
  useEffect(() => {
    if (editor) editorHeading.current?.focus();
  }, [editor?.id, editor?.kind]);
  async function mutate(path: string, body: Row) {
    setBusy(true);
    setError("");
    setMessage("");
    const payloadKey = JSON.stringify({ path, body });
    const requestKey =
      body.request_key ||
      mutationKeys.current.get(payloadKey) ||
      crypto.randomUUID();
    mutationKeys.current.set(payloadKey, requestKey);
    try {
      const result = await request(endpoint(path), {
        method: "POST",
        body: JSON.stringify({
          ...body,
          request_key: requestKey,
        }),
      });
      mutationKeys.current.delete(payloadKey);
      await reload(true);
      setMessage("Saved. Financial results have been refreshed.");
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const safe = (fn: () => Promise<any>) => void fn().catch(() => {});
  if (entity !== "ng")
    return (
      <section className="panel">
        <h2>Lagos pilot</h2>
        <p>Select GoJaye Nigeria Ltd to use the NGN financial model.</p>
      </section>
    );
  if (!data)
    return (
      <section className="panel">
        <p role={error ? "alert" : "status"}>
          {error || "Loading financial model…"}
        </p>
        {error && <button onClick={() => void reload()}>Retry</button>}
      </section>
    );
  const r = data.result,
    resources: Row[] = data.resources,
    config = resources.find((x) => x.kind === "config")!,
    canWrite = data.can_write;
  const items = (kind: string) =>
    resources.filter((x) => x.kind === kind && (showArchived || !x.archived));
  const edit = (kind: string, row?: Row) => {
    setEditor(
      row
        ? { ...row, data: { ...row.data }, request_key: crypto.randomUUID() }
        : {
            kind,
            revision: 0,
            data: fresh(kind, r.start, scenario),
            request_key: crypto.randomUUID(),
          },
    );
    setError("");
  };
  const choose = (key: string, value: any) =>
    setEditor((old) =>
      old
        ? {
            ...old,
            request_key: crypto.randomUUID(),
            data: { ...old.data, [key]: value },
          }
        : old,
    );
  async function saveEditor(e: FormEvent) {
    e.preventDefault();
    if (!editor) return;
    await mutate("resources", editor);
    setEditor(null);
  }
  const resourceTable = (kind: string) => (
    <section className="panel fm-panel" key={kind}>
      <div className="panel-heading">
        <div>
          <h2>
            {kind === "funding"
              ? "Funding plans"
              : label(kind) +
                (kind === "assumption"
                  ? "s · independent driver segments"
                  : "s")}
          </h2>
          <p>
            {kind === "assumption"
              ? "One row per distinct paying driver segment and plan. Do not count the same drivers in multiple service rows."
              : kind === "funding"
                ? "A funding envelope becomes forecast cash only when a dated plan is recorded."
                : kind === "cost"
                  ? "Amount is per unit per cycle; quantity supports headcount, seats or equipment. Existing actual costs come from the ledger."
                  : "Changes are versioned. Referenced records can be archived."}
          </p>
        </div>
        {canWrite && (
          <button className="button primary" onClick={() => edit(kind)}>
            <Plus size={16} />
            Add {label(kind).toLowerCase()}
          </button>
        )}
      </div>
      <DataTable
        headers={["Name", "Details", "Revision", "Actions"]}
        rows={items(kind).map((row) => [
          <span key="n">
            {row.data.name}
            {row.archived ? " · archived" : ""}
            <small className="fm-id">{row.id}</small>
          </span>,
          <span key="d">
            {row.data.amount_minor != null
              ? money(row.data.amount_minor)
              : row.data.rate != null
                ? percent(row.data.rate)
                : row.data.scenario_id ||
                  row.data.method ||
                  row.data.city ||
                  row.data.category ||
                  row.data.description ||
                  "Inputs awaiting confirmation"}
            {row.kind === "price" && (
              <small className="fm-id">
                {row.data.mode} · from {row.data.effective_from}
              </small>
            )}
          </span>,
          row.revision,
          <div className="action-buttons" key="a">
            <button
              title="View history"
              onClick={() =>
                safe(async () =>
                  setDetail({
                    title: row.data.name,
                    history: await request(endpoint(`history/${row.id}`)),
                  }),
                )
              }
            >
              History
            </button>
            {canWrite && (
              <>
                <button title="Edit" onClick={() => edit(kind, row)}>
                  <Pencil size={15} />
                  <span className="sr-only">Edit {row.data.name}</span>
                </button>
                {kind !== "assumption" && (
                  <button
                    title="Clone"
                    onClick={() =>
                      safe(() =>
                        mutate(`resources/${row.id}/action`, {
                          action: "clone",
                          revision: row.revision,
                        }),
                      )
                    }
                  >
                    <Copy size={15} />
                    <span className="sr-only">Clone {row.data.name}</span>
                  </button>
                )}
                <button
                  title={row.archived ? "Restore" : "Archive"}
                  onClick={() =>
                    setConfirmAction({
                      row,
                      action: row.archived ? "restore" : "archive",
                    })
                  }
                >
                  {row.archived ? (
                    <RotateCcw size={15} />
                  ) : (
                    <Archive size={15} />
                  )}
                  <span className="sr-only">
                    Archive or restore {row.data.name}
                  </span>
                </button>
                <button
                  title="Delete unreferenced draft"
                  onClick={() => setConfirmAction({ row, action: "delete" })}
                >
                  <Trash2 size={15} />
                  <span className="sr-only">Delete {row.data.name}</span>
                </button>
              </>
            )}
          </div>,
        ])}
      />
    </section>
  );
  function field(key: string, value: any) {
    if (key === "opening")
      return (
        <fieldset key={key} className="fm-opening">
          <legend>
            Opening adjustments · NGN, debit positive / credit negative
          </legend>
          <p>
            Additional balances only; posted ledger balances are included
            automatically. Credits, including equity and liabilities, are
            negative.
          </p>
          <div className="fm-grid">
            {accountNames.map((a) => (
              <label key={a}>
                {label(a)}
                <input
                  type="number"
                  step="0.01"
                  value={(value[a] || 0) / 100}
                  onChange={(e) =>
                    choose("opening", {
                      ...value,
                      [a]: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
      );
    const refKind = (
      {
        service_id: "service",
        scenario_id: "scenario",
        price_id: "price",
      } as Row
    )[key];
    let choices = refKind
      ? resources
          .filter(
            (x) =>
              x.kind === refKind &&
              !x.archived &&
              (key !== "price_id" ||
                x.data.service_id === editor!.data.service_id),
          )
          .map((x) => ({ value: x.id, name: x.data.name }))
      : undefined;
    const options =
      key === "status" && editor!.kind === "source"
        ? ["unconfigured", "healthy", "failed"]
        : enums[key];
    if (options) choices = options.map((x) => ({ value: x, name: label(x) }));
    const title = fractions.includes(key) ? `${label(key)} (%)` : label(key);
    if (typeof value === "boolean")
      return (
        <label key={key} className="fm-check">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => choose(key, e.target.checked)}
          />
          {title}
        </label>
      );
    if (choices)
      return (
        <label key={key}>
          {title}
          <select
            value={value || ""}
            onChange={(e) => {
              choose(key, e.target.value);
              if (key === "mode") {
                choose("rate", null);
                choose("amount_minor", null);
                choose(
                  "basis",
                  ["fixed", "percent"].includes(e.target.value)
                    ? "eligible_net_booking"
                    : "coverage",
                );
              }
            }}
          >
            <option value="">
              {["service_id", "scenario_id"].includes(key) &&
              editor!.kind === "cost"
                ? "All / shared"
                : "Select…"}
            </option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      );
    if (
      [
        "source",
        "description",
        "eligibility",
        "refund_policy",
        "tax_note",
      ].includes(key)
    )
      return (
        <label key={key}>
          {title}
          <textarea
            rows={2}
            value={value || ""}
            onChange={(e) => choose(key, e.target.value)}
          />
        </label>
      );
    const isNumber = numeric.includes(key),
      isMoney = key.endsWith("_minor"),
      fraction = fractions.includes(key),
      isDate =
        key.includes("date") ||
        [
          "cutoff",
          "effective_from",
          "effective_to",
          "actual_launch",
          "operating_data_complete_through",
          "coverage_through",
        ].includes(key);
    return (
      <label key={key}>
        {title}
        <input
          type={isNumber ? "number" : isDate ? "date" : "text"}
          step={isNumber ? "any" : undefined}
          min={isNumber ? 0 : undefined}
          max={fraction ? 100 : undefined}
          value={
            value == null
              ? ""
              : isMoney
                ? value / 100
                : fraction
                  ? value * 100
                  : value
          }
          placeholder={nullable.includes(key) ? "Unconfirmed" : ""}
          required={[
            "name",
            "start_date",
            "cutoff",
            "effective_from",
            "date",
            "end_date",
            "pay_date",
          ].includes(key)}
          readOnly={key === "city"}
          onChange={(e) =>
            choose(
              key,
              e.target.value === "" && nullable.includes(key)
                ? null
                : isNumber
                  ? isMoney
                    ? Math.round(Number(e.target.value) * 100)
                    : fraction
                      ? Number(e.target.value) / 100
                      : Number(e.target.value)
                  : e.target.value,
            )
          }
        />
      </label>
    );
  }
  const flowRows = r.flows.filter(
    (f: Row) =>
      (!search ||
        `${f.description} ${f.source} ${f.service}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!sourceFilter || f.source === sourceFilter),
  );
  return (
    <div className="financial-model">
      <div className="panel-heading">
        <div>
          <h2>Lagos · first 90 days</h2>
          <p>
            {r.start} – {r.end} · Actual cutoff {r.cutoff} · NGN
          </p>
        </div>
        <div className="action-buttons">
          <label className="fm-selector">
            Scenario
            <select
              aria-label="Financial scenario"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
            >
              {items("scenario")
                .filter((x) => !x.archived)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.data.name}
                  </option>
                ))}
            </select>
          </label>
          <button onClick={() => void reload()} disabled={busy}>
            <RefreshCw size={16} />
            Refresh
          </button>
          {canWrite && (
            <button onClick={() => edit("config", config)}>
              Pilot settings
            </button>
          )}
        </div>
      </div>
      <p className="micro">
        Updated {new Date(r.calculated_at).toLocaleTimeString()} · Refreshes
        every 30 seconds while visible. External data updates only after a
        successful import or API delivery.
      </p>
      {error && (
        <p className="fm-warning" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="fm-success">
          {message}
        </p>
      )}
      {r.warnings.length > 0 && (
        <details className="fm-warning">
          <summary>
            Provisional model · {r.warnings.length} items need attention
          </summary>
          <ul>
            {r.warnings.map((w: string) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {confirmAction && (
        <section className="panel fm-panel">
          <h3>
            {label(confirmAction.action)} {confirmAction.row.data.name}?
          </h3>
          <p>
            Existing source history and saved snapshots will be retained.
            Referenced records cannot be deleted.
          </p>
          <div className="action-buttons">
            <button
              disabled={busy}
              onClick={() =>
                safe(async () => {
                  await mutate(`resources/${confirmAction.row.id}/action`, {
                    action: confirmAction.action,
                    revision: confirmAction.row.revision,
                  });
                  setConfirmAction(null);
                })
              }
            >
              Confirm {confirmAction.action}
            </button>
            <button onClick={() => setConfirmAction(null)}>Cancel</button>
          </div>
        </section>
      )}
      {editor && (
        <section className="panel fm-panel">
          <h2 tabIndex={-1} ref={editorHeading}>
            {editor.id ? "Edit" : "Add"} {label(editor.kind).toLowerCase()}
          </h2>
          <p>
            Blank assumptions remain unconfirmed. Amounts are entered in naira;
            percentages use 0–100.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              safe(() => saveEditor(e));
            }}
            className="form"
          >
            <div className="fm-grid">
              {Object.entries(editor.data)
                .filter(
                  ([k]) =>
                    !(
                      editor.kind === "price" &&
                      ((k === "rate" && editor.data.mode !== "percent") ||
                        (k === "amount_minor" &&
                          editor.data.mode === "percent"))
                    ),
                )
                .map(([key, value]) => field(key, value))}
            </div>
            <div className="action-buttons">
              <button type="submit" className="button primary" disabled={busy}>
                Save {label(editor.kind).toLowerCase()}
              </button>
              <button type="button" onClick={() => setEditor(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      <div
        className="report-tabs"
        role="tablist"
        aria-label="Financial model views"
      >
        {tabs.map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "selected" : ""}
            key={t}
            onClick={() => {
              setTab(t);
              setDetail(null);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === tabs[0] && (
        <>
          <div className="fm-metrics">
            {[
              ["Platform revenue", r.summary.revenue],
              ["Gross contribution", r.summary.gross_profit],
              ["Closing operating cash", r.summary.closing_cash],
              ["Funding gap", r.summary.funding_gap],
            ].map(([title, value]) => (
              <button
                className="panel fm-metric"
                key={title}
                onClick={() => setTab("Statements")}
              >
                <span>{title}</span>
                <strong>{money(value)}</strong>
                <small>Actual + forecast · provisional</small>
              </button>
            ))}
          </div>
          <section className="panel fm-panel">
            <h2>Operating cash through the pilot</h2>
            <p>
              {r.summary.first_shortfall
                ? `First shortfall: ${r.summary.first_shortfall}`
                : "No shortfall in entered schedules. Missing costs or funding can change this."}
            </p>
            <div className="fm-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={r.daily}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={45} />
                  <YAxis
                    tickFormatter={(v) => `${(v / 100000000).toFixed(0)}m`}
                  />
                  <Tooltip formatter={(v: any) => money(v)} />
                  <Line
                    type="monotone"
                    dataKey="cash"
                    name="Operating cash"
                    stroke="#2b7661"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="panel fm-panel">
            <h2>Decision checkpoints</h2>
            <DataTable
              headers={[
                "Checkpoint",
                "Date",
                "Operating cash",
                "Revenue that day",
                "Balance check",
              ]}
              rows={r.checkpoints.map((x: Row) => [
                `Day ${x.day}`,
                x.date,
                money(x.cash),
                money(x.revenue),
                money(x.balance_check),
              ])}
            />
          </section>
          <section className="panel fm-panel">
            <h2>Operating scenarios</h2>
            <DataTable
              headers={[
                "Scenario",
                "Revenue",
                "EBITDA",
                "Closing cash",
                "Funding gap",
                "Status",
              ]}
              rows={data.comparison.map((x: Row) => [
                x.name,
                money(x.revenue),
                money(x.ebitda),
                money(x.closing_cash),
                money(x.funding_gap),
                x.complete ? "Complete inputs" : "Provisional",
              ])}
            />
          </section>
        </>
      )}
      {tab === tabs[1] && (
        <>
          {resourceTable("service")}
          {resourceTable("price")}
        </>
      )}
      {tab === tabs[2] && (
        <>
          {resourceTable("scenario")}
          {resourceTable("assumption")}
          {resourceTable("allocation")}
          {resourceTable("threshold")}
          <section className="panel fm-panel">
            <h2>Funding sensitivity · {scenario}</h2>
            <p>
              Scales dated planned funding proportionally. Without a dated plan,
              the funding envelope does not become cash.
            </p>
            <DataTable
              headers={["Planned funding", "Closing cash", "Funding gap"]}
              rows={data.sensitivities.map((x: Row) => [
                money(x.funding_minor),
                money(x.closing_cash),
                money(x.funding_gap),
              ])}
            />
          </section>
        </>
      )}
      {tab === tabs[3] && (
        <>
          {resourceTable("cost")}
          {resourceTable("funding")}
        </>
      )}
      {tab === tabs[4] && (
        <>
          <section className="panel fm-panel">
            <h2>Monthly profit and loss</h2>
            <p>
              Recorded actuals through {r.cutoff}; forecast afterward. Tax
              remains provisional until reviewed.
            </p>
            <DataTable
              headers={[
                "Metric",
                ...r.monthly.map((x: Row) => x.period),
                "90-day total",
              ]}
              rows={[
                "revenue",
                "direct_cost",
                "gross_profit",
                "marketing",
                "payroll",
                "overhead",
                "ebitda",
                "depreciation",
                "ebit",
                "interest",
                "tax",
                "net_income",
              ].map((k) => [
                <button
                  key={k}
                  onClick={() => {
                    setSourceFilter("");
                    setSearch(k.replaceAll("_", " "));
                  }}
                >
                  {label(k)}
                </button>,
                ...r.monthly.map((x: Row) => money(x[k])),
                money(r.summary[k]),
              ])}
            />
          </section>
          <section className="panel fm-panel">
            <h2>Balance sheet · closing position</h2>
            <DataTable
              headers={["Account", "Balance · NGN"]}
              rows={Object.entries(r.closing)
                .filter(
                  ([a]) =>
                    ![
                      "subscription_revenue",
                      "commission_revenue",
                      "direct_cost",
                      "marketing",
                      "payroll",
                      "overhead",
                      "depreciation",
                      "tax",
                      "interest",
                    ].includes(a),
                )
                .map(([a, v]: any) => [
                  label(a),
                  money(
                    [
                      "payables",
                      "deferred_revenue",
                      "settlements",
                      "tax_payable",
                      "debt",
                      "equity",
                      "retained_earnings",
                    ].includes(a)
                      ? -v
                      : v,
                  ),
                ])
                .concat([
                  ["Pilot earnings", money(r.summary.net_income)],
                  ["Balance check", money(r.summary.balance_check)],
                ])}
            />
          </section>
          <section className="panel fm-panel">
            <h2>Cash flow</h2>
            <DataTable
              headers={["Category", "90-day total"]}
              rows={[
                [
                  "Opening cash including restricted",
                  money(r.opening.cash + r.opening.restricted_cash),
                ],
                ...["operating_cash", "investing_cash", "financing_cash"].map(
                  (k) => [label(k), money(r.summary[k])],
                ),
                [
                  "Closing cash including restricted",
                  money(r.closing.cash + r.closing.restricted_cash),
                ],
                ["Cash reconciliation", money(r.daily.at(-1).cash_check)],
              ]}
            />
          </section>
          {data.variance && (
            <section className="panel fm-panel">
              <h2>Original budget versus latest outlook</h2>
              <DataTable
                headers={[
                  "Metric",
                  "Original budget",
                  "Latest outlook",
                  "Difference",
                ]}
                rows={["revenue", "ebitda", "closing_cash"].map((k) => [
                  label(k),
                  money(data.variance.original[k]),
                  money(data.variance.current[k]),
                  money(data.variance.current[k] - data.variance.original[k]),
                ])}
              />
            </section>
          )}
          <section className="panel fm-panel">
            <h2>Source drilldown</h2>
            <div className="action-buttons">
              <input
                aria-label="Search financial flows"
                placeholder="Search descriptions or source IDs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                onClick={() => {
                  setSearch("");
                  setSourceFilter("");
                }}
              >
                Show all
              </button>
            </div>
            <p>
              {flowRows.length} matching entries · showing first 200. Export
              contains the full schedule.
            </p>
            <DataTable
              headers={[
                "Date",
                "Basis",
                "Source",
                "Debit",
                "Credit",
                "Amount",
                "Description",
              ]}
              rows={flowRows.slice(0, 200).map((x: Row) => [
                x.date,
                x.status,
                <button key="s" onClick={() => setSourceFilter(x.source)}>
                  {x.source}
                </button>,
                label(x.debit),
                label(x.credit),
                money(x.amount),
                x.description,
              ])}
            />
          </section>
        </>
      )}
      {tab === tabs[5] && (
        <>
          <div className="fm-metrics">
            {[
              ["Customer repeat rate", percent(r.pmf.repeat)],
              ["Booking fulfilment", percent(r.pmf.fulfilment)],
              ["Eligible driver renewal", percent(r.pmf.renewal.rate)],
              ["Completed jobs", r.pmf.completed_jobs],
            ].map(([title, value]) => (
              <section className="panel fm-metric" key={title}>
                <span>{title}</span>
                <strong>{value}</strong>
              </section>
            ))}
          </div>
          <section className="panel fm-panel">
            <h2>Customer retention cohorts</h2>
            <p>
              Trailing seven-day return window ending at D7/D30/D60. Only
              cohorts with complete observation coverage qualify.
            </p>
            <DataTable
              headers={[
                "First-completion cohort",
                "Customers",
                "D7 retained / eligible",
                "D7",
                "D30 retained / eligible",
                "D30",
                "D60 retained / eligible",
                "D60",
              ]}
              rows={r.pmf.cohorts.map((x: Row) => [
                x.month,
                x.sample,
                `${x.d7.retained} / ${x.d7.eligible}`,
                percent(x.d7.rate),
                `${x.d30.retained} / ${x.d30.eligible}`,
                percent(x.d30.rate),
                `${x.d60.retained} / ${x.d60.eligible}`,
                percent(x.d60.rate),
              ])}
            />
          </section>
          <section className="panel fm-panel">
            <h2>Service performance · Lagos</h2>
            <DataTable
              headers={[
                "Service",
                "Revenue",
                "Direct contribution",
                "Allocated costs",
                "Contribution after allocation",
                "Fulfilment",
                "Repeat rate",
              ]}
              rows={r.services.map((x: Row) => [
                x.name,
                money(x.revenue),
                money(x.gross_profit),
                money(x.allocated_overhead),
                money(x.contribution_after_allocation),
                percent(x.metrics.fulfilment),
                percent(x.metrics.repeat),
              ])}
            />
          </section>
          <section className="panel fm-panel">
            <h2>Management targets</h2>
            <p>
              Targets are configurable planning judgments, not a certification
              of product-market fit.
            </p>
            <DataTable
              headers={["Metric", "Target", "Observed", "Sample", "Assessment"]}
              rows={data.thresholds.map((x: Row) => [
                x.name,
                percent(x.target),
                percent(x.observed),
                x.sample,
                x.status,
              ])}
            />
          </section>
          <section className="panel fm-panel">
            <h2>Acquisition economics</h2>
            <DataTable
              headers={[
                "Audience",
                "Attributed acquisitions",
                "Campaign spending",
                "CAC",
              ]}
              rows={Object.entries(r.pmf.acquisition).map(
                ([audience, x]: any) => [
                  label(audience),
                  x.attributed_acquisitions,
                  money(x.spend),
                  money(x.cac),
                ],
              )}
            />
            <p>
              CAC requires linked campaign IDs and audience attribution.
              Observed payback and LTV remain unavailable without complete
              attributable contribution history.
            </p>
          </section>
          <section className="panel fm-panel">
            <h2>Driver economics</h2>
            <p>
              Observed gross earnings before vehicle operating costs; refunds
              and driver costs need complete source evidence.
            </p>
            <DataTable
              headers={[
                "Driver",
                "Completed jobs",
                "Covered days",
                "Subscription cost",
                "Gross earnings less platform fees",
                "Subscription burden",
              ]}
              rows={r.pmf.driver_economics.map((x: Row) => [
                x.driver_id,
                x.jobs,
                x.coverage_days,
                money(x.subscription_cost),
                money(x.earnings_before_vehicle_costs),
                percent(x.subscription_burden),
              ])}
            />
          </section>
          <section className="panel fm-panel">
            <h2>Definitions and evidence limits</h2>
            <dl>
              {Object.entries(r.pmf.definitions).map(([k, v]: any) => (
                <div key={k}>
                  <dt>
                    <strong>{label(k)}</strong>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p>{r.pmf.notes.join(" ")}</p>
            <p>
              Registered drivers: {r.pmf.drivers} · Paying drivers:{" "}
              {r.pmf.paying_drivers} · Customers completing a job:{" "}
              {r.pmf.customers}
            </p>
          </section>
        </>
      )}
      {tab === tabs[6] && (
        <>
          <section className="panel fm-panel">
            <h2>Source freshness</h2>
            <p>
              Coverage is explicitly confirmed by the source owner. An import
              timestamp alone does not establish complete activity.
            </p>
            <DataTable
              headers={[
                "Source",
                "Method",
                "Last successful import",
                "Coverage through",
                "Status",
              ]}
              rows={data.source_status.map((x: Row) => [
                x.name,
                x.method,
                x.last_success || "Never",
                x.coverage_through || "Unconfirmed",
                x.status === "failed"
                  ? "Failed"
                  : x.stale
                    ? "Stale / not connected"
                    : x.method === "csv" && x.last_success
                      ? "Imported"
                      : x.status,
              ])}
            />
          </section>
          {resourceTable("source")}
          {resourceTable("mapping")}
          {canWrite && (
            <section className="panel fm-panel">
              <h2>Import operational activity</h2>
              <p>
                CSV amounts use integer kobo (₦1,000 = 100000). Coverage end is
                exclusive. Preview validates every row; acceptance is
                all-or-nothing. A higher source revision corrects a record;
                status “void” withdraws it with history.
              </p>
              <div className="action-buttons">
                <button
                  onClick={() =>
                    downloadText(
                      "jaye-operational-template.csv",
                      csvColumns.join(",") + "\n",
                    )
                  }
                >
                  <Download size={16} />
                  Download CSV template
                </button>
                <label>
                  Upload CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        void file.text().then((text) => {
                          setCsv(text);
                          setPreview(null);
                          setMapping({});
                        });
                    }}
                  />
                </label>
              </div>
              <label>
                CSV contents
                <textarea
                  className="fm-csv"
                  rows={6}
                  value={csv}
                  onChange={(e) => {
                    setCsv(e.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              {csv && (
                <details>
                  <summary>Map column names</summary>
                  <div className="fm-grid">
                    {csv
                      .split(/\r?\n/)[0]
                      .split(",")
                      .map((h) => (
                        <label key={h}>
                          {h}
                          <select
                            value={mapping[h] || h}
                            onChange={(e) =>
                              setMapping((m) => ({ ...m, [h]: e.target.value }))
                            }
                          >
                            {csvColumns.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                  </div>
                </details>
              )}
              <button
                className="button primary"
                disabled={busy || !csv}
                onClick={() =>
                  safe(async () => {
                    setPreview(
                      await mutate(
                        draftToReplace
                          ? `imports/${draftToReplace}/replace`
                          : "imports/preview",
                        { csv, mapping },
                      ),
                    );
                    setDraftToReplace(null);
                  })
                }
              >
                {draftToReplace ? "Preview revised draft" : "Preview import"}
              </button>
              {preview && (
                <div>
                  <h3>
                    {preview.rows.length} parsed rows · {preview.errors.length}{" "}
                    validation issues
                  </h3>
                  <p>{preview.policy}</p>
                  <DataTable
                    headers={["Event type", "Rows", "Source amount · NGN"]}
                    rows={Array.from(
                      new Set<string>(preview.rows.map((row: Row) => row.type)),
                    ).map((type) => [
                      type,
                      preview.rows.filter((row: Row) => row.type === type)
                        .length,
                      money(
                        preview.rows
                          .filter((row: Row) => row.type === type)
                          .reduce(
                            (n: number, row: Row) => n + row.amount_minor,
                            0,
                          ),
                      ),
                    ])}
                  />
                  <p className="muted">
                    Source totals include duplicate rows and are not revenue or
                    net accounting movements. Acceptance identifies exact
                    replays.
                  </p>
                  {preview.errors.map((e: Row, i: number) => (
                    <p role="alert" key={i}>
                      Row {e.row}: {e.message}
                    </p>
                  ))}
                  <DataTable
                    headers={["Source ID", "Event", "Date", "Status", "Amount"]}
                    rows={preview.rows
                      .slice(0, 20)
                      .map((x: Row) => [
                        x.external_id,
                        x.type,
                        x.date,
                        x.status,
                        money(x.amount_minor),
                      ])}
                  />
                  <div className="action-buttons">
                    <button
                      disabled={busy || preview.errors.length > 0}
                      onClick={() =>
                        safe(async () => {
                          await mutate(`imports/${preview.id}/accept`, {});
                          setPreview(null);
                          setCsv("");
                        })
                      }
                    >
                      Accept validated import
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        safe(async () => {
                          await mutate(`imports/${preview.id}/discard`, {});
                          setPreview(null);
                        })
                      }
                    >
                      Discard draft
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
          <section className="panel fm-panel">
            <h2>Source records</h2>
            <DataTable
              headers={[
                "Source",
                "External ID",
                "Event",
                "Date",
                "Revision",
                "Status",
                "Amount",
              ]}
              rows={data.events.slice(0, 150).map((x: Row) => [
                x.source_id,
                <button
                  key="id"
                  onClick={() =>
                    safe(async () =>
                      setDetail({
                        title: x.external_id,
                        record: x,
                        history: await request(endpoint(`history/${x.id}`)),
                      }),
                    )
                  }
                >
                  {x.external_id}
                </button>,
                x.type,
                x.date,
                x.revision,
                x.status,
                money(x.amount_minor),
              ])}
            />
          </section>
          <section className="panel fm-panel">
            <h2>Reconciliation exceptions</h2>
            <p>
              {r.invoice_receipts.length} invoice receipts remain outside the
              ledger. {r.pending.length} approval records await posting. These
              are not added again as actual costs or cash.
            </p>
            <DataTable
              headers={["Kind", "Record", "Date", "Amount"]}
              rows={[
                ...r.invoice_receipts.map((x: Row) => [
                  "Unbridged invoice receipt",
                  x.id,
                  x.date,
                  money(x.amount_minor),
                ]),
                ...r.pending.map((x: Row) => [
                  "Pending ledger posting",
                  x.id,
                  x.date,
                  money(x.amount_minor),
                ]),
              ]}
            />
          </section>
          <section className="panel fm-panel">
            <h2>Import history</h2>
            <DataTable
              headers={[
                "Batch",
                "Status",
                "Created",
                "Accepted",
                "Issues",
                "Actions",
              ]}
              rows={data.imports.map((x: Row) => [
                x.id,
                x.status,
                x.created_at,
                x.accepted_at || "—",
                x.errors.length,
                canWrite && x.status === "draft" ? (
                  <div className="actions" key={x.id}>
                    <button
                      onClick={() =>
                        safe(async () => {
                          const draft = await request(
                            endpoint(`imports/${x.id}`),
                          );
                          const rows = draft.original_rows;
                          const keys = Array.from(
                            new Set<string>(
                              rows.flatMap((row: Row) => Object.keys(row)),
                            ),
                          );
                          const cell = (v: unknown) =>
                            '"' + String(v ?? "").replaceAll('"', '""') + '"';
                          setCsv(
                            [
                              keys.join(","),
                              ...rows.map((row: Row) =>
                                keys.map((k) => cell(row[k])).join(","),
                              ),
                            ].join("\n"),
                          );
                          setMapping({});
                          setPreview(null);
                          setDraftToReplace(x.id);
                          setMessage(
                            "Draft loaded into the CSV editor. Revise it and preview the replacement.",
                          );
                        })
                      }
                    >
                      Revise
                    </button>
                    <button
                      onClick={() =>
                        safe(() => mutate(`imports/${x.id}/discard`, {}))
                      }
                    >
                      Discard
                    </button>
                  </div>
                ) : (
                  "—"
                ),
              ])}
            />
          </section>
          <section className="panel fm-panel">
            <h2>API adapter</h2>
            <button
              onClick={() =>
                safe(async () =>
                  downloadText(
                    "jaye-operational-contract.json",
                    JSON.stringify(
                      await request(endpoint("contract")),
                      null,
                      2,
                    ),
                    "application/json",
                  ),
                )
              }
            >
              <Download size={16} />
              Download API schema
            </button>
            <p>
              No external provider is connected by default. A trusted server
              adapter can send the same event schema to the preview and
              acceptance endpoints. Credentials stay server-side; each event
              requires a stable source ID and increasing revision.
            </p>
            <code>POST /api/financial/imports/preview?entity=ng</code>
            <p>
              Body: rows[], mapping (optional), request_key (UUID). Accept the
              returned batch ID at /api/financial/imports/:id/accept. Server
              authentication and the configured workspace role are required.
            </p>
          </section>
        </>
      )}
      {tab === tabs[7] && (
        <section className="panel fm-panel">
          <h2>Excel exports and immutable snapshots</h2>
          <p>
            Freeze a reproducible snapshot, then download the editable Excel
            model. Blue workbook inputs recalculate forecasts; workbook changes
            do not update this app.
          </p>
          {canWrite && (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                safe(() =>
                  mutate("snapshots", {
                    name: f.get("name"),
                    kind: f.get("kind"),
                    scenario_id: scenario,
                  }),
                );
              }}
            >
              <div className="form-row">
                <label>
                  Snapshot name
                  <input
                    required
                    name="name"
                    placeholder="Pilot original budget"
                  />
                </label>
                <label>
                  Type
                  <select name="kind">
                    <option value="forecast">Latest forecast</option>
                    <option value="budget">Original budget</option>
                    <option value="checkpoint">Checkpoint</option>
                  </select>
                </label>
              </div>
              <button className="button primary" disabled={busy}>
                Save snapshot
              </button>
            </form>
          )}
          <DataTable
            headers={["Name", "Type", "Scenario", "Saved", "Download"]}
            rows={data.snapshots.map((x: Row) => [
              x.name,
              x.kind,
              x.scenario_id,
              x.created_at,
              <a
                key="x"
                href={`/api${endpoint(`snapshots/${x.id}/excel`)}`}
                download
              >
                <Download size={15} />
                Excel model
              </a>,
            ])}
          />
        </section>
      )}
      {detail && (
        <section className="panel fm-panel">
          <div className="panel-heading">
            <h2>{detail.title} · source history</h2>
            <button onClick={() => setDetail(null)}>Close</button>
          </div>
          {detail.record && (
            <DataTable
              headers={["Field", "Value"]}
              rows={Object.entries(detail.record)
                .filter(([, v]) => typeof v !== "object")
                .map(([k, v]) => [label(k), String(v ?? "—")])}
            />
          )}
          <DataTable
            headers={["Revision", "Actor", "Recorded", "Details"]}
            rows={[
              ...(detail.history.resources || []),
              ...(detail.history.events || []),
            ].map((x: Row) => [
              x.revision,
              x.actor_id,
              x.created_at,
              <details key="d">
                <summary>View recorded values</summary>
                <DataTable
                  headers={["Field", "Value"]}
                  rows={Object.entries(JSON.parse(x.data)).map(([k, v]) => [
                    label(k),
                    typeof v === "object"
                      ? JSON.stringify(v)
                      : String(v ?? "Unconfirmed"),
                  ])}
                />
              </details>,
            ])}
          />
        </section>
      )}
      <label className="fm-check">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Show archived configuration
      </label>
    </div>
  );
}
