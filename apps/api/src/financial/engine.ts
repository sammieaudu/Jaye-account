import {
  Account,
  accounts,
  Resource,
  Event,
  addDays,
  days,
  monthAfter,
  coverageEnd,
  version,
} from "./types";

export type Flow = {
  date: string;
  debit: Account;
  credit: Account;
  amount: number;
  source: string;
  service: string;
  status: "actual" | "forecast";
  description: string;
  units: number;
  unit_price: number;
  factor: number;
  assumption?: string;
  driver?: string;
  cohort_date?: string;
  renewal_number?: number;
  launch?: string;
  slice?: number;
  span?: number;
};
export type LedgerLine = {
  date: string;
  account: string;
  type: string;
  amount: number;
  source: string;
  description: string;
};
export type Input = {
  resources: Resource[];
  events: Event[];
  ledger: LedgerLine[];
  pending: any[];
  invoiceReceipts: any[];
  vendorCosts?: any[];
  obligations?: any[];
  budgets?: any[];
  captured_at: string;
};
const expenseAccounts: Account[] = [
  "direct_cost",
  "marketing",
  "payroll",
  "overhead",
  "depreciation",
  "tax",
  "interest",
];
const revenueAccounts: Account[] = [
  "subscription_revenue",
  "commission_revenue",
];
const assets: Account[] = [
  "cash",
  "restricted_cash",
  "receivables",
  "prepayments",
  "deposits",
  "fixed_assets",
  "accumulated_depreciation",
];
const liabilities: Account[] = [
  "payables",
  "deferred_revenue",
  "settlements",
  "tax_payable",
  "debt",
];
export const emptyBalances = () =>
  Object.fromEntries(accounts.map((a) => [a, 0])) as Record<Account, number>;
