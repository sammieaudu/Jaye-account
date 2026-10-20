"use client";
import Select from "./select";
import SubscriptionSetup from "./subscription-setup";
import SubscriptionPayment from "./subscription-payment";
import { useEffect, useRef, useState, type FormEvent } from "react";
import FinanceStatus from "./finance-status";
type Row = Record<string, any>;
type Request = (path: string, options?: RequestInit) => Promise<any>;
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
    value / 100,
  );
const departments = ["Product", "Marketing", "Operations", "Finance"];
const categories = [
  "Cloud & software",
  "Marketing",
  "Operations",
  "Professional fees",
  "Travel",
  "Government fees",
];
function minor(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw Error("Enter a positive amount with up to two decimals");
  const [whole, part = ""] = value.split(".");
  const result = BigInt(whole) * 100n + BigInt(part.padEnd(2, "0"));
  if (result <= 0n || result > 1000000000000n)
    throw Error("Amount is outside the supported range");
  return Number(result);
}
const readableDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${value}T00:00:00Z`))
    : "Not set";
export default function Subscriptions({
  entity,
  currency,
  user,
  users,
  vendors,
  spends,
  request,
  onExpense,
  onRecord,
}: {
  entity: string;
  currency: string;
  user: Row;
  users: Row[];
  vendors: Row[];
  spends: Row[];
  request: Request;
  onExpense: (id: string) => void;
  onRecord: (id?: string) => void;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [days, setDays] = useState("90"),
    [selected, setSelected] = useState(""),
    [editing, setEditing] = useState<Row | null>(null),
    [invoice, setInvoice] = useState<Row | null>(null),
    [search, setSearch] = useState(""),
    [owner, setOwner] = useState("all"),
    [status, setStatus] = useState("all"),
    [resumeDate, setResumeDate] = useState("");
  const formPanel = useRef<HTMLElement>(null);
  const detailPanel = useRef<HTMLElement>(null);
  const invoicePanel = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const target = invoice
      ? invoicePanel.current
      : editing
        ? formPanel.current
        : selected
          ? detailPanel.current
          : null;
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [selected, editing, invoice]);
  async function reload() {
    const d = await request(`/subscriptions?entity=${entity}&days=${days}`);
    setData(d);
  }
  useEffect(() => {
    let active = true;
    setData(null);
    request(`/subscriptions?entity=${entity}&days=${days}`)
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
  const canCreate = ["employee", "manager", "finance", "cfo"].includes(
    user.role,
  );
  const canEdit = (s: Row) =>
    canCreate &&
    (["finance", "cfo"].includes(user.role) ||
      s.owner_id === user.id ||
      s.created_by === user.id);
  const selectedSub = data?.subscriptions.find((s: Row) => s.id === selected);
  async function mutate(path: string, body: Row, openExpense = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await reload();
      setEditing(null);
      setInvoice(null);
      if (openExpense) onExpense(result.id);
      else setSelected(result.id);
      setMessage(
        openExpense
          ? "Invoice linked to its expense. Attach evidence and follow the normal approval workflow."
          : "Subscription saved. Expected charges and reminders are updated.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(s?: Row) {
    setEditing(
      s || {
        name: "",
        plan: "",
        purpose: "",
        seats: 1,
        amount_minor: 0,
        owner_id: user.id,
        department: "Product",
        category: "Cloud & software",
        cadence: "monthly",
        interval_count: 1,
        billing_anchor: data?.today,
        renewal_date: "",
        cancellation_deadline: "",
        auto_renew: 1,
        payment_method: "",
        payment_account: "",
      },
    );
    setInvoice(null);
    setError("");
  }
  if (!data)
    return (
      <section className="panel reimbursement-panel">
        <p role={error ? "alert" : "status"}>
          {error || "Loading subscriptions…"}
        </p>
        <button
          className="button secondary"
          onClick={() => reload().catch((e) => setError(e.message))}
        >
          Retry
        </button>
      </section>
    );
  const visible: Row[] = data.subscriptions.filter(
    (s: Row) =>
      (owner === "all" || s.department === owner) &&
      (status === "all" || s.status === status) &&
      [
        s.name,
        s.vendor,
        s.department,
        s.responsible_employee,
        s.category_name,
        s.plan,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visibleIds = new Set(visible.map((s) => s.id));
  const upcoming: Row[] = data.charges.filter(
    (c: Row) =>
      visibleIds.has(c.subscription_id) &&
      c.outstanding_minor > 0 &&
      c.payment_due <= data.through,
  );
  const notifications = visible.flatMap((s) => [
    ...s.alerts.map((text: string) => ({ subscription: s.name, text })),
    ...s.charges.flatMap((c: Row) =>
      c.alerts.map((text: string) => ({
        subscription: s.name,
        text: `${c.due_date} · ${text}`,
      })),
    ),
  ]);
  return (
    <div className="subscriptions finance-workspace">
      <div hidden={!!selectedSub || !!editing}>
        <div className="metrics subscription-metrics">
          {[
            ["Active subscriptions", String(data.totals.active)],
            [
              "Monthly cost equivalent",
              money(data.totals.monthly_equivalent_minor, currency),
            ],
            [
              `Upcoming · ${days} days`,
              money(data.totals.upcoming_minor, currency),
            ],
            [
              "Overdue / missing invoices",
              money(data.totals.overdue_minor, currency),
            ],
          ].map(([name, value]) => (
            <section className="metric" key={name}>
              <div className="metric-top">{name}</div>
              <strong className="metric-value">{value}</strong>
            </section>
          ))}
        </div>
        <p className="micro">
          Forecasts include expected charges and outstanding linked bills once
          each. Monthly equivalents are planning estimates, not ledger expenses.
          Summary totals cover the whole entity.
        </p>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {message && (
          <p className="success-text" role="status">
            {message}
          </p>
        )}
        {notifications.length > 0 && (
          <section className="panel subscription-alerts">
            <h2>
              Needs attention{" "}
              <span className="muted">({notifications.length})</span>
            </h2>
            <ul>
              {notifications.slice(0, 8).map((n, i) => (
                <li key={i}>
                  <strong>{n.subscription}</strong> · {n.text}
                </li>
              ))}
            </ul>
            {notifications.length > 8 && (
              <p className="micro">
                Open individual subscriptions for the remaining reminders.
              </p>
            )}
          </section>
        )}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Subscription register</h2>
              <p>Services, departments, renewal dates and recurring costs.</p>
            </div>
            {canCreate && (
              <button className="button primary" onClick={() => edit()}>
                New subscription
              </button>
            )}
          </div>
          <div className="expense-filters">
            <label>
              Search
              <input
                aria-label="Search subscriptions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Subscription, provider or employee"
              />
            </label>
            <label>
              Department
              <Select
                aria-label="Subscription department filter"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              >
                <option value="all">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d} department
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Status
              <Select
                aria-label="Subscription status filter"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </label>
            <label>
              Payment horizon
              <Select
                aria-label="Payment horizon"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              >
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">365 days</option>
              </Select>
            </label>
          </div>
          {visible.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Subscription</th>
                    <th>Department / contact</th>
                    <th>Price / cycle</th>
                    <th>Next bill</th>
                    <th>Renewal</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <button
                          className="claim-link"
                          onClick={() => {
                            setSelected(s.id);
                            setEditing(null);
                            setInvoice(null);
                            setError("");
                          }}
                        >
                          {s.name}
                        </button>
                        <small className="expense-subline">
                          {s.vendor}
                          {s.plan ? ` · ${s.plan}` : ""}
                          {s.users_count ? ` · ${s.users_count} users` : ""}
                        </small>
                      </td>
                      <td>
                        {s.department}
                        <small>
                          {s.responsible_employee || "No employee assigned"}
                        </small>
                      </td>
                      <td>
                        {money(s.amount_minor, currency)}
                        <small className="expense-subline">
                          {s.cadence === "custom_days"
                            ? `Every ${s.interval_count} days`
                            : s.cadence === "annual"
                              ? "Annually"
                              : "Monthly"}
                        </small>
                      </td>
                      <td>{s.next_billing_date || "—"}</td>
                      <td>{s.renewal_date || "Not set"}</td>
                      <td>
                        <FinanceStatus status={s.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <h3>No subscriptions to show</h3>
              <p>Add a subscription or change the filters.</p>
            </div>
          )}
        </section>
      </div>
      {(selectedSub || editing) && message && (
        <p role="status" className="success-banner">
          {message}
        </p>
      )}
      {(selectedSub || editing) && error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {editing && (
        <section
          ref={formPanel}
          tabIndex={-1}
          aria-label={editing.id ? "Edit subscription" : "New subscription"}
          className="panel reimbursement-panel finance-detail"
        >
          <h2>{editing.id ? "Edit subscription" : "New subscription"}</h2>
          <SubscriptionSetup
            key={`${editing.id || "new"}:${editing.revision || 0}`}
            value={editing}
            employees={data.employees || []}
            categories={data.subscription_categories || []}
            providers={vendors}
            currency={currency}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={async (values) => {
              setBusy(true);
              try {
                const saved = await request(
                  `/subscriptions${editing.id ? `/${editing.id}/edit` : ""}`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      ...values,
                      entity_id: entity,
                      currency,
                      ...(editing.id
                        ? { expected_revision: editing.revision }
                        : {}),
                    }),
                  },
                );
                await reload();
                setEditing(null);
                setSelected(saved.id);
                setMessage(
                  "Subscription saved. Your billing dates and responsible department are ready to track.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </section>
      )}
      <section className="panel" hidden={!!selectedSub || !!editing}>
        <div className="panel-heading">
          <div>
            <h2>Upcoming payments & overdue bills</h2>
            <p>
              Through {data.through}. Paid or reimbursed invoices are excluded.
              Missing invoices remain estimates.
            </p>
          </div>
        </div>
        {upcoming.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Payment due</th>
                  <th>Subscription / department</th>
                  <th>Outstanding / expected</th>
                  <th>Status</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((c) => (
                  <tr key={`${c.subscription_id}:${c.due_date}`}>
                    <td>{c.payment_due}</td>
                    <td>
                      {c.subscription}
                      <small className="expense-subline">
                        {c.department}
                        {c.responsible_employee
                          ? ` · ${c.responsible_employee}`
                          : ""}
                      </small>
                    </td>
                    <td>{money(c.outstanding_minor, currency)}</td>
                    <td>
                      {c.status}
                      <small className="expense-subline">
                        {c.alerts.join(" · ")}
                      </small>
                    </td>
                    <td>
                      {c.record_id ? (
                        <button
                          className="button secondary small"
                          onClick={() => onRecord(c.record_id)}
                        >
                          Open in Expenses
                        </button>
                      ) : c.spend_id ? (
                        <button
                          className="button secondary small"
                          onClick={() => onExpense(c.spend_id)}
                        >
                          Open expense
                        </button>
                      ) : canEdit(
                          data.subscriptions.find(
                            (s: Row) => s.id === c.subscription_id,
                          ),
                        ) ? (
                        <button
                          className="button secondary small"
                          onClick={() => {
                            setSelected(c.subscription_id);
                            setEditing(null);
                            setInvoice({
                              ...c,
                              mode:
                                user.role === "finance" ? "payment" : "create",
                            });
                          }}
                        >
                          {user.role === "finance"
                            ? "Record payment"
                            : user.role === "finance"
                              ? "Record payment"
                              : "Record invoice"}
                        </button>
                      ) : (
                        "Awaiting invoice"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <p>No unpaid charges in this horizon.</p>
          </div>
        )}
      </section>
      {selectedSub && !editing && (
        <section
          ref={detailPanel}
          tabIndex={-1}
          className="panel reimbursement-panel finance-detail subscription-detail"
          aria-label="Subscription details"
        >
          <div className="panel-heading">
            <div>
              <div className="subscription-title-line">
                <h2>{selectedSub.name}</h2>
                <FinanceStatus status={selectedSub.status} />
              </div>
              <p>
                {selectedSub.vendor} · {selectedSub.department} department ·{" "}
                {selectedSub.responsible_employee || "No employee assigned"}
              </p>
            </div>
            <button
              className="button secondary small"
              onClick={() => {
                setSelected("");
                setInvoice(null);
              }}
            >
              ← Back to subscriptions
            </button>
          </div>
          <div className="subscription-summary">
            <div className="subscription-price">
              <span>Total cost</span>
              <strong>{money(selectedSub.amount_minor, currency)}</strong>
              <small>
                {selectedSub.cadence === "annual"
                  ? "per year"
                  : selectedSub.cadence === "monthly"
                    ? "per month"
                    : `every ${selectedSub.interval_count} days`}
              </small>
            </div>
            <div>
              <span>Next payment</span>
              <strong>
                {selectedSub.next_billing_date
                  ? readableDate(selectedSub.next_billing_date)
                  : "None scheduled"}
              </strong>
              <small>
                {selectedSub.auto_renew
                  ? "Renews automatically"
                  : "Auto-renew is off"}
              </small>
            </div>
            <div>
              <span>
                {selectedSub.auto_renew ? "Renewal date" : "Expiry date"}
              </span>
              <strong>{readableDate(selectedSub.renewal_date)}</strong>
              {selectedSub.cancellation_deadline && (
                <small>
                  Cancel by {readableDate(selectedSub.cancellation_deadline)}
                </small>
              )}
            </div>
          </div>
          <dl className="subscription-facts">
            <div>
              <dt>Category</dt>
              <dd>{selectedSub.category_name || selectedSub.category}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>
                {readableDate(
                  selectedSub.start_date || selectedSub.billing_anchor,
                )}
              </dd>
            </div>
            <div>
              <dt>Payment method</dt>
              <dd>
                {(
                  {
                    card: "Card",
                    bank_transfer: "Bank transfer",
                    cash: "Cash",
                    other: "Other",
                  } as Record<string, string>
                )[selectedSub.payment_method] || "Not specified"}
                {selectedSub.payment_account && (
                  <small>{selectedSub.payment_account}</small>
                )}
              </dd>
            </div>
          </dl>
          {selectedSub.purpose &&
            selectedSub.purpose !== "Subscription for business use" && (
              <p className="subscription-notes">{selectedSub.purpose}</p>
            )}
          {user.role === "finance" && (
            <div className="subscription-edit">
              <button
                className="button primary"
                onClick={() =>
                  setInvoice({
                    subscription_id: selectedSub.id,
                    due_date: data.today,
                    expected_minor: selectedSub.amount_minor,
                    mode: "payment",
                    manual: true,
                  })
                }
              >
                Record bill / payment
              </button>
              <p className="micro">
                Add a bill to Expenses, or link one you have already recorded.
              </p>
            </div>
          )}
          {canEdit(selectedSub) && selectedSub.status !== "cancelled" && (
            <div className="subscription-edit">
              <button
                className="button secondary"
                onClick={() => edit(selectedSub)}
              >
                Edit details
              </button>
            </div>
          )}
          {canEdit(selectedSub) && (
            <details className="subscription-manage">
              <summary>Manage tracking & linked bills</summary>
              <p className="micro">
                These controls update your records only. Cancel the service with
                the provider separately.
              </p>
              <div className="action-buttons subscription-actions">
                {selectedSub.status === "active" && (
                  <button
                    disabled={busy}
                    className="button secondary"
                    onClick={() =>
                      mutate(`/subscriptions/${selectedSub.id}/action`, {
                        action: "pause",
                        expected_revision: selectedSub.revision,
                      })
                    }
                  >
                    Pause tracking
                  </button>
                )}
                {selectedSub.status === "paused" && (
                  <>
                    <label>
                      Resume billing date
                      <input
                        type="date"
                        min={data.today}
                        value={resumeDate}
                        onChange={(e) => setResumeDate(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy || !resumeDate}
                      className="button secondary"
                      onClick={() =>
                        mutate(`/subscriptions/${selectedSub.id}/action`, {
                          action: "resume",
                          expected_revision: selectedSub.revision,
                          next_billing_date: resumeDate,
                        })
                      }
                    >
                      Resume tracking
                    </button>
                  </>
                )}
                {selectedSub.status !== "cancelled" && (
                  <button
                    disabled={busy}
                    className="button secondary"
                    onClick={() =>
                      mutate(`/subscriptions/${selectedSub.id}/action`, {
                        action: "cancel",
                        expected_revision: selectedSub.revision,
                      })
                    }
                  >
                    Mark cancelled
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() =>
                    setInvoice({
                      subscription_id: selectedSub.id,
                      due_date: data.today,
                      expected_minor: selectedSub.amount_minor,
                      mode: "link",
                    })
                  }
                >
                  Link existing / unexpected charge
                </button>
              </div>
            </details>
          )}
          <div className="subscription-billing-heading">
            <div>
              <h3>Billing history</h3>
              <p>Recorded bills and upcoming charges.</p>
            </div>
            <button className="text-button" onClick={() => onRecord()}>
              View expenses
            </button>
          </div>
          {selectedSub.charges.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Billing date</th>
                    <th>Expected</th>
                    <th>Actual invoice</th>
                    <th>Status / reminders</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSub.charges.map((c: Row) => (
                    <tr key={c.due_date}>
                      <td>{c.due_date}</td>
                      <td>{money(c.expected_minor, currency)}</td>
                      <td>
                        {c.expense
                          ? money(c.expense.amount_minor, currency)
                          : "Not recorded"}
                      </td>
                      <td>
                        {c.status}
                        <small className="expense-subline">
                          {c.alerts.join(" · ")}
                        </small>
                      </td>
                      <td>
                        {c.record_id && (
                          <button
                            className="button secondary small"
                            onClick={() => onRecord(c.record_id)}
                          >
                            Open in Expenses
                          </button>
                        )}
                        {c.spend_id && (
                          <button
                            className="button secondary small"
                            onClick={() => onExpense(c.spend_id)}
                          >
                            Open expense
                          </button>
                        )}
                        {!c.record_id &&
                          (!c.spend_id || c.expense?.status === "rejected") &&
                          canEdit(selectedSub) && (
                            <button
                              className="button secondary small"
                              onClick={() =>
                                setInvoice({
                                  ...c,
                                  subscription_id: selectedSub.id,
                                  mode:
                                    user.role === "finance" && !c.spend_id
                                      ? "payment"
                                      : "create",
                                })
                              }
                            >
                              {c.spend_id
                                ? "Replace rejected invoice"
                                : user.role === "finance"
                                  ? "Record payment"
                                  : "Record invoice"}
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="subscription-empty">
              <h4>No billing entries yet</h4>
              <p>
                {selectedSub.next_billing_date
                  ? "Scheduled charges will appear here as they enter your payment horizon."
                  : "Use Record bill / payment to add your first bill. You can update future billing dates in Edit details."}
              </p>
            </div>
          )}
          {invoice?.mode === "payment" &&
            invoice.subscription_id === selectedSub.id && (
              <SubscriptionPayment
                key={`${selectedSub.id}:${invoice.due_date}`}
                subscription={selectedSub}
                cycle={invoice}
                currency={currency}
                request={request}
                onCancel={() => setInvoice(null)}
                onDone={() => {
                  setInvoice(null);
                  setMessage(
                    "Saved in Expenses. This billing cycle uses the same record, so the cost is counted once.",
                  );
                  void reload();
                }}
              />
            )}

          {invoice &&
            invoice.mode !== "payment" &&
            invoice.subscription_id === selectedSub.id && (
              <form
                ref={invoicePanel}
                tabIndex={-1}
                aria-label="Subscription invoice"
                className="form subscription-invoice finance-detail"
                key={`${invoice.due_date}:${invoice.mode}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  try {
                    mutate(
                      `/subscriptions/${selectedSub.id}/invoices`,
                      invoice.mode === "link"
                        ? {
                            due_date: String(f.get("due_date")),
                            spend_id: String(f.get("spend_id")),
                          }
                        : {
                            due_date: invoice.due_date,
                            invoice_number: String(f.get("invoice_number")),
                            invoice_date: String(f.get("invoice_date")),
                            payment_due: String(f.get("payment_due")),
                            amount_minor: minor(String(f.get("amount"))),
                          },
                      true,
                    );
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                <h3>
                  {invoice.mode === "link"
                    ? "Link an existing expense"
                    : "Record vendor invoice"}{" "}
                  · {invoice.due_date}
                </h3>
                <div className="action-buttons">
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      setInvoice({
                        ...invoice,
                        mode: invoice.mode === "link" ? "create" : "link",
                      })
                    }
                  >
                    {invoice.mode === "link"
                      ? "Create a new bill instead"
                      : "Use an expense already in Spend"}
                  </button>
                </div>
                {invoice.mode === "link" ? (
                  <>
                    <label>
                      Billing cycle / unexpected charge date
                      <input
                        required
                        type="date"
                        name="due_date"
                        defaultValue={invoice.due_date}
                      />
                    </label>
                    <label>
                      Existing expense
                      <Select required name="spend_id" defaultValue="">
                        <option value="" disabled>
                          Select expense
                        </option>
                        {spends
                          .filter(
                            (s) =>
                              s.vendor_id === selectedSub.vendor_id &&
                              !s.subscription_id &&
                              s.kind !== "request" &&
                              s.status !== "rejected",
                          )
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.description} ·{" "}
                              {money(s.amount_minor, currency)} · {s.date}
                            </option>
                          ))}
                      </Select>
                    </label>
                  </>
                ) : (
                  <>
                    <div className="form-row">
                      <label>
                        Invoice number
                        <input required maxLength={100} name="invoice_number" />
                      </label>
                      <label>
                        Actual invoice amount ({currency})
                        <input
                          required
                          name="amount"
                          inputMode="decimal"
                          defaultValue={(invoice.expected_minor / 100).toFixed(
                            2,
                          )}
                        />
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        Invoice date
                        <input
                          required
                          type="date"
                          name="invoice_date"
                          defaultValue={invoice.due_date}
                        />
                      </label>
                      <label>
                        Payment due date
                        <input
                          required
                          type="date"
                          name="payment_due"
                          defaultValue={invoice.due_date}
                        />
                      </label>
                    </div>
                    <p className="micro">
                      Creates one draft bill. Attach the vendor invoice in its
                      expense drawer; approvals and payments stay in the
                      existing workflow. Employee/founder payment details can be
                      entered when editing that draft.
                    </p>
                  </>
                )}
                <div className="action-buttons">
                  <button disabled={busy} className="button primary">
                    Save invoice link & open expense
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setInvoice(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          <details className="claim-history">
            <summary>Subscription activity</summary>
            {selectedSub.history.map((h: Row) => (
              <p key={h.id}>
                <strong>
                  {h.action.replace("subscription.", "").replaceAll("_", " ")}
                </strong>{" "}
                · {h.actor} · {new Date(h.created_at).toLocaleString()}
              </p>
            ))}
          </details>
        </section>
      )}
    </div>
  );
}
