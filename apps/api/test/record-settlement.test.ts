import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FinanceStore } from "../src/domain";
import { BookkeepingService } from "../src/bookkeeping";
import { ReportingService } from "../src/reporting";
import { SubscriptionService } from "../src/subscriptions";
import { createFinanceApp } from "../src/main";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-record-settlement-"));
  const s = new FinanceStore(join(dir, "test.db"));
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { s, b: new BookkeepingService(s), a: s.actor("finance") };
}
const expense = (extra: any = {}) => ({
  entity_id: "ng",
  kind: "expense",
  description: "Settlement test cost",
  payee: "Settlement supplier",
  category: "Operations",
  department: "Operations",
  amount_minor: 100000,
  date: "2026-10-01",
  due_date: "2026-10-01",
  reference: randomUUID(),
  request_key: randomUUID(),
  ...extra,
});
const pay = (n = 100000, extra: any = {}) => ({
  amount_minor: n,
  date: "2026-10-02",
  reference: randomUUID(),
  method: "Bank transfer",
  request_key: randomUUID(),
  ...extra,
});
const refund = (n = 20000, extra: any = {}) => ({
  amount_minor: n,
  date: "2026-10-03",
  reference: randomUUID(),
  method: "Bank transfer",
  reason: "Supplier returned unused cost",
  request_key: randomUUID(),
  ...extra,
});
function bank(
  s: FinanceStore,
  a: any,
  n: number,
  direction = "debit",
  date = "2026-10-02",
) {
  const reference = randomUUID();
  s.importStatement(
    a,
    "ng",
    `reference,date,currency,amount_minor,description,direction\n${reference},${date},NGN,${n},Settlement test,${direction}`,
  );
  return s.bankTransactions(a, "ng").find((b) => b.reference === reference)!;
}
function balance(s: FinanceStore, a: any, account: string) {
  return s.trialBalance(a, "ng").find((r) => r.code === account).balance;
}
test("received refunds reduce net costs and net paid once; bank matching never changes journals or cash", (t) => {
  const { s, b, a } = fixture(t);
  const baseCost = balance(s, a, "6300"),
    baseCash = balance(s, a, "1100");
  let r = b.record(a, expense());
  r = b.pay(a, r.id, pay());
  const payload = refund();
  r = b.refund(a, r.id, payload);
  assert.equal(r.amount_minor, 80000);
  assert.equal(r.gross_paid_minor, 100000);
  assert.equal(r.paid_minor, 80000);
  assert.equal(r.refunded_minor, 20000);
  assert.equal(r.outstanding_minor, 0);
  assert.equal(b.refund(a, r.id, payload).refunds.length, 1);
  assert.equal(balance(s, a, "6300") - baseCost, 80000);
  assert.equal(balance(s, a, "1100") - baseCash, -80000);
  const debit = bank(s, a, 100000),
    credit = bank(s, a, 20000, "credit", "2026-10-03");
  const journals = s.all("SELECT id FROM journals").length;
  const p = {
    kind: "payment",
    target_id: r.payments[0].id,
    bank_transaction_id: debit.id,
  };
  r = b.matchBank(a, r.id, p);
  b.matchBank(a, r.id, p);
  r = b.matchBank(a, r.id, {
    kind: "refund",
    target_id: r.refunds[0].id,
    bank_transaction_id: credit.id,
  });
  assert.equal(s.all("SELECT id FROM journals").length, journals);
  assert.equal(r.payments[0].bank_reference, debit.reference);
  assert.equal(r.refunds[0].bank_reference, credit.reference);
  const report = new ReportingService(s).report(a, "ng");
  assert.ok(
    !report.unmatched.some((x) => [debit.id, credit.id].includes(x.id)),
  );
  assert.ok(!report.documented_unmatched.some((x) => x.record_id === r.id));
  assert.equal(
    report.totals.gross_posted_cost_minor -
      report.totals.posted_refunds_minor -
      report.totals.posted_adjustments_minor,
    report.totals.net_posted_cost_minor,
  );
  assert.throws(
    () =>
      b.correct(a, "payment", r.payments[0].id, {
        revision: 0,
        request_key: randomUUID(),
        amount_minor: 90000,
        date: "2026-10-02",
        reason: "Correct the payment",
      }),
    /refund/,
  );
  assert.throws(
    () =>
      b.reverseRefund(a, r.id, r.refunds[0].id, {
        reason: "Mistaken refund entry",
      }),
    /Remove the bank match/,
  );
  b.matchBank(a, r.id, {
    kind: "refund",
    target_id: r.refunds[0].id,
    remove: true,
    reason: "Wrong statement row",
  });
  r = b.reverseRefund(a, r.id, r.refunds[0].id, {
    reason: "Mistaken refund entry",
  });
  assert.equal(r.refunded_minor, 0);
  assert.equal(r.amount_minor, 100000);
  assert.equal(r.outstanding_minor, 0);
  assert.equal(balance(s, a, "6300") - baseCost, 100000);
  assert.equal(balance(s, a, "1100") - baseCash, -100000);
  assert.throws(
    () =>
      b.correct(a, "payment", r.payments[0].id, {
        revision: 0,
        request_key: randomUUID(),
        amount_minor: 90000,
        date: "2026-10-02",
        reason: "Correct the payment",
      }),
    /Remove the bank match/,
  );
  b.matchBank(a, r.id, {
    kind: "payment",
    target_id: r.payments[0].id,
    remove: true,
    reason: "Payment correction needed",
  });
  assert.ok(b.detail(a, r.id).bank_candidates.some((x) => x.id === debit.id));
});
test("salary refunds preserve unpaid salary, cap to money paid and enforce dates, permissions and closed periods", (t) => {
  const { s, b, a } = fixture(t);
  const employee = b.saveEmployee(a, {
    entity_id: "ng",
    name: "Payroll return test",
    department: "Operations",
    job_title: "Tester",
    kind: "employee",
    salary_minor: 300000,
    start_date: "2026-01-01",
  });
  let r = b.record(
    a,
    expense({
      kind: "salary",
      employee_id: employee.id,
      payroll_month: "2026-10",
      amount_minor: 300000,
    }),
  );
  r = b.pay(a, r.id, pay());
  assert.throws(() => b.refund(a, r.id, refund(100001)), /cannot exceed/);
  assert.throws(
    () => b.refund(a, r.id, refund(1000, { date: "2026-10-01" })),
    /date/,
  );
  assert.throws(
    () => b.refund(s.actor("employee"), r.id, refund()),
    /permission|access|authorized|role|Forbidden/i,
  );
  r = b.refund(a, r.id, refund());
  assert.equal(r.amount_minor, 280000);
  assert.equal(r.paid_minor, 80000);
  assert.equal(r.outstanding_minor, 200000);
  assert.equal(
    new ReportingService(s).report(a, "ng").documentation_totals
      .salary_owed_minor,
    200000,
  );
  s.run(
    "UPDATE periods SET status='closed' WHERE entity_id='ng' AND period='2026-10'",
  );
  assert.throws(() => b.refund(a, r.id, refund(1000)), /not open/i);
  assert.equal(b.detail(a, r.id).refunds.length, 1);
  assert.throws(
    () => b.reverseRefund(a, r.id, r.refunds[0].id, { reason: "Mistake" }),
    /not open/i,
  );
  assert.equal(b.detail(a, r.id).refunded_minor, 20000);
});
test("matching enforces exact bank direction, amount, date and one-use statement entries", (t) => {
  const { s, b, a } = fixture(t);
  let r = b.record(a, expense());
  r = b.pay(a, r.id, pay());
  for (const row of [
    bank(s, a, 100000, "credit"),
    bank(s, a, 99999),
    bank(s, a, 100000, "debit", "2026-10-03"),
  ])
    assert.throws(
      () =>
        b.matchBank(a, r.id, {
          kind: "payment",
          target_id: r.payments[0].id,
          bank_transaction_id: row.id,
        }),
      /unused bank/,
    );
  const row = bank(s, a, 100000);
  b.matchBank(a, r.id, {
    kind: "payment",
    target_id: r.payments[0].id,
    bank_transaction_id: row.id,
  });
  let other = b.record(a, expense());
  other = b.pay(a, other.id, pay());
  assert.throws(
    () =>
      b.matchBank(a, other.id, {
        kind: "payment",
        target_id: other.payments[0].id,
        bank_transaction_id: row.id,
      }),
    /unused bank/,
  );
  assert.throws(
    () =>
      b.matchBank(a, other.id, {
        kind: "payment",
        target_id: r.payments[0].id,
        bank_transaction_id: row.id,
      }),
    /active payment/,
  );
  assert.throws(() =>
    b.matchBank(s.actor("auditor"), r.id, {
      kind: "payment",
      target_id: r.payments[0].id,
      remove: true,
      reason: "Bad access",
    }),
  );
  let cash = b.record(a, expense());
  cash = b.pay(a, cash.id, pay(100000, { method: "Cash" }));
  assert.throws(
    () =>
      b.matchBank(a, cash.id, {
        kind: "payment",
        target_id: cash.payments[0].id,
        bank_transaction_id: bank(s, a, 100000).id,
      }),
    /Cash entries/,
  );
});
test("subscription forecast and budgets use net refund costs without reviving a paid bill", (t) => {
  const { s, b, a } = fixture(t);
  const subs = new SubscriptionService(s, () => "2026-10-20");
  const sub = subs.save(a, {
    entity_id: "ng",
    vendor_id: "ng-v0",
    owner_id: "finance",
    name: "Refunded subscription",
    purpose: "Subscription refund regression",
    plan: "Standard",
    seats: 1,
    department: "Operations",
    category: "Operations",
    currency: "NGN",
    amount_minor: 100000,
    cadence: "monthly",
    interval_count: 1,
    billing_anchor: "2026-10-01",
    renewal_date: "2027-10-01",
    cancellation_deadline: "",
    auto_renew: true,
    payment_method: "bank_transfer",
    payment_account: "",
  });
  let r = subs.recordExpense(a, sub.id, {
    due_date: "2026-10-01",
    date: "2026-10-01",
    amount_minor: 100000,
    request_key: randomUUID(),
    payment: pay(),
  });
  const budgetBefore = s
    .budgetsRaw("ng")
    .find(
      (x) =>
        x.department === "Operations" &&
        x.category === "Operations" &&
        x.period === "2026-10",
    )?.actual_minor;
  r = b.refund(a, r.id, refund(100000));
  assert.equal(r.status, "Refunded");
  const cycle = subs.list(a, "ng").charges.find((x) => x.record_id === r.id)!;
  assert.equal(cycle.outstanding_minor, 0);
  assert.equal(cycle.expense.amount_minor, 0);
  if (budgetBefore !== undefined)
    assert.equal(
      s
        .budgetsRaw("ng")
        .find(
          (x) =>
            x.department === "Operations" &&
            x.category === "Operations" &&
            x.period === "2026-10",
        )!.actual_minor,
      budgetBefore - 100000,
    );
  assert.equal(
    s.trialBalance(a, "ng").reduce((n, r) => n + r.balance, 0),
    0,
  );
});
test("HTTP refund and bank matching endpoints use authenticated records and do not double-post", async (t) => {
  process.env.JAYE_TEST = "1";
  const { s, b, a } = fixture(t);
  let r = b.record(a, expense());
  r = b.pay(a, r.id, pay());
  const app = await createFinanceApp(s);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const base = await app.getUrl();
  const login = await fetch(base + "/api/demo/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "finance" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const call = (path: string, body: any, c = cookie) =>
    fetch(base + "/api" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: c },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await call(`/records/${r.id}/refunds`, refund(), "")).status,
    401,
  );
  const response = await call(`/records/${r.id}/refunds`, refund());
  assert.equal(response.status, 201);
  const updated: any = await response.json();
  assert.equal(updated.refunded_minor, 20000);
  const row = bank(s, a, 100000);
  const match = {
    kind: "payment",
    target_id: r.payments[0].id,
    bank_transaction_id: row.id,
  };
  const count = s.all("SELECT id FROM journals").length;
  assert.equal((await call(`/records/${r.id}/bank-match`, match)).status, 201);
  assert.equal((await call(`/records/${r.id}/bank-match`, match)).status, 201);
  assert.equal(s.all("SELECT id FROM journals").length, count);
});