const total = (v: number[]) => v.reduce((a, b) => a + b, 0);
export function statements(b: Record<Account, number>) {
  const revenue = -total(revenueAccounts.map((a) => b[a]));
  const costs = total(expenseAccounts.map((a) => b[a]));
  const profit = revenue - costs;
  const assetTotal = total(assets.map((a) => b[a]));
  const liabilityTotal = -total(liabilities.map((a) => b[a]));
  const equity = -b.equity - b.retained_earnings + profit;
  return {
    revenue,
    direct_cost: b.direct_cost,
    gross_profit: revenue - b.direct_cost,
    marketing: b.marketing,
    payroll: b.payroll,
    overhead: b.overhead,
    ebitda: revenue - b.direct_cost - b.marketing - b.payroll - b.overhead,
    depreciation: b.depreciation,
    ebit:
      revenue -
      b.direct_cost -
      b.marketing -
      b.payroll -
      b.overhead -
      b.depreciation,
    interest: b.interest,
    tax: b.tax,
    net_income: profit,
    assets: assetTotal,
    liabilities: liabilityTotal,
    equity,
    balance_check: assetTotal - liabilityTotal - equity,
  };
}
export function calculate(
  input: Input,
  scenarioId = "base",
  fundingOverride?: number,
) {
  const active = input.resources.filter((r) => !r.archived);
  const config = active.find((r) => r.kind === "config")!.data;
  const evidence = completenessFrom(active, config);
  const start = config.start_date,
    end = config.end_date ?? addDays(start, 89),
    cutoff = config.cutoff < end ? config.cutoff : end;
  const length = days(start, end) + 1;
  if (length < 1 || length > 366)
    throw new Error("Choose a date range of 1–366 days, inclusive");
  const resources = new Map(input.resources.map((r) => [r.id, r]));
  const flows: Flow[] = [];
  const warnings: string[] = [];
  const operating: any[] = [];
  const emit = (
    date: string,
    debit: Account,
    credit: Account,
    amount: number,
    source: string,
    description: string,
    status: "actual" | "forecast",
    service = "",
    units = 1,
    unit_price = amount,
    factor = 1,
    assumption?: string,
    driver?: string,
  ) => {
    if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount)))
      throw new Error("Model amount exceeds safe precision");
    if (Math.round(amount) !== 0 || status === "forecast")
      flows.push({
        date,
        debit,
        credit,
        amount: Math.round(amount),
        source,
        service,
        status,
        description,
        units,
        unit_price,
        factor,
        assumption,
        driver,
      });
  };
  if (!config.opening_confirmed)
    warnings.push(
      "Opening balances are unconfirmed; cash and statements are provisional.",
    );
  if (!config.tax_reviewed)
    warnings.push(
      "Tax applicability is unresolved. Net income and cash exclude unprovided tax amounts; not a zero-tax conclusion.",
    );
  if (
    cutoff >= start &&
    (!evidence.complete_through || evidence.complete_through < cutoff)
  )
    warnings.push(
      "Operational actuals are incomplete through the cutoff. Missing activity is not zero performance.",
    );
  if (!active.some((r) => r.kind === "cost"))
    warnings.push(
      "No cost/hiring plans supplied; profitability and runway are incomplete.",
    );
  const opening = emptyBalances();
  for (const a of accounts) opening[a] = config.opening[a] || 0;
  if (total(Object.values(opening)) !== 0)
    warnings.push(
      "Opening adjustment does not balance. Resolve source balances; no balancing plug is applied.",
    );
  const mapAccount = (l: LedgerLine): Account => {
    const custom = active.find(
      (r) => r.kind === "mapping" && r.data.source_account === l.account,
    )?.data.model_account;
    if (custom) return custom;
    if (["1100", "1010"].includes(l.account)) return "cash";
    if (l.account === "1200") return "receivables";
    if (l.account === "2100") return "payables";
    if (l.account === "3100") return "equity";
    if (l.account === "6200") return "marketing";
    if (l.type === "expense")
      return l.account === "6700" ? "payroll" : "overhead";
    warnings.push(
      `Map ledger account ${l.account}; temporarily classified as ${l.type}.`,
    );
    return l.type === "asset"
      ? "receivables"
      : l.type === "liability"
        ? "payables"
        : l.type === "equity"
          ? "equity"
          : "commission_revenue";
  };
  // Posted ledger is authoritative; subregister costs are never added a second time.
  const journalGroups = new Map<string, LedgerLine[]>();
  for (const l of input.ledger.filter((l) => l.date <= cutoff)) {
    if (l.date < start) opening[mapAccount(l)] += l.amount;
    else {
      const group = journalGroups.get(l.source) || [];
      group.push(l);
      journalGroups.set(l.source, group);
    }
  }
  for (const [id, lines] of journalGroups) {
    const dr = lines
      .filter((l) => l.amount > 0)
      .map((l) => ({ ...l, left: l.amount }));
    const cr = lines
      .filter((l) => l.amount < 0)
      .map((l) => ({ ...l, left: -l.amount }));
    for (const d of dr)
      for (const c of cr) {
        const n = Math.min(d.left, c.left);
        if (n) {
          emit(
            d.date,
            mapAccount(d),
            mapAccount(c),
            n,
            id,
            d.description,
            "actual",
          );
          d.left -= n;
          c.left -= n;
        }
      }
    if (dr.some((l) => l.left) || cr.some((l) => l.left))
      warnings.push(`Unbalanced source journal ${id}`);
  }
  const events = input.events.filter(
    (e) => e.status !== "void" && e.date <= cutoff,
  );
  const eventByKey = new Map(
    events.map((e) => [`${e.source_id}:${e.external_id}`, e]),
  );
  const refunded = new Map<string, number>();
  for (const e of events.filter((e) => e.type === "refund"))
    refunded.set(
      `${e.source_id}:${e.related_id}`,
      (refunded.get(`${e.source_id}:${e.related_id}`) || 0) + e.amount_minor,
    );
  const priceOf = (e: Event) =>
    e.price_snapshot || resources.get(e.price_id)?.data;
  for (const e of events) {
    const key = `${e.source_id}:${e.external_id}`,
      service = e.service_id,
      p = priceOf(e);
    if (e.type === "subscription") {
      const span = days(e.date, e.coverage_end!);
      emit(
        e.date,
        "receivables",
        "deferred_revenue",
        e.amount_minor,
        key,
        "Subscription invoice",
        "actual",
        service,
      );
      for (let n = 0; n < span; n++) {
        const d = addDays(e.date, n);
        if (d > cutoff) continue;
        const v =
          Math.round((e.amount_minor * (n + 1)) / span) -
          Math.round((e.amount_minor * n) / span);
        emit(
          d,
          "deferred_revenue",
          "subscription_revenue",
          v,
          key,
          "Covered subscription day",
          "actual",
          service,
        );
      }
    }
    if (
      e.type === "booking" &&
      (e.status === "completed" ||
        events.some(
          (x) =>
            x.source_id === e.source_id &&
            x.related_id === e.external_id &&
            x.type === "collection",
        ))
    ) {
      const fee =
        p?.mode === "percent"
          ? Math.round(e.amount_minor * (p.rate ?? 0))
          : p?.mode === "fixed"
            ? (p.amount_minor ?? 0)
            : 0;
      if (
        (p?.mode === "fixed" && p.amount_minor === null) ||
        (p?.mode === "percent" && p.rate === null)
      )
        warnings.push(`Missing fee for ${key}`);
      emit(
        e.date,
        "receivables",
        "commission_revenue",
        fee,
        key,
        "Platform booking fee (agent basis)",
        "actual",
        service,
      );
    }
    if (e.type === "collection") {
      const related = eventByKey.get(`${e.source_id}:${e.related_id}`);
      const rp = related && priceOf(related);
      const fee =
        related?.type === "subscription"
          ? related.amount_minor
          : rp?.mode === "percent"
            ? Math.round((related?.amount_minor || 0) * (rp.rate ?? 0))
            : rp?.mode === "fixed"
              ? (rp.amount_minor ?? 0)
              : 0;
      const earlier = events
        .filter(
          (x) =>
            x.type === "collection" &&
            x.source_id === e.source_id &&
            x.related_id === e.related_id &&
            (x.date < e.date ||
              (x.date === e.date && x.external_id < e.external_id)),
        )
        .reduce((n, x) => n + x.amount_minor, 0);
      const platform = Math.max(0, Math.min(e.amount_minor, fee - earlier));
      emit(
        e.date,
        "cash",
        "receivables",
        platform,
        key,
        "Platform collection",
        "actual",
        service,
      );
      emit(
        e.date,
        "restricted_cash",
        "settlements",
        e.amount_minor - platform,
        key,
        "Driver funds collected",
        "actual",
        service,
      );
    }
    if (e.type === "settlement")
      emit(
        e.date,
        "settlements",
        "restricted_cash",
        e.amount_minor,
        key,
        "Driver settlement",
        "actual",
        service,
      );
    if (e.type === "refund") {
      const related = eventByKey.get(`${e.source_id}:${e.related_id}`);
      if (related?.type === "subscription") {
        const span = days(related.date, related.coverage_end!);
        const earned = Math.min(
          span,
          Math.max(0, days(related.date, e.date) + 1),
        );
        const recognized = Math.round((e.amount_minor * earned) / span);
        emit(
          e.date,
          "subscription_revenue",
          "cash",
          recognized,
          key,
          "Refund recognized portion",
          "actual",
          service,
        );
        emit(
          e.date,
          "deferred_revenue",
          "cash",
          e.amount_minor - recognized,
          key,
          "Refund unused coverage",
          "actual",
          service,
        );
        // Reverse refunded coverage recognition after refund, including future outlook.
        for (let n = earned; n < span; n++) {
          const d = addDays(related.date, n);
          if (d > cutoff) continue;
          const part =
            Math.round((e.amount_minor * (n + 1)) / span) -
            Math.round((e.amount_minor * n) / span);
          emit(
            d,
            "subscription_revenue",
            "deferred_revenue",
            part,
            key,
            "Refunded coverage release reversal",
            "actual",
            service,
          );
        }
      } else {
        const rp = related && priceOf(related);
        const fee =
          rp?.mode === "percent"
            ? Math.round(e.amount_minor * (rp.rate ?? 0))
            : Math.round(
                (e.amount_minor / (related?.amount_minor || 1)) *
                  (rp?.amount_minor || 0),
              );
        emit(
          e.date,
          "commission_revenue",
          "cash",
          fee,
          key,
          "Booking fee refund",
          "actual",
          service,
        );
        emit(
          e.date,
          "settlements",
          "restricted_cash",
          e.amount_minor - fee,
          key,
          "Customer refund from settlement funds",
          "actual",
          service,
        );
      }
    }
    // Campaign events attribute acquisition spend; the posted GL remains the
    // sole authority for actual costs and their cash settlements.
    if (e.type === "opening")
      emit(
        e.date,
        e.account!,
        e.offset_account!,
        e.amount_minor,
        key,
        "Explicit source adjustment",
        "actual",
        service,
      );
  }
  // Recognize remaining paid coverage in forecast without inventing another collection.
  for (const e of events.filter((e) => e.type === "subscription")) {
    const span = days(e.date, e.coverage_end!);
    const amount =
      e.amount_minor - (refunded.get(`${e.source_id}:${e.external_id}`) || 0);
    for (let n = 0; n < span; n++) {
      const d = addDays(e.date, n);
      if (d > cutoff)
        emit(
          d,
          "deferred_revenue",
          "subscription_revenue",
          Math.round((e.amount_minor * (n + 1)) / span) -
            Math.round((e.amount_minor * n) / span) -
            Math.round(((e.amount_minor - amount) * (n + 1)) / span) +
            Math.round(((e.amount_minor - amount) * n) / span),
          `${e.source_id}:${e.external_id}`,
          "Remaining purchased coverage",
          "forecast",
          e.service_id,
        );
    }
  }
  const assumptions = active.filter(
    (r) => r.kind === "assumption" && r.data.scenario_id === scenarioId,
  );
  for (const service of active.filter(
    (r) => r.kind === "service" && r.data.active,
  ))
    if (!assumptions.some((r) => r.data.service_id === service.id))
      warnings.push(
        `${service.data.name}: no scenario demand plan; enter explicit zero volumes or supply assumptions.`,
      );
  if (!assumptions.length)
    warnings.push(
      "Operating scenario has no volume assumptions. Revenue forecast is incomplete.",
    );
  for (const row of assumptions) {
    const a = row.data,
      service = resources.get(a.service_id)?.data,
      p = resources.get(a.price_id)?.data;
    if (
      !service?.active ||
      !p ||
      resources.get(a.service_id)?.archived ||
      resources.get(a.price_id)?.archived
    ) {
      warnings.push(
        `${row.data.name}: inactive or archived service/price; forecast excluded.`,
      );
      continue;
    }
    const required = [
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
    ];
    const missing = required.filter((k) => a[k] === null);
    if (missing.length) {
      warnings.push(`${row.data.name}: missing ${missing.join(", ")}`);
      continue;
    }
    if (p.mode === "percent" ? p.rate === null : p.amount_minor === null) {
      warnings.push(`${p.name}: price not configured`);
      continue;
    }
    const begins = [
      start,
      service.start_date,
      addDays(cutoff, 1),
      p.effective_from,
    ]
      .sort()
      .at(-1)!;
    const launch = addDays(begins, a.launch_delay);
    const carry = events.filter(
      (e) =>
        e.type === "subscription" &&
        e.price_id === a.price_id &&
        e.coverage_end! >= launch &&
        e.amount_minor > (refunded.get(`${e.source_id}:${e.external_id}`) || 0),
    );
    if (carry.length > a.initial_paying)
      warnings.push(
        `${row.data.name}: initial paying estimate is below ${carry.length} observed active subscriptions; existing coverage is preserved.`,
      );
    const cohorts: {
      date: string;
      count: number;
      renewals: number;
      next: string;
    }[] = carry.map((e) => ({
      date: e.date,
      count: 1,
      renewals: 1,
      next: e.coverage_end!,
    }));
    for (let d = launch; d <= end; d = addDays(d, 1)) {
      const newCount =
        (d === launch ? Math.max(0, a.initial_paying - carry.length) : 0) +
        a.new_drivers_daily * a.activation * a.paid_conversion;
      cohorts.push({ date: d, count: newCount, renewals: 0, next: d });
      let drivers = 0;
      for (const c of cohorts) {
        if (d === c.next) {
          if (c.renewals) c.count *= a.renewal;
          const count =
            c.count * (p.mode === "daily" ? a.daily_purchase_rate : 1);
          if (
            ["daily", "weekly", "monthly"].includes(p.mode) &&
            (!p.effective_to || d <= p.effective_to)
          ) {
            const finish = coverageEnd(d, p.mode),
              span = days(d, finish),
              bill = Math.round(count * p.amount_minor);
            const firstFlow = flows.length;
            emit(
              d,
              "receivables",
              "deferred_revenue",
              bill,
              row.id,
              "Forecast subscription billing",
              "forecast",
              a.service_id,
              count,
              p.amount_minor,
              1,
              row.id,
              "subscription",
            );
            emit(
              addDays(d, a.collection_delay),
              "cash",
              "receivables",
              bill,
              row.id,
              "Forecast subscription collection",
              "forecast",
              a.service_id,
              count,
              p.amount_minor,
              1,
              row.id,
              "subscription",
            );
            for (let n = 0; n < span; n++)
              emit(
                addDays(d, n),
                "deferred_revenue",
                "subscription_revenue",
                Math.round((bill * (n + 1)) / span) -
                  Math.round((bill * n) / span),
                row.id,
                "Forecast coverage recognition",
                "forecast",
                a.service_id,
                count,
                p.amount_minor,
                1 / span,
                row.id,
                "subscription_recognition",
              );
            flows.slice(firstFlow).forEach((f, i) =>
              Object.assign(f, {
                cohort_date: c.date,
                renewal_number: c.renewals,
                launch,
                span,
                slice: i - 2,
              }),
            );
          }
          c.next = coverageEnd(
            d,
            ["daily", "weekly", "monthly"].includes(p.mode)
              ? p.mode
              : "monthly",
          );
          c.renewals++;
        }
        drivers += c.count;
      }
      const jobs =
        drivers *
        Math.min(a.jobs_per_driver, a.available_hours / a.hours_per_job);
      const fee =
        p.mode === "percent"
          ? a.average_booking_minor * p.rate
          : p.mode === "fixed"
            ? p.amount_minor
            : 0;
      const firstJobFlow = flows.length;
      if (["percent", "fixed"].includes(p.mode)) {
        emit(
          d,
          "receivables",
          "commission_revenue",
          Math.round(jobs * fee),
          row.id,
          "Forecast job fees",
          "forecast",
          a.service_id,
          jobs,
          fee,
          1,
          row.id,
          "commission",
        );
        emit(
          addDays(d, a.collection_delay),
          "cash",
          "receivables",
          Math.round(jobs * fee),
          row.id,
          "Forecast job collection",
          "forecast",
          a.service_id,
          jobs,
          fee,
          1,
          row.id,
          "commission",
        );
      }
      emit(
        d,
        "direct_cost",
        "cash",
        Math.round(jobs * a.direct_cost_per_job_minor),
        row.id,
        "Forecast variable costs",
        "forecast",
        a.service_id,
        jobs,
        a.direct_cost_per_job_minor,
        1,
        row.id,
        "direct_cost",
      );
      flows
        .slice(firstJobFlow)
        .forEach((f) => Object.assign(f, { cohort_date: d, launch }));
      operating.push({
        date: d,
        service: a.service_id,
        assumption: row.id,
        drivers,
        jobs,
        gross_bookings: Math.round(jobs * a.average_booking_minor),
        capacity_hours: drivers * a.available_hours,
        used_hours: jobs * a.hours_per_job,
      });
    }
  }
  for (const r of active.filter(
    (r) =>
      r.kind === "cost" &&
      (!r.data.scenario_id || r.data.scenario_id === scenarioId),
  )) {
    const c = {
      ...r.data,
      amount_minor: Math.round(r.data.amount_minor * (r.data.quantity ?? 1)),
    };
    let cycle = 0;
    for (
      let d = c.start_date;
      d <= end && d <= c.end_date;
      d = monthAfter(c.start_date, ++cycle)
    ) {
      const pay =
        c.cadence === "monthly" ? monthAfter(c.pay_date, cycle) : c.pay_date;
      const debit: Account =
        c.category === "capex"
          ? "fixed_assets"
          : c.category === "prepayment"
            ? "prepayments"
            : c.category === "deposit"
              ? "deposits"
              : c.category;
      const payable: Account =
        c.category === "tax" ? "tax_payable" : "payables";
      if (d > cutoff)
        emit(
          d,
          debit,
          payable,
          c.amount_minor,
          r.id,
          c.name,
          "forecast",
          c.service_id,
        );
      if (pay > cutoff && d > cutoff)
        emit(
          pay,
          payable,
          "cash",
          c.amount_minor,
          r.id,
          `${c.name} payment`,
          "forecast",
          c.service_id,
        );
      if (d <= cutoff && pay > cutoff)
        warnings.push(
          `${c.name}: historical obligation must be recorded in the ledger before forecasting its payment; not assumed.`,
        );
      if (d > cutoff && ["capex", "prepayment"].includes(c.category)) {
        const finish =
            c.category === "capex"
              ? monthAfter(d, c.useful_life_months)
              : addDays(c.end_date, 1),
          span = days(d, finish);
        for (let n = 0; n < span && addDays(d, n) <= end; n++) {
          emit(
            addDays(d, n),
            c.category === "capex" ? "depreciation" : "overhead",
            c.category === "capex" ? "accumulated_depreciation" : "prepayments",
            Math.round((c.amount_minor * (n + 1)) / span) -
              Math.round((c.amount_minor * n) / span),
            r.id,
            `${c.name} recognition`,
            "forecast",
            c.service_id,
          );
          Object.assign(flows.at(-1)!, { span, slice: n });
        }
      }
      if (c.cadence === "once") break;
    }
  }
  for (const obligation of input.obligations || []) {
    if (obligation.amount_minor > 0) {
      const paymentDate =
        obligation.date > cutoff ? obligation.date : addDays(cutoff, 1);
      emit(
        paymentDate,
        "payables",
        "cash",
        obligation.amount_minor,
        obligation.id,
        "Existing payable · assumed due-date settlement",
        "forecast",
      );
      if (obligation.date <= cutoff)
        warnings.push(
          `Overdue payable ${obligation.id}: payment provisionally scheduled next day; confirm timing.`,
        );
    }
  }
  for (const v of input.vendorCosts || []) {
    emit(
      v.date,
      "prepayments",
      "payables",
      v.amount_minor,
      v.id,
      `${v.name} vendor billing estimate`,
      "forecast",
    );
    emit(
      v.date,
      "payables",
      "cash",
      v.amount_minor,
      v.id,
      `${v.name} vendor payment estimate`,
      "forecast",
    );
    const span = days(v.date, v.coverage_end);
    for (let n = 0; n < span && addDays(v.date, n) <= end; n++)
      emit(
        addDays(v.date, n),
        "overhead",
        "prepayments",
        Math.round((v.amount_minor * (n + 1)) / span) -
          Math.round((v.amount_minor * n) / span),
        v.id,
        `${v.name} vendor coverage`,
        "forecast",
      );
  }
  const funding = active.filter((r) => r.kind === "funding");
  if (!funding.length)
    warnings.push(
      "Funding envelope has no dated funding plan; it is not included in available cash.",
    );
  let plannedTotal = total(
    funding
      .filter((r) => r.data.status !== "confirmed")
      .map((r) => r.data.amount_minor),
  );
  for (const r of funding) {
    const f = r.data;
    if (f.status === "confirmed" && f.date > cutoff) continue;
    if (
      f.status === "confirmed" &&
      input.ledger.some((l) => l.source === f.reference)
    ) {
      const matched = input.ledger
        .filter(
          (l) =>
            l.source === f.reference &&
            l.date === f.date &&
            ["1100", "1010"].includes(l.account),
        )
        .reduce((n, l) => n + l.amount, 0);
      if (matched !== f.amount_minor)
        warnings.push(
          `${f.name}: linked funding journal amount/date differs; ledger takes precedence.`,
        );
      continue;
    }
    if (f.status !== "confirmed" && f.date <= cutoff) {
      warnings.push(
        `${f.name}: planned funding date has passed; confirm receipt or reschedule.`,
      );
      continue;
    }
    emit(
      f.date,
      "cash",
      f.kind,
      f.status !== "confirmed" && fundingOverride !== undefined && plannedTotal
        ? Math.round((f.amount_minor * fundingOverride) / plannedTotal)
        : f.amount_minor,
      r.id,
      f.name,
      f.status === "confirmed" ? "actual" : "forecast",
    );
  }
  const unmatchedReceipts = input.invoiceReceipts.filter(
    (receipt) =>
      !events.some(
        (e) =>
          e.invoice_payment_id === receipt.id &&
          e.type === "collection" &&
          e.amount_minor === receipt.amount_minor &&
          e.date === receipt.date,
      ),
  );
  if (unmatchedReceipts.length)
    warnings.push(
      `${unmatchedReceipts.length} customer invoice receipts are outside the ledger: excluded pending matching, to avoid double counting.`,
    );
  if (
    events.some((e) =>
      ["subscription", "booking", "collection"].includes(e.type),
    )
  )
    warnings.push(
      "Imported commercial activity is a management subledger; reconcile it to bank/ledger before treating combined statements as finalized actuals.",
    );
  for (const f of flows.filter((f) => f.date < start)) {
    opening[f.debit] += f.amount;
    opening[f.credit] -= f.amount;
  }
  // Pre-pilot income belongs in retained earnings, not this pilot's P&L.
  let preProfit = 0;
  for (const a of [...revenueAccounts, ...expenseAccounts]) {
    preProfit -= opening[a];
    opening[a] = 0;
  }
  opening.retained_earnings -= preProfit;
  const balances = { ...opening };
  const daily: any[] = [];
  let cumulativeOperating = 0,
    cumulativeInvesting = 0,
    cumulativeFinancing = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const changes = emptyBalances();
    const today = flows.filter((f) => f.date === d);
    let op = 0,
      inv = 0,
      fin = 0;
    for (const f of today) {
      balances[f.debit] += f.amount;
      balances[f.credit] -= f.amount;
      changes[f.debit] += f.amount;
      changes[f.credit] -= f.amount;
      const cash = ["cash", "restricted_cash"];
      const cashChange =
        (cash.includes(f.debit) ? f.amount : 0) -
        (cash.includes(f.credit) ? f.amount : 0);
      if ([f.debit, f.credit].some((a) => ["equity", "debt"].includes(a)))
        fin += cashChange;
      else if (
        [f.debit, f.credit].includes("fixed_assets") ||
        (f.description.endsWith("payment") &&
          active.find((r) => r.id === f.source)?.data.category === "capex")
      )
        inv += cashChange;
      else op += cashChange;
    }
    cumulativeOperating += op;
    cumulativeInvesting += inv;
    cumulativeFinancing += fin;
    const stmt = statements(changes),
      bs = statements(balances);
    daily.push({
      date: d,
      week: Math.floor(days(start, d) / 7) + 1,
      month: d.slice(0, 7),
      status: d <= cutoff ? "actual" : "forecast",
      ...stmt,
      assets: bs.assets,
      liabilities: bs.liabilities,
      equity: bs.equity,
      balance_check: bs.balance_check,
      cash: balances.cash,
      restricted_cash: balances.restricted_cash,
      operating_cash: op,
      investing_cash: inv,
      financing_cash: fin,
      cash_check:
        balances.cash +
        balances.restricted_cash -
        opening.cash -
        opening.restricted_cash -
        cumulativeOperating -
        cumulativeInvesting -
        cumulativeFinancing,
      balances: { ...balances },
    });
  }
  function group(key: "month" | "week") {
    return [...new Set(daily.map((d) => d[key]))].map((k) => {
      const ds = daily.filter((d) => d[key] === k),
        last = ds.at(-1);
      return {
        period: k,
        ...Object.fromEntries(
          [
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
            "operating_cash",
            "investing_cash",
            "financing_cash",
          ].map((n) => [n, total(ds.map((d) => d[n]))]),
        ),
        cash: last.cash,
        assets: last.assets,
        liabilities: last.liabilities,
        equity: last.equity,
        balance_check: last.balance_check,
      };
    });
  }
  const summary = Object.fromEntries(
    [
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
      "operating_cash",
      "investing_cash",
      "financing_cash",
    ].map((k) => [k, total(daily.map((d) => d[k]))]),
  );
  const minCash = Math.min(opening.cash, ...daily.map((d) => d.cash));
  const campaignAttribution = events
    .filter((e) => e.type === "campaign" && e.date >= start && e.date <= cutoff)
    .reduce((n, e) => n + e.amount_minor, 0);
  const actualMarketing = daily
    .filter((d) => d.status === "actual")
    .reduce((n, d) => n + d.marketing, 0);
  if (campaignAttribution !== actualMarketing)
    warnings.push(
      `Campaign attribution (${campaignAttribution / 100} NGN) differs from posted pilot marketing costs (${actualMarketing / 100} NGN); reconcile before relying on CAC.`,
    );
  const serviceResults = active
    .filter((r) => r.kind === "service")
    .map((service) => {
      const b = emptyBalances();
      for (const f of flows.filter(
        (f) => f.service === service.id && f.date >= start && f.date <= end,
      )) {
        b[f.debit] += f.amount;
        b[f.credit] -= f.amount;
      }
      const statement = statements(b);
      const allocation = active
        .filter(
          (r) => r.kind === "allocation" && r.data.service_id === service.id,
        )
        .reduce(
          (n, r) =>
            n +
            Math.round(
              flows
                .filter((f) => !f.service && f.date >= start && f.date <= end)
                .reduce(
                  (amount, f) =>
                    amount +
                    (f.debit === r.data.category ? f.amount : 0) -
                    (f.credit === r.data.category ? f.amount : 0),
                  0,
                ) * r.data.share,
            ),
          0,
        );
      return {
        id: service.id,
        name: service.data.name,
        city: "Lagos",
        ...statement,
        allocated_overhead: allocation,
        contribution_after_allocation: statement.gross_profit - allocation,
        metrics: pmf(
          events.filter((e) => e.service_id === service.id),
          cutoff,
          evidence.complete_through,
          start,
          evidence.basis,
        ),
      };
    });
  return {
    version,
    scenario_id: scenarioId,
    start,
    end,
    cutoff,
    captured_at: input.captured_at,
    calculated_at: new Date().toISOString(),
    currency: "NGN",
    warnings: [...new Set(warnings)],
    complete: warnings.length === 0,
    opening,
    flows: flows.filter((f) => f.date >= start && f.date <= end),
    operating,
    daily,
    weekly: group("week"),
    monthly: group("month"),
    summary: {
      ...summary,
      closing_cash: balances.cash,
      minimum_cash: minCash,
      funding_gap: Math.max(0, config.minimum_cash_minor - minCash),
      first_shortfall:
        (opening.cash < config.minimum_cash_minor
          ? start
          : daily.find((d) => d.cash < config.minimum_cash_minor)?.date) ||
        null,
      balance_check: statements(balances).balance_check,
    },
    checkpoints: [...new Set([30, 60, 90, daily.length])]
      .filter((n) => n <= daily.length)
      .sort((a, b) => a - b)
      .map((n) => ({ day: n, ...daily[n - 1] })),
    closing: balances,
    pmf: pmf(events, cutoff, evidence.complete_through, start, evidence.basis),
    services: serviceResults,
    pending: input.pending,
    invoice_receipts: unmatchedReceipts,
  };
}

