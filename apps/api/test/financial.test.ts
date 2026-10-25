import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FinanceStore } from "../src/domain";
import { FinancialService } from "../src/financial/service";
import { calculate, Input } from "../src/financial/engine";
import { defaults, Event, Resource } from "../src/financial/types";
import { exportFinancialWorkbook } from "../src/financial/workbook";
import ExcelJS from "exceljs";
import { createFinanceApp } from "../src/main";
import { BookkeepingService } from "../src/bookkeeping";

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-model-"));
  const s = new FinanceStore(join(dir, "test.db"), "empty");
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const a = s.actor("finance"),
    f = new FinancialService(s);
  f.workspace(a, "ng");
  const save = (kind: string, data: any, id?: string, revision = 0) =>
    f.save(a, "ng", { kind, data, id, revision, request_key: randomUUID() });
  return { s, a, f, save };
}
function pure(): Input {
  return {
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
  };
}
const resource = (id: string, kind: any, data: any): Resource => ({
  id,
  kind,
  data,
  revision: 1,
  archived: false,
  updated_at: "2026-10-25",
});
const event = (x: Partial<Event>): Event => ({
  source_id: "ops",
  external_id: randomUUID(),
  revision: 1,
  type: "booking",
  date: "2026-12-01",
  service_id: "chauffeur",
  driver_id: "driver-1",
  customer_id: "customer-1",
  price_id: "chauffeur-fee",
  status: "completed",
  amount_minor: 100000,
  currency: "NGN",
  coverage_end: null,
  related_id: "",
  reference: "",
  account: null,
  offset_account: null,
  available_hours: null,
  job_hours: null,
  match_minutes: null,
  campaign_id: "",
  audience: null,
  invoice_payment_id: "",
  note: "",
  ...x,
});
const assumption = (overrides: any = {}) => ({
  name: "Car subscribers",
  scenario_id: "base",
  service_id: "car",
  price_id: "car-month",
  initial_paying: 10,
  new_drivers_daily: 0,
  activation: 1,
  paid_conversion: 1,
  renewal: 1,
  daily_purchase_rate: 1,
  jobs_per_driver: 1,
  available_hours: 8,
  hours_per_job: 1,
  average_booking_minor: 100000,
  direct_cost_per_job_minor: 100,
  collection_delay: 0,
  launch_delay: 0,
  source: "test",
  confidence: "estimate",
  ...overrides,
});