test("bank entries cannot be reused between simple records and approval-workflow bills or refunds in either direction", (t) => {
  const { s, b, a } = fixture(t);
  let r = b.record(a, expense());
  r = b.pay(a, r.id, pay());
  r = b.refund(a, r.id, refund());
  const debit = bank(s, a, 100000),
    credit = bank(s, a, 20000, "credit", "2026-10-03");
  b.matchBank(a, r.id, {
    kind: "payment",
    target_id: r.payments[0].id,
    bank_transaction_id: debit.id,
  });
  b.matchBank(a, r.id, {
    kind: "refund",
    target_id: r.refunds[0].id,
    bank_transaction_id: credit.id,
  });
  const legacy = s.createSpend(s.actor("employee"), {
    entity_id: "ng",
    kind: "bill",
    vendor_id: "ng-v0",
    description: "Cross workflow bank protection",
    purpose: "Bank matching regression fixture",
    amount_minor: 100000,
    currency: "NGN",
    department: "Operations",
    category: "Operations",
    date: "2026-10-01",
    due_date: "2026-10-02",
    invoice_number: randomUUID(),
    payment_source: "company",
    payment_method: "card",
  });
  s.upload(s.actor("employee"), legacy.id, {
    originalname: "test.pdf",
    mimetype: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nTest cross matching"),
  });
  s.action(s.actor("employee"), legacy.id, "submit");
  s.action(s.actor("manager"), legacy.id, "approve");
  s.action(a, legacy.id, "approve");
  s.action(a, legacy.id, "schedule");
  s.action(s.actor("payer"), legacy.id, "confirm", { reference: randomUUID() });
  assert.throws(
    () =>
      s.action(s.actor("reconciler"), legacy.id, "reconcile", {
        reference: debit.reference,
      }),
    /unmatched/i,
  );
  b.matchBank(a, r.id, {
    kind: "payment",
    target_id: r.payments[0].id,
    remove: true,
    reason: "Testing bank reservation",
  });
  s.action(s.actor("reconciler"), legacy.id, "reconcile", {
    reference: debit.reference,
  });
  s.action(a, legacy.id, "post");
  assert.throws(
    () =>
      b.matchBank(a, r.id, {
        kind: "payment",
        target_id: r.payments[0].id,
        bank_transaction_id: debit.id,
      }),
    /unused bank/,
  );
  const reports = new ReportingService(s, () => "2026-10-20");
  const oldRefund = reports.createRefund(a, {
    spend_id: legacy.id,
    amount_minor: 20000,
    date: "2026-10-03",
    reference: randomUUID(),
    reason: "Cross workflow credit protection",
  });
  assert.throws(
    () =>
      reports.refundAction(s.actor("reconciler"), oldRefund.id, {
        action: "reconcile",
        reference: credit.reference,
      }),
    /unmatched/i,
  );
  b.matchBank(a, r.id, {
    kind: "refund",
    target_id: r.refunds[0].id,
    remove: true,
    reason: "Testing refund reservation",
  });
  reports.refundAction(s.actor("reconciler"), oldRefund.id, {
    action: "reconcile",
    reference: credit.reference,
  });
  assert.throws(
    () =>
      b.matchBank(a, r.id, {
        kind: "refund",
        target_id: r.refunds[0].id,
        bank_transaction_id: credit.id,
      }),
    /unused bank/,
  );
});

