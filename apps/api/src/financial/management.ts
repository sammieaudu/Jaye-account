import { calculate, Input, Flow } from "./engine";
import { Account } from "./types";
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const movement = (flows: Flow[], account: string) =>
  sum(
    flows.map(
      (f) =>
        (f.debit === account ? f.amount : 0) -
        (f.credit === account ? f.amount : 0),
    ),
  );
const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
const measures = [
  "revenue",
  "gross_profit",
  "marketing",
  "payroll",
  "overhead",
  "ebitda",
  "net_income",
  "operating_cash",
  "investing_cash",
  "financing_cash",
];
const total = (rows: any[]) =>
  Object.fromEntries(measures.map((k) => [k, sum(rows.map((r) => r[k] || 0))]));
export function compareSnapshots(previous: any, current: any) {
  if (previous.start !== current.start || previous.end !== current.end)
    return {
      comparable: false,
      note: "Periods differ. Align the dates before comparing.",
      rows: [],
      bridge: [],
      actual_rows: [],
    };
  const rows = measures.map((metric) => {
    const before = previous.summary[metric],
      after = current.summary[metric],
      delta = after - before;
    return {
      metric,
      previous: before,
      current: after,
      delta,
      percent: before === 0 ? null : delta / Math.abs(before),
      favourable: ["marketing", "payroll", "overhead"].includes(metric)
        ? delta <= 0
        : delta >= 0,
    };
  });
  const actual = current.daily.filter((d: any) => d.status === "actual");
  const oldToDate = previous.daily.filter((d: any) => d.date <= current.cutoff);
  const a = total(actual),
    b = total(oldToDate);
  const actual_rows = actual.length
    ? measures.map((metric) => ({
        metric,
        plan: b[metric],
        actual: a[metric],
        delta: a[metric] - b[metric],
        percent:
          b[metric] === 0
            ? null
            : (a[metric] - b[metric]) / Math.abs(b[metric]),
      }))
    : [];
  // Exact additive EBITDA bridge; no invented operational cause attribution.
  const bridge = [
    "revenue",
    "direct_cost",
    "marketing",
    "payroll",
    "overhead",
  ].map((metric) => ({
    metric,
    impact:
      (current.summary[metric] - previous.summary[metric]) *
      (metric === "revenue" ? 1 : -1),
  }));
  return {
    comparable: true,
    note: "Period totals compare actual + forecast. To-date rows compare recorded actuals against the saved plan through the current cutoff. The bridge explains financial lines, not unverified causes.",
    rows,
    bridge,
    actual_rows,
  };
}
export function management(input: Input, r: ReturnType<typeof calculate>) {
  const active = input.resources.filter((x) => !x.archived),
    config = active.find((x) => x.kind === "config")!.data;
  const currentCosts = active.filter(
    (x) =>
      x.kind === "cost" &&
      (!x.data.scenario_id || x.data.scenario_id === r.scenario_id),
  );
  const actual = r.daily.filter((d) => d.status === "actual"),
    forecast = r.daily.filter((d) => d.status === "forecast");
  const periodEvents = input.events.filter(
    (e) =>
      e.status !== "void" &&
      e.date >= r.start &&
      e.date <= r.cutoff &&
      e.date <= r.end,
  );
  const observedEvents = input.events.filter(
    (e) => e.status !== "void" && e.date <= r.cutoff,
  );
  const sources = new Map(input.resources.map((x) => [x.id, x]));
  const costSchedules = currentCosts.map((c) => {
    const flows = r.flows.filter((f) => f.source === c.id);
    return {
      id: c.id,
      ...c.data,
      recognised: sum(
        [
          "direct_cost",
          "marketing",
          "payroll",
          "overhead",
          "depreciation",
          "tax",
          "interest",
        ].map((a) => movement(flows, a)),
      ),
      cash_paid: -movement(flows, "cash"),
      payable: -movement(flows, "payables") - movement(flows, "tax_payable"),
      scheduled_units: c.data.quantity ?? 1,
    };
  });
  const links = active.filter((x) => x.kind === "budget_link");
  const budgetRows = (input.budgets || [])
    .filter(
      (b) =>
        !b.archived &&
        b.period >= r.start.slice(0, 7) &&
        b.period <= r.end.slice(0, 7),
    )
    .map((b) => {
      const mapped = links
        .filter((l) => l.data.budget_id === b.id)
        .map((l) => l.data.cost_id);
      const valid = mapped.filter((id) =>
        currentCosts.some((c) => c.id === id),
      );
      const duplicate = valid.some((id) =>
        links.some(
          (l) =>
            l.data.cost_id === id &&
            l.data.budget_id !== b.id &&
            (input.budgets || []).some(
              (other) =>
                other.id === l.data.budget_id &&
                !other.archived &&
                other.period === b.period,
            ),
        ),
      );
      const flows = r.flows.filter(
        (f) =>
          valid.includes(f.source) &&
          f.date.slice(0, 7) === b.period &&
          f.status === "forecast",
      );
      const forecastExpense = sum(
        [
          "direct_cost",
          "marketing",
          "payroll",
          "overhead",
          "depreciation",
          "tax",
          "interest",
        ].map((a) => movement(flows, a)),
      );
      // Departmental actuals are full calendar-month ledger totals; no false partial-period comparison.
      const monthStart = b.period + "-01",
        monthEnd = new Date(
          Date.UTC(
            Number(b.period.slice(0, 4)),
            Number(b.period.slice(5, 7)),
            0,
          ),
        )
          .toISOString()
          .slice(0, 10);
      const eligible =
        r.start <= monthStart &&
        r.end >= monthEnd &&
        (r.cutoff >= monthEnd || r.cutoff < monthStart);
      const actualValue = r.cutoff >= monthEnd ? b.actual_minor : null;
      const projected =
        eligible && !duplicate && valid.length
          ? r.cutoff >= monthEnd
            ? b.actual_minor
            : forecastExpense
          : null;
      return {
        id: b.id,
        name: `${b.department} · ${b.category}`,
        period: b.period,
        budget: b.amount_minor,
        actual: actualValue,
        forecast: forecastExpense,
        projected,
        remaining: projected === null ? null : b.amount_minor - projected,
        mapped: valid.length,
        note: duplicate
          ? "Ambiguous mapping: one cost is linked to multiple budgets in this month"
          : !eligible
            ? "Partial month / cutoff: comparison withheld"
            : !valid.length
              ? "Map a forecast cost to enable comparison"
              : "Monthly expense basis; budgets do not create expenses",
      };
    });
  const serviceRows = r.services.map((s) => {
    const flows = r.flows.filter((f) => f.service === s.id),
      observed = flows.filter((f) => f.status === "actual");
    const jobs = periodEvents.filter(
      (e) =>
        e.type === "booking" &&
        e.status === "completed" &&
        e.service_id === s.id,
    );
    const forecastOperations = r.operating.filter((o) => o.service === s.id);
    const actualRevenue =
      -movement(observed, "subscription_revenue") -
      movement(observed, "commission_revenue");
    const actualDirect = movement(observed, "direct_cost");
    return {
      id: s.id,
      name: s.name,
      subscription_revenue: -movement(flows, "subscription_revenue"),
      transaction_revenue: -movement(flows, "commission_revenue"),
      actual_revenue: actualRevenue,
      actual_jobs: jobs.length,
      forecast_jobs: sum(forecastOperations.map((o) => o.jobs)),
      actual_bookings: sum(jobs.map((e) => e.amount_minor)),
      forecast_bookings: sum(forecastOperations.map((o) => o.gross_bookings)),
      direct_cost: s.direct_cost,
      contribution: s.gross_profit,
      margin: ratio(s.gross_profit, s.revenue),
      actual_contribution_per_job: ratio(
        actualRevenue - actualDirect,
        jobs.length,
      ),
      collections: movement(
        observed.filter((f) =>
          ["receivables", "deferred_revenue"].includes(f.credit),
        ),
        "cash",
      ),
      allocation: s.allocated_overhead,
    };
  });
  const subscriptions = active
    .filter(
      (x) =>
        x.kind === "price" &&
        ["daily", "weekly", "monthly"].includes(x.data.mode),
    )
    .map((p) => {
      const purchases = periodEvents.filter(
        (e) => e.type === "subscription" && e.price_id === p.id,
      );
      const covered = observedEvents.filter(
        (e) =>
          e.type === "subscription" &&
          e.price_id === p.id &&
          e.coverage_end! > r.cutoff,
      );
      const eligible = observedEvents.filter(
        (e) =>
          e.type === "subscription" &&
          e.price_id === p.id &&
          e.coverage_end! <= r.cutoff &&
          e.coverage_end! >= r.start,
      );
      const renewed = eligible.filter((e) =>
        observedEvents.some(
          (next) =>
            next.type === "subscription" &&
            next.price_id === p.id &&
            next.driver_id === e.driver_id &&
            next.date === e.coverage_end,
        ),
      );
      const switching = purchases.filter((e) =>
        observedEvents.some(
          (prior) =>
            prior.type === "subscription" &&
            prior.driver_id === e.driver_id &&
            prior.price_id !== e.price_id &&
            prior.coverage_end === e.date,
        ),
      );
      const first = purchases.filter(
        (e) =>
          !observedEvents.some(
            (prior) =>
              prior.type === "subscription" &&
              prior.driver_id === e.driver_id &&
              prior.date < e.date,
          ),
      );
      return {
        name: p.data.name,
        plan: p.data.mode,
        purchases: purchases.length,
        first_purchases: first.length,
        plan_changes: switching.length,
        paying_drivers: new Set(purchases.map((e) => e.driver_id)).size,
        active_coverage: new Set(covered.map((e) => e.driver_id)).size,
        renewal_eligible: eligible.length,
        renewed: renewed.length,
        renewal_rate:
          config.operating_data_complete_through >= r.cutoff
            ? ratio(renewed.length, eligible.length)
            : null,
      };
    });
  const accounts = [
    "receivables",
    "payables",
    "deferred_revenue",
    "prepayments",
    "deposits",
    "restricted_cash",
    "settlements",
    "tax_payable",
  ];
  const workingCapital = accounts.map((account) => ({
    account,
    opening: r.opening[account as Account],
    closing: r.closing[account as Account],
    movement: r.closing[account as Account] - r.opening[account as Account],
  }));
  const assetAdditions = sum(
    r.flows.filter((f) => f.debit === "fixed_assets").map((f) => f.amount),
  );
  const assetDisposals = sum(
    r.flows.filter((f) => f.credit === "fixed_assets").map((f) => f.amount),
  );
  const unrestrictedOperating = movement(
    r.flows.filter(
      (f) =>
        f.status === "actual" &&
        ![f.debit, f.credit].some((a) =>
          ["equity", "debt", "fixed_assets"].includes(a),
        ) &&
        !(
          f.description.endsWith("payment") &&
          sources.get(f.source)?.data.category === "capex"
        ),
    ),
    "cash",
  );
  const cashPath = [{ date: r.start, cash: r.opening.cash }, ...r.daily];
  const minimum = Math.min(...cashPath.map((d) => d.cash));
  const first = cashPath.find((d) => d.cash < config.minimum_cash_minor);
  const cumulative = r.daily.reduce(
    (xs: any[], d: any) => [
      ...xs,
      { date: d.date, ebitda: (xs.at(-1)?.ebitda || 0) + d.ebitda },
    ],
    [],
  );
  const breakEven =
    cumulative.find(
      (d, i) =>
        d.ebitda >= 0 &&
        (r.summary as any).revenue > 0 &&
        cumulative.slice(i).every((x) => x.ebitda >= 0) &&
        sum(r.daily.slice(0, i + 1).map((x) => x.revenue)) > 0,
    )?.date || null;
  const funding = active
    .filter((x) => x.kind === "funding")
    .map((f) => ({
      id: f.id,
      ...f.data,
      in_period: f.data.date >= r.start && f.data.date <= r.end,
      allocated: sum(
        active
          .filter((x) => x.kind === "funding_use" && x.data.funding_id === f.id)
          .map((x) => x.data.amount_minor),
      ),
    }));
  const uses = active
    .filter((x) => x.kind === "funding_use")
    .map((u) => ({
      id: u.id,
      ...u.data,
      cost: sources.get(u.data.cost_id)?.data.name || "Archived / missing cost",
      funding:
        sources.get(u.data.funding_id)?.data.name ||
        "Archived / missing funding",
      scheduled_cash:
        costSchedules.find((c) => c.id === u.data.cost_id)?.cash_paid ?? null,
    }));
  return {
    actual: total(actual),
    forecast: total(forecast),
    actual_days: actual.length,
    forecast_days: forecast.length,
    cash: {
      opening: r.opening.cash,
      closing: r.closing.cash,
      restricted: r.closing.restricted_cash,
      reserve: config.minimum_cash_minor,
      minimum,
      shortfall: first?.date || null,
      gap: Math.max(0, config.minimum_cash_minor - minimum),
      runway:
        !config.opening_confirmed || !currentCosts.length
          ? "Not measurable · opening cash or cost schedules incomplete"
          : first
            ? `Reserve breached on ${first.date}`
            : "Beyond the modelled horizon",
      average_daily_operating_burn: actual.length
        ? Math.max(0, -unrestrictedOperating / actual.length)
        : null,
      break_even: breakEven,
    },
    costs: costSchedules,
    hiring: costSchedules.filter((c) => c.category === "payroll"),
    budgets: budgetRows,
    unmapped_costs: currentCosts
      .filter((c) => !links.some((l) => l.data.cost_id === c.id))
      .map((c) => ({ id: c.id, name: c.data.name })),
    services: serviceRows,
    subscriptions,
    working_capital: workingCapital,
    assets: {
      opening: r.opening.fixed_assets,
      additions: assetAdditions,
      disposals: assetDisposals,
      closing: r.closing.fixed_assets,
      accumulated_depreciation: -r.closing.accumulated_depreciation,
      net_book_value:
        r.closing.fixed_assets + r.closing.accumulated_depreciation,
      check:
        r.opening.fixed_assets +
        assetAdditions -
        assetDisposals -
        r.closing.fixed_assets,
    },
    funding,
    uses,
    funding_totals: Object.fromEntries(
      ["planned", "committed", "confirmed"].map((status) => [
        status,
        sum(
          funding
            .filter(
              (f) =>
                f.status === status &&
                f.in_period &&
                (status !== "confirmed" || f.date <= r.cutoff),
            )
            .map((f) => f.amount_minor),
        ),
      ]),
    ),
    tax: {
      expense: (r.summary as any).tax,
      opening_liability: -r.opening.tax_payable,
      closing_liability: -r.closing.tax_payable,
      cash_paid: -movement(
        r.flows.filter((f) => f.debit === "tax_payable" || f.debit === "tax"),
        "cash",
      ),
      policies: active
        .filter((x) => x.kind === "tax_policy")
        .map((x) => ({ id: x.id, ...x.data })),
    },
    checks: [
      { name: "Balance sheet", amount: r.summary.balance_check },
      {
        name: "Daily cash reconciliation",
        amount: Math.max(...r.daily.map((d) => Math.abs(d.cash_check))),
      },
      {
        name: "Asset rollforward",
        amount:
          r.opening.fixed_assets +
          assetAdditions -
          assetDisposals -
          r.closing.fixed_assets,
      },
    ],
    actions: active
      .filter((x) => x.kind === "action_item")
      .map((x) => ({ id: x.id, ...x.data })),
  };
}
export function sensitivities(input: Input, scenario: string) {
  const cases = [
    ["Acquisition −20%", "new_drivers_daily", 0.8],
    ["Renewal −10 points", "renewal", -0.1],
    ["Utilisation −20%", "jobs_per_driver", 0.8],
    ["Operating costs +10%", "cost", 1.1],
    ["Launch +14 days", "launch_delay", 14],
    ["Pricing −10%", "price", 0.9],
    ["Variable cost +10%", "direct_cost_per_job_minor", 1.1],
  ] as const;
  return cases.map(([name, field, value]) => {
    const copy = structuredClone(input);
    for (const e of copy.events)
      if (e.price_id && !e.price_snapshot)
        e.price_snapshot = structuredClone(
          input.resources.find((r) => r.id === e.price_id)?.data,
        );
    let affected = 0;
    for (const r of copy.resources.filter((r) => !r.archived)) {
      if (
        field === "cost" &&
        r.kind === "cost" &&
        (!r.data.scenario_id || r.data.scenario_id === scenario)
      ) {
        r.data.amount_minor = Math.round(r.data.amount_minor * value);
        affected++;
      } else if (field === "price" && r.kind === "price") {
        if (r.data.amount_minor !== null) {
          r.data.amount_minor = Math.round(r.data.amount_minor * value);
          affected++;
        }
        if (r.data.rate !== null) {
          r.data.rate *= value;
          affected++;
        }
      } else if (
        r.kind === "assumption" &&
        r.data.scenario_id === scenario &&
        r.data[field] != null
      ) {
        r.data[field] =
          field === "renewal"
            ? Math.max(0, r.data[field] + value)
            : field === "launch_delay"
              ? Math.min(365, r.data[field] + value)
              : r.data[field] * value;
        if (field === "direct_cost_per_job_minor")
          r.data[field] = Math.round(r.data[field]);
        affected++;
      }
    }
    const out = calculate(copy, scenario);
    return { name, affected, ...out.summary };
  });
}
