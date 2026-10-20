import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinanceStore } from "../src/domain";
import { ReportingService } from "../src/reporting";
import { AdjustmentService } from "../src/adjustments";
import { SubscriptionService } from "../src/subscriptions";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-report-"));
  const s = new FinanceStore(join(dir, "db"));
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const r = new ReportingService(s, () => "2026-10-19");
  return {
    s,
    r,
    f: s.actor("finance"),
    report: () => r.report(s.actor("finance"), "ng"),
  };
}
function expense(s: FinanceStore, extra: any = {}) {
  const e = s.createSpend(s.actor("employee"), {
    entity_id: "ng",
    kind: "bill",
    vendor_id: "ng-v0",
    description: "Report test expense",
    purpose: "Reporting and refund validation",
    amount_minor: 10000,
    currency: "NGN",
    department: "Operations",
    category: "Operations",
    date: "2026-10-01",
    due_date: "2026-10-10",
    invoice_number: `R-${Math.random()}`,
    payment_source: "company",
    payment_method: "card",
    ...extra,
  });
  s.upload(s.actor("employee"), e.id, {
    originalname: "receipt.pdf",
    mimetype: "application/pdf",
    buffer: Buffer.from(`%PDF-1.4\nSynthetic report invoice ${e.id}`),
  });
  return e;
}
function approve(s: FinanceStore, id: string) {
  for (const [who, action] of [
    ["employee", "submit"],
    ["manager", "approve"],
    ["finance", "approve"],
  ])
    s.action(s.actor(who), id, action);
  if (s.spend(s.actor("finance"), id).status === "cfo_review")
    s.action(s.actor("cfo"), id, "approve");
}
function statement(
  s: FinanceStore,
  ref: string,
  amount = 10000,
  direction = "debit",
  date = "2026-10-19",
) {
  s.importStatement(
    s.actor("finance"),
    "ng",
    `reference,date,currency,amount_minor,description,direction\n${ref},${date},NGN,${amount},Report test,${direction}`,
  );
}
function settle(s: FinanceStore, id: string) {
  approve(s, id);
  s.action(s.actor("finance"), id, "schedule");
  s.action(s.actor("payer"), id, "confirm", { reference: id });
  statement(s, id);
  s.action(s.actor("reconciler"), id, "reconcile", { reference: id });
  s.action(s.actor("finance"), id, "post");
}
const adjustment = (id: string, extra: any = {}) => ({
  spend_id: id,
  kind: "credit_note",
  amount_minor: 3000,
  reference: "CREDIT-001",
  reason: "Returned unused services",
  evidence_reference: "Vendor credit note CN-001",
  date: "2026-10-19",
  ...extra,
});
function postAdjustment(s: FinanceStore, id: string, extra: any = {}) {
  const svc = new AdjustmentService(s, () => "2026-10-19");
  const r = svc.create(s.actor("finance"), adjustment(id, extra));
  svc.action(s.actor("reconciler"), r.id, { action: "verify" });
  return svc.action(s.actor("finance"), r.id, { action: "post" });
}
function payRemaining(s: FinanceStore, id: string, amount: number) {
  s.action(s.actor("finance"), id, "schedule");
  s.action(s.actor("payer"), id, "confirm", { reference: id });
  statement(s, id, amount);
  s.action(s.actor("reconciler"), id, "reconcile", { reference: id });
  s.action(s.actor("finance"), id, "post");
}
function claim(s: FinanceStore) {
  const a = expense(s, {
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-10-01",
  });
  const b = expense(s, {
    date: "2026-10-02",
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-10-02",
  });
  const c = s.saveClaim(s.actor("employee"), {
    entity_id: "ng",
    title: "Refund claim",
    spend_ids: [a.id, b.id],
  });
  for (const who of ["employee", "manager", "finance"])
    s.claimAction(s.actor(who), c.id, {
      action: who === "employee" ? "submit" : "approve",
    });
  if (s.claim(s.actor("finance"), c.id).status === "cfo_review")
    s.claimAction(s.actor("cfo"), c.id, { action: "approve" });
  return { a, b, c };
}
function repay(s: FinanceStore, id: string, amount: number, ref: string) {
  const c = s.scheduleRepayment(s.actor("finance"), id, {
    amount_minor: amount,
    date: "2026-10-19",
  });
  const p = c.payments.find((p: any) => p.status === "scheduled");
  s.repaymentAction(s.actor("payer"), p.id, {
    action: "confirm",
    reference: ref,
  });
  statement(s, ref, amount);
  s.repaymentAction(s.actor("reconciler"), p.id, {
    action: "reconcile",
    reference: ref,
  });
  s.repaymentAction(s.actor("finance"), p.id, { action: "post" });
  return p;
}
function balance(s: FinanceStore, code: string) {
  return (
    s.trialBalance(s.actor("finance"), "ng").find((r: any) => r.code === code)
      ?.balance || 0
  );
}
test("unpaid credit changes payable, forecast, export and settlement once, with original expense intact", (t) => {
  const { s, f, report } = fixture(t);
  const e = expense(s);
  approve(s, e.id);
  const cash = balance(s, "1100"),
    cost = report().totals.net_posted_cost_minor;
  const svc = new AdjustmentService(s, () => "2026-10-19");
  const r = svc.create(f, adjustment(e.id));
  assert.equal(svc.create(f, adjustment(e.id)).id, r.id);
  assert.equal(s.spend(f, e.id).outstanding_minor, 10000);
  assert.throws(() => s.action(f, e.id, "schedule"), /pending/);
  assert.throws(() => svc.action(f, r.id, { action: "post" }), /verification/);
  svc.action(s.actor("reconciler"), r.id, { action: "verify" });
  svc.action(f, r.id, { action: "post" });
  svc.action(f, r.id, { action: "post" });
  assert.equal(s.spend(f, e.id).amount_minor, 10000);
  assert.equal(s.spend(f, e.id).outstanding_minor, 7000);
  assert.equal(balance(s, "1100"), cash);
  assert.equal(report().totals.net_posted_cost_minor, cost + 7000);
  s.action(f, e.id, "schedule");
  assert.match(s.paymentFile(f, "ng"), /7000/);
  s.action(s.actor("payer"), e.id, "confirm", { reference: "NET-PAYMENT" });
  statement(s, "NET-STATEMENT", 7000);
  s.action(s.actor("reconciler"), e.id, "reconcile", {
    reference: "NET-STATEMENT",
  });
  s.action(f, e.id, "post");
  assert.equal(balance(s, "1100"), cash - 7000);
  assert.equal(report().totals.net_posted_cost_minor, cost + 7000);
  assert.equal(
    s.get(
      "SELECT COUNT(*) n FROM journals WHERE idempotency_key=?",
      `${e.id}:expense`,
    ).n,
    1,
  );
  assert.equal(s.spend(f, e.id).outstanding_minor, 0);
});
test("full unpaid credit closes balance with no payment or cash journal", (t) => {
  const { s, f, report } = fixture(t);
  const e = expense(s);
  approve(s, e.id);
  const cash = balance(s, "1100"),
    cost = report().totals.net_posted_cost_minor;
  postAdjustment(s, e.id, { amount_minor: 10000 });
  assert.equal(s.spend(f, e.id).outstanding_minor, 0);
  assert.equal(s.spend(f, e.id).settled_minor, 0);
  assert.equal(s.spend(f, e.id).status, "posted");
  assert.equal(report().totals.net_posted_cost_minor, cost);
  assert.equal(balance(s, "1100"), cash);
  assert.throws(() => s.action(f, e.id, "schedule"));
});
test("personal refund before payment reduces direct founder reimbursement and posted cost", (t) => {
  const { s, f } = fixture(t);
  const e = expense(s, {
    payment_source: "founder",
    paid_by_id: "employee",
    original_paid_date: "2026-10-01",
  });
  approve(s, e.id);
  postAdjustment(s, e.id, { kind: "personal_refund", amount_minor: 4000 });
  assert.equal(s.spend(f, e.id).outstanding_minor, 6000);
  payRemaining(s, e.id, 6000);
  assert.equal(s.spend(f, e.id).reimbursed_minor, 6000);
  assert.equal(s.spend(f, e.id).recoverable_minor, 0);
  assert.equal(
    s
      .reimbursements(f, "ng")
      .balances.find((b: any) => b.person_id === "employee").reimbursed_minor,
    6000,
  );
});
test("partial grouped repayment plus personal refund reduces only remaining allocations", (t) => {
  const { s, f, report } = fixture(t);
  const { a, b, c } = claim(s);
  repay(s, c.id, 12000, "FIRST");
  postAdjustment(s, b.id, { kind: "personal_refund", amount_minor: 5000 });
  assert.equal(s.claim(f, c.id).outstanding_minor, 3000);
  assert.equal(s.claim(f, c.id).available_minor, 3000);
  const row = report().reimbursements.find((x: any) => x.id === b.id);
  assert.equal(row.outstanding_minor, 3000);
  repay(s, c.id, 3000, "LAST");
  assert.equal(s.claim(f, c.id).outstanding_minor, 0);
  assert.equal(s.spend(f, b.id).status, "posted");
  assert.equal(s.spend(f, a.id).adjustment_minor, 0);
  assert.equal(
    s.get(
      "SELECT SUM(a.amount_minor) n FROM reimbursement_allocations a JOIN reimbursement_payments p ON p.id=a.payment_id WHERE p.claim_id=?",
      c.id,
    ).n,
    15000,
  );
});
test("refund exceeding unpaid balance creates receivable without offsetting other claims or cash", (t) => {
  const { s, f, report } = fixture(t);
  const { a, b, c } = claim(s);
  repay(s, c.id, 12000, "FIRST");
  const cash = balance(s, "1100"),
    liability = balance(s, "2100");
  const r = postAdjustment(s, a.id, {
    kind: "personal_refund",
    amount_minor: 6000,
  });
  assert.equal(r.payable_reduction_minor, 0);
  assert.equal(r.recoverable_minor, 6000);
  assert.equal(s.claim(f, c.id).outstanding_minor, 8000);
  assert.equal(s.claim(f, c.id).recoverable_minor, 6000);
  assert.equal(balance(s, "1100"), cash);
  assert.equal(balance(s, "2100"), liability);
  assert.equal(balance(s, "1200"), 6000);
  assert.equal(
    report().people.find((p: any) => p.id === "employee").recoverable_minor,
    6000,
  );
  const split = postAdjustment(s, b.id, {
    kind: "personal_refund",
    reference: "SPLIT",
    amount_minor: 9000,
  });
  assert.equal(split.payable_reduction_minor, 8000);
  assert.equal(split.recoverable_minor, 1000);
  assert.equal(s.claim(f, c.id).available_minor, 0);
  assert.equal(report().totals.recoverable_minor, 7000);
});
test("scheduled and unposted payments block adjustment; pending adjustment holds claim scheduling", (t) => {
  const { s, f } = fixture(t);
  const { b, c } = claim(s);
  const svc = new AdjustmentService(s, () => "2026-10-19");
  const scheduled = s.scheduleRepayment(f, c.id, {
    amount_minor: 20000,
    date: "2026-10-19",
  }).payments[0];
  assert.throws(
    () => svc.create(f, adjustment(b.id, { kind: "personal_refund" })),
    /repayments/,
  );
  s.repaymentAction(f, scheduled.id, { action: "cancel" });
  const r = svc.create(f, adjustment(b.id, { kind: "personal_refund" }));
  assert.equal(s.claim(f, c.id).available_minor, 0);
  assert.throws(
    () =>
      s.scheduleRepayment(f, c.id, { amount_minor: 1000, date: "2026-10-19" }),
    /balance/,
  );
  svc.action(f, r.id, { action: "cancel" });
  assert.equal(s.claim(f, c.id).available_minor, 20000);
});
test("combined refund cap, cross-type references, role checks and immutable history", (t) => {
  const { s, f, r } = fixture(t);
  const e = expense(s, {
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-10-01",
  });
  settle(s, e.id);
  const svc = new AdjustmentService(s, () => "2026-10-19");
  assert.throws(
    () =>
      svc.create(
        s.actor("employee"),
        adjustment(e.id, { kind: "personal_refund" }),
      ),
    /role/,
  );
  postAdjustment(s, e.id, { kind: "personal_refund", amount_minor: 3000 });
  assert.throws(
    () =>
      r.createRefund(f, {
        spend_id: e.id,
        amount_minor: 1000,
        reference: "CREDIT-001",
        reason: "Refund duplication",
        date: "2026-10-19",
      }),
    /already recorded/,
  );
  const cash = r.createRefund(f, {
    spend_id: e.id,
    amount_minor: 7000,
    reference: "CASH",
    reason: "Other refunded portion",
    date: "2026-10-19",
  });
  assert.throws(
    () =>
      svc.create(
        f,
        adjustment(e.id, {
          kind: "personal_refund",
          reference: "EXCESS",
          amount_minor: 1,
        }),
      ),
    /exceed/,
  );
  assert.throws(
    () =>
      svc.create(
        f,
        adjustment(e.id, {
          kind: "personal_refund",
          reference: "CASH",
          amount_minor: 1,
        }),
      ),
    /already recorded/,
  );
  const ad = s.get("SELECT id FROM expense_adjustments WHERE spend_id=?", e.id);
  assert.throws(
    () => s.run("DELETE FROM expense_adjustments WHERE id=?", ad.id),
    /immutable/,
  );
  assert.throws(
    () =>
      s.run("UPDATE expense_adjustments SET amount_minor=1 WHERE id=?", ad.id),
    /immutable/,
  );
  assert.ok(s.verifyAudit());
});
test("closed-period adjustment posts atomically and wrong type is rejected", (t) => {
  const { s, f } = fixture(t);
  const e = expense(s);
  approve(s, e.id);
  const svc = new AdjustmentService(s, () => "2026-10-19");
  assert.throws(
    () => svc.create(f, adjustment(e.id, { kind: "personal_refund" })),
    /original payer/,
  );
  const r = svc.create(f, adjustment(e.id));
  assert.throws(() => svc.action(f, r.id, { action: "verify" }), /role/);
  svc.action(s.actor("reconciler"), r.id, { action: "verify" });
  s.run(
    "UPDATE periods SET status='closed' WHERE entity_id='ng' AND period='2026-10'",
  );
  assert.throws(() => svc.action(f, r.id, { action: "post" }), /period/);
  assert.equal(s.spend(f, e.id).outstanding_minor, 10000);
  assert.equal(
    s.get("SELECT COUNT(*) n FROM journals WHERE source_id=?", e.id).n,
    0,
  );
  assert.equal(
    s.get("SELECT status FROM expense_adjustments WHERE id=?", r.id).status,
    "verified",
  );
});
test("subscription forecast uses adjusted invoice once and persists across reopening", (t) => {
  const { s, f, r } = fixture(t);
  const sub = new SubscriptionService(s, () => "2026-10-19");
  const plan = sub.save(f, {
    entity_id: "ng",
    vendor_id: "ng-v0",
    owner_id: "employee",
    name: "Adjusted subscription",
    purpose: "Testing forecast credit note",
    plan: "Team",
    seats: 1,
    department: "Operations",
    category: "Operations",
    currency: "NGN",
    amount_minor: 10000,
    cadence: "monthly",
    interval_count: 1,
    billing_anchor: "2026-10-20",
    renewal_date: "2027-10-20",
    cancellation_deadline: "",
    auto_renew: true,
    payment_method: "card",
    payment_account: "Test",
  });
  const e = expense(s, { due_date: "2026-10-20" });
  sub.record(f, plan.id, { due_date: "2026-10-20", spend_id: e.id });
  approve(s, e.id);
  postAdjustment(s, e.id);
  assert.equal(r.report(f, "ng", 30).totals.forecast_minor, 7000);
  const again = new FinanceStore(join(s.dir, "db"));
  try {
    assert.equal(again.spend(f, e.id).outstanding_minor, 7000);
    assert.equal(
      again.get("SELECT COUNT(*) n FROM migrations WHERE version=8").n,
      1,
    );
  } finally {
    again.db.close();
  }
});