test("pilot defaults contain confirmed prices, no synthetic activity or received funding", (t) => {
  const { f, a } = fixture(t);
  const w = f.workspace(a, "ng");
  assert.equal(w.result.end, "2027-02-28");
  assert.equal(w.result.daily.length, 90);
  assert.equal(w.events.length, 0);
  assert.equal(w.result.summary.closing_cash, 0);
  assert.equal(w.result.complete, false);
  assert.equal(
    w.resources.find((r) => r.id === "car-month")?.data.amount_minor,
    2000000,
  );
});
test("resource saves are retry safe, revision guarded and entity/role scoped", (t) => {
  const { f, a, s } = fixture(t);
  const v = {
    kind: "scenario",
    revision: 0,
    data: { name: "Stress", description: "", source: "test" },
    request_key: randomUUID(),
  };
  const r = f.save(a, "ng", v);
  assert.equal(f.save(a, "ng", v).id, r.id);
  assert.throws(
    () => f.save(a, "ng", { ...v, data: { ...v.data, name: "Other" } }),
    /reused/,
  );
  assert.throws(
    () => f.save(a, "ng", { ...v, id: r.id, request_key: randomUUID() }),
    /changed/,
  );
  assert.throws(() => f.workspace(a, "inc"), /NGN/);
  assert.throws(() => f.save({ ...a, role: "auditor" }, "ng", v), /role/);
  assert.equal(s.all("SELECT * FROM fm_history").length, 1);
});
test("cloning scenarios copies their assumptions without changing actuals", (t) => {
  const { f, a, save } = fixture(t);
  save("assumption", assumption());
  const clone = f.action(a, "ng", "base", {
    action: "clone",
    revision: 1,
    request_key: randomUUID(),
  });
  assert.equal(
    f
      .workspace(a, "ng", clone.id)
      .resources.filter(
        (r) => r.kind === "assumption" && r.data.scenario_id === clone.id,
      ).length,
    1,
  );
});
test("funding changes cash and equity, never revenue; missing plan is not cash", () => {
  const i = pure();
  i.resources.push(
    resource("fund", "funding", {
      name: "Pilot",
      date: "2026-12-01",
      amount_minor: 6500000000,
      kind: "equity",
      status: "planned",
    }),
  );
  const m = calculate(i);
  assert.equal(m.summary.closing_cash, 6500000000);
  assert.equal(m.summary.revenue, 0);
  assert.equal(m.summary.financing_cash, 6500000000);
  assert.equal(m.summary.balance_check, 0);
  assert.equal(
    calculate(i, "base", 6000000000).summary.closing_cash,
    6000000000,
  );
});
test("subscription cash and coverage across day 90 leave deferred revenue", () => {
  const i = pure();
  i.resources[0].data.cutoff = "2027-02-28";
  const sub = event({
    external_id: "sub",
    type: "subscription",
    date: "2027-02-20",
    service_id: "car",
    price_id: "car-month",
    amount_minor: 2000000,
    coverage_end: "2027-03-20",
    status: "paid",
  });
  i.events = [
    sub,
    event({
      external_id: "receipt",
      type: "collection",
      date: sub.date,
      related_id: "sub",
      amount_minor: 2000000,
    }),
  ];
  const m = calculate(i);
  assert.equal(m.summary.revenue, Math.round((2000000 * 9) / 28));
  assert.equal(m.closing.deferred_revenue, -(2000000 - m.summary.revenue));
  assert.equal(m.closing.cash, 2000000);
  assert.equal(m.summary.balance_check, 0);
});
test("booking gross value is not platform revenue, driver funds are restricted", () => {
  const i = pure();
  i.resources[0].data.cutoff = "2026-12-10";
  i.events = [
    event({ external_id: "job" }),
    event({ type: "collection", external_id: "paid", related_id: "job" }),
  ];
  const m = calculate(i);
  assert.equal(m.summary.revenue, 15000);
  assert.equal(m.closing.cash, 15000);
  assert.equal(m.closing.restricted_cash, 85000);
  assert.equal(m.closing.settlements, -85000);
  assert.equal(m.summary.balance_check, 0);
});
test("subscription refund reverses future earned coverage without negative deferred revenue", () => {
  const i = pure();
  i.resources[0].data.cutoff = "2027-02-28";
  i.events = [
    event({
      external_id: "s",
      type: "subscription",
      service_id: "car",
      price_id: "car-month",
      amount_minor: 310000,
      coverage_end: "2027-01-01",
      status: "paid",
    }),
    event({ type: "collection", related_id: "s", amount_minor: 310000 }),
    event({
      type: "refund",
      date: "2026-12-16",
      related_id: "s",
      amount_minor: 155000,
    }),
  ];
  const m = calculate(i);
  assert.equal(m.summary.revenue, 155000);
  assert.equal(m.closing.deferred_revenue, 0);
  assert.equal(m.closing.cash, 155000);
  assert.equal(m.summary.balance_check, 0);
});
test("prepaid rent spreads expense, capex cash is investing, financing remains separate", () => {
  const i = pure();
  i.resources.push(
    resource("rent", "cost", {
      name: "Rent",
      scenario_id: "base",
      service_id: "",
      category: "prepayment",
      amount_minor: 900000,
      start_date: "2026-12-01",
      end_date: "2027-02-28",
      pay_date: "2026-12-01",
      cadence: "once",
      useful_life_months: 12,
    }),
    resource("laptop", "cost", {
      name: "Laptop",
      scenario_id: "base",
      service_id: "",
      category: "capex",
      amount_minor: 120000,
      start_date: "2026-12-01",
      end_date: "2026-12-01",
      pay_date: "2026-12-01",
      cadence: "once",
      useful_life_months: 12,
    }),
  );
  const m = calculate(i);
  assert.equal(m.summary.overhead, 900000);
  assert.equal(m.closing.prepayments, 0);
  assert.equal(m.summary.investing_cash, -120000);
  assert.equal(m.summary.operating_cash, -900000);
  assert.equal(m.summary.balance_check, 0);
  assert.ok(m.daily.every((d) => d.cash_check === 0));
});
test("posted ledger cost is included once, payments settle payable only", () => {
  const i = pure();
  i.resources[0].data.cutoff = "2026-12-10";
  i.ledger = [
    {
      date: "2026-12-01",
      account: "6100",
      type: "expense",
      amount: 10000,
      source: "j1",
      description: "Cost",
    },
    {
      date: "2026-12-01",
      account: "2100",
      type: "liability",
      amount: -10000,
      source: "j1",
      description: "Cost",
    },
    {
      date: "2026-12-05",
      account: "2100",
      type: "liability",
      amount: 10000,
      source: "j2",
      description: "Payment",
    },
    {
      date: "2026-12-05",
      account: "1100",
      type: "asset",
      amount: -10000,
      source: "j2",
      description: "Payment",
    },
  ];
  const m = calculate(i);
  assert.equal(m.summary.overhead, 10000);
  assert.equal(m.closing.payables, 0);
  assert.equal(m.closing.cash, -10000);
  assert.equal(m.summary.balance_check, 0);
});
test("forecast plans recognize real month lengths and all daily cash identities", () => {
  const i = pure();
  i.resources.push(resource("a", "assumption", assumption()));
  const m = calculate(i);
  assert.equal(m.summary.revenue, 60000000);
  assert.equal(m.summary.direct_cost, 90000);
  assert.equal(m.closing.deferred_revenue, 0);
  assert.ok(m.daily.every((d) => d.balance_check === 0 && d.cash_check === 0));
});
test("capacity limits completed jobs and incomplete assumptions do not fabricate activity", () => {
  const i = pure();
  i.resources.push(
    resource(
      "a",
      "assumption",
      assumption({
        jobs_per_driver: 100,
        available_hours: 2,
        hours_per_job: 1,
      }),
    ),
  );
  const m = calculate(i);
  assert.equal(m.operating[0].jobs, 20);
  i.resources.at(-1)!.data.initial_paying = null;
  assert.equal(calculate(i).operating.length, 0);
});
test("mature retention denominators exclude young cohorts and incomplete coverage", () => {
  const i = pure();
  i.resources[0].data.cutoff = "2026-12-31";
  i.resources[0].data.operating_data_complete_through = "2026-12-31";
  i.events = [
    event({ date: "2026-12-01" }),
    event({ date: "2026-12-30" }),
    event({ date: "2026-12-20", customer_id: "new" }),
  ];
  const m = calculate(i);
  assert.deepEqual((m.pmf.cohorts[0] as any).d30, {
    eligible: 1,
    retained: 1,
    rate: 1,
  });
  assert.equal((m.pmf.cohorts[0] as any).d60.rate, null);
});
test("CSV preview, acceptance, retries and historical prices remain stable", (t) => {
  const { f, a, save } = fixture(t);
  save(
    "source",
    {
      name: "Operations",
      method: "csv",
      coverage_through: null,
      status: "unconfigured",
      cursor: "",
      source: "test",
    },
    "ops",
  );
  const e = event({ external_id: "job" });
  const p = f.preview(a, "ng", { rows: [e], request_key: randomUUID() });
  assert.equal(p.errors.length, 0);
  const accepted = f.accept(a, "ng", p.id, { request_key: randomUUID() });
  assert.equal(accepted.inserted, 1);
  const p2 = f.preview(a, "ng", { rows: [e], request_key: randomUUID() });
  assert.equal(
    f.accept(a, "ng", p2.id, { request_key: randomUUID() }).duplicates,
    1,
  );
  const price = f
    .workspace(a, "ng")
    .resources.find((r) => r.id === "chauffeur-fee")!;
  assert.throws(
    () => save("price", { ...price.data, rate: 0.2 }, price.id, price.revision),
    /Clone/,
  );
});
test("failed import is atomic, duplicate IDs and overlapping coverage are rejected", (t) => {
  const { f, a, save } = fixture(t);
  save(
    "source",
    {
      name: "Ops",
      method: "csv",
      coverage_through: null,
      status: "unconfigured",
      cursor: "",
      source: "test",
    },
    "ops",
  );
  const sub = event({
    type: "subscription",
    external_id: "s1",
    service_id: "car",
    price_id: "car-month",
    coverage_end: "2027-01-01",
  });
  const p = f.preview(a, "ng", {
    rows: [sub, { ...sub, external_id: "s2" }],
    request_key: randomUUID(),
  });
  assert.ok(p.errors.length > 0);
  assert.throws(
    () => f.accept(a, "ng", p.id, { request_key: randomUUID() }),
    /overlap/,
  );
  assert.equal(f.workspace(a, "ng").events.length, 0);
});
test("immutable snapshots retain original inputs after subsequent changes", (t) => {
  const { f, a, save } = fixture(t);
  const snap = f.snapshot(a, "ng", {
    name: "Original",
    kind: "budget",
    scenario_id: "base",
    request_key: randomUUID(),
  });
  save("funding", {
    name: "Pilot",
    date: "2026-12-01",
    amount_minor: 6500000000,
    kind: "equity",
    status: "planned",
    reference: "",
    source: "test",
  });
  assert.equal(f.snapshotData(a, "ng", snap.id).result.summary.closing_cash, 0);
  assert.equal(f.workspace(a, "ng").result.summary.closing_cash, 6500000000);
});
test("Excel contains linked formulas, scenario controls and frozen metadata", async () => {
  const i = pure();
  i.resources.push(
    resource("a", "assumption", assumption({ launch_delay: 88 })),
  );
  const bytes = await exportFinancialWorkbook(i, "test-snapshot", "base");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  assert.equal(
    wb.getWorksheet("Read Me")!.getCell("B2").value,
    "test-snapshot",
  );
  assert.equal(wb.getWorksheet("Read Me")!.getCell("B4").value, "base");
  assert.ok(wb.getWorksheet("Daily Cash and PL")!.getCell("B2").formula);
  assert.ok(
    wb
      .getWorksheet("Financial Flows")!
      .getColumn(8)
      .values.some(
        (v) => typeof v === "object" && v !== null && "formula" in v,
      ),
  );
  assert.ok(wb.getWorksheet("Scenario Comparison")!.getCell("B2").formula);
});

