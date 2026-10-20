import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FinanceStore } from "../src/domain";
import { BookkeepingService } from "../src/bookkeeping";
import { ReportingService } from "../src/reporting";
import { createFinanceApp } from "../src/main";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-bookkeeping-"));
  const s = new FinanceStore(join(dir, "test.db"), "empty");
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { s, b: new BookkeepingService(s), a: s.actor("finance") };
}
const person = {
  entity_id: "ng",
  name: "Test Accountant",
  employee_code: "EMP-001",
  department: "Finance",
  job_title: "Accountant",
  kind: "employee",
  salary_minor: 30000000,
  start_date: "2026-01-01",
};
const expense = () => ({
  entity_id: "ng",
  kind: "expense",
  description: "Office internet",
  payee: "Internet provider",
  category: "Operations",
  department: "Operations",
  amount_minor: 100000,
  date: "2026-10-01",
  due_date: "2026-10-15",
  reference: "INV-1",
  request_key: randomUUID(),
});
const payment = (n: number, ref: string) => ({
  amount_minor: n,
  date: "2026-10-15",
  reference: ref,
  method: "Bank transfer",
  request_key: randomUUID(),
});
test("salary and partial payments count cost once in ledger, reports, budget and dashboard", (t) => {
  const { s, b, a } = fixture(t);
  const e = b.saveEmployee(a, person);
  s.run(
    "INSERT INTO budgets VALUES('salary-budget','ng','Finance','Salaries','2026-10',40000000)",
  );
  const input = {
    ...expense(),
    kind: "salary",
    employee_id: e.id,
    payroll_month: "2026-10",
    amount_minor: 30000000,
    category: "Salaries",
    department: "Finance",
  };
  const r = b.record(a, input);
  assert.equal(r.outstanding_minor, 30000000);
  assert.equal(b.record(a, input).id, r.id);
  assert.throws(
    () => b.record(a, { ...input, request_key: randomUUID() }),
    /already recorded/,
  );
  const p = payment(10000000, "SAL-1");
  assert.equal(b.pay(a, r.id, p).outstanding_minor, 20000000);
  assert.equal(b.pay(a, r.id, p).paid_minor, 10000000);
  assert.throws(() => b.pay(a, r.id, payment(20000001, "TOO-MUCH")), /exceeds/);
  const final = b.pay(a, r.id, payment(20000000, "SAL-2"));
  assert.equal(final.status, "Paid");
  assert.equal(final.payments.length, 2);
  const trial = s.trialBalance(a, "ng");
  assert.equal(trial.find((x) => x.code === "6700").balance, 30000000);
  assert.equal(trial.find((x) => x.code === "2100").balance, 0);
  assert.equal(trial.find((x) => x.code === "1100").balance, -30000000);
  assert.equal(
    trial.reduce((n, r) => n + r.balance, 0),
    0,
  );
  assert.equal(s.dashboard(a, "ng").spend_minor, 30000000);
  assert.equal(s.budgets(a, "ng")[0].actual_minor, 30000000);
  const report = new ReportingService(s, () => "2026-10-20").report(a, "ng");
  assert.equal(report.totals.net_posted_cost_minor, 30000000);
  assert.equal(report.documentation_totals.outstanding_minor, 0);
  assert.equal(s.verifyAudit(), true);
});
test("company costs and personal reimbursements share a simple payment history without duplicate cost", (t) => {
  const { s, b, a } = fixture(t);
  const e = b.saveEmployee(a, { ...person, kind: "founder" });
  const r = b.record(a, { ...expense(), payment: payment(100000, "DIRECT") });
  assert.equal(r.status, "Paid");
  const personal = b.record(a, {
    ...expense(),
    reference: "INV-2",
    employee_id: e.id,
  });
  assert.equal(personal.payee, e.name);
  assert.equal(personal.outstanding_minor, 100000);
  b.pay(a, personal.id, { ...payment(40000, "REPAY-1"), method: "Cash" });
  assert.equal(b.detail(a, personal.id).outstanding_minor, 60000);
  assert.equal(
    s.trialBalance(a, "ng").find((x) => x.code === "1010").balance,
    -40000,
  );
  assert.equal(s.dashboard(a, "ng").spend_minor, 200000);
  assert.equal(s.dashboard(a, "ng").cash_minor, -140000);
  assert.equal(s.dashboard(a, "ng").record_summary.owed_minor, 60000);
  assert.throws(
    () => b.record(a, { ...expense(), request_key: randomUUID() }),
    /already recorded/,
  );
  assert.throws(
    () => b.pay(a, personal.id, payment(1000, "DIRECT")),
    /already recorded/,
  );
});
test("invalid or closed-period writes roll back, inactive and foreign employees cannot be used", (t) => {
  const { s, b, a } = fixture(t);
  const e = b.saveEmployee(a, person);
  assert.throws(
    () => b.record(a, { ...expense(), payment: payment(100001, "OVER") }),
    /exceeds/,
  );
  assert.equal(b.list(a, "ng").length, 0);
  assert.equal(s.get("SELECT count(*) AS n FROM journals").n, 0);
  s.run(
    "UPDATE periods SET status='closed' WHERE entity_id='ng' AND period='2026-10'",
  );
  assert.throws(() => b.record(a, expense()), /period is not open/);
  assert.equal(b.list(a, "ng").length, 0);
  s.run("UPDATE periods SET status='open' WHERE entity_id='ng'");
  b.saveEmployee(a, { ...person, active: false, revision: 0 }, e.id);
  assert.throws(
    () => b.saveEmployee(a, { ...person, active: true, revision: 0 }, e.id),
    /updated/,
  );
  assert.throws(
    () => b.record(a, { ...expense(), employee_id: e.id }),
    /active employee/,
  );
  const foreign = b.saveEmployee(a, { ...person, entity_id: "inc" });
  assert.throws(
    () => b.record(a, { ...expense(), employee_id: foreign.id }),
    /active employee/,
  );
  assert.throws(
    () => b.record(a, { ...expense(), amount_minor: 1.5 }),
    /amount_minor/,
  );
  assert.throws(
    () => b.record(a, { ...expense(), date: "2026-02-30" }),
    /valid date/,
  );
  assert.throws(() => b.record({ ...a, role: "employee" }, expense()), /role/);
  assert.throws(() => b.list({ ...a, entities: ["inc"] }, "ng"), /access/);
});
test("employee edits preserve historical salary records, attachments are encrypted and access controlled", (t) => {
  const { s, b, a } = fixture(t);
  const e = b.saveEmployee(a, person);
  const r = b.record(a, {
    ...expense(),
    kind: "salary",
    employee_id: e.id,
    payroll_month: "2026-10",
    amount_minor: person.salary_minor,
  });
  b.saveEmployee(
    a,
    { ...person, name: "Updated Name", salary_minor: 50000000, revision: 0 },
    e.id,
  );
  assert.equal(b.detail(a, r.id).payee, person.name);
  assert.equal(b.detail(a, r.id).amount_minor, person.salary_minor);
  const file = {
    buffer: Buffer.from("%PDF-1.4\nTest receipt"),
    mimetype: "application/pdf",
    originalname: "receipt.pdf",
  };
  const f = b.attach(a, r.id, file);
  assert.equal(b.attach(a, r.id, file).id, f.id);
  assert.equal(
    b.attachment(a, f.id).content.toString(),
    file.buffer.toString(),
  );
  assert.equal(
    Buffer.from(
      s.get("SELECT encrypted FROM record_attachments WHERE id=?", f.id)
        .encrypted,
    ).includes(file.buffer),
    false,
  );
  assert.throws(
    () => b.attachment({ ...a, entities: ["inc"] }, f.id),
    /access/,
  );
  assert.throws(
    () => b.attach(a, r.id, { ...file, mimetype: "image/png" }),
    /valid PDF/,
  );
});
test("HTTP employee, expense, salary and payment endpoints persist documentation and enforce access", async (t) => {
  process.env.JAYE_TEST = "1";
  const { s } = fixture(t);
  const app = await createFinanceApp(s);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const base = await app.getUrl();
  const login = await fetch(`${base}/api/demo/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "finance" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const call = async (path: string, input?: any) => {
    const res = await fetch(`${base}/api${path}`, {
      method: input ? "POST" : "GET",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    const value = await res.json();
    assert.equal(res.status, input ? 201 : 200, JSON.stringify(value));
    return value;
  };
  assert.equal((await fetch(`${base}/api/employees?entity=ng`)).status, 401);
  const e = await call("/employees", person);
  const r = await call("/records", {
    ...expense(),
    kind: "salary",
    employee_id: e.id,
    payroll_month: "2026-10",
    amount_minor: 30000000,
  });
  const updated = await call(
    `/records/${r.id}/payments`,
    payment(9000000, "HTTP-PAY"),
  );
  assert.equal(updated.outstanding_minor, 21000000);
  assert.equal((await call("/records?entity=ng")).length, 1);
  assert.equal(
    (await call("/reports/operations?entity=ng")).documentation_totals
      .salary_owed_minor,
    21000000,
  );
  const fixed = await call(`/records/${r.id}/correct`, {
    revision: 0,
    request_key: randomUUID(),
    reason: "Fix salary amount",
    amount_minor: 25000000,
    date: r.date,
  });
  assert.equal(fixed.outstanding_minor, 16000000);
  const payFix = {
    revision: 0,
    request_key: randomUUID(),
    reason: "Fix paid amount",
    amount_minor: 5000000,
    date: "2026-10-15",
  };
  const fixedPayment = await call(
    `/record-payments/${updated.payments[0].id}/correct`,
    payFix,
  );
  assert.equal(fixedPayment.outstanding_minor, 20000000);
  assert.equal(
    (await call(`/record-payments/${updated.payments[0].id}/correct`, payFix))
      .corrections.length,
    2,
  );
});

test("staff IDs are generated, unique and stable on edits", (t) => {
  const { b, a } = fixture(t);
  const first = b.saveEmployee(a, {
    ...person,
    employee_code: undefined,
    department: "Product",
  });
  const second = b.saveEmployee(a, { ...person, employee_code: "CUSTOM-ID" });
  assert.equal(first.employee_code, "JAYE-0001");
  assert.equal(second.employee_code, "JAYE-0002");
  const edited = b.saveEmployee(
    a,
    { ...person, employee_code: "REPLACE", revision: 0 },
    first.id,
  );
  assert.equal(edited.employee_code, first.employee_code);
});
test("cost and salary payment corrections preserve histories and keep every balance counted once", (t) => {
  const { s, b, a } = fixture(t);
  const employee = b.saveEmployee(a, person);
  const r = b.record(a, {
    ...expense(),
    kind: "salary",
    employee_id: employee.id,
    payroll_month: "2026-10",
    amount_minor: 30000000,
  });
  let paid = b.pay(a, r.id, payment(10000000, "COR-PAY"));
  const id = paid.payments[0].id;
  const input = {
    revision: 0,
    request_key: randomUUID(),
    reason: "Payment amount was mistyped",
    amount_minor: 8000000,
    date: "2026-10-15",
    reference: "COR-PAY",
    method: "Bank transfer",
  };
  paid = b.correct(a, "payment", id, input);
  assert.equal(paid.paid_minor, 8000000);
  assert.equal(paid.outstanding_minor, 22000000);
  assert.equal(b.correct(a, "payment", id, input).paid_minor, 8000000);
  assert.throws(
    () => b.correct(a, "payment", id, { ...input, request_key: randomUUID() }),
    /changed/,
  );
  const cost = b.correct(a, "record", r.id, {
    revision: 0,
    request_key: randomUUID(),
    reason: "Salary should be lower",
    amount_minor: 25000000,
    date: r.date,
    due_date: r.due_date,
  });
  assert.equal(cost.outstanding_minor, 17000000);
  assert.equal(cost.corrections.length, 2);
  const report = new ReportingService(s, () => "2026-10-20").report(a, "ng");
  assert.equal(report.totals.net_posted_cost_minor, 25000000);
  assert.equal(report.documentation_totals.paid_minor, 8000000);
  assert.equal(s.dashboard(a, "ng").spend_minor, 25000000);
  const trial = s.trialBalance(a, "ng");
  assert.equal(trial.find((x) => x.code === "2100").balance, -17000000);
  assert.equal(trial.find((x) => x.code === "1100").balance, -8000000);
  assert.equal(
    trial.reduce((n, r) => n + r.balance, 0),
    0,
  );
  assert.equal(s.verifyAudit(), true);
  assert.throws(
    () => s.run("UPDATE bookkeeping_corrections SET reason='changed'"),
    /immutable/,
  );
});
test("void payment then expense clears balances and releases the payroll month without deleting history", (t) => {
  const { s, b, a } = fixture(t);
  const employee = b.saveEmployee(a, person);
  const input = {
    ...expense(),
    kind: "salary",
    employee_id: employee.id,
    payroll_month: "2026-10",
    amount_minor: 100000,
  };
  const r = b.record(a, input);
  const p = b.pay(a, r.id, payment(100000, "VOID-PAY"));
  const change = {
    revision: 0,
    request_key: randomUUID(),
    reason: "Duplicate entered in error",
    amount_minor: 0,
    date: r.date,
  };
  assert.throws(() => b.correct(a, "record", r.id, change), /payment first/);
  assert.equal(s.get("SELECT count(*) AS n FROM bookkeeping_corrections").n, 0);
  b.correct(a, "payment", p.payments[0].id, {
    ...change,
    date: "2026-10-15",
    request_key: randomUUID(),
  });
  const final = b.correct(a, "record", r.id, change);
  assert.equal(final.status, "Voided");
  assert.equal(final.amount_minor, 0);
  assert.equal(final.original_amount_minor, 100000);
  assert.equal(final.paid_minor, 0);
  assert.equal(s.dashboard(a, "ng").spend_minor, 0);
  assert.equal(s.dashboard(a, "ng").cash_minor, 0);
  assert.throws(() => b.pay(a, r.id, payment(100, "VOID-PAY2")), /voided/);
  assert.throws(
    () =>
      b.correct(a, "record", r.id, {
        ...change,
        revision: 1,
        request_key: randomUUID(),
      }),
    /voided/,
  );
  assert.ok(b.record(a, { ...input, request_key: randomUUID() }).id);
});
test("correction validation, closed periods and permissions roll back the whole change", (t) => {
  const { s, b, a } = fixture(t);
  const r = b.record(a, expense());
  const input = {
    revision: 0,
    request_key: randomUUID(),
    reason: "Fix amount",
    amount_minor: 80000,
    date: r.date,
  };
  assert.throws(
    () => b.correct({ ...a, role: "employee" }, "record", r.id, input),
    /role/,
  );
  s.run("UPDATE periods SET status='closed' WHERE entity_id='ng'");
  assert.throws(() => b.correct(a, "record", r.id, input), /both be open/);
  assert.equal(b.detail(a, r.id).amount_minor, 100000);
  assert.equal(s.get("SELECT count(*) AS n FROM bookkeeping_corrections").n, 0);
  s.run("UPDATE periods SET status='open' WHERE entity_id='ng'");
  const corrected = b.correct(a, "record", r.id, {
    ...input,
    department: "Product",
    category: "Travel",
    date: "2026-10-02",
  });
  assert.equal(corrected.department, "Product");
  assert.equal(
    s.trialBalance(a, "ng").find((x) => x.code === "6300").balance,
    0,
  );
  assert.equal(
    s.trialBalance(a, "ng").find((x) => x.code === "6500").balance,
    80000,
  );
  assert.throws(
    () =>
      s.run("UPDATE bookkeeping_records SET amount_minor=1 WHERE id=?", r.id),
    /audited correction/,
  );
});
test("vendor directory rejects case-insensitive duplicates", (t) => {
  const { s, a } = fixture(t);
  const vendor = s.createVendor(a, {
    entity_id: "ng",
    name: "Office supplier",
    category: "Operations",
  });
  assert.ok(vendor.id);
  assert.throws(
    () =>
      s.createVendor(a, {
        entity_id: "ng",
        name: "office supplier",
        category: "Operations",
      }),
    /already saved/,
  );
});

test("automatic numbering continues existing mixed-case staff IDs", (t) => {
  const { s, b, a } = fixture(t);
  s.run(
    "INSERT INTO employees(id,entity_id,name,employee_code,department,job_title,kind,salary_minor,start_date) VALUES('existing','ng','Existing person','Jaye-001','Product','','employee',0,'2026-01-01')",
  );
  assert.equal(b.saveEmployee(a, person).employee_code, "JAYE-0002");
});

test("invoice duplicate checks ignore payee and reference capitalization on creation and correction", (t) => {
  const { s, b, a } = fixture(t);
  const first = b.record(a, expense());
  const before = new ReportingService(s).report(a, "ng").totals
    .net_posted_cost_minor;
  assert.throws(
    () =>
      b.record(a, {
        ...expense(),
        payee: " INTERNET PROVIDER ",
        reference: "inv-1",
      }),
    /already recorded/,
  );
  const second = b.record(a, { ...expense(), reference: "INV-2" });
  assert.throws(
    () =>
      b.correct(a, "record", second.id, {
        revision: second.revision,
        request_key: randomUUID(),
        reason: "Duplicate reference correction",
        amount_minor: second.amount_minor,
        date: second.date,
        payee: "internet provider",
        reference: "inv-1",
      }),
    /already recorded/,
  );
  assert.equal(b.list(a, "ng").length, 2);
  assert.equal(
    new ReportingService(s).report(a, "ng").totals.net_posted_cost_minor,
    before + second.amount_minor,
  );
  assert.equal(b.detail(a, first.id).reference, "INV-1");
});

test("documented employee expenses appear in reimbursement ageing once, excluding salaries and paid records", (t) => {
  const { s, b, a } = fixture(t);
  const employee = b.saveEmployee(a, person);
  const record = b.record(a, { ...expense(), employee_id: employee.id });
  b.record(a, {
    ...expense(),
    kind: "salary",
    employee_id: employee.id,
    payroll_month: "2026-10",
    reference: "SALARY",
    amount_minor: 30000000,
  });
  const reports = new ReportingService(s, () => "2026-10-20");
  let report = reports.report(a, "ng");
  assert.equal(report.documented_people.length, 1);
  assert.equal(report.documented_people[0].owed_minor, record.amount_minor);
  assert.equal(
    report.documented_people[0].buckets["1–30 days"],
    record.amount_minor,
  );
  assert.equal(report.documentation_totals.outstanding_minor, 30100000);
  const cost = report.totals.net_posted_cost_minor;
  b.pay(a, record.id, payment(40000, "AGE-PART"));
  report = reports.report(a, "ng");
  assert.equal(report.documented_people[0].owed_minor, 60000);
  assert.equal(report.totals.net_posted_cost_minor, cost);
  b.pay(a, record.id, payment(60000, "AGE-FINAL"));
  assert.equal(reports.report(a, "ng").documented_people.length, 0);
});

test("documented vendor bills appear in outstanding bills without increasing report totals twice", (t) => {
  const { s, b, a } = fixture(t);
  const bill = b.record(a, expense());
  const reports = new ReportingService(s, () => "2026-10-20");
  let r = reports.report(a, "ng");
  assert.equal(r.documented_bills.length, 1);
  assert.equal(r.documented_bills[0].record_id, bill.id);
  assert.equal(r.documented_bills[0].age_days, 5);
  assert.equal(
    r.totals.bills_minor +
      r.totals.reimbursements_minor +
      r.documentation_totals.outstanding_minor,
    bill.amount_minor,
  );
  b.pay(a, bill.id, payment(40000, "BILL-PART"));
  r = reports.report(a, "ng");
  assert.equal(r.documented_bills[0].outstanding_minor, 60000);
  assert.equal(r.totals.net_posted_cost_minor, bill.amount_minor);
  b.pay(a, bill.id, payment(60000, "BILL-FINAL"));
  assert.equal(reports.report(a, "ng").documented_bills.length, 0);
});
