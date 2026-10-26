import fs from "node:fs/promises";
import assert from "node:assert/strict";
const { FileBlob, SpreadsheetFile } = await import(
  process.env.JAYE_ARTIFACT_MODULE || "@oai/artifact-tool"
);
const dir = process.env.JAYE_QA_DIR || "/tmp/jaye-management-validation";
const expected = JSON.parse(
  await fs.readFile(`${dir}/expected.json`, "utf8"),
).base;
const wb = await SpreadsheetFile.importXlsx(
  await FileBlob.load(`${dir}/investor.xlsx`),
);
wb.recalculate();
const col = String.fromCharCode(66 + expected.monthly.length);
const near = (a, b) =>
  assert.ok(typeof a === "number" && Math.abs(a - b) < 0.005, `${a} != ${b}`);
for (const [row, key] of [
  [2, "revenue"],
  [8, "ebitda"],
  [13, "net_income"],
])
  near(
    wb.worksheets.getItem("Financial Performance").getRange(`${col}${row}`)
      .values[0][0],
    expected.summary[key] / 100,
  );
for (const [row, key] of [
  [7, "revenue"],
  [8, "ebitda"],
  [9, "net_income"],
])
  near(
    wb.worksheets.getItem("Investor Summary").getRange(`B${row}`).values[0][0],
    expected.summary[key] / 100,
  );
for (const [row, key] of [
  [2, "operating_cash"],
  [3, "investing_cash"],
  [4, "financing_cash"],
])
  near(
    wb.worksheets.getItem("Cash Flow").getRange(`${col}${row}`).values[0][0],
    expected.summary[key] / 100,
  );
near(wb.worksheets.getItem("Balance Sheet").getRange("C17").values[0][0], 0);
const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!",
  options: { useRegex: true, maxResults: 20 },
});
console.log(JSON.stringify({ parity: "passed", errors: errors.ndjson }));
for (const [name, range] of [
  ["Investor Summary", "A1:B20"],
  ["Financial Performance", `A1:${col}13`],
  ["Cash Flow", `A1:${col}4`],
  ["Balance Sheet", "A1:C17"],
  ["Service Contribution", "A1:E6"],
  ["Pricing", "A1:F8"],
]) {
  const png = await wb.render({
    sheetName: name,
    range,
    scale: 1.5,
    format: "png",
  });
  await fs.writeFile(
    `${dir}/investor-${name}.png`,
    new Uint8Array(await png.arrayBuffer()),
  );
}
const review = await SpreadsheetFile.importXlsx(
  await FileBlob.load(`${dir}/model.xlsx`),
);
review.recalculate();
const png = await review.render({
  sheetName: "Management Review",
  range: "A1:D8",
  scale: 1.5,
  format: "png",
});
await fs.writeFile(
  `${dir}/management-review.png`,
  new Uint8Array(await png.arrayBuffer()),
);