test("partial subscription refund before cutoff reconciles every kobo through later forecast", () => {
  const i = pure();
  i.resources[0].data.cutoff = "2026-12-17";
  i.events = [
    event({
      external_id: "sub",
      type: "subscription",
      service_id: "car",
      price_id: "car-month",
      coverage_end: "2027-01-01",
      amount_minor: 2000000,
    }),
    event({ type: "collection", related_id: "sub", amount_minor: 2000000 }),
    event({
      type: "refund",
      related_id: "sub",
      date: "2026-12-16",
      amount_minor: 10001,
    }),
  ];
  const m = calculate(i);
  assert.equal(m.closing.deferred_revenue, 0);
  assert.equal(m.summary.revenue, 1989999);
  assert.ok(m.daily.every((d) => d.balance_check === 0 && d.cash_check === 0));
});
test("existing recorded payable settles in forecast without repeating the expense", (t) => {
  const { f, a, s } = fixture(t);
  const b = new BookkeepingService(s);
  b.record(a, {
    entity_id: "ng",
    kind: "expense",
    description: "Committed hosting",
    payee: "QA vendor",
    category: "Operations",
    department: "Operations",
    amount_minor: 100000,
    date: "2026-10-01",
    due_date: "2026-12-10",
    reference: "QA-obligation",
    request_key: randomUUID(),
  });
  const w = f.workspace(a, "ng");
  assert.equal(w.result.opening.payables, -100000);
  assert.equal(w.result.closing.payables, 0);
  assert.equal(w.result.summary.overhead, 0);
  assert.equal(w.result.summary.operating_cash, -100000);
  assert.equal(w.result.summary.balance_check, 0);
});
test("source revisions cannot void a parent with unsettled dependent receipts", (t) => {
  const { f, a, save } = fixture(t);
  save(
    "source",
    {
      name: "Ops",
      method: "csv",
      coverage_through: null,
      status: "unconfigured",
      cursor: "",
      source: "test",
    },
    "ops",
  );
  const parent = event({ external_id: "booking" }),
    receipt = event({
      type: "collection",
      external_id: "receipt",
      related_id: "booking",
    });
  const first = f.preview(a, "ng", {
    rows: [parent, receipt],
    request_key: randomUUID(),
  });
  assert.equal(first.errors.length, 0);
  f.accept(a, "ng", first.id, { request_key: randomUUID() });
  const revision = f.preview(a, "ng", {
    rows: [{ ...parent, revision: 2, status: "void" }],
    request_key: randomUUID(),
  });
  assert.ok(
    revision.errors.some((e) => e.message.includes("missing or voided")),
  );
  assert.throws(
    () => f.accept(a, "ng", revision.id, { request_key: randomUUID() }),
    /missing or voided/,
  );
  assert.equal(
    f.workspace(a, "ng").events.find((e) => e.external_id === "booking")!
      .revision,
    1,
  );
});
test("financial HTTP endpoints enforce sessions and return a usable adapter contract", async (t) => {
  const { s } = fixture(t),
    app = await createFinanceApp(s);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const url = await app.getUrl();
  assert.equal(
    (await fetch(`${url}/api/financial/workspace?entity=ng`)).status,
    401,
  );
  const session = s.login("finance");
  const headers = {
    cookie: `jaye_session=${session.token}`,
    "Content-Type": "application/json",
  };
  const contract = await fetch(`${url}/api/financial/contract?entity=ng`, {
    headers,
  });
  assert.equal(contract.status, 200);
  const body = await contract.json();
  assert.equal(body.money_unit, "integer kobo");
  assert.ok(body.schema.properties.external_id);
  const save = await fetch(`${url}/api/financial/resources?entity=ng`, {
    headers,
    method: "POST",
    body: JSON.stringify({
      kind: "scenario",
      revision: 0,
      data: { name: "HTTP QA", description: "", source: "test" },
      request_key: randomUUID(),
    }),
  });
  assert.equal(save.status, 201);
  assert.equal(
    (await fetch(`${url}/api/financial/workspace?entity=inc`, { headers }))
      .status,
    400,
  );
});

