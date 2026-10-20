"use client";
import Select from "./select";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  FileText,
  Globe2,
  LockKeyhole,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
type Row = Record<string, any>;

export function AuditTrail({
  data,
  entityName,
}: {
  data: Row;
  entityName: string;
}) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = drawer.current?.querySelector<HTMLButtonElement>("button");
    close?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      // The read-only drawer has one interactive control.
      if (event.key === "Tab") {
        event.preventDefault();
        close?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [selected]);
  const events: Row[] = data.events || [];
  const actions = [
    ...new Set(events.map((event) => String(event.action))),
  ].sort();
  const rows = events.filter(
    (event) =>
      (!action || event.action === action) &&
      [
        event.action,
        event.actor,
        event.actor_id,
        event.resource_id,
        event.hash,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
  );
  let payload = selected?.details || "{}";
  try {
    payload = JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    /* Preserve stored text if it is not JSON. */
  }
  return (
    <section className="panel finance-workspace audit-workspace">
      <div className="panel-heading">
        <div>
          <h2>
            Audit events <span className="count-pill">{events.length}</span>
          </h2>
          <p>
            The latest 200 events for this entity. Existing events cannot be
            edited or deleted.
          </p>
        </div>
        <span
          className={`integrity-badge ${data.valid ? "verified" : "failed"}`}
        >
          <ShieldCheck size={15} />
          {data.valid ? "Chain verified" : "Integrity failure"}
        </span>
      </div>
      <div className="audit-filters">
        <label className="audit-search">
          <span>Search events</span>
          <div>
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Event, actor, source or hash"
            />
          </div>
        </label>
        <label>
          Event type
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All events</option>
            {actions.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
        </label>
        {(query || action) && (
          <button
            className="button secondary small"
            onClick={() => {
              setQuery("");
              setAction("");
            }}
          >
            Clear filters
          </button>
        )}
        <span className="audit-result-count" role="status">
          {rows.length} of {events.length} events
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
            {rows.map((event) => (
              <tr key={event.id}>
                <td>
                  <button
                    className="record-link"
                    onClick={() => setSelected(event)}
                  >
                    {event.action}
                    <ArrowUpRight size={14} />
                  </button>
                  <small>Event #{event.id}</small>
                </td>
                <td>{event.actor || event.actor_id}</td>
                <td>{event.resource_id}</td>
                <td>{new Date(event.created_at).toLocaleString()}</td>
                <td>
                  <code title={event.hash}>{event.hash.slice(0, 14)}…</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className="empty">
          <FileText size={24} />
          <h3>
            {events.length ? "No matching events" : "No audit events yet"}
          </h3>
          <p>
            {events.length
              ? "Try another search or clear your filters."
              : "Actions for this entity will appear here."}
          </p>
        </div>
      )}
      {selected && (
        <div
          className="drawer-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <section
            ref={drawer}
            className="drawer audit-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Audit event details"
          >
            <div className="drawer-top">
              <span className="kicker">AUDIT EVENT #{selected.id}</span>
              <button
                className="icon-button"
                onClick={() => setSelected(null)}
                aria-label="Close audit details"
              >
                <X size={21} />
              </button>
            </div>
            <div className="drawer-hero">
              <span className="vendor-icon large">
                <ShieldCheck size={24} />
              </span>
              <h2>{selected.action}</h2>
              <p>{new Date(selected.created_at).toLocaleString()}</p>
            </div>
            <div className="detail-grid">
              {[
                ["Entity", entityName],
                ["Actor", selected.actor || selected.actor_id],
                ["Actor ID", selected.actor_id],
                ["Source record", selected.resource_id],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value || "—"}</strong>
                </div>
              ))}
            </div>
            <div className="register-section">
              <h3>Recorded details</h3>
              <pre className="audit-payload">{payload}</pre>
            </div>
            <div className="register-section">
              <h3>Integrity record</h3>
              <dl className="audit-hashes">
                <dt>Event hash</dt>
                <dd>{selected.hash}</dd>
                <dt>Previous hash</dt>
                <dd>{selected.previous_hash}</dd>
              </dl>
              <p className="register-note">
                {data.valid
                  ? "The audit chain passed verification when these records were loaded."
                  : "The audit chain failed verification. Review the integrity failure before relying on these records."}
              </p>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
const controls = [
  [
    "Data",
    "Workspace records",
    "Only records entered into this workspace contribute to its balances.",
  ],
  [
    "Storage",
    "Persistent local database",
    "Records are stored in SQLite with write-ahead logging in the local data directory.",
  ],
  [
    "Evidence",
    "Encrypted supporting documents",
    "Evidence uses AES-256-GCM encryption. Upload signatures are checked and stored originals remain immutable.",
  ],
  [
    "Identity",
    "Local workspace access",
    "This local workspace uses a bootstrap owner account. Employee accounts, SSO and MFA are not configured.",
  ],
  [
    "Money",
    "Nigerian naira (NGN)",
    "GoJaye Nigeria Ltd is the company for this workspace. All amounts are recorded in NGN.",
  ],
  [
    "Payments",
    "Manual payment records",
    "No payment provider is connected. Confirmations in this build do not move real money.",
  ],
  [
    "Audit",
    "Append-only event history",
    "Audit events are linked by hashes. Open Audit trail to inspect events and the latest chain verification result.",
  ],
  [
    "Production",
    "Disabled pending sign-off",
    "Accountant, CPA and CFO sign-off is required before live use.",
  ],
];
const gates = [
  [
    "Expense policies & approval bands",
    "Confirm the expense policy and approval thresholds before using these controls with live transactions.",
  ],
  [
    "Charts of accounts & reporting framework",
    "Approve account mappings and the reporting framework with the finance advisers.",
  ],
  [
    "SSO / MFA & PostgreSQL migration",
    "Production identity and database infrastructure remain pending.",
  ],
  [
    "Payroll rules & adviser golden datasets",
    "Validate payroll rules against adviser-approved reference datasets.",
  ],
  [
    "Parallel run & auditor walkthrough",
    "Complete the parallel run and audit walkthrough before production sign-off.",
  ],
];
export function SettingsControls() {
  return (
    <div className="settings-grid finance-workspace controls-workspace">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Environment & controls</h2>
            <p>Workspace configuration</p>
          </div>
          <span className="finance-status neutral">Local workspace</span>
        </div>
        {controls.map(([title, value, description]) => (
          <details className="control-detail" key={title}>
            <summary>
              <span>
                <strong>{title}</strong>
                <small>{value}</small>
              </span>
              <ChevronDown size={16} />
            </summary>
            <p>{description}</p>
          </details>
        ))}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Approval gates</h2>
            <p>Requirements to resolve before live use.</p>
          </div>
          <span className="finance-status warning">Pending</span>
        </div>
        {gates.map(([title, description]) => (
          <details className="control-detail gate-detail" key={title}>
            <summary>
              <LockKeyhole size={16} />
              <strong>{title}</strong>
              <ChevronDown size={16} />
            </summary>
            <p>{description}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
export function InvestorWorkspace() {
  return (
    <div className="finance-workspace investor-workspace">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              Approved snapshots <span className="count-pill">0</span>
            </h2>
            <p>Monthly financial updates · USD reporting</p>
          </div>
          <span className="finance-status warning">Awaiting approval</span>
        </div>
        <div className="investor-empty">
          <span className="investor-empty-icon">
            <Globe2 size={28} />
          </span>
          <h2>A trusted view, approved first.</h2>
          <p>
            No snapshots have been approved in this local environment. Investor
            reporting will show frozen, CFO-approved monthly snapshots.
          </p>
          <span className="finance-status neutral">
            Phase 2 · Policy approval pending
          </span>
        </div>
      </section>
      <section className="panel investor-access">
        <div className="panel-heading">
          <div>
            <h2>Access & publication controls</h2>
            <p>How investor reporting is intended to work.</p>
          </div>
          <ShieldCheck size={20} />
        </div>
        {[
          [
            "Live financial data stays private",
            "Investors cannot access live expenses, payments or the general ledger. Only approved snapshots are intended for this workspace.",
          ],
          [
            "Approval and version history required",
            "Snapshot publication remains gated until the CFO approval process and version history are implemented.",
          ],
          [
            "Consolidation & FX policy pending",
            "Group reporting in USD requires approved consolidation rules and exchange-rate policies before figures can be published.",
          ],
        ].map(([title, description]) => (
          <details key={title} className="control-detail gate-detail">
            <summary>
              <LockKeyhole size={16} />
              <strong>{title}</strong>
              <ChevronDown size={16} />
            </summary>
            <p>{description}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