test("refund dated in a later month changes that month budget and dashboard net costs only", (t) => {
  const { s, b, a } = fixture(t);
  s.run(
    "INSERT INTO budgets VALUES(?,?,?,?,?,?)",
    randomUUID(),
    "ng",
    "Operations",
    "Operations",
    "2026-09",
    500000,
  );
  let r = b.record(a, expense({ date: "2026-09-01", due_date: "2026-09-01" }));
  r = b.pay(a, r.id, pay(100000, { date: "2026-09-02" }));
  const sept = s
    .budgetsRaw("ng")
    .find(
      (x) =>
        x.department === "Operations" &&
        x.category === "Operations" &&
        x.period === "2026-09",
    )!.actual_minor;
  const oct = s
    .budgetsRaw("ng")
    .find(
      (x) =>
        x.department === "Operations" &&
        x.category === "Operations" &&
        x.period === "2026-10",
    )!.actual_minor;
  b.refund(a, r.id, refund());
  assert.equal(
    s
      .budgetsRaw("ng")
      .find(
        (x) =>
          x.department === "Operations" &&
          x.category === "Operations" &&
          x.period === "2026-09",
      )!.actual_minor,
    sept,
  );
  assert.equal(
    s
      .budgetsRaw("ng")
      .find(
        (x) =>
          x.department === "Operations" &&
          x.category === "Operations" &&
          x.period === "2026-10",
      )!.actual_minor,
    oct - 20000,
  );
  assert.equal(s.dashboard(a, "ng").record_summary.owed_minor, 0);
  assert.equal(b.list(a, "ng").find((x) => x.id === r.id)!.amount_minor, 80000);
});

