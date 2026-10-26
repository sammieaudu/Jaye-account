import { createFinanceApp } from "../src/main";
import { eventSchema } from "../src/financial/types";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { defaults, Resource, resourceSchemas } from "../src/financial/types";
import { calculate, Input } from "../src/financial/engine";
import {
  management,
  compareSnapshots,
  sensitivities,
} from "../src/financial/management";
import { FinancialService } from "../src/financial/service";
import { FinanceStore } from "../src/domain";
import { exportInvestorWorkbook } from "../src/financial/investor-workbook";
import { exportFinancialWorkbook } from "../src/financial/workbook";
const input = (): Input => ({
  resources: defaults().map((r) => ({
    ...r,
    revision: 1,
    archived: false,
    updated_at: "2026-10-25",
  })),
  events: [],
  ledger: [],
  pending: [],
  invoiceReceipts: [],
  captured_at: "2026-10-25T12:00:00Z",
});
function add(i: Input, id: string, kind: any, data: any) {
  i.resources.push({
    id,
    kind,
    data,
    revision: 1,
    archived: false,
    updated_at: i.captured_at,
  });
}
const cost = (extra: any = {}) => ({
  name: "Analyst",
  scenario_id: "base",
  service_id: "",
  category: "payroll",
  department: "Finance",
  amount_minor: 100000,
  quantity: 2,
  start_date: "2026-12-01",
  end_date: "2027-02-28",
  pay_date: "2026-12-01",
  cadence: "monthly",
  useful_life_months: 36,
  owner: "CFO",
  source: "QA",
  ...extra,
});
const fund = (extra: any = {}) => ({
  name: "Pilot equity",
  date: "2026-12-01",
  amount_minor: 1000000,
  kind: "equity",
  status: "committed",
  reference: "",
  source: "QA",
  ...extra,
});
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-management-"));
  const s = new FinanceStore(join(dir, "test.db"), "empty");
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const f = new FinancialService(s),
    a = s.actor("finance");
  f.workspace(a, "ng");
  const save = (kind: string, data: any, id?: string, revision = 0) =>
    f.save(a, "ng", { kind, data, id, revision, request_key: randomUUID() });
  return { s, f, a, save };
}
test("management reconciles headcount, costs, funding and opening reserve without duplicating flows", () => {
  const i = input();
  i.resources[0].data.minimum_cash_minor = 50000;
  add(i, "payroll", "cost", cost());
  add(i, "fund", "funding", fund());
  const before = JSON.stringify(i);
  const r = calculate(i),
    m = management(i, r);
  assert.equal(m.hiring[0].recognised, 600000);
  assert.equal(m.hiring[0].cash_paid, 600000);
  assert.equal(m.cash.closing, 400000);
  assert.equal(m.cash.gap, 50000);
  assert.equal(m.cash.shortfall, "2026-12-01");
  assert.equal(m.funding_totals.committed, 1000000);
  assert.equal(m.funding_totals.confirmed, 0);
  assert.equal(m.cash.break_even, null);
  assert.equal(JSON.stringify(i), before);
  assert.ok(m.checks.every((x) => x.amount === 0));
});
test("budget mapping flags missing, ambiguous and partial periods, never adds expenses", () => {
  const i = input();
  add(i, "payroll", "cost", cost());
  i.budgets = [
    {
      id: "b",
      period: "2026-12",
      department: "Finance",
      category: "payroll",
      amount_minor: 300000,
      actual_minor: 0,
      archived: 0,
    },
  ];
  const r = calculate(i);
  assert.equal(management(i, r).budgets[0].projected, null);
  add(i, "link", "budget_link", { budget_id: "b", cost_id: "payroll" });
  let m = management(i, calculate(i));
  assert.equal(m.budgets[0].forecast, 200000);
  assert.equal(m.budgets[0].remaining, 100000);
  assert.equal(calculate(i).summary.net_income, r.summary.net_income);
  i.resources[0].data.cutoff = "2026-12-15";
  assert.match(management(i, calculate(i)).budgets[0].note, /Partial/);
  i.resources[0].data.cutoff = "2026-11-30";
  i.budgets.push({ ...i.budgets[0], id: "b2" });
  add(i, "link2", "budget_link", { budget_id: "b2", cost_id: "payroll" });
  assert.match(management(i, calculate(i)).budgets[0].note, /Ambiguous/);
});
test("revision bridge sums exactly to EBITDA change and periods must match", () => {
  const i = input();
  add(i, "payroll", "cost", cost());
  const old = calculate(i);
  i.resources.find((x) => x.id === "payroll")!.data.quantity = 3;
  const current = calculate(i),
    c = compareSnapshots(old, current);
  assert.equal(c.comparable, true);
  assert.equal(
    c.bridge.reduce((n, x) => n + x.impact, 0),
    current.summary.ebitda - old.summary.ebitda,
  );
  assert.equal(c.rows.find((x) => x.metric === "payroll")!.percent, 0.5);
  i.resources[0].data.end_date = "2027-02-27";
  assert.equal(compareSnapshots(old, calculate(i)).comparable, false);
});
test("operating sensitivities preserve originals and do not alter observed ledger costs", () => {
  const i = input();
  add(i, "payroll", "cost", cost());
  const before = JSON.stringify(i);
  const cases = sensitivities(i, "base");
  assert.equal(JSON.stringify(i), before);
  assert.equal(
    cases.find((x) => x.name === "Operating costs +10%")!.net_income,
    -660000,
  );
  assert.equal(
    cases.find((x) => x.name === "Pricing −10%")!.net_income,
    -600000,
  );
});
test("planning records enforce references, funding caps, revisions and immutable review submissions", (t) => {
  const { s, f, a, save } = fixture(t);
  const c = save("cost", cost()),
    funding = save("funding", fund());
  const allocation = save("funding_use", {
    name: "People",
    cost_id: c.id,
    funding_id: funding.id,
    amount_minor: 800000,
    milestone: "Pilot team",
    owner: "CFO",
    due_date: "2026-12-01",
    source: "QA",
  });
  assert.throws(
    () => save("funding", fund({ amount_minor: 700000 }), funding.id, 1),
    /Reduce funding allocations/,
  );
  assert.throws(
    () =>
      save("funding_use", {
        ...allocation.data,
        name: "More",
        amount_minor: 300000,
      }),
    /exceed/,
  );
  assert.throws(
    () =>
      save("budget_link", {
        name: "Wrong entity",
        cost_id: c.id,
        budget_id: "missing",
        source: "QA",
      }),
    /Unknown budget/,
  );
  const snap = f.snapshot(a, "ng", {
    name: "Baseline",
    kind: "forecast",
    scenario_id: "base",
    request_key: randomUUID(),
  });
  const draft = save("report_draft", {
    name: "Investor update",
    snapshot_id: snap.id,
    description: "Evidence",
    disclosures: "Provisional",
    audience: "investor",
    source: "QA",
  });
  const req = { id: draft.id, revision: 1, request_key: randomUUID() };
  const submitted = f.submitReport(a, "ng", req);
  assert.equal(f.submitReport(a, "ng", req).id, submitted.id);
  save("report_draft", { ...draft.data, description: "Revised" }, draft.id, 1);
  assert.throws(
    () => f.submitReport(a, "ng", { ...req, request_key: randomUUID() }),
    /Reload/,
  );
  assert.match(
    s.get("SELECT data FROM fm_report_submissions WHERE id=?", submitted.id)
      .data,
    /Evidence/,
  );
  assert.throws(
    () =>
      s.run(
        "UPDATE fm_report_submissions SET name=? WHERE id=?",
        "Changed",
        submitted.id,
      ),
    /immutable/,
  );
  assert.equal(s.get("SELECT COUNT(*) n FROM journals").n, 0);
  assert.equal(f.workspace(a, "ng").report_submissions.length, 1);
});
test("tax policies require evidence for reviewed status without inventing tax amounts", () => {
  assert.throws(
    () =>
      resourceSchemas.tax_policy.parse({
        name: "VAT",
        treatment: "applicable",
        effective_from: "2026-01-01",
        effective_to: null,
        rate: null,
        reviewed: true,
        reviewer: "",
        evidence: "",
        source: "",
        description: "",
      }),
    /require/,
  );
  const i = input();
  add(i, "tax-policy", "tax_policy", {
    name: "Pending tax review",
    rate: null,
    reviewed: false,
  });
  assert.equal(calculate(i).summary.tax, 0);
  assert.equal(management(i, calculate(i)).tax.policies[0].rate, null);
});
test("investor export contains only allowed aggregates, formulas reconcile and management appendix is explicit", async () => {
  const i = input();
  add(
    i,
    "private-cost",
    "cost",
    cost({
      name: "SECRET-PERSON",
      owner: "SECRET-EMAIL",
      source: "SECRET-BANK",
    }),
  );
  add(i, "fund", "funding", fund());
  add(i, "private-action", "action_item", {
    name: "SECRET-ACTION",
    description: "SECRET-NOTE",
    owner: "SECRET-EMAIL",
    due_date: "2026-12-01",
    status: "open",
  });
  const r = calculate(i);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    (await exportInvestorWorkbook({ input: i, result: r })) as any,
  );
  assert.equal(wb.worksheets.length, 7);
  assert.ok(wb.getWorksheet("Traction"));
  assert.equal(
    wb.getWorksheet("Pricing")!.getCell("C7").value,
    "Not applicable",
  );
  assert.equal(wb.getWorksheet("Pricing")!.getCell("C8").value, "Unconfirmed");
  assert.equal(
    wb.getWorksheet("Investor Summary")!.getCell("B7").result,
    r.summary.revenue / 100,
  );
  const serialized = JSON.stringify(wb.model);
  assert.ok(!serialized.includes("SECRET-"));
  assert.ok(!serialized.includes("private-cost"));
  const pnl = wb.getWorksheet("Financial Performance")!;
  assert.equal(pnl.getCell("E13").result, r.summary.net_income / 100);
  assert.equal(pnl.getCell("E13").formula, "SUM(B13:D13)");
  const managementBook = new ExcelJS.Workbook();
  await managementBook.xlsx.load(
    (await exportFinancialWorkbook(i, "test", "base")) as any,
  );
  assert.match(
    String(
      managementBook.getWorksheet("Management Review")!.getCell("B2").value,
    ),
    /frozen/,
  );
});

