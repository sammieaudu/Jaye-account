// Product-runtime exporter. ExcelJS is a deployable dependency; artifact-tool is
// used by the verification harness, not required on the production API host.
import { management } from "./management";
import ExcelJS from "exceljs";
import { Input, calculate, Flow } from "./engine";
import { accounts, addDays, coverageEnd, days, version } from "./types";

export async function exportFinancialWorkbook(
  input: Input,
  snapshotId: string,
  scenarioId: string,
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jaye Finance";
  wb.created = new Date(input.captured_at);
  wb.calcProperties.fullCalcOnLoad = true;
  const fmt = '#,##0.00;(#,##0.00);"—"';
  const sheet = (name: string, headers: string[]) => {
    const s = wb.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
      properties: { defaultRowHeight: 22 },
    });
    s.addRow(headers);
    s.getRow(1).font = {
      name: "Aptos",
      bold: true,
      color: { argb: "FFFFFFFF" },
      size: 11,
    };
    s.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2B7661" },
    };
    s.getRow(1).height = 44;
    s.getRow(1).alignment = { wrapText: true, vertical: "middle" };
    s.columns.forEach((c, i) => (c.width = i === 0 ? 41 : 22));
    s.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };
    return s;
  };
  const read = sheet("Read Me", ["Jaye · Lagos financial model", "Details"]);
  read.getColumn(2).width = 95;
  read.addRows([
    ["Snapshot", snapshotId],
    ["Captured at", input.captured_at],
    ["Active scenario", scenarioId],
    [
      "Currency / calculation units",
      "NGN; input money and flow calculations use kobo, outputs show naira",
    ],
    ["Model version", version],
    [
      "Editable cells",
      "Blue inputs: volumes, rates, prices, costs and dated funding amounts. Green formulas link schedules.",
    ],
    [
      "Calendar and actuals",
      "Frozen snapshot dates and source records. Change dates, add schedules or import actuals in the app and export again.",
    ],
    [
      "Synchronization",
      "Workbook edits do not update the app. All scenario comparisons recalculate from the input schedules.",
    ],
    [
      "Completeness",
      "Missing data is not zero. Review warnings before using results.",
    ],
    [
      "Actual/forecast boundary",
      input.resources.find((r) => r.kind === "config")!.data.cutoff,
    ],
  ]);
  const scenarios = input.resources.filter(
    (r) => r.kind === "scenario" && !r.archived,
  );
  read.getCell("B4").dataValidation = {
    type: "list",
    allowBlank: false,
    formulae: [`"${scenarios.map((r) => r.id).join(",")}"`],
  };
  read.getCell("B4").font = { color: { argb: "FF0000FF" } };
  const assumptionFields = [
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
  // Build formula paths even for incomplete inputs. Guards below keep their
  // results at zero until every required input is supplied in the workbook.
  const buildInput: Input = structuredClone(input);
  for (const r of buildInput.resources) {
    if (r.kind === "assumption")
      for (const field of assumptionFields)
        if (r.data[field] === null)
          r.data[field] = field === "hours_per_job" ? 1 : 0;
    if (r.kind === "price") {
      if (r.data.mode === "percent" && r.data.rate === null) r.data.rate = 0;
      else if (r.data.mode !== "percent" && r.data.amount_minor === null)
        r.data.amount_minor = 0;
    }
  }
  const assumptions = sheet("Assumptions", [
    "ID",
    "Scenario",
    "Service",
    ...assumptionFields.map((field) => field.replaceAll("_", " ")),
    "Evidence / confidence",
  ]);
  const aRefs = new Map<string, Record<string, string>>();
  for (const r of input.resources.filter(
    (r) => r.kind === "assumption" && !r.archived,
  )) {
    const row = assumptions.addRow([
      r.id,
      r.data.scenario_id,
      r.data.service_id,
      ...assumptionFields.map((k) => r.data[k]),
      `${r.data.source} / ${r.data.confidence}`,
    ]);
    const refs: Record<string, string> = {};
    assumptionFields.forEach((k, i) => {
      refs[k] = `Assumptions!${row.getCell(i + 4).address}`;
      row.getCell(i + 4).font = { color: { argb: "FF0000FF" } };
      row.getCell(i + 4).numFmt = fmt;
      row.getCell(i + 4).dataValidation = {
        type: "decimal",
        operator: "between",
        formulae: [
          0,
          [
            "activation",
            "paid_conversion",
            "renewal",
            "daily_purchase_rate",
          ].includes(k)
            ? 1
            : 1e13,
        ],
        allowBlank: true,
      };
    });
    aRefs.set(r.id, refs);
  }
  const prices = sheet("Services and Pricing", [
    "Price ID",
    "Service",
    "Mode",
    "Amount · kobo",
    "Rate",
    "Effective from",
    "Effective to",
    "Evidence",
  ]);
  const pRefs = new Map<string, { amount: string; rate: string }>();
  for (const r of input.resources.filter((r) => r.kind === "price")) {
    const row = prices.addRow([
      r.id,
      r.data.service_id,
      r.data.mode,
      r.data.amount_minor,
      r.data.rate,
      r.data.effective_from,
      r.data.effective_to,
      r.data.source,
    ]);
    pRefs.set(r.id, {
      amount: `'Services and Pricing'!D${row.number}`,
      rate: `'Services and Pricing'!E${row.number}`,
    });
    for (const col of [4, 5]) {
      row.getCell(col).font = { color: { argb: "FF0000FF" } };
      row.getCell(col).dataValidation = {
        type: "decimal",
        operator: "between",
        formulae: [0, col === 5 ? 1 : 1e13],
        allowBlank: true,
      };
    }
  }
  const costs = sheet("Costs and Funding", [
    "ID",
    "Name",
    "Kind",
    "Amount · kobo",
    "Start / receipt date",
    "Payment date",
    "End date",
    "Cadence",
    "Evidence",
    "Quantity",
  ]);
  const costRefs = new Map<string, string>();
  for (const r of input.resources.filter(
    (r) => ["cost", "funding"].includes(r.kind) && !r.archived,
  )) {
    const row = costs.addRow([
      r.id,
      r.data.name,
      r.kind === "funding"
        ? `${r.data.status} ${r.data.kind}`
        : r.data.category,
      r.data.amount_minor,
      r.data.start_date || r.data.date,
      r.data.pay_date || "",
      r.data.end_date || "",
      r.data.cadence || "",
      r.data.source,
      r.kind === "cost" ? (r.data.quantity ?? 1) : 1,
    ]);
    costRefs.set(
      r.id,
      `('Costs and Funding'!D${row.number}*'Costs and Funding'!J${row.number})`,
    );
    row.getCell(4).font = { color: { argb: "FF0000FF" } };
    if (r.kind === "cost") {
      row.getCell(10).font = { color: { argb: "FF0000FF" } };
      row.getCell(10).dataValidation = {
        type: "decimal",
        operator: "between",
        formulae: [0, 1e7],
        allowBlank: false,
      };
    }
    row.getCell(4).dataValidation = {
      type: "decimal",
      operator: "between",
      formulae: [0, 1e13],
      allowBlank: false,
    };
  }
  const actuals = sheet("Actuals", [
    "Source",
    "Date",
    "Type / account",
    "Status",
    "Amount · kobo",
    "Revision",
    "Reference",
  ]);
  for (const e of input.events)
    actuals.addRow([
      `${e.source_id}:${e.external_id}`,
      e.date,
      e.type,
      e.status,
      e.amount_minor,
      e.revision,
      e.reference,
    ]);
  for (const l of input.ledger)
    actuals.addRow([
      l.source,
      l.date,
      l.account,
      "posted ledger",
      l.amount,
      0,
      l.description,
    ]);
  const operations = sheet("Operations", [
    "Scenario",
    "Assumption",
    "Date",
    "Active drivers",
    "Completed jobs",
    "Gross bookings · kobo",
  ]);
  const jobRefs = new Map<string, string>();
  const flows = sheet("Financial Flows", [
    "Scenario",
    "Date",
    "State",
    "Source",
    "Service",
    "Debit account",
    "Credit account",
    "Amount · kobo",
    "Description",
  ]);
  const opening = sheet("Opening Balances", [
    "Account",
    "Debit-positive · kobo",
  ]);
  const base = calculate(input, scenarioId);
  read.getCell("B11").value = base.cutoff;
  const lastDailyRow = base.daily.length + 1;
  const checkpointRows = base.checkpoints.map((c) => c.day + 1);
  read.addRows([
    ["Period start", base.start],
    ["Period end", base.end],
    ["Days (inclusive)", base.daily.length],
  ]);
  accounts.forEach((a) => opening.addRow([a, base.opening[a]]));
  const sourceById = new Map(input.resources.map((r) => [r.id, r]));
  const carried = (id: string, launch: string) =>
    input.events.filter(
      (e) =>
        e.type === "subscription" &&
        e.status !== "void" &&
        e.date <= base.cutoff &&
        e.price_id === sourceById.get(id)!.data.price_id &&
        e.coverage_end! >= launch &&
        e.amount_minor >
          input.events
            .filter(
              (x) =>
                x.type === "refund" &&
                x.status !== "void" &&
                x.date <= base.cutoff &&
                x.source_id === e.source_id &&
                x.related_id === e.external_id,
            )
            .reduce((n, x) => n + x.amount_minor, 0),
    );
  function countFormula(
    id: string,
    cohort: string,
    launch: string,
    renewals: number,
  ) {
    const a = aRefs.get(id)!;
    if (cohort < launch) return `(${a.renewal}^${renewals})`;
    return `((${cohort === launch ? `MAX(0,${a.initial_paying}-${carried(id, launch).length})` : "0"}+${a.new_drivers_daily}*${a.activation}*${a.paid_conversion})*${a.renewal}^${renewals})`;
  }
  for (const scenario of scenarios) {
    const result = calculate(buildInput, scenario.id);
    for (const o of result.operating) {
      const row = sourceById.get(o.assumption)!,
        a = aRefs.get(row.id)!,
        p = sourceById.get(row.data.price_id)!.data;
      const first = result.operating.find((x) => x.assumption === row.id)!.date;
      const terms: string[] = [];
      for (const c of carried(row.id, first)) {
        let n = 0,
          next = c.coverage_end!;
        while (next <= o.date) {
          n++;
          next = coverageEnd(next, p.mode);
        }
        terms.push(countFormula(row.id, c.date, first, n));
      }
      for (let d = first; d <= o.date; d = addDays(d, 1)) {
        let renewals = 0,
          next = coverageEnd(
            d,
            ["daily", "weekly", "monthly"].includes(p.mode)
              ? p.mode
              : "monthly",
          );
        while (next <= o.date) {
          renewals++;
          next = coverageEnd(
            next,
            ["daily", "weekly", "monthly"].includes(p.mode)
              ? p.mode
              : "monthly",
          );
        }
        terms.push(countFormula(row.id, d, first, renewals));
      }
      const r = operations.addRow([scenario.id, row.id, o.date]);
      r.getCell(4).value = {
        formula: terms.join("+") || "0",
        result: o.drivers,
      };
      r.getCell(5).value = {
        formula: `D${r.number}*MIN(${a.jobs_per_driver},IF(${a.hours_per_job}>0,${a.available_hours}/${a.hours_per_job},0))`,
        result: o.jobs,
      };
      r.getCell(6).value = {
        formula: `ROUND(E${r.number}*${a.average_booking_minor},0)`,
        result: o.gross_bookings,
      };
      jobRefs.set(
        `${scenario.id}:${row.id}:${o.date}`,
        `Operations!E${r.number}`,
      );
    }
    for (const f of result.flows) {
      let formula: string | undefined;
      if (f.assumption) {
        const a = aRefs.get(f.assumption)!,
          source = sourceById.get(f.assumption)!,
          price = sourceById.get(source.data.price_id)!,
          p = pRefs.get(price.id)!;
        if (f.driver?.startsWith("subscription")) {
          const units = `${countFormula(f.assumption, f.cohort_date!, f.launch!, f.renewal_number!)}${price.data.mode === "daily" ? `*${a.daily_purchase_rate}` : ""}`;
          const bill = `ROUND(${units}*${p.amount},0)`;
          formula =
            f.driver === "subscription_recognition"
              ? `ROUND(${bill}*${f.slice! + 1}/${f.span},0)-ROUND(${bill}*${f.slice}/${f.span},0)`
              : bill;
        } else {
          const jobs = jobRefs.get(
            `${scenario.id}:${f.assumption}:${f.cohort_date}`,
          )!;
          const unit =
            f.driver === "direct_cost"
              ? a.direct_cost_per_job_minor
              : price.data.mode === "percent"
                ? `${a.average_booking_minor}*${p.rate}`
                : p.amount;
          formula = `ROUND(${jobs}*${unit},0)`;
        }
      } else if (f.status === "forecast" && costRefs.has(f.source)) {
        const amount = costRefs.get(f.source)!;
        formula = f.span
          ? `ROUND(${amount}*${f.slice! + 1}/${f.span},0)-ROUND(${amount}*${f.slice}/${f.span},0)`
          : amount;
      }
      if (formula && f.assumption) {
        const a = aRefs.get(f.assumption)!;
        const p = pRefs.get(sourceById.get(f.assumption)!.data.price_id)!;
        const price = sourceById.get(
          sourceById.get(f.assumption)!.data.price_id,
        )!.data;
        formula = `IF(COUNTBLANK(${a.initial_paying}:${a.direct_cost_per_job_minor.split("!")[1]})+COUNTBLANK(${price.mode === "percent" ? p.rate : p.amount})>0,0,${formula})`;
      }
      const row = flows.addRow([
        scenario.id,
        f.date,
        f.status,
        f.source,
        f.service,
        f.debit,
        f.credit,
        formula
          ? {
              formula,
              result:
                f.assumption &&
                assumptionFields.some(
                  (field) =>
                    sourceById.get(f.assumption!)!.data[field] === null,
                )
                  ? 0
                  : f.amount,
            }
          : f.amount,
        f.description,
      ]);
      row.getCell(8).numFmt = fmt;
    }
  }
  // A single normalized flow build feeds every statement and case comparison.
  // Actual rows are fixed source records; only forecast rows link editable inputs.
  const last = Math.max(2, flows.rowCount),
    range = (c: string) => `'Financial Flows'!$${c}$2:$${c}$${last}`;
  const sum = (account: string, date: string, scenario: string, op = "=") =>
    `SUMIFS(${range("H")},${range("F")},"${account}",${range("B")},"${op}"&${date},${range("A")},${scenario})-SUMIFS(${range("H")},${range("G")},"${account}",${range("B")},"${op}"&${date},${range("A")},${scenario})`;
  const balances = sheet("Daily Accounts", ["Date", ...accounts]);
  const daily = sheet("Daily Cash and PL", [
    "Date",
    "Revenue · NGN",
    "Direct cost",
    "Gross profit",
    "Marketing",
    "Payroll",
    "Overhead",
    "EBITDA",
    "Depreciation",
    "Interest",
    "Tax",
    "Net income",
    "Unrestricted cash",
    "Restricted cash",
    "Assets",
    "Liabilities",
    "Equity",
    "Balance check",
    "Cash change",
  ]);
  const col = (a: string) =>
    balances.getColumn(accounts.indexOf(a as any) + 2).letter;
  const b = (a: string, row: number) => `'Daily Accounts'!${col(a)}${row}`;
  for (let n = 0; n < base.daily.length; n++) {
    const d = addDays(base.start, n),
      r = n + 2;
    balances.addRow([d]);
    accounts.forEach((a, i) => {
      const c = balances.getCell(r, i + 2);
      c.value = {
        formula: `'Opening Balances'!B${i + 2}+${sum(a, `A${r}`, "'Read Me'!$B$4", "<=")}`,
        result: base.daily[n].balances[a],
      };
      c.numFmt = fmt;
    });
    daily.addRow([d]);
    const delta = (a: string) =>
      `(${b(a, r)}-${r === 2 ? `'Opening Balances'!B${accounts.indexOf(a as any) + 2}` : b(a, r - 1)})/100`;
    const formulas: Record<number, string> = {
      2: `-(${delta("subscription_revenue")})-(${delta("commission_revenue")})`,
      3: delta("direct_cost"),
      4: `B${r}-C${r}`,
      5: delta("marketing"),
      6: delta("payroll"),
      7: delta("overhead"),
      8: `D${r}-E${r}-F${r}-G${r}`,
      9: delta("depreciation"),
      10: delta("interest"),
      11: delta("tax"),
      12: `H${r}-I${r}-J${r}-K${r}`,
      13: `${b("cash", r)}/100`,
      14: `${b("restricted_cash", r)}/100`,
      15: `(${["cash", "restricted_cash", "receivables", "prepayments", "deposits", "fixed_assets", "accumulated_depreciation"].map((a) => b(a, r)).join("+")})/100`,
      16: `-(${["payables", "deferred_revenue", "settlements", "tax_payable", "debt"].map((a) => b(a, r)).join("+")})/100`,
      17: `-(${b("equity", r)}+${b("retained_earnings", r)})/100+SUM(L$2:L${r})`,
      18: `O${r}-P${r}-Q${r}`,
      19: `(${delta("cash")})+(${delta("restricted_cash")})`,
    };
    Object.entries(formulas).forEach(([c, f]) => {
      daily.getCell(r, +c).value = { formula: f };
      daily.getCell(r, +c).numFmt = fmt;
    });
  }
  const pnl = sheet("P&L", [
    "Metric · NGN",
    ...base.monthly.map((m) => m.period),
    "Period total",
  ]);
  const metrics = [
    ["Revenue", "B"],
    ["Direct costs", "C"],
    ["Gross profit", "D"],
    ["Marketing", "E"],
    ["Payroll", "F"],
    ["Overhead", "G"],
    ["EBITDA", "H"],
    ["Depreciation", "I"],
    ["Interest", "J"],
    ["Tax — provisional", "K"],
    ["Net income — provisional", "L"],
  ];
  metrics.forEach(([label, c], i) => {
    const r = i + 2;
    pnl.addRow([label]);
    base.monthly.forEach((m, j) => {
      const first = base.daily.findIndex((d) => d.month === m.period) + 2;
      const last = base.daily.map((d) => d.month).lastIndexOf(m.period) + 2;
      pnl.getCell(r, j + 2).value = {
        formula: `SUM('Daily Cash and PL'!${c}${first}:${c}${last})`,
      };
    });
    pnl.getCell(r, base.monthly.length + 2).value = {
      formula: `SUM('Daily Cash and PL'!${c}2:${c}${lastDailyRow})`,
    };
  });
  const bs = sheet("Balance Sheet", [
    "Account · NGN",
    "Opening",
    ...base.checkpoints.map((c) => `Day ${c.day} · ${c.date}`),
  ]);
  accounts
    .filter(
      (a) =>
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
    .forEach((a) => {
      const i = accounts.indexOf(a),
        r = bs.addRow([a]);
      const sign = [
        "payables",
        "deferred_revenue",
        "settlements",
        "tax_payable",
        "debt",
        "equity",
        "retained_earnings",
      ].includes(a)
        ? -1
        : 1;
      r.getCell(2).value = {
        formula: `'Opening Balances'!B${i + 2}*${sign}/100`,
      };
      checkpointRows.forEach(
        (d, j) =>
          (r.getCell(j + 3).value = { formula: `${b(a, d)}*${sign}/100` }),
      );
    });
  const earnings = bs.addRow(["Period earnings"]);
  checkpointRows.forEach(
    (d, j) =>
      (earnings.getCell(j + 3).value = {
        formula: `SUM('Daily Cash and PL'!L2:L${d})`,
      }),
  );
  const cf = sheet("Cash Flow", ["Metric · NGN", "Period total"]);
  const cashType = (f: Flow) =>
    [f.debit, f.credit].some((a) => ["equity", "debt"].includes(a))
      ? "financing"
      : [f.debit, f.credit].includes("fixed_assets") ||
          (f.description.endsWith("payment") &&
            sourceById.get(f.source)?.data.category === "capex")
        ? "investing"
        : "operating";
  flows.getCell(1, 10).value = "Cash class";
  flows.getCell(1, 11).value = "Cash amount · kobo";
  let flowIndex = 2;
  for (const scenario of scenarios)
    for (const f of calculate(buildInput, scenario.id).flows) {
      const r = flowIndex++;
      flows.getCell(r, 10).value = cashType(f);
      const sign =
        (["cash", "restricted_cash"].includes(f.debit) ? 1 : 0) -
        (["cash", "restricted_cash"].includes(f.credit) ? 1 : 0);
      flows.getCell(r, 11).value = { formula: `H${r}*${sign}` };
    }
  for (const label of ["operating", "investing", "financing"]) {
    const r = cf.addRow([label]);
    r.getCell(2).value = {
      formula: `SUMIFS(${range("K")},${range("J")},A${r.number},${range("A")},'Read Me'!B4)/100`,
    };
  }
  cf.addRow([
    "Opening cash",
    { formula: `('Opening Balances'!B2+'Opening Balances'!B3)/100` },
  ]);
  cf.addRow(["Closing cash", { formula: "SUM(B2:B5)" }]);
  cf.addRow([
    "Cash reconciliation",
    {
      formula: `B6-'Daily Cash and PL'!M${lastDailyRow}-'Daily Cash and PL'!N${lastDailyRow}`,
    },
  ]);
  const cases = sheet("Scenario Comparison", [
    "Scenario",
    "Revenue · NGN",
    "Expenses · NGN",
    "Net income · NGN",
    "Closing cash · NGN",
  ]);
  for (const s of scenarios) {
    const r = cases.addRow([s.id]);
    const get = (a: string) => sum(a, `"${base.end}"`, `A${r.number}`, "<=");
    r.getCell(2).value = {
      formula: `-(${get("subscription_revenue")})/100-(${get("commission_revenue")})/100`,
    };
    r.getCell(3).value = {
      formula: `(${["direct_cost", "marketing", "payroll", "overhead", "depreciation", "interest", "tax"].map((a) => `(${get(a)})`).join("+")})/100`,
    };
    r.getCell(4).value = { formula: `B${r.number}-C${r.number}` };
    r.getCell(5).value = {
      formula: `('Opening Balances'!B2+${get("cash")})/100`,
    };
  }
  const cohorts = sheet("PMF and Cohorts", [
    "Cohort",
    "Customers",
    "D7 eligible",
    "D7 retained",
    "D7 rate",
    "D30 eligible",
    "D30 retained",
    "D30 rate",
    "D60 eligible",
    "D60 retained",
    "D60 rate",
  ]);
  for (const c of base.pmf.cohorts as any[]) {
    const r = cohorts.addRow([
      c.month,
      c.sample,
      c.d7.eligible,
      c.d7.retained,
      null,
      c.d30.eligible,
      c.d30.retained,
      null,
      c.d60.eligible,
      c.d60.retained,
    ]);
    for (const [out, n, d] of [
      [5, "D", "C"],
      [8, "G", "F"],
      [11, "J", "I"],
    ] as const) {
      r.getCell(out).value = {
        formula: `IF(${d}${r.number}=0,"n.a.",${n}${r.number}/${d}${r.number})`,
      };
      r.getCell(out).numFmt = "0.0%";
    }
  }
  const weekly = sheet("PMF Weekly", [
    "Week",
    "From",
    "To",
    "Coverage complete",
    "New drivers",
    "New customers",
    "Paying drivers",
    "Paying driver growth",
    "Active drivers",
    "Completed jobs",
    "Requested bookings",
    "Fulfilment",
    "Paying driver-days",
    "Jobs by paying drivers",
    "Jobs per paying driver-day",
    "Gross bookings · NGN",
    "Campaign spend · NGN",
  ]);
  for (const w of base.pmf.weekly as any[]) {
    const r = weekly.addRow([
      w.week,
      w.from,
      w.to,
      w.complete ? "Yes" : "No",
      w.new_drivers,
      w.new_customers,
      w.paying_drivers,
      null,
      w.active_drivers,
      w.completed_jobs,
      w.requested_bookings,
      null,
      w.paying_driver_days,
      w.completed_jobs_by_paying,
      null,
      w.gross_bookings / 100,
      w.campaign_spend / 100,
    ]);
    const n = r.number;
    r.getCell(8).value = {
      formula:
        n === 2
          ? `"n.a."`
          : `IF(G${n - 1}=0,"n.a.",(G${n}-G${n - 1})/G${n - 1})`,
    };
    r.getCell(12).value = { formula: `IF(K${n}=0,"n.a.",J${n}/K${n})` };
    r.getCell(15).value = { formula: `IF(M${n}=0,"n.a.",N${n}/M${n})` };
    r.getCell(8).numFmt = "0.0%";
    r.getCell(12).numFmt = "0.0%";
    r.getCell(15).numFmt = "0.00";
  }
  const definitions = sheet("Definitions and Warnings", [
    "Topic",
    "Definition / unresolved input",
  ]);
  definitions.getColumn(2).width = 110;
  for (const [k, v] of Object.entries(base.pmf.definitions))
    definitions.addRow([k, v]);
  base.warnings.forEach((w) => definitions.addRow(["Unresolved", w]));
  (base.source_notes || []).forEach((note) =>
    definitions.addRow(["Source policy", note]),
  );
  const checks = sheet("Checks", [
    "Check",
    "Difference · NGN",
    "Interpretation",
  ]);
  checks.getColumn(3).width = 90;
  checks.addRows([
    [
      "Period-end balance",
      { formula: `'Daily Cash and PL'!R${lastDailyRow}` },
      "Zero means arithmetic balances; completeness is separate.",
    ],
    [
      "Cash reconciliation",
      { formula: "'Cash Flow'!B7" },
      "Opening cash plus operating/investing/financing equals closing cash.",
    ],
    [
      "Revenue tie",
      {
        formula: `'P&L'!${pnl.getColumn(base.monthly.length + 2).letter}2-SUM('Daily Cash and PL'!B2:B${lastDailyRow})`,
      },
      "P&L reconciles to daily schedule.",
    ],
    [
      "Data completeness",
      base.warnings.length,
      "Review Definitions and Warnings. Missing inputs prevent an approved forecast.",
    ],
  ]);
  for (const s of wb.worksheets) {
    s.eachRow((row, n) => {
      if (n === 1) return;
      row.eachCell((cell) => {
        if (!cell.font) cell.font = { name: "Aptos", size: 11 };
        if (cell.type === ExcelJS.ValueType.Formula)
          cell.font = {
            name: "Aptos",
            size: 11,
            color: {
              argb: [
                "P&L",
                "Balance Sheet",
                "Cash Flow",
                "Scenario Comparison",
                "Checks",
                "Daily Cash and PL",
              ].includes(s.name)
                ? "FF1B1D22"
                : "FF2B7661",
            },
          };
        if (
          typeof cell.value === "number" ||
          cell.type === ExcelJS.ValueType.Formula
        )
          cell.numFmt = cell.numFmt || fmt;
        cell.alignment = { vertical: "middle", wrapText: false };
      });
    });
    s.pageSetup = {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
  }
  definitions.eachRow((r, n) => {
    if (n > 1) {
      r.height = 45;
      r.getCell(2).alignment = { wrapText: true, vertical: "middle" };
    }
  });
  read.eachRow((r, n) => {
    if (n > 1) {
      r.height = 35;
      r.getCell(2).alignment = { wrapText: true, vertical: "middle" };
    }
  });
  const report = management(input, base);
  const detail = sheet("Management Review", [
    "Frozen snapshot schedule",
    "Value / reference",
    "Amount · NGN",
    "Status / context",
  ]);
  detail.addRow([
    "Basis",
    "These schedules are frozen evidence from the selected scenario. Workbook what-if edits recalculate the existing financial model, not this review appendix.",
  ]);
  detail.addRow([
    "Runway",
    report.cash.runway,
    report.cash.gap / 100,
    "Required reserve gap including opening cash",
  ]);
  for (const b of report.budgets)
    detail.addRow(["Budget", `${b.period} ${b.name}`, b.budget / 100, b.note]);
  for (const c of report.costs)
    detail.addRow([
      "Cost schedule",
      c.name,
      c.cash_paid / 100,
      `${c.category}; ${c.start_date} to ${c.end_date}`,
    ]);
  for (const f of report.funding)
    detail.addRow(["Funding", f.name, f.amount_minor / 100, f.status]);
  for (const u of report.uses)
    detail.addRow([
      "Use of funds",
      u.milestone,
      u.amount_minor / 100,
      `${u.funding} / ${u.cost}`,
    ]);
  for (const a of report.actions)
    detail.addRow([
      "CFO action",
      a.description,
      null,
      `${a.owner}; ${a.due_date}; ${a.status}`,
    ]);
  detail.columns.forEach((c, i) => {
    c.width = [28, 65, 24, 65][i];
  });
  detail.eachRow((row, n) => {
    if (n > 1) {
      row.height = 42;
      row.eachCell((c) => {
        c.alignment = { wrapText: true, vertical: "middle" };
      });
      row.getCell(3).numFmt = fmt;
    }
  });
  return wb.xlsx.writeBuffer();
}
