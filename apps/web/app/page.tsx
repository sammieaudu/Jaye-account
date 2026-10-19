"use client";
import {
  useCallback,
  useRef,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  LayoutDashboard,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Plus,
  ChevronDown,
  Search,
  Bell,
  ChevronsUpDown,
  Wallet,
  CircleDollarSign,
  Clock3,
  Check,
  FileText,
  Layers3,
  PieChart,
  Landmark,
  Users,
  ShieldCheck,
  Settings2,
  X,
  Upload,
  Download,
  Receipt,
  CheckCheck,
  ChevronRight,
  ExternalLink,
  LockKeyhole,
  Building2,
  Globe2,
  Activity,
  AlertCircle,
  RefreshCw,
  LogOut,
  Menu,
} from "lucide-react";
type Row = Record<string, any>;
const menus = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Spend", icon: Receipt },
  { label: "Approvals", icon: CheckCheck },
  { label: "Budgets", icon: PieChart },
  { label: "Payments", icon: Landmark },
  { label: "Vendors", icon: Users },
  { label: "General ledger", icon: Layers3 },
  { label: "Reports", icon: FileText },
  { label: "Audit trail", icon: ShieldCheck },
];
const roleNames: Record<string, string> = {
  employee: "Employee",
  manager: "Department manager",
  finance: "Finance manager",
  cfo: "CFO",
  payer: "Payment releaser",
  reconciler: "Reconciler",
  auditor: "Auditor",
  investor: "Investor",
  admin: "Technical admin",
};
const statusNames: Record<string, string> = {
  draft: "Draft",
  manager_review: "Manager review",
  finance_review: "Finance review",
  cfo_review: "CFO review",
  approved: "Approved",
  scheduled: "Scheduled",
  paid: "Paid",
  reconciled: "Reconciled",
  posted: "Posted",
  returned: "Returned",
  rejected: "Rejected",
};
const cats = [
  "Cloud & software",
  "Marketing",
  "Operations",
  "Professional fees",
  "Travel",
  "Government fees",
];
const departments = ["Engineering", "Marketing", "Operations", "Finance"];
const api = async (path: string, options: RequestInit = {}) => {
  const r = await fetch("/api" + path, {
    ...options,
    headers:
      options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await r.json().catch(() => {
    throw new Error(
      "The local API is restarting or unavailable. Refresh in a moment.",
    );
  });
  if (!r.ok) throw new Error(data.message || "Request failed");
  return data;
};
const fmt = (v: number, currency = "NGN", compact = false) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 0 : 2,
    ...(compact && Math.abs(v / 100) >= 1000000
      ? { notation: "compact" as const, maximumFractionDigits: 2 }
      : {}),
  }).format((v || 0) / 100);
const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((v) => v[0])
    .join("");
