"use client";
import Select from "./select";
import CategorySelect from "./category-select";
import Invoices from "./invoices";
import Bookkeeping from "./bookkeeping";
import Recoveries from "./recoveries";
import Reimbursements from "./reimbursements";
import Subscriptions from "./subscriptions";
import Reporting from "./reporting";
import FinancialModel from "./financial-model";
import { AuditTrail, SettingsControls, InvestorWorkspace } from "./governance";
import FinanceStatus from "./finance-status";
import RegisterDetails from "./register-details";
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
const menuGroups = [
  { title: "Workspace", items: [{ label: "Overview", icon: LayoutDashboard }] },
  {
    title: "Expenses & suppliers",
    items: [
      { label: "Expenses", icon: Receipt },
      { label: "Subscriptions", icon: RefreshCw },
      { label: "Vendors", icon: Users, display: "Suppliers" },
    ],
  },
  {
    title: "Team & payroll",
    items: [
      { label: "Employees", icon: Users },
      { label: "Payroll", icon: Wallet },
      { label: "Reimbursements", icon: Wallet },
      { label: "Recoveries", icon: ArrowDownLeft },
    ],
  },
  {
    title: "Customer invoices",
    items: [{ label: "Invoices", icon: FileText }],
  },
  {
    title: "Planning & reports",
    items: [
      { label: "Budgets", icon: PieChart },
      { label: "Financial Model", icon: Activity },
      { label: "Reports", icon: FileText },
    ],
  },
  {
    title: "Approvals",
    items: [
      { label: "Spend", icon: Receipt, display: "Approval requests" },
      { label: "Approvals", icon: CheckCheck },
      { label: "Payments", icon: Landmark, display: "Payment approvals" },
    ],
  },
  {
    title: "Accounting & review",
    items: [
      { label: "General ledger", icon: Layers3 },
      { label: "Audit trail", icon: ShieldCheck },
      { label: "Investor workspace", icon: Globe2 },
    ],
  },
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
  "Salaries",
];
const departments = ["Product", "Marketing", "Operations", "Finance"];
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
    [globalSearch, setGlobalSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sourceFilter, setSourceFilter] = useState("all"),
    [categoryFilter, setCategoryFilter] = useState("all"),
    [fromDate, setFromDate] = useState(""),
    [toDate, setToDate] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [recordTarget, setRecordTarget] = useState(""),
    [registerDetail, setRegisterDetail] = useState<{
      kind: "budget" | "vendor" | "journal";
      record: Row;
    } | null>(null),
    [modal, setModal] = useState(""),
    [busy, setBusy] = useState(false),
    [nav, setNav] = useState(false),
    [showGuide, setShowGuide] = useState(false),
    [openMenuGroup, setOpenMenuGroup] = useState("Expenses & suppliers");
  useEffect(() => {
    if (!nav) return;
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNav(false);
        document.querySelector<HTMLButtonElement>(".mobile-menu")?.focus();
      }
    };
    document.addEventListener("keydown", closeMenu);
    return () => document.removeEventListener("keydown", closeMenu);
  }, [nav]);
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
        setPage(
          me.user.role === "employee"
            ? "Spend"
            : me.user.role === "investor"
              ? "Investor workspace"
              : "Overview",
        );
        setEntities(await api("/entities"));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>(
      modal ? ".modal" : ".drawer",
    );
    dialog
      ?.querySelector<HTMLElement>("button,input,select,textarea,a[href]")
      ?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modal) setModal("");
        else if (registerDetail) setRegisterDetail(null);
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
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [modal, detail?.id, registerDetail]);
  useEffect(() => {
    if (detail || registerDetail) {
      const view = document.querySelector<HTMLElement>(".record-page-content");
      view?.scrollIntoView({ block: "start" });
      view?.focus();
    }
  }, [detail?.id, registerDetail]);
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
      setPage(
        me.user.role === "employee"
          ? "Spend"
          : me.user.role === "investor"
            ? "Investor workspace"
            : "Overview",
      );
      setEntities(await api("/entities"));
      notify(`Testing as ${me.user.name} · ${roleNames[me.user.role]}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function navigate(name: string) {
    const group = menuGroups.find((group) =>
      group.items.some((item) => item.label === name),
    );
    if (group && group.title !== "Workspace") setOpenMenuGroup(group.title);
    setRecordTarget("");
    setRegisterDetail(null);
    setDetail(null);
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
  function openRecord(id?: string, kind?: string) {
    navigate(kind === "salary" ? "Payroll" : "Expenses");
    setRecordTarget(id || "");
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
      [
        s.description,
        s.vendor,
        s.id,
        s.requester,
        s.invoice_number,
        users.find((u) => u.id === s.paid_by_id)?.name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .filter(
      (s) =>
        filter === "all" ||
        (filter === "missing"
          ? s.kind !== "request" && !s.receipt_count
          : filter === "owed"
            ? s.payment_source !== "company" &&
              s.outstanding_minor > 0 &&
              ["approved", "scheduled"].includes(s.status)
            : s.status === filter),
    )
    .filter(
      (s) =>
        page !== "Spend" ||
        ((sourceFilter === "all" || s.payment_source === sourceFilter) &&
          (categoryFilter === "all" || s.category === categoryFilter) &&
          (!fromDate || s.date >= fromDate) &&
          (!toDate || s.date <= toDate)),
    )
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
              <th>Approval</th>
              {!short && <th>Settlement</th>}
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
                  <Badge status={s.approval_status || s.status} />
                </td>
                {!short && (
                  <td>
                    <strong>{s.settlement_status}</strong>
                    <small className="expense-subline">
                      {s.payment_source === "company"
                        ? "Jaye → vendor"
                        : `${s.payment_source === "founder" ? "Founder" : "Employee"} · ${users.find((u) => u.id === s.paid_by_id)?.name || "Unknown payer"}`}
                    </small>
                    <small className="expense-subline">
                      {s.receipt_count
                        ? `${s.receipt_count} attachment(s)`
                        : s.kind === "request"
                          ? "Pre-approval request"
                          : "Receipt missing"}
                    </small>
                  </td>
                )}
                <td className="number amount">
                  {fmt(s.amount_minor, s.currency)}
                  {s.adjustment_minor > 0 && (
                    <small className="micro">
                      Net cost {fmt(s.effective_amount_minor, s.currency)} · due{" "}
                      {fmt(s.outstanding_minor, s.currency)}
                    </small>
                  )}
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
  function renderMenuItem({
    label,
    icon: Icon,
    display,
  }: {
    label: string;
    icon: typeof Users;
    display?: string;
  }) {
    return (
      <button
        key={label}
        aria-current={page === label ? "page" : undefined}
        className={page === label ? "active" : ""}
        onClick={() => navigate(label)}
      >
        <Icon size={18} />
        <span>{display || label}</span>
        {label === "Approvals" && (
          <span className="nav-count">
            {
              spends.filter((s) =>
                ["manager_review", "finance_review", "cfo_review"].includes(
                  s.status,
                ),
              ).length
            }
          </span>
        )}
      </button>
    );
  }
  const activeRoles = ["Expenses", "Employees", "Payroll"].includes(page)
    ? ["finance", "cfo", "auditor", "reconciler"]
    : page === "Overview"
      ? ["manager", "finance", "cfo", "auditor", "payer", "reconciler"]
      : page === "Budgets"
        ? ["manager", "finance", "cfo", "auditor"]
        : ["General ledger", "Reports", "Financial Model"].includes(page)
          ? ["finance", "cfo", "auditor", "reconciler"]
          : page === "Audit trail"
            ? ["finance", "cfo", "auditor"]
            : null;
  return (
    <div className="app-shell">
      {nav && (
        <button
          className="mobile-nav-backdrop"
          tabIndex={-1}
          aria-label="Dismiss navigation"
          onClick={() => setNav(false)}
        />
      )}
      <aside id="main-navigation" className={`sidebar ${nav ? "open" : ""}`}>
        <button
          className="mobile-nav-close icon-button"
          aria-label="Close navigation"
          onClick={() => {
            setNav(false);
            document.querySelector<HTMLButtonElement>(".mobile-menu")?.focus();
          }}
        >
          <X size={20} />
        </button>
        <a className="brand" href="/" aria-label="Jaye Finance home">
          <img src="/brand/jaye.svg" alt="Jaye" />
          <span className="brand-finance">Finance</span>
        </a>
        <nav aria-label="Main navigation" className="task-navigation">
          {renderMenuItem({ label: "Overview", icon: LayoutDashboard })}
          <span className="nav-section-label">YOUR WORKSPACE</span>
          {menuGroups
            .filter((group) => group.title !== "Workspace")
            .map((group, index) => {
              const expanded = openMenuGroup === group.title;
              const containsPage = group.items.some(
                (item) => item.label === page,
              );
              const Icon = group.items[0].icon;
              return (
                <div className="task-nav-group" key={group.title}>
                  <button
                    className={`task-nav-heading ${containsPage ? "contains-active" : ""}`}
                    aria-expanded={expanded}
                    aria-controls={`menu-group-${index}`}
                    onClick={() =>
                      setOpenMenuGroup(expanded ? "" : group.title)
                    }
                  >
                    <Icon size={18} />
                    <span>{group.title}</span>
                    <ChevronDown size={15} />
                  </button>
                  <div
                    id={`menu-group-${index}`}
                    className="task-nav-items"
                    hidden={!expanded}
                  >
                    {group.items.map(renderMenuItem)}
                  </div>
                </div>
              );
            })}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`settings-nav ${page === "Settings" ? "active" : ""}`}
            aria-current={page === "Settings" ? "page" : undefined}
            onClick={() => navigate("Settings")}
          >
            <img src="/brand/settings.svg" alt="" />
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
            aria-expanded={nav}
            aria-controls="main-navigation"
          >
            <Menu size={21} />
          </button>
          <form
            className="global-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              navigate("Expenses");
              setSearch(globalSearch.trim());
            }}
          >
            <img src="/brand/search.svg" alt="" />
            <input
              aria-label="Search expenses"
              placeholder="Search expenses, vendors or references…"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
            />
            <button type="submit" aria-label="Search expenses and open results">
              <ArrowRight size={16} />
            </button>
          </form>
          <div className="top-right">
            <button
              className="button"
              aria-expanded={showGuide}
              aria-controls="workspace-quick-guide"
              onClick={() => setShowGuide(!showGuide)}
            >
              <FileText size={18} /> Quick guide
            </button>
            <div className="top-avatar" title={user?.name || "Workspace owner"}>
              {user ? initials(user.name) : "JF"}
            </div>
          </div>
        </header>
        <main>
          {showGuide && (
            <section
              id="workspace-quick-guide"
              className="workspace-quick-guide"
              aria-label="Quick guide"
            >
              <div className="quick-guide-heading">
                <div>
                  <h2>Start with what you want to record</h2>
                  <p>
                    Record the cost once. Add payments and refunds to that same
                    record.
                  </p>
                </div>
                <button className="button" onClick={() => setShowGuide(false)}>
                  Close guide
                </button>
              </div>
              <div className="quick-guide-grid">
                {[
                  {
                    page: "Expenses",
                    title: "1. Expenses & bills",
                    text: "Anything Jaye buys: internet, equipment, transport or services. An unpaid bill is simply an expense you still owe.",
                  },
                  {
                    page: "Subscriptions",
                    title: "2. Subscriptions",
                    text: "Recurring services such as Figma or hosting. Add the service and billing dates, then use Record bill / payment to create its expense.",
                  },
                  {
                    page: "Employees",
                    title: "3. Employees",
                    text: "Add each person, their department and agreed salary. Staff IDs are generated automatically. This does not create a login account.",
                  },
                  {
                    page: "Payroll",
                    title: "4. Salary records",
                    text: "Choose an employee and salary month. Record the salary once, then add full or partial payments. The remaining amount stays visible.",
                  },
                  {
                    page: "Vendors",
                    title: "5. Suppliers",
                    text: "The businesses or people you buy from. Save regular suppliers here so you can choose them again when entering expenses.",
                  },
                  {
                    page: "Reports",
                    title: "6. Reports",
                    text: "See recorded costs, money paid and what is still owed. Refunds reduce costs; payments do not create a second expense.",
                  },
                ].map((item) => (
                  <button
                    key={item.page}
                    className="quick-guide-item"
                    onClick={() => {
                      navigate(item.page);
                      setShowGuide(false);
                    }}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.text}</span>
                    <span className="quick-guide-link">Open section →</span>
                  </button>
                ))}
              </div>
              <p>
                <strong>Made a mistake?</strong> Open the record and choose
                Correct record or Correct payment. Use Record refund only when
                money was actually returned to Jaye.
              </p>
            </section>
          )}
          {registerDetail && (
            <RegisterDetails
              kind={registerDetail.kind}
              record={registerDetail.record}
              entityName={current?.name || entity}
              currency={currency}
              users={users}
              format={fmt}
              onClose={() => setRegisterDetail(null)}
              onSource={(id) => {
                setRegisterDetail(null);
                void openDetail(id);
              }}
            />
          )}
          {detail && (
            <div className="record-page">
              <section
                className="drawer record-page-content"
                tabIndex={-1}
                aria-label="Spend details"
              >
                <div className="drawer-top">
                  <span className="kicker">TRANSACTION DETAILS</span>
                  <button
                    className="button secondary"
                    onClick={() => setDetail(null)}
                  >
                    ← Back to {page}
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
                    ...(detail.subscription_id
                      ? [
                          ["Subscription", detail.subscription_name],
                          ["Billing cycle", detail.billing_date],
                        ]
                      : []),
                    [
                      "Approval",
                      statusNames[detail.approval_status] ||
                        detail.approval_status,
                    ],
                    ["Settlement", detail.settlement_status],
                    [
                      "Paid by",
                      detail.payment_source === "company"
                        ? "Jaye"
                        : `${detail.payment_source} · ${users.find((u) => u.id === detail.paid_by_id)?.name}`,
                    ],
                    [
                      "Amount still to settle",
                      fmt(detail.outstanding_minor, detail.currency),
                    ],
                    ...(detail.adjustment_minor > 0
                      ? [
                          [
                            "Credits / personal refunds",
                            fmt(detail.adjustment_minor, detail.currency),
                          ],
                          [
                            "Adjusted expense cost",
                            fmt(detail.effective_amount_minor, detail.currency),
                          ],
                        ]
                      : []),
                    ...(detail.recoverable_minor > 0
                      ? [
                          [
                            "Due back to Jaye",
                            fmt(detail.recoverable_minor, detail.currency),
                          ],
                        ]
                      : []),
                    ...(detail.pending_adjustments
                      ? [
                          [
                            "Payment hold",
                            "Credit / refund awaiting posting or cancellation",
                          ],
                        ]
                      : []),
                    ["Invoice number", detail.invoice_number || "—"],
                    ["Invoice date", detail.invoice_date || "—"],
                    ["Due date", detail.due_date || "—"],
                    [
                      "Original payment date",
                      detail.original_paid_date || "Not recorded",
                    ],
                    [
                      "Payment method",
                      detail.payment_method?.replaceAll("_", " ") || "—",
                    ],
                    ["Account / method label", detail.payment_account || "—"],
                    [
                      "Original payment reference",
                      detail.original_payment_reference || "—",
                    ],
                    ...(detail.payment_reference
                      ? [["Bank confirmation", detail.payment_reference]]
                      : []),
                    ...(detail.reconciliation_reference
                      ? [
                          [
                            "Statement reference",
                            detail.reconciliation_reference,
                          ],
                        ]
                      : []),
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span>{k}</span>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>
                {user?.id === detail.requester_id &&
                  ["draft", "returned"].includes(detail.status) && (
                    <button
                      className="button secondary"
                      onClick={() => setModal("edit")}
                    >
                      Edit expense details
                    </button>
                  )}
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
                {detail.claim_id ? (
                  <div className="workflow">
                    <h3>Grouped reimbursement</h3>
                    <p>
                      This expense belongs to {detail.claim_id}. Review and
                      repay it through its claim.
                    </p>
                    <button
                      className="button primary"
                      onClick={() => navigate("Reimbursements")}
                    >
                      Open reimbursements
                    </button>
                  </div>
                ) : (
                  <Workflow
                    detail={detail}
                    user={user}
                    busy={busy}
                    onAction={perform}
                    onConvert={() => setModal("convert")}
                  />
                )}
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
                        {JSON.parse(h.details).changes && (
                          <details>
                            <summary>View changed fields</summary>
                            {Object.entries(JSON.parse(h.details).changes).map(
                              ([field, change]: [string, any]) => (
                                <p key={field}>
                                  {field.replaceAll("_", " ")}:{" "}
                                  {String(change.before || "—")} →{" "}
                                  {String(change.after || "—")}
                                </p>
                              ),
                            )}
                          </details>
                        )}
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

          <div hidden={!!detail || !!registerDetail}>
            <div
              className={`page-heading ${page === "Overview" ? "dashboard-heading" : ""}`}
            >
              <div>
                <h1>
                  {page === "Overview"
                    ? "Dashboard"
                    : page === "Settings"
                      ? "Settings & controls"
                      : page === "Spend"
                        ? "Approval requests"
                        : page === "Vendors"
                          ? "Suppliers"
                          : page === "Payments"
                            ? "Payment approvals"
                            : page}
                </h1>
                <p>
                  {page === "Overview"
                    ? "Track spend, stay in control, and keep every naira accounted for."
                    : page === "Invoices"
                      ? "Create branded customer invoices, export a PDF and share it."
                      : page === "Expenses"
                        ? "Record purchases, unpaid bills and payments in one place."
                        : page === "Employees"
                          ? "Keep employee details and agreed salaries up to date."
                          : page === "Payroll"
                            ? "Document monthly salaries, payments and the amount still owed."
                            : page === "Recoveries"
                              ? "Track repayments to Jaye, match bank credits, and clear recovery balances."
                              : page === "Subscriptions"
                                ? "Track recurring costs, departments and renewal dates."
                                : page === "Reimbursements"
                                  ? "Group personal expenses, repay in stages, and see what each person is owed."
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
                                              ? "Outstanding balances, recurring forecasts, refunds and posted financial statements."
                                              : page === "Audit trail"
                                                ? "A complete, tamper-evident history of every financial action."
                                                : page === "Vendors"
                                                  ? "Save the suppliers you buy from, then reuse their names when recording expenses."
                                                  : "Transparency, with the right controls."}
                </p>
              </div>
              {canCreate &&
                ["Overview", "Spend", "Approvals", "Payments"].includes(
                  page,
                ) && (
                  <button
                    className="button primary"
                    onClick={() =>
                      page === "Overview"
                        ? openRecord("new", "expense")
                        : setModal("spend")
                    }
                  >
                    <Plus size={17} />
                    {page === "Overview"
                      ? "Record expense"
                      : "New approval request"}
                  </button>
                )}
            </div>
            <div className="workspace-toolbar">
              <div className="entity-select">
                <span className="entity-icon">
                  <Building2 size={17} />
                </span>
                <span className="workspace-company">GoJaye Nigeria Ltd</span>
                <span className="currency-chip">
                  {entity === "group" ? "USD" : currency}
                </span>
              </div>
              <div className="period-label">
                <Clock3 size={15} />
                {new Intl.DateTimeFormat("en-NG", {
                  month: "long",
                  year: "numeric",
                  timeZone: "Africa/Lagos",
                }).format(new Date())}
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
              <InvestorWorkspace />
            ) : user?.role === "admin" ? (
              <Empty title="Technical configuration only">
                This role cannot view, approve, post or pay financial records.
                Contact your workspace administrator for financial access.
              </Empty>
            ) : entity === "group" ? (
              <Empty title="Group consolidation is gated">
                Consolidated figures require approved FX policies, matched
                intercompany balances and a frozen consolidation run. Select an
                individual entity to view spend and the ledger.
              </Empty>
            ) : activeRoles && !activeRoles.includes(user?.role || "") ? (
              <Empty title="This view is restricted for your role">
                Contact your workspace administrator if you need access.
                Employees can submit and track their own expenses from Spend.
              </Empty>
            ) : (
              !error && (
                <>
                  {page === "Financial Model" && user && (
                    <FinancialModel
                      key={`${entity}:${user.id}`}
                      entity={entity}
                      request={api}
                    />
                  )}
                  {page === "Recoveries" && user && (
                    <Recoveries
                      key={`${entity}:${user.id}`}
                      entity={entity}
                      currency={currency}
                      user={user}
                      request={api}
                      onExpense={openDetail}
                    />
                  )}
                  {page === "Subscriptions" && user && (
                    <Subscriptions
                      key={`${entity}:${user.id}`}
                      entity={entity}
                      currency={currency}
                      user={user}
                      users={users}
                      vendors={vendors}
                      spends={spends}
                      request={api}
                      onExpense={openDetail}
                      onRecord={openRecord}
                    />
                  )}
                  {page === "Reimbursements" && user && (
                    <Reimbursements
                      key={`${entity}:${user.id}`}
                      entity={entity}
                      currency={currency}
                      user={user}
                      request={api}
                      onExpense={openDetail}
                    />
                  )}
                  {["Expenses", "Employees", "Payroll"].includes(page) &&
                    user && (
                      <Bookkeeping
                        key={`${page}:${entity}`}
                        entity={entity}
                        currency={currency}
                        page={page}
                        initialQuery={search}
                        initialRecordId={recordTarget}
                        user={user}
                        request={api}
                        navigate={navigate}
                      />
                    )}
                  {page === "Overview" && data && (
                    <>
                      <div className="metrics simple-dashboard-metrics">
                        <Metric
                          label="Total recorded costs"
                          value={fmt(data.spend_minor, currency)}
                          icon={<Receipt size={19} />}
                          note="Expenses and salaries · counted once"
                        />
                        <Metric
                          label="Still owed"
                          value={fmt(
                            data.record_summary?.owed_minor || 0,
                            currency,
                          )}
                          icon={<Wallet size={19} />}
                          note="Documented expenses and salaries"
                        />
                        <Metric
                          label="Salary payments due"
                          value={fmt(
                            data.record_summary?.salary_owed_minor || 0,
                            currency,
                          )}
                          icon={<Users size={19} />}
                          note="Included in the amount still owed"
                        />
                      </div>
                      <div className="dashboard-records-layout">
                        <section className="panel dashboard-records">
                          <div className="panel-heading">
                            <div>
                              <h2>Recent records</h2>
                              <p>
                                Latest expenses and salaries, with payment
                                status.
                              </p>
                            </div>
                            <button
                              className="text-button"
                              onClick={() => navigate("Reports")}
                            >
                              View reports <ArrowRight size={16} />
                            </button>
                          </div>
                          {data.documented_recent?.length ? (
                            <div className="table-scroll">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Description</th>
                                    <th>Payee</th>
                                    <th>Cost</th>
                                    <th>Status</th>
                                    <th>
                                      <span className="sr-only">Actions</span>
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {data.documented_recent.map((r: Row) => (
                                    <tr key={r.id}>
                                      <td>
                                        {r.description}
                                        <small>{r.date}</small>
                                      </td>
                                      <td>{r.payee}</td>
                                      <td>{fmt(r.amount_minor, currency)}</td>
                                      <td>
                                        <span
                                          className={`dashboard-record-status ${r.outstanding_minor === 0 ? "is-paid" : "is-due"}`}
                                        >
                                          {r.outstanding_minor === 0
                                            ? "Paid"
                                            : r.outstanding_minor <
                                                r.amount_minor
                                              ? "Part paid"
                                              : "Unpaid"}
                                        </span>
                                        {r.outstanding_minor > 0 && (
                                          <small>
                                            {fmt(r.outstanding_minor, currency)}{" "}
                                            owed
                                          </small>
                                        )}
                                      </td>
                                      <td>
                                        <button
                                          className="button"
                                          onClick={() =>
                                            navigate(
                                              r.kind === "salary"
                                                ? "Payroll"
                                                : "Expenses",
                                            )
                                          }
                                        >
                                          View records
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <Empty title="Your workspace is ready">
                              Record your first expense, or add an employee to
                              start documenting salaries.
                            </Empty>
                          )}
                        </section>
                        <aside
                          className="dashboard-sidebar"
                          aria-label="Workspace shortcuts and outstanding payments"
                        >
                          <section className="panel dashboard-attention">
                            <div className="dashboard-section-label">
                              <Clock3 size={16} /> Payment overview
                            </div>
                            <h2>
                              {data.record_summary?.owed_minor > 0
                                ? "Payments to follow up"
                                : "No outstanding payments"}
                            </h2>
                            <p>
                              {data.record_summary?.owed_minor > 0
                                ? "Amounts still owed on your recorded expenses and salaries."
                                : "Your recorded expenses and salaries have no remaining balance."}
                            </p>
                            <button
                              className="dashboard-balance-link"
                              onClick={() => navigate("Expenses")}
                            >
                              <span>Expenses & bills</span>
                              <strong>
                                {fmt(
                                  (data.record_summary?.owed_minor || 0) -
                                    (data.record_summary?.salary_owed_minor ||
                                      0),
                                  currency,
                                )}
                              </strong>
                              <ArrowRight size={16} />
                            </button>
                            <button
                              className="dashboard-balance-link"
                              onClick={() => navigate("Payroll")}
                            >
                              <span>Salaries</span>
                              <strong>
                                {fmt(
                                  data.record_summary?.salary_owed_minor || 0,
                                  currency,
                                )}
                              </strong>
                              <ArrowRight size={16} />
                            </button>
                          </section>
                          <section className="panel dashboard-shortcuts">
                            <div className="dashboard-section-label">
                              Quick access
                            </div>
                            {[
                              {
                                page: "Expenses",
                                title: "Expenses & bills",
                                note: "Record costs and payments",
                                icon: <Receipt size={19} />,
                              },
                              {
                                page: "Employees",
                                title: "Employees",
                                note: "Manage your team and salaries",
                                icon: <Users size={19} />,
                              },
                              {
                                page: "Payroll",
                                title: "Payroll",
                                note: "Record monthly salary payments",
                                icon: <Wallet size={19} />,
                              },
                            ].map((item) => (
                              <button
                                key={item.page}
                                className="dashboard-shortcut"
                                onClick={() => navigate(item.page)}
                              >
                                <span className="dashboard-shortcut-icon">
                                  {item.icon}
                                </span>
                                <span>
                                  <strong>{item.title}</strong>
                                  <small>{item.note}</small>
                                </span>
                                <ArrowRight size={16} />
                              </button>
                            ))}
                          </section>
                        </aside>
                      </div>
                      {spends.length > 0 && (
                        <section className="panel">
                          <div className="panel-heading">
                            <h2>Approval workflow records</h2>
                            <button
                              className="button"
                              onClick={() => {
                                navigate("Spend");
                              }}
                            >
                              View approval requests
                            </button>
                          </div>
                          <SpendTable rows={data.recent} short />
                        </section>
                      )}
                    </>
                  )}
                  {["Spend", "Approvals", "Payments"].includes(page) && (
                    <section className="panel finance-workspace spend-workspace">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            {page === "Spend"
                              ? "Expense register"
                              : page === "Approvals"
                                ? "Approval queue"
                                : "Payment queue"}
                          </h2>
                          <p>
                            {page === "Spend"
                              ? "Expenses, vendor bills and spend requests in one place."
                              : page === "Approvals"
                                ? "Open a request to review its details, evidence and approval history."
                                : "Track scheduled payments, confirmations and bank reconciliation."}
                          </p>
                        </div>
                      </div>
                      <div className="list-toolbar">
                        <div
                          className="table-tabs"
                          aria-label="Expense filters"
                        >
                          <button
                            className={filter === "all" ? "selected" : ""}
                            aria-pressed={filter === "all"}
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
                                aria-pressed={filter === "draft"}
                                onClick={() => setFilter("draft")}
                              >
                                Drafts
                              </button>
                              <button
                                className={
                                  filter === "approved" ? "selected" : ""
                                }
                                aria-pressed={filter === "approved"}
                                onClick={() => setFilter("approved")}
                              >
                                Approved
                              </button>
                              <button
                                className={
                                  filter === "missing" ? "selected" : ""
                                }
                                aria-pressed={filter === "missing"}
                                onClick={() => setFilter("missing")}
                              >
                                Missing receipts
                              </button>
                              <button
                                className={filter === "owed" ? "selected" : ""}
                                aria-pressed={filter === "owed"}
                                onClick={() => setFilter("owed")}
                              >
                                Reimbursements due
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
                      {page === "Spend" && (
                        <div className="expense-filters">
                          <label>
                            Paid by
                            <Select
                              aria-label="Filter paid by"
                              value={sourceFilter}
                              onChange={(e) => setSourceFilter(e.target.value)}
                            >
                              <option value="all">All payment sources</option>
                              <option value="company">Jaye</option>
                              <option value="employee">Employee</option>
                              <option value="founder">Founder</option>
                            </Select>
                          </label>
                          <label>
                            Category
                            <Select
                              aria-label="Filter category"
                              value={categoryFilter}
                              onChange={(e) =>
                                setCategoryFilter(e.target.value)
                              }
                            >
                              <option value="all">All categories</option>
                              {cats.map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                            </Select>
                          </label>
                          <label>
                            From
                            <input
                              aria-label="From date"
                              type="date"
                              value={fromDate}
                              onChange={(e) => setFromDate(e.target.value)}
                            />
                          </label>
                          <label>
                            To
                            <input
                              aria-label="To date"
                              type="date"
                              value={toDate}
                              onChange={(e) => setToDate(e.target.value)}
                            />
                          </label>
                          <button
                            className="button secondary small"
                            onClick={() => {
                              setSourceFilter("all");
                              setCategoryFilter("all");
                              setFromDate("");
                              setToDate("");
                              setFilter("all");
                              setSearch("");
                            }}
                          >
                            Clear filters
                          </button>
                          <span className="micro">
                            CSV exports all accessible expenses for this entity.
                          </span>
                        </div>
                      )}
                      {page === "Payments" && (
                        <div className="inline-note">
                          <LockKeyhole size={16} />
                          Record payments made outside Jaye, then match them to
                          bank statements.
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
                    <div className="finance-workspace budgets-workspace">
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
                      <section className="panel budgets-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>Department budgets</h2>
                            <p>
                              Track department allocations, commitments and
                              actual spend.
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
                                    <button
                                      className="record-link"
                                      onClick={() =>
                                        setRegisterDetail({
                                          kind: "budget",
                                          record: b,
                                        })
                                      }
                                    >
                                      {b.department}
                                      <ArrowUpRight size={14} />
                                    </button>
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
                                          width: `${b.amount_minor > 0 ? Math.max(0, Math.min(100, ((b.committed_minor + b.actual_minor) / b.amount_minor) * 100)) : 0}%`,
                                        }}
                                      />
                                    </div>
                                    <small>
                                      {b.amount_minor > 0
                                        ? `${Math.round(((b.committed_minor + b.actual_minor) / b.amount_minor) * 100)}% used`
                                        : "No budget set"}
                                    </small>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    </div>
                  )}
                  {page === "Vendors" && (
                    <section className="panel finance-workspace vendors-workspace">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            Supplier directory{" "}
                            <span className="count-pill">{vendors.length}</span>
                          </h2>
                          <p>
                            Businesses and suppliers you pay. Add a supplier
                            once, then reuse it in Expenses.
                          </p>
                        </div>
                        {user?.role === "finance" && (
                          <button
                            className="button primary small"
                            onClick={() => setModal("vendor")}
                          >
                            <Plus size={15} />
                            Add supplier
                          </button>
                        )}
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Supplier</th>
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
                                      <button
                                        className="record-link"
                                        onClick={() =>
                                          setRegisterDetail({
                                            kind: "vendor",
                                            record: v,
                                          })
                                        }
                                      >
                                        {v.name}
                                        <ArrowUpRight size={14} />
                                      </button>
                                      <small>{v.id}</small>
                                    </div>
                                  </div>
                                </td>
                                <td>{v.category}</td>
                                <td>
                                  <FinanceStatus status={v.status} />
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
                    <section className="panel finance-workspace ledger-workspace">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            Posted journals{" "}
                            <span className="count-pill">{data.length}</span>
                          </h2>
                          <p>
                            Posted entries and account balances for this entity.
                          </p>
                        </div>
                        <span
                          className={`balanced ${data.some((j: Row) => j.lines.reduce((n: number, l: Row) => n + l.debit - l.credit, 0) !== 0) ? "invalid" : ""}`}
                        >
                          <Check size={14} />
                          {data.some(
                            (j: Row) =>
                              j.lines.reduce(
                                (n: number, l: Row) => n + l.debit - l.credit,
                                0,
                              ) !== 0,
                          )
                            ? "Review required"
                            : "Balanced"}
                        </span>
                      </div>
                      {data.map((j: Row) => (
                        <div className="journal" key={j.id}>
                          <div className="journal-title">
                            <div>
                              <button
                                className="record-link"
                                onClick={() =>
                                  setRegisterDetail({
                                    kind: "journal",
                                    record: j,
                                  })
                                }
                              >
                                JE-{j.year}-{String(j.number).padStart(5, "0")}
                                <ArrowUpRight size={14} />
                              </button>
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
                          <div className="table-scroll">
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
                        </div>
                      ))}
                      {data.length === 0 && (
                        <Empty title="No posted journals yet">
                          Entries appear here after transactions are posted.
                        </Empty>
                      )}
                    </section>
                  )}
                  {page === "Reports" && Array.isArray(data) && (
                    <>
                      <Reporting
                        key={`${entity}:${user?.id}`}
                        entity={entity}
                        currency={currency}
                        user={user!}
                        request={api}
                        onExpense={openDetail}
                        onChanged={() => {
                          api(`/reports/trial-balance?entity=${entity}`)
                            .then(setData)
                            .catch((e) => setError(e.message));
                        }}
                        onRecord={openRecord}
                      />
                      <Reports
                        rows={data}
                        currency={currency}
                        exportUrl={exportLink("trial-balance")}
                      />
                    </>
                  )}
                  {page === "Audit trail" && data && (
                    <AuditTrail
                      key={`${entity}:${user?.id}`}
                      data={data}
                      entityName={current?.name || entity}
                    />
                  )}
                  {page === "Invoices" && (
                    <Invoices entity={entity} request={api} />
                  )}
                  {page === "Settings" && <SettingsControls />}
                </>
              )
            )}
          </div>
        </main>
        <footer>
          <span className="footer-brand">jaye finance</span>
          <span>Clarity in every transaction.</span>
          <span>Jaye Finance</span>
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
      {modal && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setModal("")}
        >
          <section
            className={`modal spend-modal ${modal === "vendor" ? "vendor-modal" : ""}`}
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
                    ? "Add a supplier"
                    : modal === "edit"
                      ? "Edit expense details"
                      : modal === "convert"
                        ? "Record bill against request"
                        : "New expense"}
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
                  notify("Supplier saved. You can now select it in Expenses.");
                }}
              />
            ) : (
              <SpendForm
                entity={entity}
                currency={currency}
                vendors={vendors}
                parent={modal === "convert" ? detail : undefined}
                initial={modal === "edit" ? detail : undefined}
                users={users.filter(
                  (u) =>
                    u.entities.includes(entity) &&
                    !["admin", "investor"].includes(u.role) &&
                    (user?.role !== "employee" || u.id === user.id),
                )}
                userId={user?.id || ""}
                onDone={async (id) => {
                  setDetail(null);
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
        <span>
          {label === "Spend"
            ? "Approval requests"
            : label === "Payments"
              ? "Payment approvals"
              : label}
        </span>
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
      <h3>
        {review
          ? "Review expense"
          : d.status === "scheduled"
            ? "Payment confirmation"
            : d.status === "paid"
              ? "Bank reconciliation"
              : d.status === "reconciled"
                ? "Post payment"
                : "Next step"}
      </h3>
      {d.kind !== "request" && (
        <p>
          {d.payment_source !== "company"
            ? "This personal purchase is reimbursable. Payment settles the amount owed to the named person, not another vendor bill."
            : d.original_paid_date
              ? "Jaye has already paid. Verify the original reference and match the statement; this item is excluded from payment exports."
              : "Jaye will pay the vendor directly after approval."}
        </p>
      )}
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
              <label className="review-comment">
                Review comment
                <textarea
                  placeholder="Required to return or reject"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
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
              {d.payment_source !== "company"
                ? "Schedule reimbursement"
                : d.original_paid_date
                  ? "Queue existing payment verification"
                  : "Schedule payment"}
              <ArrowRight size={16} />
            </button>
          )}
          {((d.status === "scheduled" && role === "payer") ||
            (d.status === "paid" && role === "reconciler")) && (
            <>
              <label>
                {d.status === "paid"
                  ? "Statement row reference"
                  : "Bank confirmation reference"}
                {d.status === "paid" ? (
                  <Select
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
                  </Select>
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
                  : "Record payment confirmation"}
                <Check size={16} />
              </button>
              <p className="micro">
                Records a payment made outside Jaye. This does not transfer
                money.
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
                .
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
  initial,
  users,
  userId,
  onDone,
}: {
  entity: string;
  currency: string;
  vendors: Row[];
  parent?: Row | null;
  initial?: Row | null;
  users: Row[];
  userId: string;
  onDone: (id: string) => void;
}) {
  const [kind, setKind] = useState(
      initial?.kind || (parent ? "bill" : "expense"),
    ),
    [paymentSource, setPaymentSource] = useState(
      initial?.payment_source || "company",
    ),
    [companyPaid, setCompanyPaid] = useState(!!initial?.original_paid_date),
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
        ...(parent || initial?.parent_id
          ? { parent_id: parent?.id || initial?.parent_id }
          : {}),
        payment_source: kind === "request" ? "company" : paymentSource,
        paid_by_id:
          kind !== "request" && paymentSource !== "company"
            ? String(f.get("paid_by_id"))
            : "",
        original_paid_date: String(f.get("original_paid_date") || ""),
        original_payment_reference: String(
          f.get("original_payment_reference") || "",
        ),
        payment_method: String(f.get("payment_method") || ""),
        payment_account: String(f.get("payment_account") || ""),
        invoice_date: String(f.get("invoice_date") || ""),
        due_date: String(f.get("due_date") || ""),
        ...(initial ? { expected_revision: initial.revision } : {}),
      };
      const s = await api(initial ? `/spends/${initial.id}/edit` : "/spends", {
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
          ["expense", "Expense"],
          ["bill", "Vendor bill"],
          ["request", "Spend request"],
        ].map(([k, l]) => (
          <button
            type="button"
            key={k}
            disabled={!!parent || !!initial || !!savedId}
            aria-pressed={kind === k}
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
          defaultValue={initial?.description || parent?.description}
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
            defaultValue={
              initial || parent
                ? ((initial || parent)!.amount_minor / 100).toFixed(2)
                : ""
            }
            disabled={!!savedId}
          />
        </label>
        <label>
          Transaction date
          <input
            required
            name="date"
            type="date"
            defaultValue={
              initial?.date || new Date().toLocaleDateString("en-CA")
            }
            disabled={!!savedId}
          />
        </label>
      </div>
      <label>
        Vendor
        <Select
          required
          name="vendor_id"
          defaultValue={initial?.vendor_id || parent?.vendor_id || ""}
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
        </Select>
      </label>
      <div className="form-row">
        <label>
          Department
          <Select
            name="department"
            defaultValue={
              initial?.department || parent?.department || "Operations"
            }
            disabled={!!savedId}
          >
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        </label>
        <label>
          Category
          <CategorySelect
            entity={entity}
            defaultValue={initial?.category || parent?.category || "Operations"}
            disabled={!!savedId}
          />
        </label>
      </div>
      {kind !== "request" && (
        <label>
          Invoice number
          <input
            required={kind === "bill"}
            defaultValue={initial?.invoice_number || ""}
            name="invoice_number"
            placeholder="INV-2026-001"
            disabled={!!savedId}
          />
        </label>
      )}
      {kind !== "request" && (
        <>
          <div className="form-row">
            <label>
              Invoice date
              <input
                type="date"
                name="invoice_date"
                defaultValue={initial?.invoice_date}
                disabled={!!savedId}
              />
            </label>
            <label>
              Due date
              <input
                type="date"
                name="due_date"
                defaultValue={initial?.due_date}
                disabled={!!savedId}
              />
            </label>
          </div>
          <fieldset className="payment-fields" disabled={!!savedId}>
            <legend>Payment responsibility</legend>
            <label>
              Who pays for this expense?
              <Select
                value={paymentSource}
                onChange={(e) => setPaymentSource(e.target.value)}
              >
                <option value="company">Jaye pays directly</option>
                <option value="employee">Employee paid personally</option>
                <option value="founder">Founder paid personally</option>
              </Select>
            </label>
            {paymentSource === "company" ? (
              <label>
                Company payment
                <Select
                  value={companyPaid ? "paid" : "unpaid"}
                  onChange={(e) => setCompanyPaid(e.target.value === "paid")}
                >
                  <option value="unpaid">Not paid yet</option>
                  <option value="paid">
                    Already paid — record for verification
                  </option>
                </Select>
              </label>
            ) : (
              <>
                <label>
                  Person to reimburse
                  <Select
                    required
                    name="paid_by_id"
                    defaultValue={initial?.paid_by_id || userId}
                  >
                    {users.map((u) => (
                      <option value={u.id} key={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <p className="micro">
                  Record a repayable business purchase. Founder loans and
                  capital contributions belong in a separate funding workflow.
                </p>
              </>
            )}
            {(paymentSource !== "company" || companyPaid) && (
              <>
                <div className="form-row">
                  <label>
                    Original payment date
                    <input
                      required
                      type="date"
                      name="original_paid_date"
                      defaultValue={initial?.original_paid_date || ""}
                    />
                  </label>
                  <label>
                    Payment method
                    <Select
                      required
                      name="payment_method"
                      defaultValue={initial?.payment_method || ""}
                    >
                      <option value="">Select method</option>
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="card">Card</option>
                      <option value="cash">Cash</option>
                      <option value="other">Other</option>
                    </Select>
                  </label>
                </div>
                <label>
                  Account / method label
                  <input
                    name="payment_account"
                    maxLength={100}
                    defaultValue={initial?.payment_account}
                    placeholder="e.g. Jaye operating account or personal card (no account numbers)"
                  />
                </label>
                <label>
                  Original payment reference
                  <input
                    required={paymentSource === "company"}
                    name="original_payment_reference"
                    maxLength={120}
                    defaultValue={initial?.original_payment_reference}
                  />
                </label>
              </>
            )}
          </fieldset>
        </>
      )}
      <label>
        Business purpose
        <textarea
          required
          name="purpose"
          minLength={5}
          maxLength={1000}
          placeholder="Help the reviewer understand the business reason."
          defaultValue={initial?.purpose || parent?.purpose}
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
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <label>
        Business or supplier name
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          placeholder="e.g. Internet provider or office supplier"
        />
      </label>
      <label>
        Category
        <CategorySelect entity={entity} />
      </label>
      <label className="checkbox-label">
        <input type="checkbox" name="related_party" />
        Related-party supplier
      </label>
      <div className="inline-note">
        Save a supplier once, then select their name in Expenses. This directory
        records suppliers; it does not send payments.
      </div>
      <button className="button primary" disabled={busy}>
        {busy ? "Saving…" : "Create supplier"}
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
    <section className="panel finance-workspace financial-statements">
      <div className="panel-heading">
        <div>
          <h2>{report}</h2>
          <p>All posted entries · {currency}</p>
        </div>
        <a className="button secondary small" href={exportUrl}>
          <Download size={15} />
          Trial balance CSV
        </a>
      </div>
      <div
        className="report-tabs finance-tabs"
        aria-label="Financial statements"
      >
        {["Trial balance", "Profit & loss", "Balance sheet"].map((r) => (
          <button
            key={r}
            aria-pressed={report === r}
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
        Management reports. Accounting policies and statutory presentation await
        accountant and CPA approval.
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
    <section className="panel bank-import finance-workspace">
      <div className="panel-heading">
        <div>
          <h2>Statement reconciliation</h2>
          <p>
            Import a debit or credit statement. Match each row once, for the
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
          are positive integer minor units ({currency}). Add an optional
          direction column: debit or credit (defaults to debit). Bank balance
          validation is not included.
        </p>
        {["finance", "reconciler"].includes(role) && (
          <div className="bank-upload">
            <label className="bank-file-label">
              <span>Upload statement CSV</span>
              <small>Debit and credit transactions · maximum 1 MB</small>
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="Bank statement CSV"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
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
              {busy ? "Importing…" : "Import statement"}
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
                  <th className="number">Amount / direction</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.reference}</td>
                    <td>{r.date}</td>
                    <td className="number">
                      {fmt(r.amount_minor, currency)} · {r.direction}
                    </td>
                    <td>
                      {r.matched_spend_id ||
                        r.matched_repayment_id ||
                        r.matched_refund_id ||
                        r.matched_record_payment_id ||
                        r.matched_record_refund_id ||
                        r.matched_recovery_id ||
                        "Unmatched"}
                    </td>
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
