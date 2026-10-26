"use client";
import { useState } from "react";
type Row = Record<string, any>;
const money = (v: any) =>
  v == null
    ? "Not available"
    : new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2,
      }).format(v / 100);
const pct = (v: any) =>
  v == null ? "Not measurable" : `${(v * 100).toFixed(1)}%`;
const label = (v: string) => v.replaceAll("_", " ");
function Table({ headers, rows }: { headers: string[]; rows: any[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell ?? "—"}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>
                No records for this period. Add inputs or import operational
                data.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel fm-panel">
      <h2>{title}</h2>
      {note && <p>{note}</p>}
      {children}
    </section>
  );
}
export function FinancialManagement({
  data,
  section,
  resourceTable,
  onSubmit,
  busy,
}: {
  data: Row;
  section: string;
  resourceTable: (kind: string) => React.ReactNode;
  onSubmit: (row: Row) => void;
  busy: boolean;
}) {
  const [comparison, setComparison] = useState("budget");
  const m = data.management;
  const openingConfirmed =
    data.resources?.find((r: Row) => r.kind === "config" && !r.archived)?.data
      .opening_confirmed === true;
  if (!m) return null;
  if (section === "Performance")
    return (
      <>
        <Panel
          title="Actuals and remaining forecast"
          note={`NGN · Actuals through ${data.result.cutoff}. Actual and forecast figures are separate; missing source coverage makes actuals incomplete.`}
        >
          <Table
            headers={["Metric", "Actual", "Remaining forecast", "Period total"]}
            rows={Object.keys(m.actual).map((k) => [
              label(k),
              m.actual_days ? money(m.actual[k]) : "No actual days",
              m.forecast_days ? money(m.forecast[k]) : "No forecast days",
              money(m.actual[k] + m.forecast[k]),
            ])}
          />
        </Panel>
        <Panel title="Budget and forecast variance">
          <label>
            Compare with{" "}
            <select
              value={comparison}
              onChange={(e) => setComparison(e.target.value)}
            >
              <option value="budget">Original frozen budget</option>
              <option value="forecast">Latest saved forecast</option>
            </select>
          </label>
          {(() => {
            const c =
              comparison === "budget"
                ? data.budget_comparison
                : data.revision_comparison;
            return !c ? (
              <p>
                Save a {comparison} snapshot in Exports to enable this
                comparison.
              </p>
            ) : (
              <>
                <p>
                  {c.name} {c.note}
                </p>
                <Table
                  headers={[
                    "Metric",
                    "Saved period total",
                    "Current period total",
                    "Change",
                    "Change %",
                    "Direction",
                  ]}
                  rows={c.rows.map((x: Row) => [
                    label(x.metric),
                    money(x.previous),
                    money(x.current),
                    money(x.delta),
                    pct(x.percent),
                    ["financing_cash", "investing_cash"].includes(x.metric)
                      ? "Context dependent"
                      : x.favourable
                        ? "Favourable / unchanged"
                        : "Unfavourable",
                  ])}
                />
                <h3>Actual versus saved plan through cutoff</h3>
                <Table
                  headers={[
                    "Metric",
                    "Plan to date",
                    "Actual to date",
                    "Change",
                    "Change %",
                  ]}
                  rows={c.actual_rows.map((x: Row) => [
                    label(x.metric),
                    money(x.plan),
                    money(x.actual),
                    money(x.delta),
                    pct(x.percent),
                  ])}
                />
                <h3>EBITDA revision bridge</h3>
                <Table
                  headers={["Financial driver", "Impact on EBITDA"]}
                  rows={c.bridge.map((x: Row) => [
                    label(x.metric),
                    money(x.impact),
                  ])}
                />
              </>
            );
          })()}
        </Panel>
        <Panel
          title="Departmental budget mapping"
          note="Budgets are monthly expense limits. Mappings compare costs without adding expenses. Partial-month and mixed-cutoff comparisons are withheld until full-month evidence can be aligned."
        >
          <Table
            headers={[
              "Budget",
              "Month",
              "Limit",
              "Actual",
              "Mapped forecast",
              "Projected",
              "Available",
              "Mapping status",
            ]}
            rows={m.budgets.map((x: Row) => [
              x.name,
              x.period,
              money(x.budget),
              money(x.actual),
              money(x.forecast),
              money(x.projected),
              money(x.remaining),
              x.note,
            ])}
          />
          <p>
            Unmapped forecast costs:{" "}
            {m.unmapped_costs.map((x: Row) => x.name).join(", ") || "None"}
          </p>
        </Panel>
        {resourceTable("budget_link")}
      </>
    );
  if (section === "Revenue & economics")
    return (
      <>
        <Panel
          title="Revenue and service contribution"
          note="Gross bookings are customer transaction value, not platform revenue. Actual jobs cover the selected period; forecast jobs are modelled capacity. Collections exclude settlement funds."
        >
          <Table
            headers={[
              "Service",
              "Subscription revenue",
              "Transaction revenue",
              "Actual revenue",
              "Direct costs",
              "Gross contribution",
              "Margin",
            ]}
            rows={m.services.map((x: Row) => [
              x.name,
              money(x.subscription_revenue),
              money(x.transaction_revenue),
              money(x.actual_revenue),
              money(x.direct_cost),
              money(x.contribution),
              pct(x.margin),
            ])}
          />
          <Table
            headers={[
              "Service",
              "Actual jobs",
              "Forecast jobs",
              "Actual gross bookings",
              "Forecast gross bookings",
              "Actual collections",
              "Actual contribution / job",
            ]}
            rows={m.services.map((x: Row) => [
              x.name,
              x.actual_jobs,
              x.forecast_jobs.toFixed(1),
              money(x.actual_bookings),
              money(x.forecast_bookings),
              money(x.collections),
              money(x.actual_contribution_per_job),
            ])}
          />
        </Panel>
        <Panel
          title="Subscription activity"
          note="Observed purchases during the selected period; active coverage at cutoff. Renewal is same-plan renewal on expiry, not customer churn. Plan changes count switches at expiry. Renewal rates require complete coverage through cutoff."
        >
          <Table
            headers={[
              "Plan",
              "Purchases",
              "First purchases",
              "Plan switches",
              "Paying drivers",
              "Active coverage",
              "Eligible renewals",
              "Renewed",
              "Renewal %",
            ]}
            rows={m.subscriptions.map((x: Row) => [
              x.name,
              x.purchases,
              x.first_purchases,
              x.plan_changes,
              x.paying_drivers,
              x.active_coverage,
              x.renewal_eligible,
              x.renewed,
              pct(x.renewal_rate),
            ])}
          />
        </Panel>
      </>
    );
  if (section === "Cash & funding")
    return (
      <>
        <Panel
          title="Cash runway and reserve"
          note="Opening cash is included in the funding-gap test. Restricted settlement money is excluded. Planned and committed funding remain assumptions until received."
        >
          <Table
            headers={["Measure", "Value"]}
            rows={[
              [
                "Opening unrestricted cash",
                openingConfirmed
                  ? money(m.cash.opening)
                  : "Opening balance unconfirmed",
              ],
              [
                "Closing unrestricted cash",
                openingConfirmed
                  ? money(m.cash.closing)
                  : "Projection requires confirmed opening cash",
              ],
              [
                "Restricted cash",
                openingConfirmed ? money(m.cash.restricted) : "Unconfirmed",
              ],
              ["Minimum reserve", money(m.cash.reserve)],
              [
                "Lowest unrestricted cash",
                openingConfirmed ? money(m.cash.minimum) : "Unconfirmed",
              ],
              [
                "Additional funding required",
                data.result.complete
                  ? money(m.cash.gap)
                  : "Not yet established",
              ],
              [
                "Runway",
                data.result.complete
                  ? m.cash.runway
                  : "Not decision-ready · missing model evidence",
              ],
              [
                "Observed daily unrestricted operating burn",
                money(m.cash.average_daily_operating_burn),
              ],
              [
                "Cumulative EBITDA break-even",
                m.cash.break_even || "Not reached within horizon",
              ],
            ]}
          />
          <p>
            Break-even means cumulative period EBITDA becomes non-negative and
            stays so through the horizon; it is not investor payback.
          </p>
        </Panel>
        <Panel
          title="Funding status"
          note="Confirmed means receipt evidence was entered; ledger reconciliation remains authoritative. Totals include funding dated within the selected period."
        >
          <Table
            headers={["Status", "Amount"]}
            rows={Object.entries(m.funding_totals).map(([k, v]) => [
              k === "confirmed" ? "Received / confirmed" : label(k),
              money(v),
            ])}
          />
          <Table
            headers={[
              "Funding",
              "Date",
              "Status",
              "Amount",
              "Allocated",
              "Unallocated",
              "In period",
            ]}
            rows={m.funding.map((x: Row) => [
              x.name,
              x.date,
              x.status,
              money(x.amount_minor),
              money(x.allocated),
              money(x.amount_minor - x.allocated),
              x.in_period ? "Yes" : "No",
            ])}
          />
        </Panel>
        <Panel
          title="Use of funds and milestones"
          note="Allocation is a plan, not an expense or a payment. Scheduled cash belongs to the linked cost and must not be summed across repeated allocations."
        >
          <Table
            headers={[
              "Funding",
              "Cost",
              "Allocation",
              "Linked forecast cash",
              "Milestone",
              "Owner",
              "Due",
            ]}
            rows={m.uses.map((x: Row) => [
              x.funding,
              x.cost,
              money(x.amount_minor),
              money(x.scheduled_cash),
              x.milestone,
              x.owner,
              x.due_date,
            ])}
          />
        </Panel>
        {resourceTable("funding_use")}
      </>
    );
  if (section === "Schedules")
    return (
      <>
        <Panel
          title="Hiring and payroll"
          note="Use a payroll cost row per role: quantity is planned headcount, amount is cost per person per cycle. Include evidenced employer costs in the unit cost or separate payroll lines. Costs are forecast inputs; historical payroll comes from the ledger."
        >
          <Table
            headers={[
              "Role",
              "Department",
              "Headcount",
              "Cost / person / cycle",
              "Start",
              "End",
              "First payment",
              "Cadence",
              "Recognised expense",
              "Scheduled cash",
            ]}
            rows={m.hiring.map((x: Row) => [
              x.name,
              x.department,
              x.scheduled_units,
              money(x.amount_minor),
              x.start_date,
              x.end_date,
              x.pay_date,
              x.cadence,
              money(x.recognised),
              money(x.cash_paid),
            ])}
          />
        </Panel>
        <Panel
          title="Operating costs and commitments"
          note="This view uses the existing cost schedules. Payment dates and expense recognition can differ; vendor subscriptions and posted obligations remain included in the engine and source drilldowns."
        >
          <Table
            headers={[
              "Cost",
              "Category",
              "Department",
              "Start",
              "End",
              "Payment",
              "Cadence",
              "Recognised",
              "Scheduled cash",
              "Net payable movement",
            ]}
            rows={m.costs.map((x: Row) => [
              x.name,
              x.category,
              x.department,
              x.start_date,
              x.end_date,
              x.pay_date,
              x.cadence,
              money(x.recognised),
              money(x.cash_paid),
              money(x.payable),
            ])}
          />
        </Panel>
        <Panel
          title="Working capital and settlement balances"
          note="Debit-positive convention: liabilities normally appear negative. Movements reconcile to the model; restricted cash and settlement liabilities are shown separately from operating working capital."
        >
          <Table
            headers={["Account", "Opening", "Movement", "Closing"]}
            rows={m.working_capital.map((x: Row) => [
              label(x.account),
              money(x.opening),
              money(x.movement),
              money(x.closing),
            ])}
          />
        </Panel>
        <Panel
          title="Asset rollforward"
          note="Additions and disposals follow posted/modelled asset movements. Record actual disposals through accounting; forecast additions use capex cost schedules. Do not capitalise development without a supported accounting policy."
        >
          <Table
            headers={["Measure", "Amount"]}
            rows={Object.entries(m.assets).map(([k, v]) => [
              label(k),
              money(v),
            ])}
          />
        </Panel>
        <Panel
          title="Tax assumptions and payment schedule"
          note="Policy records document applicability and evidence; they do not automatically calculate statutory tax. Enter reviewed forecast tax amounts as tax cost schedules. Unknown applicability is not a zero tax rate."
        >
          <Table
            headers={["Measure", "Amount"]}
            rows={[
              "expense",
              "opening_liability",
              "cash_paid",
              "closing_liability",
            ].map((k) => [label(k), money(m.tax[k])])}
          />
          <Table
            headers={[
              "Policy",
              "Applicability",
              "Rate",
              "Effective from",
              "Effective to",
              "Reviewed",
              "Source",
            ]}
            rows={m.tax.policies.map((x: Row) => [
              x.name,
              x.treatment,
              pct(x.rate),
              x.effective_from,
              x.effective_to,
              x.reviewed ? "Yes" : "No",
              x.source,
            ])}
          />
        </Panel>
        {resourceTable("tax_policy")}
      </>
    );
  if (section === "Review & actions")
    return (
      <>
        <Panel title="Financial checks">
          <Table
            headers={["Check", "Difference", "Result"]}
            rows={m.checks.map((x: Row) => [
              x.name,
              money(x.amount),
              Math.abs(x.amount) <= 1 ? "Reconciled" : "Investigate",
            ])}
          />
          <p>
            {data.result.warnings.length} model warnings. Resolve missing
            evidence and unmatched records in Data & reconciliation.
          </p>
        </Panel>
        <Panel
          title="CFO commentary and action tracker"
          note="Record the explanation, evidence, owner and due date for each material issue. Resolving an action does not suppress underlying model warnings."
        >
          <Table
            headers={[
              "Action",
              "Explanation",
              "Priority",
              "Owner",
              "Due",
              "Status",
              "Evidence",
            ]}
            rows={m.actions.map((x: Row) => [
              x.name,
              x.description,
              x.priority,
              x.owner,
              x.due_date,
              x.status,
              x.evidence,
            ])}
          />
        </Panel>
        {resourceTable("action_item")}
      </>
    );
  if (section === "Sensitivity")
    return (
      <Panel
        title="Operating sensitivities"
        note="One driver changes at a time; actual records stay fixed. These are recalculated tests of the selected scenario, not saved assumption changes. Missing assumptions remain missing."
      >
        <Table
          headers={[
            "Change",
            "Affected inputs",
            "Revenue",
            "EBITDA",
            "Closing cash",
            "Funding gap",
          ]}
          rows={data.operating_sensitivities.map((x: Row) => [
            x.name,
            x.affected,
            money(x.revenue),
            money(x.ebitda),
            money(x.closing_cash),
            money(x.funding_gap),
          ])}
        />
      </Panel>
    );
  if (section === "Reports")
    return (
      <>
        <Panel
          title="Prepare an investor report"
          note="Choose a frozen snapshot, add a summary and disclosures, then submit an immutable copy for CFO review. Submission does not approve or publish it to investors. Drafts remain editable for a new submission."
        >
          {resourceTable("report_draft")}
          <Table
            headers={["Draft", "Snapshot", "Revision", "Action"]}
            rows={data.resources
              .filter((x: Row) => x.kind === "report_draft" && !x.archived)
              .map((x: Row) => [
                x.data.name,
                x.data.snapshot_id,
                x.revision,
                data.can_write ? (
                  <button disabled={busy} onClick={() => onSubmit(x)}>
                    Submit for review
                  </button>
                ) : (
                  "Read only"
                ),
              ])}
          />
        </Panel>
        <Panel
          title="Submitted reports"
          note="Submitted versions retain their disclosures and snapshot reference. Investor access and publication are separate from this preparation queue."
        >
          <Table
            headers={[
              "Report",
              "Snapshot",
              "Submitted",
              "Submitted by",
              "Frozen summary",
              "Frozen disclosures",
            ]}
            rows={data.report_submissions.map((x: Row) => [
              x.name,
              x.snapshot_id,
              x.created_at,
              x.actor_id,
              x.data.description,
              x.data.disclosures,
            ])}
          />
        </Panel>
      </>
    );
  return null;
}