export type CompletenessBasis = "configured" | "source_coverage" | "unset";
// Completeness date: configured value first, otherwise the earliest coverage
// date across active operational sources. Cohort, renewal and growth metrics
// are only measurable through this date.
export function completenessFrom(active: Resource[], config: any) {
  if (config.operating_data_complete_through)
    return {
      complete_through: config.operating_data_complete_through as string,
      basis: "configured" as CompletenessBasis,
    };
  const coverage = active
    .filter((r) => r.kind === "source" && r.data.coverage_through)
    .map((r) => r.data.coverage_through as string)
    .sort()[0];
  return coverage
    ? {
        complete_through: coverage,
        basis: "source_coverage" as CompletenessBasis,
      }
    : { complete_through: null, basis: "unset" as CompletenessBasis };
}
export const rateMetrics = [
  "customer_d30",
  "driver_renewal",
  "fulfilment",
  "contribution_margin",
  "driver_d30_active",
  "paying_driver_growth_weekly",
];
export function pmf(
  events: Event[],
  cutoff: string,
  completeThrough: string | null,
  start = cutoff,
  basis: CompletenessBasis = completeThrough ? "configured" : "unset",
) {
  const observed = events.filter(
    (e) => e.date <= cutoff && e.status !== "void",
  );
  const bookings = observed.filter((e) => e.type === "booking"),
    completed = bookings.filter((e) => e.status === "completed");
  const ratio = (n: number, d: number) => (d ? n / d : null);
  const mean = (xs: number[]) => (xs.length ? total(xs) / xs.length : null);
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b),
      m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const customers = [...new Set(completed.map((e) => e.customer_id))];
  const firstCompletion = (id: string) =>
    completed
      .filter((e) => e.customer_id === id)
      .map((e) => e.date)
      .sort()[0];
  const mature = (d: string, n: number) =>
    addDays(d, n) <= cutoff &&
    !!completeThrough &&
    addDays(d, n) <= completeThrough;
  const cohorts = [...new Set(completed.map((e) => e.date.slice(0, 7)))]
    .sort()
    .map((month) => {
      const members = customers.filter((id) =>
        firstCompletion(id)?.startsWith(month),
      );
      const metrics = Object.fromEntries(
        [7, 30, 60].map((n) => {
          const eligible = members.filter((id) =>
            mature(firstCompletion(id), n),
          );
          const retained = eligible.filter((id) => {
            const first = firstCompletion(id);
            return completed.some(
              (e) =>
                e.customer_id === id &&
                e.date >= addDays(first, n - 6) &&
                e.date <= addDays(first, n) &&
                e.date > first,
            );
          });
          return [
            `d${n}`,
            {
              eligible: eligible.length,
              retained: retained.length,
              rate: ratio(retained.length, eligible.length),
            },
          ];
        }),
      );
      return { month, sample: members.length, ...metrics };
    });
  const subs = observed.filter((e) => e.type === "subscription");
  const eligible = subs.filter(
    (e) =>
      e.price_snapshot?.mode !== "daily" &&
      e.coverage_end! <= cutoff &&
      completeThrough &&
      e.coverage_end! <= completeThrough,
  );
  const renewed = eligible.filter((e) =>
    subs.some(
      (x) =>
        x.driver_id === e.driver_id &&
        x.service_id === e.service_id &&
        x.date === e.coverage_end,
    ),
  );
  const drivers = [
    ...new Set(
      observed.filter((e) => e.type === "driver").map((e) => e.driver_id),
    ),
  ];
  const registrations = observed.filter(
    (e) => e.type === "driver" || e.type === "customer",
  );
  const personId = (e: Event) =>
    e.type === "driver" ? e.driver_id : e.customer_id;
  const firstRegistration = new Map<string, string>();
  for (const e of registrations) {
    const key = `${e.type}:${personId(e)}`;
    const cur = firstRegistration.get(key);
    if (!cur || e.date < cur) firstRegistration.set(key, e.date);
  }
  const newPeople = (audience: string) => [
    ...new Set(
      registrations.filter((e) => e.type === audience).map(personId),
    ),
  ];
  const campaigns = observed.filter((e) => e.type === "campaign");
  const attributedIds = (a: string) =>
    new Set(
      registrations
        .filter(
          (e) =>
            e.type === a &&
            e.campaign_id &&
            campaigns.some(
              (c) =>
                (e.campaign_id === `${c.source_id}:${c.external_id}` ||
                  (c.external_id === e.campaign_id &&
                    c.source_id === e.source_id)) &&
                c.audience === a,
            ),
        )
        .map(personId),
    );
  const acquisition = Object.fromEntries(
    ["driver", "customer"].map((a) => {
      const spend = total(
        campaigns.filter((e) => e.audience === a).map((e) => e.amount_minor),
      );
      const acquired = attributedIds(a).size;
      return [
        a,
        {
          spend,
          attributed_acquisitions: acquired,
          cac: acquired ? spend / acquired : null,
        },
      ];
    }),
  );
  const net = (e: Event) =>
    e.amount_minor -
    total(
      observed
        .filter(
          (x) =>
            x.type === "refund" &&
            x.source_id === e.source_id &&
            x.related_id === e.external_id,
        )
        .map((x) => x.amount_minor),
    );
  const commissionOf = (e: Event) =>
    e.price_snapshot?.mode === "percent"
      ? Math.round(net(e) * e.price_snapshot.rate)
      : e.price_snapshot?.mode === "fixed"
        ? Math.round(
            (e.price_snapshot.amount_minor || 0) *
              (e.amount_minor ? net(e) / e.amount_minor : 0),
          )
        : 0;
  // Paid coverage is [date, coverage_end) with an exclusive end.
  const overlapDays = (e: Event, from: string, to: string) => {
    const a = e.date > from ? e.date : from;
    const last = addDays(e.coverage_end!, -1);
    const b = last < to ? last : to;
    return b >= a ? days(a, b) + 1 : 0;
  };
  const payingIds = new Set(subs.map((e) => e.driver_id));
  const driverEconomics = [
    ...new Set([
      ...drivers,
      ...completed.map((e) => e.driver_id),
      ...subs.map((e) => e.driver_id),
    ]),
  ].map((id) => {
    const jobs = completed.filter((e) => e.driver_id === id),
      plans = subs.filter((e) => e.driver_id === id);
    const gross = total(jobs.map(net));
    const commission = total(jobs.map(commissionOf));
    const subscriptionCost = total(plans.map(net));
    const coverage = total(plans.map((e) => overlapDays(e, e.date, cutoff)));
    return {
      driver_id: id,
      jobs: jobs.length,
      gross_bookings: gross,
      commission,
      subscription_cost: subscriptionCost,
      earnings_before_vehicle_costs: gross - commission - subscriptionCost,
      subscription_burden: ratio(subscriptionCost, gross - commission),
      coverage_days: coverage,
      jobs_per_covered_day: ratio(jobs.length, coverage),
      active_days: new Set(jobs.map((e) => e.date)).size,
    };
  });
  const firstTimes = customers
    .map((id) => {
      const reg = firstRegistration.get(`customer:${id}`),
        first = firstCompletion(id);
      return reg ? days(reg, first) : null;
    })
    .filter((n): n is number => n !== null && n >= 0);
  // Weekly momentum: week 1 starts on the period start; only observed weeks.
  const weekly: any[] = [];
  if (cutoff >= start) {
    const weeks = Math.floor(days(start, cutoff) / 7) + 1;
    let previous: number | null = null;
    for (let w = 1; w <= weeks; w++) {
      const from = addDays(start, (w - 1) * 7),
        end = addDays(from, 6),
        to = end < cutoff ? end : cutoff;
      const inWeek = (e: Event) => e.date >= from && e.date <= to;
      const jobs = completed.filter(inWeek);
      const paying = new Set(
        subs
          .filter((e) => e.date <= to && e.coverage_end! > from)
          .map((e) => e.driver_id),
      );
      const activeDrivers = new Set(jobs.map((e) => e.driver_id));
      const payingDriverDays = total(
        subs.map((e) => overlapDays(e, from, to)),
      );
      const requested = bookings.filter(inWeek).length;
      weekly.push({
        week: w,
        from,
        to,
        complete: !!completeThrough && to <= completeThrough,
        new_drivers: new Set(
          registrations
            .filter((e) => e.type === "driver" && inWeek(e))
            .map(personId),
        ).size,
        new_customers: new Set(
          registrations
            .filter((e) => e.type === "customer" && inWeek(e))
            .map(personId),
        ).size,
        paying_drivers: paying.size,
        paying_driver_growth:
          previous === null ? null : ratio(paying.size - previous, previous),
        active_drivers: activeDrivers.size,
        active_paying_share: ratio(
          [...activeDrivers].filter((id) => paying.has(id)).length,
          paying.size,
        ),
        completed_jobs: jobs.length,
        requested_bookings: requested,
        fulfilment: ratio(jobs.length, requested),
        customers_transacting: new Set(jobs.map((e) => e.customer_id)).size,
        gross_bookings: total(jobs.map(net)),
        subscription_purchases: total(subs.filter(inWeek).map(net)),
        campaign_spend: total(
          campaigns.filter(inWeek).map((e) => e.amount_minor),
        ),
        paying_driver_days: payingDriverDays,
        completed_jobs_by_paying: jobs.filter((e) => paying.has(e.driver_id))
          .length,
        jobs_per_paying_driver_day: ratio(
          jobs.filter((e) => paying.has(e.driver_id)).length,
          payingDriverDays,
        ),
      });
      previous = paying.size;
    }
  }
  const growthWeeks = weekly
    .filter((w) => w.complete && w.paying_driver_growth !== null)
    .slice(-4);
  // Driver cohorts by first registration month: paid conversion and whether the
  // driver was still active (job completed or paid coverage) around D30/D60.
  const driverRegistered = [...firstRegistration]
    .filter(([k]) => k.startsWith("driver:"))
    .map(([k, d]) => ({ id: k.slice(7), date: d }));
  const driverCohorts = [
    ...new Set(driverRegistered.map((d) => d.date.slice(0, 7))),
  ]
    .sort()
    .map((month) => {
      const members = driverRegistered.filter((d) =>
        d.date.startsWith(month),
      );
      const paid = members.filter((m) => payingIds.has(m.id)).length;
      const window = (n: number) => {
        const eligibleMembers = members.filter((m) => mature(m.date, n));
        const active = eligibleMembers.filter((m) => {
          const from = addDays(m.date, n - 6),
            to = addDays(m.date, n);
          return (
            completed.some(
              (e) => e.driver_id === m.id && e.date >= from && e.date <= to,
            ) ||
            subs.some(
              (e) =>
                e.driver_id === m.id &&
                e.date <= to &&
                e.coverage_end! > from,
            )
          );
        });
        return {
          eligible: eligibleMembers.length,
          active: active.length,
          rate: ratio(active.length, eligibleMembers.length),
        };
      };
      return {
        month,
        registered: members.length,
        paid,
        paid_rate: ratio(paid, members.length),
        d30: window(30),
        d60: window(60),
      };
    });
  const byStatus = (s: string) =>
    bookings.filter((e) => e.status === s).length;
  const reachedAcceptance =
    byStatus("accepted") + byStatus("completed") + byStatus("paid");
  const matchMinutes = completed
    .filter((e) => e.match_minutes !== null)
    .map((e) => e.match_minutes!);
  const funnel = {
    bookings: bookings.length,
    still_requested: byStatus("requested"),
    accepted_not_completed: byStatus("accepted"),
    completed: completed.length,
    cancelled: byStatus("cancelled"),
    acceptance_rate: ratio(reachedAcceptance, bookings.length),
    completion_rate: ratio(completed.length, bookings.length),
    median_match_minutes: median(matchMinutes),
    matched_sample: matchMinutes.length,
  };
  const payingDriverDays = total(driverEconomics.map((d) => d.coverage_days));
  const activeDriverDays = new Set(
    completed.map((e) => `${e.driver_id}|${e.date}`),
  ).size;
  const jobsByPaying = completed.filter((e) =>
    payingIds.has(e.driver_id),
  ).length;
  const utilisation = {
    paying_driver_days: payingDriverDays,
    jobs_by_paying_drivers: jobsByPaying,
    jobs_per_paying_driver_day: ratio(jobsByPaying, payingDriverDays),
    active_driver_days: activeDriverDays,
    jobs_per_active_driver_day: ratio(completed.length, activeDriverDays),
    average_job_hours: mean(
      completed.filter((e) => e.job_hours !== null).map((e) => e.job_hours!),
    ),
    average_available_hours: mean(
      observed
        .filter((e) => e.type === "driver" && e.available_hours !== null)
        .map((e) => e.available_hours!),
    ),
    subscription_burden_median: median(
      driverEconomics
        .filter(
          (d) =>
            d.subscription_cost > 0 && d.gross_bookings - d.commission > 0,
        )
        .map((d) => d.subscription_burden!),
    ),
    paying_drivers_without_jobs: driverEconomics.filter(
      (d) => d.subscription_cost > 0 && d.jobs === 0,
    ).length,
  };
  // Early payback: CAC against observed platform revenue per attributed
  // acquisition, scaled to a month. Labelled immature below 90 observed days;
  // it is a direction signal, not a mature LTV.
  const payback = Object.fromEntries(
    ["driver", "customer"].map((a) => {
      const ids = attributedIds(a);
      const revenue =
        a === "driver"
          ? total(subs.filter((e) => ids.has(e.driver_id)).map(net)) +
            total(
              completed.filter((e) => ids.has(e.driver_id)).map(commissionOf),
            )
          : total(
              completed
                .filter((e) => ids.has(e.customer_id))
                .map(commissionOf),
            );
      const observedDays = total(
        [...ids].map(
          (id) => days(firstRegistration.get(`${a}:${id}`)!, cutoff) + 1,
        ),
      );
      const monthly = ratio(revenue * 30.4, observedDays);
      const cac = acquisition[a].cac;
      const months =
        cac !== null && monthly !== null && monthly > 0 ? cac / monthly : null;
      const averageDays = ratio(observedDays, ids.size);
      return [
        a,
        {
          attributed: ids.size,
          observed_revenue: revenue,
          average_observed_days: averageDays,
          monthly_revenue_per_acquisition: monthly,
          payback_months: months,
          maturity:
            months === null
              ? "unavailable"
              : averageDays !== null && averageDays < 90
                ? "immature"
                : "observed",
        },
      ];
    }),
  );
  return {
    complete_through: completeThrough,
    complete_through_basis: basis,
    acquisition,
    payback,
    driver_economics: driverEconomics,
    activation: {
      customers: ratio(customers.length, newPeople("customer").length),
      drivers: ratio(
        new Set(completed.map((e) => e.driver_id)).size,
        drivers.length,
      ),
      paid_conversion: ratio(payingIds.size, drivers.length),
    },
    booking_frequency: ratio(completed.length, customers.length),
    time_to_first_completion_days: mean(firstTimes),
    weekly,
    growth: {
      weeks_used: growthWeeks.length,
      paying_driver_growth_weekly: mean(
        growthWeeks.map((w) => w.paying_driver_growth as number),
      ),
      latest_paying_drivers: weekly.at(-1)?.paying_drivers ?? 0,
      latest_week: weekly.at(-1)?.week ?? null,
    },
    driver_cohorts: driverCohorts,
    funnel,
    utilisation,
    definitions: {
      retention:
        "Completed job in trailing 7-day window ending D7/D30/D60 after first completion, excluding first job. Only cohorts with complete observation coverage are eligible.",
      driver_cohorts:
        "Drivers grouped by first registration month. Paid = any subscription purchase by cutoff. D30/D60 active = completed a job or held paid coverage in the trailing 7-day window ending D30/D60 after registration; complete coverage required.",
      renewal:
        "Non-daily subscription followed by coverage starting on exclusive expiry date; observed complete periods only.",
      weekly:
        "Week 1 starts on the period start date. Paying drivers hold paid coverage on at least one day of the week. Growth compares paying drivers with the prior week; the scorecard averages the last four complete weeks.",
      utilisation:
        "Jobs per paying driver-day = completed jobs by subscribed drivers / days of paid coverage through cutoff. Subscription burden = subscription cost / (gross bookings - platform commission), median across paying drivers with earnings.",
      funnel:
        "Each booking record carries its latest status. Acceptance = accepted, completed or paid / all non-void bookings. Match minutes are reported where the source supplies them.",
      fulfilment:
        "Completed bookings / all non-void booking records; latest source revision only.",
      repeat:
        "Customers with at least two completed bookings / customers with a completed booking.",
      cac: "Campaign spend / newly registered attributed population; unavailable without attribution.",
      payback:
        "CAC / monthly platform revenue per attributed acquisition (subscriptions net of refunds plus commission for drivers; commission for customers), using observed days through cutoff. Immature below 90 average observed days. Not a mature LTV.",
      completeness:
        "Metrics that need a full observation window use the completeness date: the configured value, otherwise the earliest coverage date of active operational sources.",
    },
    cohorts,
    customers: customers.length,
    drivers: drivers.length,
    paying_drivers: payingIds.size,
    completed_jobs: completed.length,
    fulfilment: ratio(completed.length, bookings.length),
    cancellation: ratio(
      bookings.filter((e) => e.status === "cancelled").length,
      bookings.length,
    ),
    repeat: ratio(
      customers.filter(
        (id) => completed.filter((e) => e.customer_id === id).length >= 2,
      ).length,
      customers.length,
    ),
    renewal: {
      eligible: eligible.length,
      renewed: renewed.length,
      rate: ratio(renewed.length, eligible.length),
    },
    average_match_minutes: mean(matchMinutes),
    ltv: null,
    notes: [
      "Mature LTV remains unavailable; early payback is a direction signal only.",
      "Metrics reflect imported records; incomplete feeds limit conclusions.",
      completeThrough
        ? `Observation coverage is complete through ${completeThrough} (${basis === "configured" ? "configured" : "earliest source coverage"}).`
        : "No completeness date: configure one or set source coverage dates before reading cohort, renewal or growth figures.",
    ],
  };
}