test("adjustment HTTP workflow enforces roles, exposes updated reports and returns retry-safe posting", async (t) => {
  const { s } = fixture(t);
  const { createFinanceApp } = await import("../src/main");
  process.env.JAYE_TEST = "1";
  const app = await createFinanceApp(s);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const base = await app.getUrl();
  const call = (path: string, cookie = "", body?: any) =>
    fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (user_id: string) =>
    (await call("/demo/login", "", { user_id })).headers
      .get("set-cookie")!
      .split(";")[0];
  const finance = await login("finance"),
    rec = await login("reconciler"),
    emp = await login("employee");
  const e = expense(s);
  approve(s, e.id);
  assert.equal((await call("/adjustments", "", adjustment(e.id))).status, 401);
  assert.equal((await call("/adjustments", emp, adjustment(e.id))).status, 403);
  const response = await call("/adjustments", finance, adjustment(e.id));
  assert.equal(response.status, 201);
  const r: any = await response.json();
  assert.equal(
    (await call(`/adjustments/${r.id}/action`, finance, { action: "verify" }))
      .status,
    403,
  );
  assert.equal(
    (await call(`/adjustments/${r.id}/action`, rec, { action: "verify" }))
      .status,
    201,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await call(`/adjustments/${r.id}/action`, finance, { action: "post" }))
        .status,
      201,
    );
  const report: any = await (
    await call("/reports/operations?entity=ng", finance)
  ).json();
  assert.equal(report.adjustments[0].status, "posted");
  assert.equal(
    report.bills.find((b: any) => b.id === e.id).outstanding_minor,
    7000,
  );
});

