import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { FinanceStore } from "../src/domain";
import { BookkeepingService } from "../src/bookkeeping";
import { MonthlyExpenseService } from "../src/monthly-expenses";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-monthly-"));
  const s = new FinanceStore(join(dir, "test.db"), "empty");
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    s,
    m: new MonthlyExpenseService(s),
    b: new BookkeepingService(s),
    a: s.actor("finance"),
  };
}
async function source() {
  const w = new ExcelJS.Workbook(),
    l = w.addWorksheet("Ledger"),
    b = w.addWorksheet("Budget"),
    s = w.addWorksheet("Settings");
  w.addWorksheet("Contributions").getCell("A1").value = "Do not import";
  s.getCell("C4").value = 1347;
  l.getRow(4).values = [
    "Date",
    "Month",
    "In / Out",
    "Category",
    "Person / Vendor",
    "Paid from",
    "Currency",
    "Amount",
    "FX",
  ];
  l.getRow(5).values = [
    "",
    "June",
    "Out",
    "Software & Tools",
    "Hosting",
    "Company",
    "USD",
    100,
  ];
  l.getRow(6).values = [
    "",
    "June",
    "In",
    "Contribution - Operations",
    "Founder",
    "",
    "USD",
    null,
  ];
  b.getRow(4).values = [
    "Item",
    "Category",
    "Currency",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  b.getRow(5).values = ["Hosting", "Software & Tools", "USD", 100, 200];
  b.getRow(6).values = ["Unmapped", "", "NGN", 110000];
  return Buffer.from(await w.xlsx.writeBuffer());
}
const record = (extra: any = {}) => ({
  entity_id: "ng",
  kind: "expense",
  description: "Monthly hosting",
  payee: "Hosting",
  category: "Cloud & software",
  department: "Product",
  amount_minor: 10000,
  date: "2026-06-15",
  due_date: "2026-06-15",
  request_key: randomUUID(),
  ...extra,
});
test("import preserves raw source, excludes Contributions, is retry safe and stages uncertain rows without posting", async (t) => {
  const { m, s, a } = fixture(t),
    file = await source();
  const p = await m.preview(a, "ng", file, "CRM.xlsx", 2026);
  assert.equal(p.rows.length, 5);
  assert.equal(p.rows[0].data.amount_minor, 13470000);
  assert.equal(p.rows[0].data.date, "");
  assert.equal(
    p.source.some((r) => r.sheet === "Contributions"),
    false,
  );
  assert.equal((await m.stage(a, "ng", file, "CRM.xlsx", 2026)).added, 5);
  assert.equal((await m.stage(a, "ng", file, "renamed.xlsx", 2026)).added, 0);
  assert.equal(s.all("SELECT * FROM journals").length, 0);
  const r = m.report(a, "ng", "2026-06-01", "2026-06-30");
  assert.equal(r.actual_minor, 0);
  assert.equal(r.historical_review_minor, 13470000);
  assert.equal(r.cash_paid_minor, 0);
  assert.equal(r.outstanding_minor, 0);
  assert.equal(m.applyBudgets(a, "ng").applied, 2);
  assert.equal(
    m.rows(a, "ng").find((r) => r.data.description === "Unmapped")!.status,
    "review",
  );
  assert.equal(m.applyBudgets(a, "ng").applied, 0);
});
test("verified historical expenses require real dates, confirmed payment state and reconciled FX; links prevent duplicates", async (t) => {
  const { m, s, a } = fixture(t);
  await m.stage(a, "ng", await source(), "CRM.xlsx", 2026);
  let row = m.rows(a, "ng").find((r) => r.kind === "expense")!;
  assert.throws(
    () =>
      m.review(a, "ng", row.id, {
        revision: 0,
        action: "post",
        reason: "Review complete",
      }),
    /actual expense date/,
  );
  assert.throws(
    () =>
      m.review(a, "ng", row.id, {
        revision: 0,
        action: "post",
        reason: "Review complete",
        data: { date: "2026-06-15" },
      }),
    /paid or unpaid/,
  );
  row = m.review(a, "ng", row.id, {
    revision: 0,
    action: "post",
    reason: "Invoice and bank evidence checked",
    data: {
      date: "2026-06-15",
      payment_status: "paid",
      payment_date: "2026-07-02",
      payment_reference: "HIST-1",
    },
  });
  assert.equal(row.status, "posted");
  assert.equal(s.all("SELECT * FROM bookkeeping_records").length, 1);
  const june = m.report(a, "ng", "2026-06-01", "2026-06-30");
  assert.equal(june.actual_minor, 13470000);
  assert.equal(june.cash_paid_minor, 0);
  assert.equal(june.outstanding_minor, 13470000);
  const july = m.report(a, "ng", "2026-07-01", "2026-07-31");
  assert.equal(july.actual_minor, 0);
  assert.equal(july.cash_paid_minor, 13470000);
  assert.equal(july.outstanding_minor, 0);
  assert.equal(july.historical_review_minor, 0);
  assert.throws(
    () =>
      m.review(a, "ng", row.id, {
        revision: row.revision,
        action: "post",
        reason: "Retry",
      }),
    /audited correction/,
  );
});
test("monthly actuals, dated partial payments and refunds reconcile to Excel and category filters", async (t) => {
  const { m, b, a } = fixture(t);
  const r = b.record(a, record());
  b.pay(a, r.id, {
    amount_minor: 6000,
    date: "2026-07-02",
    reference: "PART-1",
    method: "Cash",
    request_key: randomUUID(),
  });
  const june = m.report(a, "ng", "2026-06-01", "2026-06-30");
  assert.equal(june.actual_minor, 10000);
  assert.equal(june.outstanding_minor, 10000);
  const july = m.report(a, "ng", "2026-07-01", "2026-07-31");
  assert.equal(july.cash_paid_minor, 6000);
  assert.equal(july.outstanding_minor, 4000);
  assert.equal(
    m.report(a, "ng", "2026-06-01", "2026-06-30", "Marketing").actual_minor,
    0,
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    (await m.workbook(a, "ng", "2026-06-01", "2026-06-30")) as any,
  );
  assert.equal(wb.getWorksheet("Monthly Summary")!.getCell("B9").value, 100);
  assert.equal(wb.getWorksheet("Expense Detail")!.getCell("F2").value, 100);
  assert.equal(
    wb.getWorksheet("Budget vs Actual")!.getCell("B2").value,
    "Not set",
  );
});
test("month close blocks posting, reopening is audited, and unauthorized users cannot import", async (t) => {
  const { m, b, s, a } = fixture(t);
  b.record(a, record());
  m.close(a, "ng", {
    period: "2026-06",
    status: "closed",
    note: "Reviewed all recorded expenses",
  });
  assert.throws(
    () => b.record(a, record({ description: "late invoice" })),
    /period/i,
  );
  m.close(a, "ng", {
    period: "2026-06",
    status: "open",
    note: "Late invoice received",
  });
  b.record(a, record({ description: "late invoice" }));
  assert.equal(
    s.all("SELECT * FROM audit WHERE action='expense_month.open'").length,
    1,
  );
  const auditor = { ...a, role: "auditor" };
  await assert.rejects(
    m.stage(auditor, "ng", await source(), "CRM.xlsx", 2026),
  );
  assert.throws(
    () => m.report(a, "ng", "2026-02-30", "2026-03-01"),
    /valid range/,
  );
  assert.throws(() =>
    m.report({ ...a, entities: [] }, "ng", "2026-06-01", "2026-06-30"),
  );
});
test("corrections retain original department attribution and refunds reduce the refund month only", (t) => {
  const { m, b, a } = fixture(t);
  let r = b.record(a, record());
  r = b.correct(a, "record", r.id, {
    revision: 0,
    request_key: randomUUID(),
    reason: "Correct department allocation",
    amount_minor: 10000,
    date: "2026-06-15",
    department: "Marketing",
  });
  assert.equal(
    m.report(a, "ng", "2026-06-01", "2026-06-30", "", "Product").actual_minor,
    0,
  );
  assert.equal(
    m.report(a, "ng", "2026-06-01", "2026-06-30", "", "Marketing").actual_minor,
    10000,
  );
  b.pay(a, r.id, {
    amount_minor: 10000,
    date: "2026-06-20",
    reference: "FULL",
    method: "Cash",
    request_key: randomUUID(),
  });
  b.refund(a, r.id, {
    amount_minor: 3000,
    date: "2026-07-05",
    reference: "REF-1",
    method: "Cash",
    reason: "Partial refund received",
    request_key: randomUUID(),
  });
  assert.equal(
    m.report(a, "ng", "2026-06-01", "2026-06-30").actual_minor,
    10000,
  );
  const july = m.report(
    a,
    "ng",
    "2026-07-01",
    "2026-07-31",
    "Cloud & software",
    "Marketing",
  );
  assert.equal(july.actual_minor, -3000);
  assert.equal(july.cash_paid_minor, -3000);
  assert.equal(july.outstanding_minor, 0);
  assert.equal(
    july.trend.find((r) => r.period === "2026-06").actual_minor,
    10000,
  );
});
test("HTTP upload, source archive and filtered export require authentication and preserve entity boundaries", async (t) => {
  const { s } = fixture(t);
  const { createFinanceApp } = await import("../src/main");
  const app = await createFinanceApp(s);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const root = (await app.getUrl()) + "/api";
  assert.equal(
    (
      await fetch(
        root + "/expenses/monthly?entity=ng&from=2026-06-01&to=2026-06-30",
      )
    ).status,
    401,
  );
  const headers = { cookie: `jaye_session=${s.login("finance").token}` };
  const f = new FormData();
  f.set("file", new Blob([new Uint8Array(await source())]), "CRM.xlsx");
  const upload = await fetch(
    root + "/expenses/imports/stage?entity=ng&year=2026",
    { method: "POST", headers, body: f },
  );
  assert.equal(upload.status, 201);
  const batch = await upload.json();
  const archive = await fetch(
    root + `/expenses/imports/source/${batch.id}?entity=ng`,
    { headers },
  );
  assert.equal(archive.status, 200);
  assert.equal(
    (await archive.json()).source.some((r: any) => r.sheet === "Contributions"),
    false,
  );
  assert.equal(
    (
      await fetch(root + `/expenses/imports/source/${batch.id}?entity=inc`, {
        headers,
      })
    ).status,
    404,
  );
  const excel = await fetch(
    root +
      "/expenses/monthly.xlsx?entity=ng&from=2026-06-01&to=2026-06-30&category=Marketing",
    { headers },
  );
  assert.equal(excel.status, 200);
  assert.match(excel.headers.get("content-type") || "", /spreadsheet/);
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(Buffer.from(await excel.arrayBuffer()) as any);
  assert.equal(w.getWorksheet("Expense Detail")!.rowCount, 1);
});
test("budget conflicts preserve existing plans; review revisions and existing-record links prevent duplicate posting", async (t) => {
  const { m, b, s, a } = fixture(t);
  await m.stage(a, "ng", await source(), "CRM.xlsx", 2026);
  const { BudgetService } = await import("../src/budgets");
  new BudgetService(s).save(a, {
    entity_id: "ng",
    period: "2026-06",
    category: "Cloud & software",
    department: "Operations",
    amount_minor: 50000,
    request_key: randomUUID(),
  });
  const applied = m.applyBudgets(a, "ng");
  assert.equal(applied.applied, 1);
  assert.equal(applied.conflicts.length, 1);
  assert.equal(
    s.get("SELECT amount_minor FROM budgets WHERE period='2026-06'")
      .amount_minor,
    50000,
  );
  const row = m.rows(a, "ng").find((r) => r.kind === "expense")!;
  const existing = b.record(
    a,
    record({ department: "Operations", amount_minor: 13470000 }),
  );
  assert.throws(
    () =>
      m.review(a, "ng", row.id, {
        action: "post",
        revision: 0,
        reason: "Historical invoice confirmed",
        data: { date: "2026-06-15", payment_status: "unpaid" },
      }),
    /duplicate/,
  );
  const linked = m.review(a, "ng", row.id, {
    action: "link",
    revision: 0,
    reason: "Matched the existing invoice",
    target_id: existing.id,
  });
  assert.equal(linked.target_id, existing.id);
  assert.equal(s.all("SELECT * FROM bookkeeping_records").length, 1);
  assert.equal(
    m.report(a, "ng", "2026-06-01", "2026-06-30").historical_review_minor,
    0,
  );
  const unresolved = m
    .rows(a, "ng")
    .find((r) => r.kind === "budget" && r.status === "review")!;
  m.review(a, "ng", unresolved.id, {
    action: "save",
    revision: 0,
    reason: "Reviewed mapping",
  });
  assert.throws(
    () =>
      m.review(a, "ng", unresolved.id, {
        action: "exclude",
        revision: 0,
        reason: "Stale update",
      }),
    /changed/,
  );
});