test("pricing sensitivities freeze historical terms even when legacy events lack price snapshots", () => {
  const i = input();
  i.resources[0].data.cutoff = "2026-12-01";
  i.events.push(
    eventSchema.parse({
      source_id: "qa",
      external_id: "booking",
      revision: 1,
      type: "booking",
      date: "2026-12-01",
      service_id: "chauffeur",
      driver_id: "d",
      customer_id: "c",
      price_id: "chauffeur-fee",
      status: "completed",
      amount_minor: 100000,
      currency: "NGN",
    }),
  );
  const base = calculate(i);
  assert.equal(base.summary.revenue, 15000);
  assert.equal(
    sensitivities(i, "base").find((x) => x.name === "Pricing −10%")!.revenue,
    base.summary.revenue,
  );
});
test("report and investor draft HTTP routes enforce authentication and investor isolation", async (t) => {
  const { s, f, a, save } = fixture(t);
  s.run(
    "INSERT INTO users(id,name,role,entities) VALUES(?,?,?,?)",
    "qa-investor",
    "QA investor",
    "investor",
    JSON.stringify(["ng"]),
  );
  s.run(
    "INSERT INTO users(id,name,role,entities) VALUES(?,?,?,?)",
    "qa-auditor",
    "QA auditor",
    "auditor",
    JSON.stringify(["ng"]),
  );
  const snap = f.snapshot(a, "ng", {
    name: "QA",
    kind: "forecast",
    scenario_id: "base",
    request_key: randomUUID(),
  });
  const draft = save("report_draft", {
    name: "QA",
    snapshot_id: snap.id,
    description: "Draft",
    disclosures: "Provisional",
    audience: "investor",
    source: "QA",
  });
  const app = await createFinanceApp(s);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const root = await app.getUrl();
  const url =
    root + `/api/financial/snapshots/${snap.id}/investor-excel?entity=ng`;
  assert.equal((await fetch(url)).status, 401);
  const headers = (id: string) => ({
    cookie: `jaye_session=${s.login(id).token}`,
    "Content-Type": "application/json",
  });
  assert.equal(
    (await fetch(url, { headers: headers("qa-investor") })).status,
    403,
  );
  const exported = await fetch(url, { headers: headers("finance") });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type")!, /spreadsheetml/);
  assert.equal(
    (
      await fetch(url.replace("entity=ng", "entity=inc"), {
        headers: headers("finance"),
      })
    ).status,
    400,
  );
  const body = JSON.stringify({
    id: draft.id,
    revision: draft.revision,
    request_key: randomUUID(),
  });
  assert.equal(
    (
      await fetch(root + "/api/financial/reports/submit?entity=ng", {
        method: "POST",
        headers: headers("qa-auditor"),
        body,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(root + "/api/financial/reports/submit?entity=ng", {
        method: "POST",
        headers: headers("finance"),
        body,
      })
    ).status,
    201,
  );
});

test("mapping restores validate caps and action CRUD survives a database reopen", (t) => {
  const { s, f, a, save } = fixture(t);
  const c = save("cost", cost()),
    funding = save("funding", fund());
  const allocation = save("funding_use", {
    name: "Allocation",
    cost_id: c.id,
    funding_id: funding.id,
    amount_minor: 800000,
    milestone: "Pilot",
    owner: "CFO",
    due_date: "2026-12-01",
    source: "QA",
  });
  f.action(a, "ng", allocation.id, {
    action: "archive",
    revision: 1,
    request_key: randomUUID(),
  });
  save("funding", fund({ amount_minor: 700000 }), funding.id, 1);
  assert.throws(
    () =>
      f.action(a, "ng", allocation.id, {
        action: "restore",
        revision: 2,
        request_key: randomUUID(),
      }),
    /exceed/,
  );
  save("funding", fund(), funding.id, 2);
  f.action(a, "ng", allocation.id, {
    action: "restore",
    revision: 2,
    request_key: randomUUID(),
  });
  const action = save("action_item", {
    name: "Review",
    description: "Check evidence",
    owner: "CFO",
    due_date: "2026-12-01",
    status: "open",
    priority: "high",
    evidence: "QA",
    source: "QA",
  });
  save("action_item", { ...action.data, status: "resolved" }, action.id, 1);
  const path = s.get("PRAGMA database_list").file;
  const reopened = new FinanceStore(path, "empty");
  assert.equal(
    new FinancialService(reopened)
      .resources("ng")
      .find((r) => r.id === action.id)!.data.status,
    "resolved",
  );
  reopened.db.close();
  f.action(a, "ng", action.id, {
    action: "delete",
    revision: 2,
    request_key: randomUUID(),
  });
  assert.ok(!f.resources("ng").some((r) => r.id === action.id));
  assert.equal(f.history(a, "ng", action.id).resources.length, 2);
});
test("investor aggregate totals cover one-day and leap-year horizons", async () => {
  for (const [start, end, count] of [
    ["2028-02-29", "2028-02-29", 1],
    ["2028-01-01", "2028-12-31", 12],
  ] as const) {
    const i = input();
    Object.assign(i.resources[0].data, {
      start_date: start,
      end_date: end,
      cutoff: "2027-12-31",
    });
    const r = calculate(i),
      wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await exportInvestorWorkbook({ input: i, result: r })) as any,
    );
    const p = wb.getWorksheet("Financial Performance")!;
    assert.equal(p.columnCount, count + 2);
    assert.equal(p.getCell(13, count + 2).result, r.summary.net_income / 100);
    assert.equal(wb.worksheets[0].name, "Investor Summary");
  }
});