const day = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
const Badge = ({ status }: { status: string }) => (
  <span className={`badge ${status}`}>
    <span />
    {statusNames[status] || status.replaceAll("_", " ")}
  </span>
);
const Empty = ({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) => (
  <div className="empty">
    <div className="empty-icon">
      <FileText size={25} />
    </div>
    <h3>{title}</h3>
    <p>
      {children || "New records will appear here as your workflow progresses."}
    </p>
  </div>
);

export default function Home() {
  const [page, setPage] = useState("Overview"),
    [entity, setEntity] = useState("ng"),
    [users, setUsers] = useState<Row[]>([]),
    [user, setUser] = useState<Row | null>(null),
    [entities, setEntities] = useState<Row[]>([]),
    [data, setData] = useState<any>(null),
    [spends, setSpends] = useState<Row[]>([]),
    [vendors, setVendors] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [detail, setDetail] = useState<Row | null>(null),
    [modal, setModal] = useState(""),
    [busy, setBusy] = useState(false),
    [nav, setNav] = useState(false);
  const loadVersion = useRef(0);
  const currency = entity === "inc" ? "USD" : "NGN";
  const current = entities.find((e) => e.id === entity);
  const financial =
    user && !["employee", "investor", "admin"].includes(user.role);
  function notify(message: string) {
    setToast(message);
    setTimeout(() => setToast(""), 5000);
  }
  useEffect(() => {
    (async () => {
      try {
        const people = await api("/demo/users");
        setUsers(people);
        let me;
        try {
          me = await api("/me");
        } catch {
          me = await api("/demo/login", {
            method: "POST",
            body: JSON.stringify({ user_id: "finance" }),
          });
        }
        setUser(me.user);
        setPage(me.user.role === "employee" ? "Spend" : "Overview");
        setEntities(await api("/entities"));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!modal && !detail) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(
      modal ? ".modal" : ".drawer",
    );
    dialog
      ?.querySelector<HTMLElement>("button,input,select,textarea,a[href]")
      ?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modal) setModal("");
        else setDetail(null);
      }
      if (e.key === "Tab" && dialog) {
        const items = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ),
        );
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [modal, detail?.id]);
  const load = useCallback(async () => {
    if (!user) return;
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    setData(null);
    try {
      if (user.role === "investor") {
        const snapshot = await api("/investor/snapshots");
        if (version === loadVersion.current) setData(snapshot);
        return;
      }
      if (user.role === "admin") return;
      if (entity === "group") return;
      const path =
        page === "Overview"
          ? "/dashboard"
          : page === "Budgets"
            ? "/budgets"
            : page === "General ledger"
              ? "/journals"
              : page === "Reports"
                ? "/reports/trial-balance"
                : page === "Audit trail"
                  ? "/audit"
                  : null;
      const [s, v, d] = await Promise.all([
        api(`/spends?entity=${entity}`),
        api(`/vendors?entity=${entity}`),
        path ? api(`${path}?entity=${entity}`) : Promise.resolve(null),
      ]);
      if (version !== loadVersion.current) return;
      setSpends(s);
      setVendors(v);
      setData(d);
    } catch (e) {
      if (version === loadVersion.current) setError((e as Error).message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [page, entity, user]);
  useEffect(() => {
    load();
  }, [load]);
  async function switchUser(id: string) {
    try {
      const me = await api("/demo/login", {
        method: "POST",
        body: JSON.stringify({ user_id: id }),
      });
      loadVersion.current++;
      setData(null);
      setSpends([]);
      setLoading(true);
      setUser(me.user);
      setDetail(null);
      setPage(me.user.role === "employee" ? "Spend" : "Overview");
      setEntities(await api("/entities"));
      notify(`Testing as ${me.user.name} · ${roleNames[me.user.role]}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function navigate(name: string) {
    if (name === page) {
      load();
      setNav(false);
      return;
    }
    loadVersion.current++;
    setData(null);
    setLoading(true);
    setPage(name);
    setSearch("");
    setFilter("all");
    setNav(false);
    setDetail(null);
  }
  async function openDetail(id: string) {
    try {
      setDetail(await api(`/spends/${id}`));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function perform(action: string, extra: Row = {}) {
    if (!detail) return;
    setBusy(true);
    try {
      await api(`/spends/${detail.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
      });
      setDetail(await api(`/spends/${detail.id}`));
      await load();
      notify("Workflow updated. Audit event recorded.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = spends
    .filter((s) =>
      [s.description, s.vendor, s.id, s.requester]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .filter((s) => filter === "all" || s.status === filter)
    .filter((s) =>
      page === "Approvals"
        ? ["manager_review", "finance_review", "cfo_review"].includes(s.status)
        : page === "Payments"
          ? ["approved", "scheduled", "paid", "reconciled"].includes(
              s.status,
            ) && s.kind !== "request"
          : true,
    );
  function exportLink(type: string) {
    return `/api/exports/${type}?entity=${entity}`;
  }
  const canCreate =
    !!user &&
    ["employee", "manager", "finance", "cfo"].includes(user.role) &&
    entity !== "group";
  function SpendTable({
    rows,
    short = false,
  }: {
    rows: Row[];
    short?: boolean;
  }) {
    return rows.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="check-col">
                <span className="check-box" />
              </th>
              <th>Transaction</th>
              <th>Department</th>
              <th>Status</th>
              <th className="number">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.id}
                onClick={() => openDetail(s.id)}
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && openDetail(s.id)}
              >
                <td>
                  <span className="check-box" />
                </td>
                <td>
                  <div className="transaction">
                    <span
                      className={`vendor-icon ${s.category === "Marketing" ? "purple" : s.category === "Operations" ? "orange" : ""}`}
                    >
                      {s.category === "Cloud & software" ? (
                        <Layers3 size={18} />
                      ) : s.kind === "request" ? (
                        <FileText size={18} />
                      ) : (
                        <Receipt size={18} />
                      )}
                    </span>
                    <div>
                      <strong>{s.description}</strong>
                      <small>
                        {s.vendor.replace(" · sample", "")} <span>·</span>{" "}
                        {day(s.date)}
                      </small>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="dept">{s.department}</span>
                </td>
                <td>
                  <Badge status={s.status} />
                </td>
                <td className="number amount">
                  {fmt(s.amount_minor, s.currency)}
                </td>
                <td>
                  <ChevronRight size={16} className="muted" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty title="No transactions to show">
        Try another filter, or submit your first expense.
      </Empty>
    );
  }
  const activeRoles =
    page === "Overview"
      ? ["manager", "finance", "cfo", "auditor", "payer", "reconciler"]
      : page === "Budgets"
        ? ["manager", "finance", "cfo", "auditor"]
        : ["General ledger", "Reports"].includes(page)
          ? ["finance", "cfo", "auditor", "reconciler"]
          : page === "Audit trail"
            ? ["finance", "cfo", "auditor"]
            : null;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${nav ? "open" : ""}`}>
        <a className="brand" href="/" aria-label="Jaye Finance home">
          <span className="brand-symbol">
            j<span>↗</span>
          </span>
          <span>
            jaye<span className="brand-finance">finance</span>
          </span>
        </a>
        <div className="workspace">
          <div className="workspace-logo">J</div>
          <div>
            <strong>GoJaye workspace</strong>
            <small>Finance & operations</small>
          </div>
          <ChevronsUpDown size={15} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {menus.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={page === label ? "active" : ""}
              onClick={() => navigate(label)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "Approvals" && (
                <span className="nav-count">
                  {
                    spends.filter((s) =>
                      [
                        "manager_review",
                        "finance_review",
                        "cfo_review",
                      ].includes(s.status),
                    ).length
                  }
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-caption investor-caption">STAKEHOLDERS</div>
        <button
          className={`investor-nav ${page === "Investor workspace" ? "active" : ""}`}
          onClick={() => navigate("Investor workspace")}
        >
          <Globe2 size={19} />
          <span>Investor workspace</span>
          <ArrowUpRight size={14} />
        </button>
        <div className="sidebar-bottom">
          <div className="shadow-card">
            <ShieldCheck size={21} />
            <strong>Built on trust.</strong>
            <p>
              Every transaction.
              <br />
              Every approval. Accounted for.
            </p>
            <span>
              <span className="live-dot" /> Shadow environment
            </span>
          </div>
          <button className="settings-nav" onClick={() => navigate("Settings")}>
            <Settings2 size={18} />
            Settings & controls
          </button>
          <div className="profile">
            <div className="avatar">{user ? initials(user.name) : "JF"}</div>
            <div>
              <strong>{user?.name || "Jaye Finance"}</strong>
              <small>{user ? roleNames[user.role] : "Connecting…"}</small>
            </div>
            <ChevronsUpDown size={15} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            onClick={() => setNav(!nav)}
            aria-label="Open menu"
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="top-right">
            <span className="test-label">
              <span />
              LOCAL TEST MODE
            </span>
            <button
              className="icon-button"
              title="Notifications"
              onClick={() =>
                notify(
                  "Notifications are local only. Review the Approvals and Payments queues for pending work.",
                )
              }
            >
              <Bell size={19} />
              <span className="notification-dot" />
            </button>
            <div className="top-avatar">
              {user ? initials(user.name) : "JF"}
            </div>
          </div>
        </header>
        <div className="demo-banner">
          <span>
            <ShieldCheck size={15} />
            <strong>Synthetic data · Shadow mode</strong>
            <span className="demo-explain">
              No real payments. No live accounting records.
            </span>
          </span>
          <label>
            Test as{" "}
            <select
              aria-label="Local test identity"
              value={user?.id || "finance"}
              onChange={(e) => switchUser(e.target.value)}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {roleNames[u.role]}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
        </div>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR FINANCIAL WORKSPACE</div>
              <h1>
                {page === "Overview" ? "A clear view of your money." : page}
              </h1>
              <p>
                {page === "Overview"
                  ? "Track spend, stay in control, and keep every naira accounted for."
                  : page === "Spend"
                    ? "From the first request to the final journal. All in one place."
                    : page === "Approvals"
                      ? "Review the evidence. Make a decision. Keep things moving."
                      : page === "Budgets"
                        ? "Plan with intention. See what’s spent, committed, and still available."
                        : page === "Payments"
                          ? "Approved spend, confirmed payments, and a clear paper trail."
                          : page === "General ledger"
                            ? "Balanced entries. Immutable records. A dependable foundation."
                            : page === "Reports"
                              ? "Financial statements that trace directly to posted journals."
                              : page === "Audit trail"
                                ? "A complete, tamper-evident history of every financial action."
                                : page === "Vendors"
                                  ? "The people and businesses that help GoJaye run."
                                  : "Transparency, with the right controls."}
              </p>
            </div>
            {canCreate && (
              <button
                className="button primary"
                onClick={() => setModal("spend")}
              >
                <Plus size={17} />
                New expense
              </button>
            )}
          </div>
          <div className="workspace-toolbar">
            <div className="entity-select">
              <span className="entity-icon">
                <Building2 size={17} />
              </span>
              <select
                aria-label="Legal entity"
                value={entity}
                onChange={(e) => {
                  if(e.target.value===entity)return;
                  loadVersion.current++;
                  setData(null);
                  setSpends([]);
                  setLoading(true);
                  setEntity(e.target.value);
                  setDetail(null);
                }}
              >
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
                <option value="group">Consolidated group · gated</option>
              </select>
              <ChevronDown size={14} />
              <span className="currency-chip">
                {entity === "group" ? "USD" : currency}
              </span>
            </div>
            <div className="period-label">
              <Clock3 size={15} />
              October 2026<span className="period-note">Local test period</span>
            </div>
            <button
              className="icon-button refresh"
              onClick={load}
              aria-label="Refresh records"
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              {error}
              <button onClick={load}>Retry</button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <RefreshCw size={22} className="spin" />
              Loading your workspace…
            </div>
          ) : user?.role === "investor" || page === "Investor workspace" ? (
            <div className="gated-panel">
              <div className="gated-icon">
                <Globe2 size={32} />
              </div>
              <span className="kicker">INVESTOR TRANSPARENCY</span>
              <h2>A trusted view, approved first.</h2>
              <p>
                Investors see frozen, CFO-approved monthly snapshots in USD. No
                snapshots have been approved in this local environment.
              </p>
              <div className="gate-items">
                <span>
                  <LockKeyhole size={16} />
                  Live financial data stays private
                </span>
                <span>
                  <ShieldCheck size={16} />
                  Approval and version history required
                </span>
                <span>
                  <Globe2 size={16} />
                  Consolidation & FX policy pending
                </span>
              </div>
              <span className="tag">Phase 2 · Awaiting policy approval</span>
            </div>
          ) : user?.role === "admin" ? (
            <Empty title="Technical configuration only">
              This role cannot view, approve, post or pay financial records.
              Choose another local test identity to test those workflows.
            </Empty>
          ) : entity === "group" ? (
            <Empty title="Group consolidation is gated">
              Consolidated figures require approved FX policies, matched
              intercompany balances and a frozen consolidation run. Select an
              individual entity to test spend and the ledger.
            </Empty>
          ) : activeRoles && !activeRoles.includes(user?.role || "") ? (
            <Empty title="This view is restricted for your role">
              Use the local test identity selector to explore authorized roles.
              Employees can submit and track their own expenses from Spend.
            </Empty>
          ) : (
            !error && (
              <>
                {page === "Overview" && data && (
                  <>
                    <div className="metrics">
                      <Metric
                        label="Cash in the books"
                        value={fmt(data.cash_minor, currency, true)}
                        icon={<Wallet size={19} />}
                        note="Operating account · posted ledger"
                      />
                      <Metric
                        label="Total posted spend"
                        value={fmt(data.spend_minor, currency, true)}
                        icon={<ArrowUpRight size={19} />}
                        note="Supported by balanced journals"
                      />
                      <Metric
                        label="Committed spend"
                        value={fmt(data.committed_minor, currency, true)}
                        icon={<CircleDollarSign size={19} />}
                        note="Approved, not yet posted"
                      />
                      <Metric
                        label="Awaiting approval"
                        value={String(data.pending).padStart(2, "0")}
                        icon={<Clock3 size={19} />}
                        note="Requests waiting on a review"
                        highlight
                      />
                    </div>
                    <div className="overview-grid">
                      <section className="panel spend-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>Spend at a glance</h2>
                            <p>Posted spend by category</p>
                          </div>
                          <span className="subtle-tag">October 2026</span>
                        </div>
                        <div className="spend-chart">
                          <div className="chart-total">
                            <span>Total posted spend</span>
                            <strong>{fmt(data.spend_minor, currency)}</strong>
                            <small>
                              <span className="chart-dot" /> {current?.name}
                            </small>
                          </div>
                          <div className="category-chart">
                            {data.by_category
                              .filter(
                                (c: Row) => c.category !== "Government fees",
                              )
                              .map((c: Row, i: number) => (
                                <div
                                  className="category-bar-row"
                                  key={c.category}
                                >
                                  <div>
                                    <span>{c.category}</span>
                                    <strong>
                                      {fmt(c.amount_minor, currency, true)}
                                    </strong>
                                  </div>
                                  <div className="bar-track">
                                    <span
                                      className={`bar bar-${i}`}
                                      style={{
                                        width: `${data.spend_minor ? Math.max(0, (c.amount_minor / data.spend_minor) * 100) : 0}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                        <div className="chart-footer">
                          <ShieldCheck size={14} />
                          Every figure comes from a posted, balanced journal.
                          <button onClick={() => navigate("Reports")}>
                            View reports
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      </section>
                      <section className="panel attention-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>Needs your attention</h2>
                            <p>A little review keeps things moving.</p>
                          </div>
                          <span className="attention-dot" />
                        </div>
                        <button
                          className="attention-row"
                          onClick={() => navigate("Approvals")}
                        >
                          <span className="attention-icon yellow">
                            <Clock3 size={19} />
                          </span>
                          <div>
                            <strong>{data.pending} pending approvals</strong>
                            <small>Review requests and receipts</small>
                          </div>
                          <ChevronRight size={16} />
                        </button>
                        <button
                          className="attention-row"
                          onClick={() => navigate("Payments")}
                        >
                          <span className="attention-icon blue">
                            <Landmark size={19} />
                          </span>
                          <div>
                            <strong>
                              {data.unreconciled} payment
                              {data.unreconciled === 1 ? "" : "s"} to reconcile
                            </strong>
                            <small>Match to a statement reference</small>
                          </div>
                          <ChevronRight size={16} />
                        </button>
                        <div className="close-note">
                          <div>
                            <ShieldCheck size={17} />
                            <strong>October books are open</strong>
                          </div>
                          <p>
                            Keep the paper trail complete as you go. Month-end
                            will thank you.
                          </p>
                          <button onClick={() => navigate("Audit trail")}>
                            Check the audit trail
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      </section>
                    </div>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            Recent transactions{" "}
                            <span className="count-pill">{spends.length}</span>
                          </h2>
                          <p>The latest across your workspace.</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => navigate("Spend")}
                        >
                          View all transactions
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      <SpendTable rows={data.recent} short />
                    </section>
                    <div className="bottom-note">
                      <ShieldCheck size={15} />
                      <span>
                        One workspace. Two entities. A complete paper trail.
                      </span>
                      <span>
                        All amounts in {currency} · Synthetic test records
                      </span>
                    </div>
                  </>
                )}
                {["Spend", "Approvals", "Payments"].includes(page) && (
                  <section className="panel">
                    <div className="list-toolbar">
                      <div className="table-tabs">
                        <button
                          className={filter === "all" ? "selected" : ""}
                          onClick={() => setFilter("all")}
                        >
                          All{" "}
                          {page === "Approvals"
                            ? "approvals"
                            : page === "Payments"
                              ? "payments"
                              : "transactions"}
                          <span>{filtered.length}</span>
                        </button>
                        {page === "Spend" && (
                          <>
                            <button
                              className={filter === "draft" ? "selected" : ""}
                              onClick={() => setFilter("draft")}
                            >
                              Drafts
                            </button>
                            <button
                              className={
                                filter === "approved" ? "selected" : ""
                              }
                              onClick={() => setFilter("approved")}
                            >
                              Approved
                            </button>
                          </>
                        )}
                      </div>
                      <div className="table-tools">
                        <div className="search">
                          <Search size={16} />
                          <input
                            aria-label="Search transactions"
                            placeholder="Search transactions…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                        <a
                          className="button secondary small"
                          href={exportLink(
                            page === "Payments" ? "payments" : "spend",
                          )}
                        >
                          <Download size={15} />
                          Export CSV
                        </a>
                      </div>
                    </div>
                    {page === "Payments" && (
                      <div className="inline-note">
                        <LockKeyhole size={16} />
                        Test file export only. Payments require a separate
                        releaser and synthetic bank confirmation. No money
                        moves.
                      </div>
                    )}
                    <SpendTable rows={filtered} />
                  </section>
                )}
                {page === "Payments" &&
                  ["finance", "reconciler", "auditor", "cfo"].includes(
                    user?.role || "",
                  ) && (
                    <BankImport
                      entity={entity}
                      currency={currency}
                      role={user?.role || ""}
                    />
                  )}
                {page === "Budgets" && Array.isArray(data) && (
                  <>
                    <div className="metrics three">
                      <Metric
                        label="Approved sample budget"
                        value={fmt(
                          data.reduce(
                            (n: number, b: Row) => n + b.amount_minor,
                            0,
                          ),
                          currency,
                          true,
                        )}
                        icon={<PieChart size={19} />}
                        note="October 2026 · entity currency"
                      />
                      <Metric
                        label="Committed + actual"
                        value={fmt(
                          data.reduce(
                            (n: number, b: Row) =>
                              n + b.committed_minor + b.actual_minor,
                            0,
                          ),
                          currency,
                          true,
                        )}
                        icon={<Wallet size={19} />}
                        note="Commitments exclude posted spend"
                      />
                      <Metric
                        label="Available to spend"
                        value={fmt(
                          data.reduce(
                            (n: number, b: Row) => n + b.remaining_minor,
                            0,
                          ),
                          currency,
                          true,
                        )}
                        icon={<CircleDollarSign size={19} />}
                        note="Budget less committed and actual"
                      />
                    </div>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Department budgets</h2>
                          <p>
                            Synthetic policy amounts. Founder approval required
                            before live use.
                          </p>
                        </div>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Budget line</th>
                              <th className="number">Budget</th>
                              <th className="number">Committed</th>
                              <th className="number">Actual</th>
                              <th className="number">Remaining</th>
                              <th>Utilization</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.map((b: Row) => (
                              <tr key={b.id}>
                                <td>
                                  <strong>{b.department}</strong>
                                  <small>{b.category}</small>
                                </td>
                                <td className="number">
                                  {fmt(b.amount_minor, currency)}
                                </td>
                                <td className="number">
                                  {fmt(b.committed_minor, currency)}
                                </td>
                                <td className="number">
                                  {fmt(b.actual_minor, currency)}
                                </td>
                                <td className="number">
                                  {fmt(b.remaining_minor, currency)}
                                </td>
                                <td>
                                  <div className="budget-meter">
                                    <span
                                      style={{
                                        width: `${Math.min(100, ((b.committed_minor + b.actual_minor) / b.amount_minor) * 100)}%`,
                                      }}
                                    />
                                  </div>
                                  <small>
                                    {Math.round(
                                      ((b.committed_minor + b.actual_minor) /
                                        b.amount_minor) *
                                        100,
                                    )}
                                    % used
                                  </small>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                )}
                {page === "Vendors" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          Vendor directory{" "}
                          <span className="count-pill">{vendors.length}</span>
                        </h2>
                        <p>
                          Entity-specific records. Sensitive bank details are
                          not stored in this local build.
                        </p>
                      </div>
                      {user?.role === "finance" && (
                        <button
                          className="button primary small"
                          onClick={() => setModal("vendor")}
                        >
                          <Plus size={15} />
                          Add vendor
                        </button>
                      )}
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Vendor</th>
                            <th>Category</th>
                            <th>Due diligence</th>
                            <th>Related party</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vendors.map((v) => (
                            <tr key={v.id}>
                              <td>
                                <div className="transaction">
                                  <span className="vendor-icon">
                                    {initials(v.name)}
                                  </span>
                                  <div>
                                    <strong>{v.name}</strong>
                                    <small>{v.id}</small>
                                  </div>
                                </div>
                              </td>
                              <td>{v.category}</td>
                              <td>
                                <span className="subtle-tag">
                                  {v.status.replaceAll("_", " ")}
                                </span>
                              </td>
                              <td>
                                {v.related_party
                                  ? "Yes · independent review"
                                  : "No"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                {page === "General ledger" && Array.isArray(data) && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          Posted journals{" "}
                          <span className="count-pill">{data.length}</span>
                        </h2>
                        <p>
                          Append-only entries · integer minor units ·
                          entity-scoped numbering
                        </p>
                      </div>
                      <span className="balanced">
                        <Check size={14} />
                        Balanced
                      </span>
                    </div>
                    {data.map((j: Row) => (
                      <div className="journal" key={j.id}>
                        <div className="journal-title">
                          <div>
                            <strong>
                              JE-{j.year}-{String(j.number).padStart(5, "0")}
                            </strong>
                            <span>{j.description}</span>
                          </div>
                          <div>
                            <small>{day(j.date)}</small>
                            {j.source_id && (
                              <button
                                className="text-button"
                                onClick={() => openDetail(j.source_id)}
                              >
                                Source record
                                <ArrowUpRight size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                        <table>
                          <thead>
                            <tr>
                              <th>Account</th>
                              <th className="number">Debit</th>
                              <th className="number">Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {j.lines.map((l: Row) => (
                              <tr key={l.id}>
                                <td>
                                  <span className="account-code">
                                    {l.account}
                                  </span>
                                  {l.account_name}
                                </td>
                                <td className="number">
                                  {l.debit ? fmt(l.debit, currency) : "—"}
                                </td>
                                <td className="number">
                                  {l.credit ? fmt(l.credit, currency) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </section>
                )}
                {page === "Reports" && Array.isArray(data) && (
                  <Reports
                    rows={data}
                    currency={currency}
                    exportUrl={exportLink("trial-balance")}
                  />
                )}
                {page === "Audit trail" && data && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Audit events</h2>
                        <p>
                          Hash-chained records. Updates and deletes are blocked
                          by the database.
                        </p>
                      </div>
                      <span
                        className={`balanced ${!data.valid ? "invalid" : ""}`}
                      >
                        <ShieldCheck size={15} />
                        {data.valid ? "Chain verified" : "Integrity failure"}
                      </span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Event</th>
                            <th>Actor</th>
                            <th>Source record</th>
                            <th>Time</th>
                            <th>Hash</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.events.map((a: Row) => (
                            <tr key={a.id}>
                              <td>
                                <strong>{a.action}</strong>
                              </td>
                              <td>{a.actor || a.actor_id}</td>
                              <td>{a.resource_id}</td>
                              <td>{new Date(a.created_at).toLocaleString()}</td>
                              <td>
                                <code title={a.hash}>
                                  {a.hash.slice(0, 14)}…
                                </code>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                {page === "Settings" && (
                  <div className="settings-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Environment & controls</h2>
                          <p>
                            Local shadow build · read-only configuration summary
                          </p>
                        </div>
                      </div>
                      {[
                        [
                          "Data",
                          "Synthetic fixtures + your local test entries",
                        ],
                        [
                          "Storage",
                          "SQLite WAL · persistent local data directory",
                        ],
                        [
                          "Evidence",
                          "AES-256-GCM encrypted · signature-checked uploads",
                        ],
                        [
                          "Identity",
                          "Local test identities · SSO/MFA not integrated",
                        ],
                        ["Money", "Integer minor units · USD / NGN per entity"],
                        [
                          "Payments",
                          "Synthetic confirmation only · no provider connection",
                        ],
                        [
                          "Audit",
                          "Append-only hash chain · verify in Audit trail",
                        ],
                        [
                          "Production",
                          "Disabled · accountant / CPA / CFO sign-off required",
                        ],
                      ].map(([k, v]) => (
                        <div className="setting-row" key={k}>
                          <strong>{k}</strong>
                          <span>{v}</span>
                        </div>
                      ))}
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Next approval gates</h2>
                          <p>Recorded in OPEN_DECISIONS.md</p>
                        </div>
                      </div>
                      <div className="gate-list">
                        {[
                          "Expense policies & approval bands",
                          "Charts of accounts & reporting framework",
                          "FX sources & consolidation policy",
                          "SSO / MFA & PostgreSQL migration",
                          "Payroll rules & adviser golden datasets",
                          "Parallel run & auditor walkthrough",
                        ].map((v) => (
                          <div key={v}>
                            <LockKeyhole size={16} />
                            {v}
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </>
            )
          )}
        </main>
        <footer>
          <span className="footer-brand">jaye finance</span>
          <span>Clarity in every transaction.</span>
          <span>Local development · v0.1</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={18} />
          {toast}
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {detail && (
        <div
          className="drawer-overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}
        >
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Spend details"
          >
            <div className="drawer-top">
              <span className="kicker">TRANSACTION DETAILS</span>
              <button
                className="icon-button"
                onClick={() => setDetail(null)}
                aria-label="Close details"
              >
                <X size={21} />
              </button>
            </div>
            <div className="drawer-hero">
              <span className="vendor-icon large">
                <Receipt size={24} />
              </span>
              <h2>{detail.description}</h2>
              <p>{detail.vendor}</p>
              <strong>{fmt(detail.amount_minor, detail.currency)}</strong>
              <Badge status={detail.status} />
            </div>
            <div className="detail-grid">
              {[
                ["Record", detail.id],
                ["Type", detail.kind],
                ["Entity", current?.name],
                [
                  "Requester",
                  users.find((u) => u.id === detail.requester_id)?.name,
                ],
                ["Department", detail.department],
                ["Category", detail.category],
                ["Transaction date", detail.date],
                ["Purpose", detail.purpose],
                ...(detail.payment_reference
                  ? [["Bank confirmation", detail.payment_reference]]
                  : []),
                ...(detail.reconciliation_reference
                  ? [["Statement reference", detail.reconciliation_reference]]
                  : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            {detail.warnings.length > 0 && (
              <div className="warnings">
                <h3>
                  <AlertCircle size={16} />
                  Policy checks
                </h3>
                {detail.warnings.map((w: string) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            )}
            <div className="detail-section">
              <h3>
                Supporting evidence <span>{detail.receipts.length}</span>
              </h3>
              {detail.receipts.map((r: Row) => (
                <a
                  className="receipt-file"
                  href={`/api/receipts/${r.id}`}
                  key={r.id}
                >
                  <FileText size={20} />
                  <div>
                    <strong>{r.filename}</strong>
                    <small>
                      {r.synthetic
                        ? "Synthetic fixture · not a real invoice"
                        : "Encrypted original · immutable evidence"}
                    </small>
                  </div>
                  <Download size={16} />
                </a>
              ))}
              {!detail.receipts.length && (
                <p className="muted">No supporting evidence attached.</p>
              )}
              {user?.id === detail.requester_id &&
                ["draft", "returned"].includes(detail.status) && (
                  <label className="upload-inline">
                    <Upload size={16} />
                    Attach receipt
                    <input
                      type="file"
                      accept="image/png,image/jpeg,application/pdf"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const form = new FormData();
                        form.append("file", file);
                        try {
                          await api(`/spends/${detail.id}/receipt`, {
                            method: "POST",
                            body: form,
                          });
                          await openDetail(detail.id);
                          notify("Evidence encrypted and attached.");
                        } catch (err) {
                          notify((err as Error).message);
                        }
                      }}
                    />
                  </label>
                )}
            </div>
            <Workflow
              detail={detail}
              user={user}
              busy={busy}
              onAction={perform}
              onConvert={() => setModal("convert")}
            />
            <div className="detail-section">
              <h3>Activity & approvals</h3>
              <div className="timeline">
                {detail.history.map((h: Row) => (
                  <div key={h.id}>
                    <span className="timeline-dot" />
                    <strong>
                      {h.action.replace("spend.", "").replaceAll("_", " ")}
                    </strong>
                    <small>
                      {h.actor} · {new Date(h.created_at).toLocaleString()}
                    </small>
                    {JSON.parse(h.details).comment && (
                      <p>{JSON.parse(h.details).comment}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
      {modal && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setModal("")}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal === "vendor" ? "Add vendor" : "New spend"}
          >
            <div className="modal-heading">
              <div>
                <span className="kicker">
                  {current?.name} · {currency}
                </span>
                <h2>
                  {modal === "vendor"
                    ? "Add a vendor"
                    : modal === "convert"
                      ? "Record bill against request"
                      : "Every expense starts here."}
                </h2>
                <p>
                  {modal === "vendor"
                    ? "Keep your supplier records organized."
                    : "A few details now. A complete paper trail later."}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close form"
                onClick={() => setModal("")}
              >
                <X size={21} />
              </button>
            </div>
            {modal === "vendor" ? (
              <VendorForm
                entity={entity}
                onDone={async () => {
                  setModal("");
                  await load();
                  notify("Vendor created. Due diligence review required.");
                }}
              />
            ) : (
              <SpendForm
                entity={entity}
                currency={currency}
                vendors={vendors}
                parent={modal === "convert" ? detail : undefined}
                onDone={async (id) => {
                  setModal("");
                  await load();
                  await openDetail(id);
                  notify(
                    "Draft saved. Attach evidence, then submit for approval.",
                  );
                }}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  icon,
  note,
  highlight = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  note: string;
  highlight?: boolean;
}) {
  return (
    <section className={`metric ${highlight ? "highlight" : ""}`}>
      <div className="metric-top">
        <span>{label}</span>
        <div>{icon}</div>
      </div>
      <strong className="metric-value">{value}</strong>
      <p>
        {highlight ? (
          <span className="mini-dot" />
        ) : (
          <span className="metric-dash" />
        )}
        {note}
      </p>
    </section>
  );
}
function Workflow({
  detail: d,
  user,
  busy,
  onAction,
  onConvert,
}: {
  detail: Row;
  user: Row | null;
  busy: boolean;
  onAction: (a: string, p?: Row) => void;
  onConvert: () => void;
}) {
  const [reference, setReference] = useState(""),
    [comment, setComment] = useState("");
  const role = user?.role;
  const review =
    (
      {
        manager_review: "manager",
        finance_review: "finance",
        cfo_review: "cfo",
      } as Row
    )[d.status] === role;
  return (
    <div className="workflow">
      <h3>Next step</h3>
      {d.status === "approved" && d.kind === "request" ? (
        <>
          <p>
            Commitment reserved against the budget. Record the vendor invoice
            before entering the payment workflow.
          </p>
          {["employee", "manager", "finance", "cfo"].includes(role || "") && (
            <button className="button primary" onClick={onConvert}>
              Record matched bill
              <ArrowRight size={16} />
            </button>
          )}
        </>
      ) : (
        <>
          {d.requester_id === user?.id &&
            ["draft", "returned"].includes(d.status) && (
              <button
                disabled={busy}
                className="button primary"
                onClick={() => onAction("submit")}
              >
                Submit for approval
                <ArrowRight size={16} />
              </button>
            )}
          {review && (
            <>
              <textarea
                placeholder="Review comment (required to return or reject)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="action-buttons">
                <button
                  disabled={busy}
                  className="button primary"
                  onClick={() => onAction("approve", { comment })}
                >
                  <Check size={16} />
                  Approve
                </button>
                <button
                  disabled={busy}
                  className="button secondary"
                  onClick={() => onAction("return", { comment })}
                >
                  Return
                </button>
                <button
                  disabled={busy}
                  className="button danger"
                  onClick={() => onAction("reject", { comment })}
                >
                  Reject
                </button>
              </div>
            </>
          )}
          {d.status === "approved" && role === "finance" && (
            <button
              disabled={busy}
              className="button primary"
              onClick={() => onAction("schedule")}
            >
              Schedule test payment
              <ArrowRight size={16} />
            </button>
          )}
          {((d.status === "scheduled" && role === "payer") ||
            (d.status === "paid" && role === "reconciler")) && (
            <>
              <label>
                {d.status === "paid"
                  ? "Synthetic statement row reference"
                  : "Synthetic bank confirmation reference"}
                {d.status === "paid" ? (
                  <select
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  >
                    <option value="">
                      Select matching imported statement row
                    </option>
                    {d.statement_rows?.map((r: Row) => (
                      <option key={r.reference} value={r.reference}>
                        {r.reference} · {r.date}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    placeholder="e.g. TEST-BANK-2026-001"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                )}
              </label>
              <button
                disabled={busy}
                className="button primary"
                onClick={() =>
                  onAction(d.status === "paid" ? "reconcile" : "confirm", {
                    reference,
                  })
                }
              >
                {d.status === "paid"
                  ? "Reconcile payment"
                  : "Confirm simulated payment"}
                <Check size={16} />
              </button>
              <p className="micro">
                Local simulation only. No bank connection or money movement.
              </p>
            </>
          )}
          {d.status === "reconciled" && role === "finance" && (
            <button
              disabled={busy}
              className="button primary"
              onClick={() => onAction("post")}
            >
              Post balanced journals
              <CheckCheck size={16} />
            </button>
          )}
          {d.status === "posted" && (
            <p className="success-text">
              <ShieldCheck size={17} />
              Posted to the ledger. Entries are immutable.
            </p>
          )}
          {!review &&
            d.status !== "posted" &&
            !(
              d.requester_id === user?.id &&
              ["draft", "returned"].includes(d.status)
            ) &&
            !(
              role === "finance" &&
              ["approved", "reconciled"].includes(d.status)
            ) &&
            !(role === "payer" && d.status === "scheduled") &&
            !(role === "reconciler" && d.status === "paid") && (
              <p>
                Waiting on{" "}
                {(
                  {
                    manager_review: "a department manager",
                    finance_review: "finance review",
                    cfo_review: "CFO approval",
                    scheduled: "a separate payment releaser",
                    paid: "a separate reconciler",
                    reconciled: "finance to post the journals",
                    approved: "finance to schedule payment",
                    draft: "the requester to submit",
                    returned: "the requester to make changes",
                  } as Row
                )[d.status] || "the next authorized person"}
                . Switch test identity to continue.
              </p>
            )}
        </>
      )}
    </div>
  );
}
function SpendForm({
  entity,
  currency,
  vendors,
  parent,
  onDone,
}: {
  entity: string;
  currency: string;
  vendors: Row[];
  parent?: Row | null;
  onDone: (id: string) => void;
}) {
  const [kind, setKind] = useState(parent ? "bill" : "expense"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [savedId, setSavedId] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      if (savedId) {
        const file = f.get("file") as File;
        if (file?.size) {
          const upload = new FormData();
          upload.append("file", file);
          await api(`/spends/${savedId}/receipt`, {
            method: "POST",
            body: upload,
          });
        }
        onDone(savedId);
        return;
      }
      const amount = String(f.get("amount"));
      if (!/^\d+(\.\d{1,2})?$/.test(amount))
        throw new Error("Use a positive amount with up to two decimal places");
      const [whole, fraction = ""] = amount.split(".");
      const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
      if (minor <= 0n || minor > 1000000000000n)
        throw new Error("Amount is outside the supported range");
      const payload = {
        entity_id: entity,
        kind,
        vendor_id: String(f.get("vendor_id")),
        description: String(f.get("description")),
        purpose: String(f.get("purpose")),
        amount_minor: Number(minor),
        currency,
        department: String(f.get("department")),
        category: String(f.get("category")),
        date: String(f.get("date")),
        ...(f.get("invoice_number")
          ? { invoice_number: String(f.get("invoice_number")) }
          : {}),
        ...(parent ? { parent_id: parent.id } : {}),
      };
      const s = await api("/spends", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSavedId(s.id);
      const file = f.get("file") as File;
      if (file?.size) {
        const upload = new FormData();
        upload.append("file", file);
        await api(`/spends/${s.id}/receipt`, { method: "POST", body: upload });
      }
      onDone(s.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form">
      <div className="kind-picker">
        {[
          ["expense", "Expense claim"],
          ["bill", "Vendor bill"],
          ["request", "Spend request"],
        ].map(([k, l]) => (
          <button
            type="button"
            key={k}
            disabled={!!parent || !!savedId}
            className={kind === k ? "selected" : ""}
            onClick={() => setKind(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {error && (
        <div className="error-banner">
          {error}
          {savedId && (
            <span>
              Draft {savedId} is saved. Retry attachment or close and open it
              from Spend.
            </span>
          )}
        </div>
      )}
      <label>
        Description
        <input
          required
          minLength={3}
          maxLength={180}
          name="description"
          placeholder="What was this expense for?"
          defaultValue={parent?.description}
          disabled={!!savedId}
        />
      </label>
      <div className="form-row">
        <label>
          Amount ({currency})
          <input
            required
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={parent ? (parent.amount_minor / 100).toFixed(2) : ""}
            disabled={!!savedId}
          />
        </label>
        <label>
          Transaction date
          <input
            required
            name="date"
            type="date"
            defaultValue="2026-10-19"
            disabled={!!savedId}
          />
        </label>
      </div>
      <label>
        Vendor
        <select
          required
          name="vendor_id"
          defaultValue={parent?.vendor_id || ""}
          disabled={!!savedId}
        >
          <option value="" disabled>
            Select a vendor
          </option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <div className="form-row">
        <label>
          Department
          <select
            name="department"
            defaultValue={parent?.department || "Operations"}
            disabled={!!savedId}
          >
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select
            name="category"
            defaultValue={parent?.category || "Operations"}
            disabled={!!savedId}
          >
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      {kind === "bill" && (
        <label>
          Invoice number
          <input
            required
            name="invoice_number"
            placeholder="INV-2026-001"
            disabled={!!savedId}
          />
        </label>
      )}
      <label>
        Business purpose
        <textarea
          required
          name="purpose"
          minLength={5}
          maxLength={1000}
          placeholder="Help the reviewer understand the business reason."
          defaultValue={parent?.purpose}
          disabled={!!savedId}
        />
      </label>
      {kind !== "request" && (
        <label className="file-drop">
          <Upload size={24} />
          <strong>Attach a receipt or invoice</strong>
          <span>PNG, JPG or PDF · up to 8 MB · camera supported</span>
          <input
            type="file"
            name="file"
            accept="image/png,image/jpeg,application/pdf"
          />
        </label>
      )}
      <p className="micro">
        <LockKeyhole size={13} />
        Saved as a draft. Evidence is required before submitting a claim or
        bill.
      </p>
      <button
        disabled={busy}
        className="button primary form-submit"
        type="submit"
      >
        {busy ? "Saving…" : savedId ? "Retry attachment" : "Save draft"}
        <ArrowRight size={17} />
      </button>
    </form>
  );
}
function VendorForm({
  entity,
  onDone,
}: {
  entity: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await api("/vendors", {
            method: "POST",
            body: JSON.stringify({
              entity_id: entity,
              name: f.get("name"),
              category: f.get("category"),
              related_party: f.get("related_party") === "on",
            }),
          });
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <p className="error-banner">{error}</p>}
      <label>
        Legal name
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          placeholder="Vendor legal name"
        />
      </label>
      <label>
        Category
        <select name="category">
          {cats.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="checkbox-label">
        <input type="checkbox" name="related_party" />
        Related-party vendor
      </label>
      <div className="inline-note">
        Due diligence is required before live use. Bank details are
        intentionally gated in this build.
      </div>
      <button className="button primary" disabled={busy}>
        {busy ? "Saving…" : "Create vendor"}
        <Plus size={16} />
      </button>
    </form>
  );
}
function Reports({
  rows,
  currency,
  exportUrl,
}: {
  rows: Row[];
  currency: string;
  exportUrl: string;
}) {
  const [report, setReport] = useState("Trial balance");
  const expenses = rows.filter((r) => r.type === "expense"),
    net = expenses.reduce((n, r) => n + r.balance, 0),
    assets = rows
      .filter((r) => r.type === "asset")
      .reduce((n, r) => n + r.balance, 0),
    liabilities = -rows
      .filter((r) => r.type === "liability")
      .reduce((n, r) => n + r.balance, 0),
    equity =
      -rows
        .filter((r) => r.type === "equity")
        .reduce((n, r) => n + r.balance, 0) - net;
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{report}</h2>
          <p>All posted entries · local October 2026 dataset · {currency}</p>
        </div>
        <a className="button secondary small" href={exportUrl}>
          <Download size={15} />
          Trial balance CSV
        </a>
      </div>
      <div className="report-tabs">
        {["Trial balance", "Profit & loss", "Balance sheet"].map((r) => (
          <button
            key={r}
            className={report === r ? "selected" : ""}
            onClick={() => setReport(r)}
          >
            {r}
          </button>
        ))}
      </div>
      {report === "Trial balance" ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th className="number">Debit</th>
                <th className="number">Credit</th>
                <th className="number">Net balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td className="account-code">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="number">{fmt(r.debit, currency)}</td>
                  <td className="number">{fmt(r.credit, currency)}</td>
                  <td className="number">{fmt(r.balance, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Totals</td>
                <td className="number">
                  {fmt(
                    rows.reduce((n, r) => n + r.debit, 0),
                    currency,
                  )}
                </td>
                <td className="number">
                  {fmt(
                    rows.reduce((n, r) => n + r.credit, 0),
                    currency,
                  )}
                </td>
                <td className="number">
                  {fmt(
                    rows.reduce((n, r) => n + r.balance, 0),
                    currency,
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : report === "Profit & loss" ? (
        <div className="statement">
          <div className="statement-line">
            <strong>Recognized revenue</strong>
            <strong>{fmt(0, currency)}</strong>
          </div>
          <p>
            Revenue module is gated. No revenue entries exist in this local
            chart.
          </p>
          <h3>Operating expenses</h3>
          {expenses.map((r) => (
            <div className="statement-line" key={r.code}>
              <span>{r.name}</span>
              <span>{fmt(r.balance, currency)}</span>
            </div>
          ))}
          <div className="statement-line total">
            <strong>Net result</strong>
            <strong>{fmt(-net, currency)}</strong>
          </div>
        </div>
      ) : (
        <div className="statement">
          <div className="statement-line">
            <strong>Total assets</strong>
            <strong>{fmt(assets, currency)}</strong>
          </div>
          <div className="statement-line">
            <span>Total liabilities</span>
            <span>{fmt(liabilities, currency)}</span>
          </div>
          <div className="statement-line">
            <span>Equity including current result</span>
            <span>{fmt(equity, currency)}</span>
          </div>
          <div className="statement-line total">
            <strong>Balance check</strong>
            <strong>{fmt(assets - liabilities - equity, currency)}</strong>
          </div>
        </div>
      )}
      <div className="report-note">
        <ShieldCheck size={16} />
        Management test reports. Accounting policies and statutory presentation
        await accountant and CPA approval.
      </div>
    </section>
  );
}

function BankImport({
  entity,
  currency,
  role,
}: {
  entity: string;
  currency: string;
  role: string;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [file, setFile] = useState<File | null>(null),
    [result, setResult] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api(`/banking/transactions?entity=${entity}`)
        .then(setRows)
        .catch((e) => setError(e.message)),
    [entity],
  );
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section className="panel bank-import">
      <div className="panel-heading">
        <div>
          <h2>Statement reconciliation</h2>
          <p>
            Import a synthetic debit statement. Match each row once, for the
            exact amount and currency.
          </p>
        </div>
        <a
          className="button secondary small"
          href={`/samples/${entity}-statement.csv`}
          download
        >
          <Download size={14} />
          Sample CSV
        </a>
      </div>
      <div className="bank-content">
        <p>
          Columns: reference, date, currency, amount_minor, description. Amounts
          are positive debit amounts in integer minor units ({currency}).
          Credits and bank balance validation are outside this local slice.
        </p>
        {["finance", "reconciler"].includes(role) && (
          <div className="bank-upload">
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Synthetic bank statement CSV"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <button
              className="button secondary small"
              disabled={!file || busy}
              onClick={async () => {
                if (!file) return;
                setBusy(true);
                setError("");
                try {
                  if (file.size > 1024 * 1024)
                    throw new Error("CSV must be under 1 MB");
                  const r = await api("/banking/import", {
                    method: "POST",
                    body: JSON.stringify({
                      entity_id: entity,
                      csv: await file.text(),
                    }),
                  });
                  setResult(
                    `${r.added} rows imported · ${r.skipped} duplicates skipped. Open a paid expense as the Reconciler to match it.`,
                  );
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Upload size={14} />
              {busy ? "Importing…" : "Import test statement"}
            </button>
          </div>
        )}
        {result && (
          <p className="bank-result" role="status">
            {result}
          </p>
        )}
        {error && (
          <p className="bank-error" role="alert">
            {error}
          </p>
        )}
        {rows.length > 0 && (
          <div className="bank-rows">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Date</th>
                  <th className="number">Debit</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.reference}</td>
                    <td>{r.date}</td>
                    <td className="number">{fmt(r.amount_minor, currency)}</td>
                    <td>{r.matched_spend_id || "Unmatched"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