test("existing paid coverage renews at expiry rather than billing again at forecast cutoff", () => {
  const i = pure();
  i.resources[0].data.cutoff = "2026-12-10";
  i.events = [
    event({
      external_id: "existing",
      type: "subscription",
      service_id: "car",
      price_id: "car-month",
      coverage_end: "2027-01-01",
      amount_minor: 2000000,
    }),
    event({
      type: "collection",
      related_id: "existing",
      amount_minor: 2000000,
    }),
  ];
  i.resources.push(
    resource("a", "assumption", assumption({ initial_paying: 1 })),
  );
  const m = calculate(i);
  assert.equal(m.summary.revenue, 6000000);
  assert.equal(m.closing.deferred_revenue, 0);
  assert.equal(m.operating[0].drivers, 1);
  assert.equal(
    m.flows
      .filter(
        (f) =>
          f.status === "forecast" &&
          f.debit === "cash" &&
          f.credit === "receivables" &&
          f.date < "2027-01-01",
      )
      .reduce((n, f) => n + f.amount, 0),
    0,
  );
});

test("draft import revisions preserve history and are retry safe", (t) => {
  const { f, a, save } = fixture(t);
  save(
    "source",
    {
      name: "Operations",
      method: "csv",
      coverage_through: null,
      status: "unconfigured",
      cursor: "",
      source: "test",
    },
    "ops",
  );
  const row = event({ external_id: "draft-job" });
  const first = f.preview(a, "ng", { rows: [row], request_key: randomUUID() });
  assert.equal(f.readImport(a, "ng", first.id).status, "draft");
  const input = {
    rows: [{ ...row, amount_minor: 200000 }],
    request_key: randomUUID(),
  };
  const next = f.replaceDraft(a, "ng", first.id, input);
  assert.equal(f.replaceDraft(a, "ng", first.id, input).id, next.id);
  assert.equal(f.readImport(a, "ng", first.id).status, "superseded");
  assert.equal(
    f.accept(a, "ng", next.id, { request_key: randomUUID() }).inserted,
    1,
  );
  assert.throws(
    () =>
      f.replaceDraft(a, "ng", next.id, { ...input, request_key: randomUUID() }),
    /Only draft/,
  );
});

