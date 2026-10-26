import ExcelJS from "exceljs";
// Privacy boundary: explicit aggregate allowlist. Never serialize input records,
// free-text names, notes, source IDs, counterparties or driver/customer detail.
export async function exportInvestorWorkbook(snapshot: any) {
  const r = snapshot.result,
    input = snapshot.input;
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Investor Summary", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  wb.creator = "Jaye Finance";
  wb.calcProperties.fullCalcOnLoad = true;
  const fmt = '#,##0.00;(#,##0.00);"—"';
  const add = (name: string, headers: string[], rows: any[][]) => {
    const s =
      wb.getWorksheet(name) ||
      wb.addWorksheet(name, {
        views: [{ state: "frozen", ySplit: 1 }],
      });
    s.addRow(headers);
    s.addRows(rows);
    s.columns.forEach((c, i) => (c.width = i === 0 ? 40 : 24));
    s.getRow(1).font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
      name: "Aptos",
      size: 11,
    };
    s.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2B7661" },
    };
    s.getRow(1).height = 34;
    s.eachRow((row, n) => {
      if (n > 1) row.height = 24;
      row.eachCell((c) => {
        if (n > 1) c.font = { name: "Aptos", size: 11 };
        c.alignment = { vertical: "middle", wrapText: true };
        if (typeof c.value === "number" || c.type === ExcelJS.ValueType.Formula)
          c.numFmt = fmt;
      });
    });
    s.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
    return s;
  };
  const months = r.monthly,
    keys = [
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
    ];
  const p = add(
    "Financial Performance",
    ["NGN", ...months.map((m: any) => m.period), "Period total"],
    keys.map((k) => [
      k.replaceAll("_", " "),
      ...months.map((m: any) => m[k] / 100),
    ]),
  );
  keys.forEach((k, i) => {
    const row = i + 2,
      last = months.length + 1;
    const col = p.getColumn(last).letter;
    p.getCell(row, last + 1).value = {
      formula: `SUM(B${row}:${col}${row})`,
      result: r.summary[k] / 100,
    };
  });
  const cf = add(
    "Cash Flow",
    ["NGN", ...months.map((m: any) => m.period), "Period total"],
    ["operating_cash", "investing_cash", "financing_cash"].map((k) => [
      k.replaceAll("_", " "),
      ...months.map((m: any) => m[k] / 100),
    ]),
  );
  ["operating_cash", "investing_cash", "financing_cash"].forEach((k, i) => {
    const row = i + 2,
      last = months.length + 1;
    cf.getCell(row, last + 1).value = {
      formula: `SUM(B${row}:${cf.getColumn(last).letter}${row})`,
      result: r.summary[k] / 100,
    };
  });
  const bsKeys = [
    "cash",
    "restricted_cash",
    "receivables",
    "prepayments",
    "deposits",
    "fixed_assets",
    "accumulated_depreciation",
    "payables",
    "deferred_revenue",
    "settlements",
    "tax_payable",
    "debt",
    "equity",
    "retained_earnings",
  ];
  const balance = add(
    "Balance Sheet",
    ["NGN · debit positive", "Opening", "Closing"],
    bsKeys
      .map((k) => [
        k.replaceAll("_", " "),
        r.opening[k] / 100,
        r.closing[k] / 100,
      ])
      .concat([
        ["Period earnings (equity)", 0, -r.summary.net_income / 100],
        ["Balance check", 0, r.summary.balance_check / 100],
      ]),
  );
  const summary = add(
    "Investor Summary",
    ["Jaye · investor draft", "Value"],
    [
      [
        "Status",
        "DRAFT — internal review required. Not an approved investor publication.",
      ],
      ["Period", `${r.start} to ${r.end}`],
      ["Actual cutoff", r.cutoff],
      ["Model version", r.version],
      ["Currency", "NGN"],
      ["Revenue", r.summary.revenue / 100],
      ["EBITDA", r.summary.ebitda / 100],
      ["Net income", r.summary.net_income / 100],
      ["Closing unrestricted cash", r.summary.closing_cash / 100],
      [
        "Funding gap",
        Math.max(
          0,
          (input.resources.find((x: any) => x.kind === "config")?.data
            .minimum_cash_minor || 0) -
            Math.min(r.opening.cash, r.summary.minimum_cash),
        ) / 100,
      ],
      ["Restricted cash", r.closing.restricted_cash / 100],
      ["Model warnings", r.warnings.length],
      [
        "Basis",
        "Frozen aggregate snapshot. Totals use formulas; change operational assumptions in the app and export a new snapshot.",
      ],
      [
        "Limitations",
        "Missing operating evidence, tax applicability or funding receipts can change results. Forecast figures are not audited actuals.",
      ],
      [
        "Privacy",
        "No transaction records, personal identifiers, payroll detail, internal commentary or source credentials included.",
      ],
      ["Synchronization", "Workbook edits do not update Jaye."],
    ],
  );
  summary.getColumn(2).width = 95;
  summary.eachRow((row, n) => {
    if ([2, 14, 15, 16, 17].includes(n)) row.height = 42;
  });
  const totalColumn = p.getColumn(months.length + 2).letter;
  for (const [summaryRow, statementRow, key] of [
    [7, 2, "revenue"],
    [8, 8, "ebitda"],
    [9, 13, "net_income"],
  ] as const)
    summary.getCell(summaryRow, 2).value = {
      formula: `'Financial Performance'!${totalColumn}${statementRow}`,
      result: r.summary[key] / 100,
    };
  summary.addRow([
    "Scenario",
    ["base", "conservative", "aggressive"].includes(r.scenario_id)
      ? r.scenario_id
      : "Custom scenario",
  ]);
  summary.addRow(["Captured", r.captured_at]);
  summary.addRow(["Snapshot", snapshot.id || "QA export"]);
  summary.getCell("B13").numFmt = "0";
  balance.getCell("C16").value = {
    formula: `-'Financial Performance'!${totalColumn}13`,
    result: -r.summary.net_income / 100,
  };
  balance.getCell("B17").value = { formula: "SUM(B2:B16)", result: 0 };
  balance.getCell("C17").value = {
    formula: "SUM(C2:C16)",
    result: r.summary.balance_check / 100,
  };
  const serviceLabels: Record<string, string> = {
    car: "Car",
    keke: "Keke",
    bike: "Bike",
    chauffeur: "Chauffeur",
    courier: "Courier",
  };
  add(
    "Service Contribution",
    [
      "Service",
      "Revenue · NGN",
      "Direct costs · NGN",
      "Gross contribution · NGN",
      "Allocated overhead · NGN",
    ],
    r.services.map((s: any, i: number) => [
      serviceLabels[s.id] || `Service ${i + 1}`,
      s.revenue / 100,
      s.direct_cost / 100,
      s.gross_profit / 100,
      s.allocated_overhead / 100,
    ]),
  );
  add(
    "Pricing",
    [
      "Service",
      "Mode",
      "Amount · NGN",
      "Rate",
      "Effective from",
      "Effective to",
    ],
    input.resources
      .filter((x: any) => x.kind === "price" && !x.archived)
      .map((x: any) => [
        serviceLabels[x.data.service_id] || "Other service",
        x.data.mode,
        x.data.amount_minor == null
          ? x.data.mode === "percent"
            ? "Not applicable"
            : "Unconfirmed"
          : x.data.amount_minor / 100,
        x.data.rate == null
          ? x.data.mode === "percent"
            ? "Unconfirmed"
            : "Not applicable"
          : x.data.rate,
        x.data.effective_from,
        x.data.effective_to || "Open ended",
      ]),
  ).getColumn(4).numFmt = "0.0%";
  // Traction: aggregate weekly momentum and PMF evidence. No identifiers.
  const pmf = r.pmf;
  const rate = (v: number | null) => (v === null ? "Not measurable" : v);
  const d30 = (pmf.cohorts as any[]).reduce(
    (a, c) => ({
      eligible: a.eligible + c.d30.eligible,
      retained: a.retained + c.d30.retained,
    }),
    { eligible: 0, retained: 0 },
  );
  const traction = add(
    "Traction",
    [
      "Week",
      "From",
      "To",
      "Coverage complete",
      "New drivers",
      "Paying drivers",
      "Paying driver growth",
      "Active drivers",
      "Completed jobs",
      "Fulfilment",
      "Jobs per paying driver-day",
      "Gross bookings · NGN",
    ],
    (pmf.weekly as any[]).map((w) => [
      w.week,
      w.from,
      w.to,
      w.complete ? "Yes" : "No",
      w.new_drivers,
      w.paying_drivers,
      rate(w.paying_driver_growth),
      w.active_drivers,
      w.completed_jobs,
      rate(w.fulfilment),
      rate(w.jobs_per_paying_driver_day),
      w.gross_bookings / 100,
    ]),
  );
  traction.eachRow((row, n) => {
    if (n === 1) return;
    for (const c of [1, 5, 6, 8, 9]) row.getCell(c).numFmt = "0";
    for (const c of [7, 10]) row.getCell(c).numFmt = "0.0%";
    row.getCell(11).numFmt = "0.00";
  });
  const evidence = [
    ["Observed through", r.cutoff],
    [
      "Coverage complete through",
      pmf.complete_through || "Not set",
    ],
    ["Paying drivers (latest week)", pmf.growth.latest_paying_drivers],
    ["Driver renewal rate", rate(pmf.renewal.rate)],
    ["Driver renewal sample (eligible plans)", pmf.renewal.eligible],
    [
      "Customer D30 retention",
      d30.eligible ? d30.retained / d30.eligible : "Not measurable",
    ],
    ["Customer D30 sample (eligible customers)", d30.eligible],
    ["Booking fulfilment", rate(pmf.fulfilment)],
    [
      "Jobs per paying driver-day",
      rate(pmf.utilisation.jobs_per_paying_driver_day),
    ],
    [
      "Subscription burden (median)",
      rate(pmf.utilisation.subscription_burden_median),
    ],
    [
      "Driver CAC payback (months)",
      pmf.payback.driver.payback_months === null
        ? "Not measurable"
        : pmf.payback.driver.payback_months,
    ],
    ["Driver CAC payback maturity", pmf.payback.driver.maturity],
    [
      "PMF basis",
      "Observed records only. Cohort, renewal and growth figures use complete coverage. Early payback is a direction signal, not mature LTV.",
    ],
  ];
  const firstEvidence = summary.rowCount + 1;
  for (const row of evidence) summary.addRow(row);
  for (const n of [
    firstEvidence + 3,
    firstEvidence + 5,
    firstEvidence + 7,
    firstEvidence + 9,
  ])
    summary.getCell(n, 2).numFmt = "0.0%";
  for (const n of [firstEvidence + 2, firstEvidence + 4, firstEvidence + 6])
    summary.getCell(n, 2).numFmt = "0";
  summary.getCell(firstEvidence + 8, 2).numFmt = "0.00";
  summary.getCell(firstEvidence + 10, 2).numFmt = "0.0";
  summary.getRow(firstEvidence + 12).height = 42;
  for (const s of wb.worksheets) {
    s.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
    s.eachRow((row, n) => {
      if (n > 1)
        row.eachCell((cell) => {
          cell.font = { name: "Aptos", size: 11 };
          if (cell.type === ExcelJS.ValueType.Formula) {
            cell.numFmt = fmt;
            cell.alignment = { vertical: "middle", horizontal: "right" };
          }
        });
    });
  }
  return wb.xlsx.writeBuffer();
}
