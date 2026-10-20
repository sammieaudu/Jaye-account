import { ArrowUpRight, Building2, FileText, PieChart, X } from "lucide-react";
import FinanceStatus from "./finance-status";

type Row = Record<string, any>;
export default function RegisterDetails({
  kind,
  record,
  entityName,
  currency,
  users,
  format,
  onClose,
  onSource,
}: {
  kind: "budget" | "vendor" | "journal";
  record: Row;
  entityName: string;
  currency: string;
  users: Row[];
  format: (value: number, currency: string) => string;
  onClose: () => void;
  onSource: (id: string) => void;
}) {
  const journalNumber = `JE-${record.year}-${String(record.number).padStart(5, "0")}`;
  const title =
    kind === "budget"
      ? record.department
      : kind === "vendor"
        ? record.name
        : journalNumber;
  const Icon =
    kind === "budget" ? PieChart : kind === "vendor" ? Building2 : FileText;
  const person = (id: string) =>
    users.find((u) => u.id === id)?.name || id || "—";
  const fields =
    kind === "budget"
      ? [
          ["Entity", entityName],
          ["Period", record.period],
          ["Category", record.category],
          ["Budget", format(record.amount_minor, currency)],
          ["Committed", format(record.committed_minor, currency)],
          ["Actual", format(record.actual_minor, currency)],
          ["Remaining", format(record.remaining_minor, currency)],
        ]
      : kind === "vendor"
        ? [
            ["Entity", entityName],
            ["Vendor ID", record.id],
            ["Category", record.category],
            [
              "Related party",
              record.related_party ? "Yes · independent review required" : "No",
            ],
          ]
        : [
            ["Entity", entityName],
            ["Journal date", record.date],
            ["Posted by", person(record.posted_by)],
            ["Approved by", person(record.approved_by)],
            ...(record.reversal_of
              ? [["Reversal of", record.reversal_of]]
              : []),
          ];
  const debit = (record.lines || []).reduce(
    (n: number, l: Row) => n + l.debit,
    0,
  );
  const credit = (record.lines || []).reduce(
    (n: number, l: Row) => n + l.credit,
    0,
  );
  return (
    <div className="record-page">
      <section
        className="drawer register-drawer finance-workspace record-page-content"
        tabIndex={-1}
        aria-label={`${kind === "budget" ? "Budget" : kind === "vendor" ? "Vendor" : "Journal"} details`}
      >
        <div className="drawer-top">
          <span className="kicker">{kind} details</span>
          <button className="button secondary" onClick={onClose}>
            ← Back to{" "}
            {kind === "budget"
              ? "budgets"
              : kind === "vendor"
                ? "vendors"
                : "general ledger"}
          </button>
        </div>
        <div className="drawer-hero">
          <span className="vendor-icon large">
            <Icon size={24} />
          </span>
          <h2>{title}</h2>
          <p>{kind === "journal" ? record.description : record.category}</p>
          {kind === "budget" ? (
            <>
              <strong>{format(record.remaining_minor, currency)}</strong>
              <p>Remaining budget</p>
            </>
          ) : (
            <FinanceStatus status={record.status || "posted"} />
          )}
        </div>
        <div className="detail-grid">
          {fields.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value || "—"}</strong>
            </div>
          ))}
        </div>
        {kind === "journal" ? (
          <>
            <div className="register-section">
              <h3>Journal lines</h3>
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
                    {record.lines.map((l: Row) => (
                      <tr key={l.id}>
                        <td>
                          <span className="account-code">{l.account}</span>
                          {l.account_name}
                        </td>
                        <td className="number">
                          {l.debit ? format(l.debit, currency) : "—"}
                        </td>
                        <td className="number">
                          {l.credit ? format(l.credit, currency) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="number">{format(debit, currency)}</td>
                      <td className="number">{format(credit, currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p
                className={`register-note ${debit !== credit ? "invalid" : ""}`}
              >
                {debit === credit
                  ? "Debits and credits balance."
                  : "Debits and credits do not balance. Review required."}
              </p>
            </div>
            {record.source_id && (
              <div className="register-actions">
                <button
                  className="button secondary"
                  onClick={() => onSource(record.source_id)}
                >
                  View source record
                  <ArrowUpRight size={16} />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="register-section">
            <h3>
              {kind === "budget" ? "How this budget is used" : "Vendor review"}
            </h3>
            <p className="register-note">
              {kind === "budget"
                ? "Remaining budget is the approved amount less commitments and actual spend. Commitments exclude posted expenses, so the same spend is counted once."
                : "Due diligence is required before live use. Bank details are not stored in this local build."}
            </p>
            {kind === "budget" && (
              <p className="register-note">
                These are sample policy amounts. Founder approval is required
                before live use.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