test("archived active scenario falls back and the final scenario cannot be removed", (t) => {
  const { f, a } = fixture(t);
  for (const id of ["base", "conservative"])
    f.action(a, "ng", id, {
      action: "archive",
      revision: 1,
      request_key: randomUUID(),
    });
  assert.equal(f.workspace(a, "ng", "base").result.scenario_id, "aggressive");
  assert.throws(
    () =>
      f.action(a, "ng", "aggressive", {
        action: "archive",
        revision: 1,
        request_key: randomUUID(),
      }),
    /at least one/,
  );
});

test("campaign attribution does not create a second expense or cash payment", () => {
  const input = pure();
  input.resources.find((r) => r.kind === "config")!.data.cutoff = "2026-12-02";
  input.events = [
    event({
      type: "campaign",
      external_id: "campaign",
      audience: "customer",
      amount_minor: 100000,
    }),
  ];
  const result = calculate(input, "base");
  assert.equal(result.summary.operating_cash, 0);
  assert.equal(
    result.daily.reduce((n, d) => n + d.marketing, 0),
    0,
  );
  assert.ok(result.warnings.some((w) => w.includes("Campaign attribution")));
});

test("custom financial ranges are inclusive, preserve the legacy 90-day default and handle leap dates", () => {
  const input = pure();
  assert.equal(calculate(input).daily.length, 90);
  const config = input.resources.find((r) => r.kind === "config")!.data;
  Object.assign(config, {
    start_date: "2028-02-28",
    end_date: "2028-03-01",
    cutoff: "2028-02-27",
  });
  let result = calculate(input);
  assert.deepEqual(
    result.daily.map((d) => d.date),
    ["2028-02-28", "2028-02-29", "2028-03-01"],
  );
  assert.deepEqual(
    result.checkpoints.map((c) => c.day),
    [3],
  );
  assert.equal(result.monthly.length, 2);
  config.end_date = config.start_date;
  assert.equal(calculate(input).daily.length, 1);
  config.end_date = "2029-02-27";
  assert.equal(calculate(input).daily.length, 366);
  config.end_date = "2029-02-28";
  assert.throws(() => calculate(input), /1–366/);
});
test("custom date range saves reject reversed ranges and preserve frozen original budgets", (t) => {
  const { f, a, save } = fixture(t),
    before = f.workspace(a, "ng"),
    config = before.resources.find((r) => r.kind === "config")!;
  const snap = f.snapshot(a, "ng", {
    name: "Original 90 days",
    kind: "budget",
    scenario_id: "base",
    request_key: randomUUID(),
  });
  assert.throws(
    () =>
      save(
        "config",
        { ...config.data, end_date: "2026-11-01" },
        config.id,
        config.revision,
      ),
    /1–366/,
  );
  save(
    "config",
    { ...config.data, end_date: "2026-12-31" },
    config.id,
    config.revision,
  );
  const after = f.workspace(a, "ng");
  assert.equal(after.result.daily.length, 31);
  assert.ok(after.variance_note?.includes("different calendar"));
  assert.equal(f.snapshotData(a, "ng", snap.id).result.daily.length, 90);
});
test("custom-range workbook rows, monthly totals and final balances cover the selected period", async () => {
  for (const end of ["2026-12-01", "2026-12-15", "2027-04-15"]) {
    const input = pure();
    input.resources.find((r) => r.kind === "config")!.data.end_date = end;
    const result = calculate(input),
      last = result.daily.length + 1;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await exportFinancialWorkbook(input, "custom-range", "base")) as any,
    );
    assert.equal(wb.getWorksheet("Daily Cash and PL")!.rowCount, last);
    assert.equal(
      wb.getWorksheet("Daily Cash and PL")!.getCell(`A${last}`).value,
      end,
    );
    assert.equal(
      wb.getWorksheet("Checks")!.getCell("B2").formula,
      `'Daily Cash and PL'!R${last}`,
    );
    assert.equal(
      wb.getWorksheet("P&L")!.getCell(2, result.monthly.length + 2).formula,
      `SUM('Daily Cash and PL'!B2:B${last})`,
    );
    assert.equal(
      wb.getWorksheet("Balance Sheet")!.columnCount,
      result.checkpoints.length + 2,
    );
  }
});