test("personal refund cannot predate the employee payment", (t) => {
  const { s, f } = fixture(t);
  const e = expense(s, {
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-10-10",
  });
  approve(s, e.id);
  const svc = new AdjustmentService(s, () => "2026-10-19");
  assert.throws(
    () =>
      svc.create(
        f,
        adjustment(e.id, { kind: "personal_refund", date: "2026-10-09" }),
      ),
    /personal payment/,
  );
});

test("budget actuals follow journal periods when a credit arrives in a later month", (t) => {
  const { s, f } = fixture(t);
  const before = s
    .budgetsRaw("ng")
    .find(
      (b) => b.department === "Operations" && b.category === "Operations",
    ).actual_minor;
  const e = expense(s);
  approve(s, e.id);
  s.run(
    "INSERT INTO periods(entity_id,period,status) VALUES('ng','2026-11','open')",
  );
  const svc = new AdjustmentService(s, () => "2026-11-10");
  const r = svc.create(f, adjustment(e.id, { date: "2026-11-10" }));
  svc.action(s.actor("reconciler"), r.id, { action: "verify" });
  svc.action(f, r.id, { action: "post" });
  assert.equal(
    s
      .budgetsRaw("ng")
      .find((b) => b.department === "Operations" && b.category === "Operations")
      .actual_minor,
    before + 10000,
  );
  assert.equal(s.spend(f, e.id).outstanding_minor, 7000);
});