test("one empty workspace keeps expenses, subscription bills, salaries, refunds and reconciliation consistent end to end", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jaye-connected-"));
  const s = new FinanceStore(join(dir, "test.db"), "empty");
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const a = s.actor("finance"),
    b = new BookkeepingService(s);
  const reports = new ReportingService(s, () => "2026-10-20");
  const subs = new SubscriptionService(s, () => "2026-10-20");
  for (const category of ["Operations", "Salaries"])
    s.run(
      "INSERT INTO budgets VALUES(?,?,?,?,?,?)",
      randomUUID(),
      "ng",
      "Operations",
      category,
      "2026-10",
      1000000,
    );
  const employee = b.saveEmployee(a, {
    entity_id: "ng",
    name: "Connected workflow employee",
    department: "Operations",
    job_title: "Accountant",
    kind: "employee",
    salary_minor: 300000,
    start_date: "2026-01-01",
  });
  const subscription = subs.save(a, {
    entity_id: "ng",
    provider_name: "Connected provider",
    name: "Connected subscription",
    purpose: "Accounting workflow test",
    plan: "",
    seats: 1,
    department: "Operations",
    category: "Operations",
    currency: "NGN",
    amount_minor: 200000,
    cadence: "monthly",
    interval_count: 1,
    billing_anchor: "2026-10-01",
    start_date: "2026-10-01",
    renewal_date: "2027-10-01",
    cancellation_deadline: "",
    auto_renew: true,
    payment_method: "bank_transfer",
    payment_account: "",
    employee_id: employee.id,
  });
  assert.equal(
    b.list(a, "ng").length,
    0,
    "a subscription schedule is not an actual expense",
  );
  const ordinary = b.record(a, expense());
  const billInput = {
    due_date: "2026-10-01",
    date: "2026-10-01",
    amount_minor: 200000,
    request_key: randomUUID(),
  };
  const bill = subs.recordExpense(a, subscription.id, billInput);
  assert.equal(subs.recordExpense(a, subscription.id, billInput).id, bill.id);
  const salary = b.record(
    a,
    expense({
      kind: "salary",
      employee_id: employee.id,
      payroll_month: "2026-10",
      amount_minor: 300000,
    }),
  );
  const records = [ordinary, bill, salary];
  const assertTotals = (cost: number, paid: number, owed: number) => {
    const report = reports.report(a, "ng");
    assert.deepEqual(report.documentation_totals, {
      cost_minor: cost,
      paid_minor: paid,
      outstanding_minor: owed,
      salary_owed_minor: b.detail(a, salary.id).outstanding_minor,
    });
    assert.equal(report.totals.net_posted_cost_minor, cost);
    const trial = s.trialBalance(a, "ng");
    assert.equal(
      trial.reduce((n, r) => n + r.balance, 0),
      0,
    );
    assert.equal(
      trial
        .filter((r) => r.type === "expense")
        .reduce((n, r) => n + r.balance, 0),
      cost,
    );
    assert.equal(balance(s, a, "1100"), paid ? -paid : 0);
    assert.equal(balance(s, a, "2100"), owed ? -owed : 0);
    assert.equal(s.dashboard(a, "ng").record_summary.owed_minor, owed);
    assert.equal(
      s.budgetsRaw("ng").reduce((n, r) => n + r.actual_minor, 0),
      cost,
    );
    assert.equal(report.documentation.length, 3);
  };
  assertTotals(600000, 0, 600000);
  records.forEach((r, i) => {
    const p = pay([40000, 200000, 100000][i]);
    b.pay(a, r.id, p);
    b.pay(a, r.id, p);
  });
  assertTotals(600000, 340000, 260000);
  records.forEach((r, i) => {
    const f = refund([10000, 20000, 30000][i]);
    b.refund(a, r.id, f);
    b.refund(a, r.id, f);
  });
  assertTotals(540000, 280000, 260000);
  assert.equal(reports.report(a, "ng").totals.posted_refunds_minor, 60000);
  const cycle = subs
    .list(a, "ng")
    .charges.find((c) => c.record_id === bill.id)!;
  assert.equal(cycle.outstanding_minor, 0);
  assert.equal(cycle.expense.amount_minor, 180000);
  b.pay(a, ordinary.id, pay(60000, { date: "2026-10-04" }));
  b.pay(a, salary.id, pay(200000, { date: "2026-10-04" }));
  assertTotals(540000, 540000, 0);
  const journalCount = s.all("SELECT id FROM journals").length;
  for (const r of records) {
    const detail = b.detail(a, r.id);
    for (const kind of ["payment", "refund"] as const) {
      for (const entry of kind === "payment"
        ? detail.payments
        : detail.refunds) {
        const row = bank(
          s,
          a,
          entry.amount_minor,
          kind === "payment" ? "debit" : "credit",
          entry.date,
        );
        const match = {
          kind,
          target_id: entry.id,
          bank_transaction_id: row.id,
        };
        b.matchBank(a, r.id, match);
        b.matchBank(a, r.id, match);
      }
    }
  }
  assertTotals(540000, 540000, 0);
  assert.equal(s.all("SELECT id FROM journals").length, journalCount);
  assert.equal(reports.report(a, "ng").unmatched.length, 0);
  assert.equal(reports.report(a, "ng").documented_unmatched.length, 0);
  const matched = b.detail(a, ordinary.id).payments[0];
  b.matchBank(a, ordinary.id, {
    kind: "payment",
    target_id: matched.id,
    remove: true,
    reason: "Recheck matching",
  });
  assertTotals(540000, 540000, 0);
  assert.equal(reports.report(a, "ng").documented_unmatched.length, 1);
  b.matchBank(a, ordinary.id, {
    kind: "payment",
    target_id: matched.id,
    bank_transaction_id: matched.bank_transaction_id,
  });
  assertTotals(540000, 540000, 0);
});
