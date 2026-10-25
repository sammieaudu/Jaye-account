"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Archive,
  Trash2,
  RotateCcw,
  RefreshCw,
} from "lucide-react";
type Row = Record<string, any>;
const departments = ["Product", "Marketing", "Operations", "Finance"];
const categories = [
  "Cloud & software",
  "Marketing",
  "Operations",
  "Professional fees",
  "Travel",
  "Government fees",
  "Salaries",
];
const currentMonth = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
export default function Budgets({
  entity,
  currency,
  request,
}: {
  entity: string;
  currency: string;
  request: (path: string, options?: RequestInit) => Promise<any>;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [canWrite, setCanWrite] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [archived, setArchived] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [editor, setEditor] = useState<Row | null>(null),
    [confirm, setConfirm] = useState<Row | null>(null),
    [history, setHistory] = useState<Row | null>(null);
  const keys = useRef(new Map<string, string>()),
    heading = useRef<HTMLHeadingElement>(null);
  const money = (n: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
      n / 100,
    );
  const load = useCallback(async () => {
    try {
      const [list, access] = await Promise.all([
        request(`/budgets?entity=${entity}&archived=1`),
        request(`/budgets/access?entity=${entity}`),
      ]);
      setRows(list);
      setCanWrite(access.can_write);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [entity, request]);
  useEffect(() => {
    setLoading(true);
    setEditor(null);
    setConfirm(null);
    setHistory(null);
    void load();
  }, [load]);
  useEffect(() => {
    if (editor) heading.current?.focus();
  }, [editor]);
  async function mutate(path: string, payload: Row) {
    setBusy(true);
    setError("");
    setMessage("");
    const fingerprint = JSON.stringify({ path, ...payload }),
      key = keys.current.get(fingerprint) || crypto.randomUUID();
    keys.current.set(fingerprint, key);
    try {
      await request(path, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          entity_id: entity,
          request_key: key,
        }),
      });
      keys.current.delete(fingerprint);
      setEditor(null);
      setConfirm(null);
      setMessage("Budget saved. History has been retained.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = rows.filter(
    (r) =>
      (archived || !r.archived) &&
      (!from || r.period >= from) &&
      (!to || r.period <= to),
  );
  const active = filtered.filter((r) => !r.archived),
    total = (key: string) => active.reduce((n, r) => n + r[key], 0);
  if (loading)
    return <section className="panel fm-panel">Loading budgets…</section>;
  return (
    <div className="financial-model finance-workspace budgets-workspace">
      <div className="panel-heading">
        <div>
          <h2>Department budgets</h2>
          <p>
            Monthly spending plans, with recorded costs and commitments shown
            separately.
          </p>
        </div>
        <div className="action-buttons">
          <button onClick={() => void load()} disabled={busy}>
            <RefreshCw size={15} />
            Refresh
          </button>
          {canWrite && (
            <button
              className="button primary"
              onClick={() => {
                setEditor({
                  department: "Operations",
                  category: "Operations",
                  period: currentMonth(),
                  amount: "",
                  revision: 0,
                });
                setHistory(null);
              }}
            >
              <Plus size={16} />
              Add budget
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="fm-warning">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="fm-success">
          {message}
        </p>
      )}
      <section className="panel fm-panel">
        <div className="fm-grid">
          <label>
            From month
            <input
              type="month"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Through month
            <input
              type="month"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div className="action-buttons">
          <button
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            All months
          </button>
          <label className="fm-check">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Show archived budgets
          </label>
        </div>
      </section>
      <div className="metrics three">
        {[
          ["Planned budget", total("amount_minor")],
          [
            "Committed + actual",
            total("committed_minor") + total("actual_minor"),
          ],
          ["Available to spend", total("remaining_minor")],
        ].map(([label, value]) => (
          <section className="panel fm-panel" key={label}>
            <p>{label}</p>
            <h2>{money(value as number)}</h2>
            <small>Active lines in the selected months</small>
          </section>
        ))}
      </div>
      {editor && (
        <section className="panel fm-panel">
          <h2 ref={heading} tabIndex={-1}>
            {editor.id ? "Edit budget" : "Create budget"}
          </h2>
          <p>
            Budgets do not post expenses or move cash. Changing a plan preserves
            earlier amounts in history.
          </p>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(editor.id ? `/budgets/${editor.id}` : "/budgets", {
                department: editor.department,
                category: editor.category,
                period: editor.period,
                amount_minor: Math.round(Number(editor.amount) * 100),
                revision: editor.revision,
              });
            }}
          >
            <div className="fm-grid">
              <label>
                Department
                <select
                  value={editor.department}
                  onChange={(e) =>
                    setEditor({ ...editor, department: e.target.value })
                  }
                >
                  {departments.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                Accounting category
                <select
                  value={editor.category}
                  onChange={(e) =>
                    setEditor({ ...editor, category: e.target.value })
                  }
                >
                  {categories.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                Budget month
                <input
                  type="month"
                  required
                  value={editor.period}
                  onChange={(e) =>
                    setEditor({ ...editor, period: e.target.value })
                  }
                />
              </label>
              <label>
                Budget amount · {currency}
                <input
                  type="number"
                  min="0"
                  max="10000000000"
                  step="0.01"
                  required
                  value={editor.amount}
                  onChange={(e) =>
                    setEditor({ ...editor, amount: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="action-buttons">
              <button className="button primary" disabled={busy}>
                Save budget
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      {confirm && (
        <section className="panel fm-panel">
          <h3>
            {confirm.action} {confirm.row.department} · {confirm.row.period}?
          </h3>
          <p>
            {confirm.action === "delete"
              ? "Only budget lines without recorded activity can be deleted. Audit history is retained."
              : confirm.action === "archive"
                ? "Archiving excludes this line from available-budget checks and totals. Actual expenses remain unchanged."
                : "Restoring includes this budget in active spending checks again."}
          </p>
          <div className="action-buttons">
            <button
              disabled={busy}
              onClick={() =>
                void mutate(`/budgets/${confirm.row.id}/action`, {
                  action: confirm.action,
                  revision: confirm.row.revision,
                })
              }
            >
              Confirm {confirm.action}
            </button>
            <button disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
      <section className="panel fm-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Month",
                  "Department / category",
                  "Budget",
                  "Committed",
                  "Actual",
                  "Remaining",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.period}</td>
                  <td>
                    {r.department}
                    <small className="fm-id">{r.category}</small>
                  </td>
                  {[
                    "amount_minor",
                    "committed_minor",
                    "actual_minor",
                    "remaining_minor",
                  ].map((k) => (
                    <td key={k}>{money(r[k])}</td>
                  ))}
                  <td>{r.archived ? "Archived" : "Active"}</td>
                  <td>
                    <div className="action-buttons">
                      <button
                        onClick={async () => {
                          try {
                            setHistory({
                              name: `${r.department} · ${r.category} · ${r.period}`,
                              rows: await request(
                                `/budgets/${r.id}/history?entity=${entity}`,
                              ),
                            });
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        History
                      </button>
                      {canWrite && (
                        <>
                          {!r.archived && (
                            <button
                              title="Edit budget"
                              aria-label={`Edit ${r.department} ${r.category} ${r.period}`}
                              onClick={() =>
                                setEditor({
                                  ...r,
                                  amount: String(r.amount_minor / 100),
                                })
                              }
                            >
                              <Pencil size={15} />
                            </button>
                          )}
                          <button
                            title={
                              r.archived ? "Restore budget" : "Archive budget"
                            }
                            aria-label={`${r.archived ? "Restore" : "Archive"} ${r.department} ${r.period}`}
                            onClick={() =>
                              setConfirm({
                                row: r,
                                action: r.archived ? "restore" : "archive",
                              })
                            }
                          >
                            {r.archived ? (
                              <RotateCcw size={15} />
                            ) : (
                              <Archive size={15} />
                            )}
                          </button>
                          <button
                            title="Delete unused budget"
                            aria-label={`Delete ${r.department} ${r.period}`}
                            onClick={() =>
                              setConfirm({ row: r, action: "delete" })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <p>
            No budgets in this period.{" "}
            {canWrite
              ? "Create a budget line to plan spending."
              : "Budget lines will appear when finance adds them."}
          </p>
        )}
      </section>
      {history && (
        <section className="panel fm-panel">
          <div className="panel-heading">
            <h2>{history.name} · history</h2>
            <button onClick={() => setHistory(null)}>Close history</button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "Revision",
                    "Action",
                    "Month",
                    "Budget",
                    "Recorded by",
                    "Recorded at",
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.rows.map((h: Row) => (
                  <tr key={h.revision}>
                    <td>{h.revision}</td>
                    <td>{h.action}</td>
                    <td>{h.data.period}</td>
                    <td>{money(h.data.amount_minor)}</td>
                    <td>{h.actor_id}</td>
                    <td>{h.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!history.rows.length && (
            <p>
              This is an existing budget. Its first change will preserve the
              original values here.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
