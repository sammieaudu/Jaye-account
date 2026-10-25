import fs from "node:fs/promises";
import assert from "node:assert/strict";
// Set JAYE_ARTIFACT_MODULE to an installed @oai/artifact-tool entry point when it is not on Node's module path.
const { FileBlob, SpreadsheetFile } = await import(
  process.env.JAYE_ARTIFACT_MODULE || "@oai/artifact-tool"
);
const root = process.env.JAYE_QA_DIR || "/tmp/jaye-fm-validation";
const cases = ["conservative", "base", "aggressive"];
const findings = [];
for (const dir of process.env.JAYE_QA_DATASETS?.split(",") || [
  root,
  `${root}/mixed`,
]) {
  const wb = await SpreadsheetFile.importXlsx(
    await FileBlob.load(`${dir}/model.xlsx`),
  );
  const expected = JSON.parse(
    await fs.readFile(`${dir}/expected.json`, "utf8"),
  );
  const dayRow = expected.base.daily.length + 1,
    monthCount = expected.base.monthly.length;
  const column = (n) => String.fromCharCode(64 + n);
  const totalColumn = column(monthCount + 2);
  const near = (value, expected, label) =>
    assert.ok(
      typeof value === "number" && Math.abs(value - expected) < 0.005,
      `${dir} ${label}: ${value} != ${expected}`,
    );
  for (const scenario of cases) {
    wb.worksheets.getItem("Read Me").getRange("B4").values = [[scenario]];
    wb.recalculate();
    const pnl = wb.worksheets
      .getItem("P&L")
      .getRange(`B2:${totalColumn}12`).values;
    const cash = wb.worksheets
      .getItem("Daily Cash and PL")
      .getRange(`M${dayRow}:S${dayRow}`).values[0];
    const cf = wb.worksheets
      .getItem("Cash Flow")
      .getRange("B2:B7")
      .values.flat();
    const e = expected[scenario];
    near(pnl[0][monthCount], e.summary.revenue / 100, "revenue");
    near(pnl[10][monthCount], e.summary.net_income / 100, "profit");
    near(cash[0], e.summary.closing_cash / 100, "cash");
    near(cash[5], 0, "balance");
    e.monthly.forEach((m, i) => {
      near(pnl[0][i], m.revenue / 100, `monthly revenue ${m.period}`);
      near(pnl[10][i], m.net_income / 100, `monthly profit ${m.period}`);
    });
    near(cf[0], e.summary.operating_cash / 100, "operating cash");
    near(cf[1], e.summary.investing_cash / 100, "investing cash");
    near(cf[2], e.summary.financing_cash / 100, "financing cash");
    near(cf[5], 0, "cash reconciliation");
  }
  wb.worksheets.getItem("Read Me").getRange("B4").values = [["base"]];
  const assumptionRow =
    wb.worksheets
      .getItem("Assumptions")
      .getRange("A2:A4")
      .values.flat()
      .indexOf("assumption-base") + 2;
  const priceRow =
    wb.worksheets
      .getItem("Services and Pricing")
      .getRange("A2:A8")
      .values.flat()
      .indexOf("car-month") + 2;
  const costRow =
    wb.worksheets
      .getItem("Costs and Funding")
      .getRange("A2:A4")
      .values.flat()
      .indexOf("cost") + 2;
  wb.worksheets.getItem("Assumptions").getRange(`D${assumptionRow}`).values = [
    [15],
  ];
  wb.worksheets
    .getItem("Services and Pricing")
    .getRange(`D${priceRow}`).values = [[3000000]];
  wb.worksheets.getItem("Costs and Funding").getRange(`J${costRow}`).values = [
    [2],
  ];
  wb.recalculate();
  const edited = JSON.parse(
    await fs.readFile(`${dir}/expected-edited.json`, "utf8"),
  );
  near(
    wb.worksheets.getItem("P&L").getRange(`${totalColumn}2`).values[0][0],
    edited.summary.revenue / 100,
    "edited revenue",
  );
  near(
    wb.worksheets.getItem("P&L").getRange(`${totalColumn}12`).values[0][0],
    edited.summary.net_income / 100,
    "edited profit",
  );
  near(
    wb.worksheets.getItem("Daily Cash and PL").getRange(`M${dayRow}`)
      .values[0][0],
    edited.summary.closing_cash / 100,
    "edited cash",
  );
  const errors = await wb.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!",
    options: { useRegex: true, maxResults: 20 },
    summary: "Formula error scan",
  });
  findings.push({
    dataset: dir,
    scenarios: "3 passed",
    monthly: "all passed",
    inputEdits: "volume, price and quantity passed",
    errors: errors.ndjson,
  });
  console.log(JSON.stringify(findings.at(-1)));
  if (dir.endsWith("/mixed") || process.env.JAYE_QA_RENDER === "1") {
    for (const name of [
      "Read Me",
      "Assumptions",
      "Services and Pricing",
      "Costs and Funding",
      "Actuals",
      "Operations",
      "Financial Flows",
      "Opening Balances",
      "Daily Accounts",
      "Daily Cash and PL",
      "P&L",
      "Balance Sheet",
      "Cash Flow",
      "Scenario Comparison",
      "PMF and Cohorts",
      "Definitions and Warnings",
      "Checks",
    ]) {
      const region =
        name === "Read Me"
          ? "A1:B11"
          : name === "P&L"
            ? `A1:${totalColumn}12`
            : name === "Balance Sheet"
              ? `A1:${column(expected.base.checkpoints.length + 2)}17`
              : name === "Definitions and Warnings"
                ? "A1:B10"
                : "A1:F7";
      const blob = await wb.render({
        sheetName: name,
        range: region,
        scale: 1,
      });
      await fs.writeFile(
        `${dir}/${name.replaceAll("/", "-")}.png`,
        new Uint8Array(await blob.arrayBuffer()),
      );
    }
  }
}
await fs.writeFile(
  `${root}/parity-results.json`,
  JSON.stringify(findings, null, 2),
);
