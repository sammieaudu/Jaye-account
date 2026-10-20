import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinanceStore } from "../src/domain";
import { ReportingService } from "../src/reporting";
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
test("report separates pending bills, approved bills, personal liabilities and requests", (t) => {
  const { s, report } = fixture(t);
  const base = report();
  const b = expense(s);
  let d = report();
  assert.equal(d.totals.bills_minor, base.totals.bills_minor);
  assert.equal(d.totals.pending_minor, base.totals.pending_minor + 10000);
  approve(s, b.id);
  d = report();
  assert.equal(d.totals.bills_minor, base.totals.bills_minor + 10000);
  assert.equal(d.bills.find((x: any) => x.id === b.id).age_days, 9);
  const personal = expense(s, {
    date: "2026-10-02",
    payment_source: "founder",
    paid_by_id: "employee",
    original_paid_date: "2026-09-01",
  });
  approve(s, personal.id);
  d = report();
  assert.equal(
    d.totals.reimbursements_minor,
    base.totals.reimbursements_minor + 10000,
  );
  assert.equal(
    d.reimbursements.find((x: any) => x.id === personal.id).bucket,
    "31–60 days",
  );
  expense(s, { kind: "request" });
  assert.equal(report().totals.pending_minor, base.totals.pending_minor);
});
test("partial repayments reduce ageing by allocations without creating a second expense", (t) => {
  const { s, report, f } = fixture(t);
  const a = expense(s, {
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-09-01",
  });
  const b = expense(s, {
    date: "2026-10-02",
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-10-01",
  });
  const c = s.saveClaim(s.actor("employee"), {
    entity_id: "ng",
    title: "Ageing grouped claim",
    spend_ids: [a.id, b.id],
  });
  for (const who of ["employee", "manager", "finance"])
    s.claimAction(s.actor(who), c.id, {
      action: who === "employee" ? "submit" : "approve",
    });
  if (s.claim(f, c.id).status === "cfo_review")
    s.claimAction(s.actor("cfo"), c.id, { action: "approve" });
  const before = report();
  const payment = s.scheduleRepayment(f, c.id, {
    amount_minor: 12000,
    date: "2026-10-19",
  }).payments[0];
  assert.equal(
    report().totals.reimbursements_minor,
    before.totals.reimbursements_minor,
  );
  s.repaymentAction(s.actor("payer"), payment.id, {
    action: "confirm",
    reference: "PARTIAL",
  });
  const after = report();
  assert.equal(
    after.totals.reimbursements_minor,
    before.totals.reimbursements_minor - 12000,
  );
  assert.equal(
    after.reimbursements
      .filter((r: any) => [a.id, b.id].includes(r.id))
      .reduce((n: number, r: any) => n + r.outstanding_minor, 0),
    8000,
  );
  assert.equal(
    after.totals.net_posted_cost_minor,
    before.totals.net_posted_cost_minor + 20000,
  );
});
test("forecast replaces estimate with actual invoice and excludes paid invoices", (t) => {
  const { s, r, f } = fixture(t);
  const sub = new SubscriptionService(s, () => "2026-10-19");
  const plan = sub.save(f, {
    entity_id: "ng",
    vendor_id: "ng-v0",
    owner_id: "employee",
    name: "Forecast subscription",
    purpose: "Testing recurring forecast basis",
    plan: "Team",
    seats: 3,
    department: "Operations",
    category: "Operations",
    currency: "NGN",
    amount_minor: 9000,
    cadence: "monthly",
    interval_count: 1,
    billing_anchor: "2026-10-20",
    renewal_date: "2027-10-20",
    cancellation_deadline: "",
    auto_renew: true,
    payment_method: "card",
    payment_account: "Test",
  });
  assert.equal(r.report(f, "ng", 30).totals.forecast_minor, 9000);
  const e = expense(s, { due_date: "2026-10-20" });
  sub.record(f, plan.id, { due_date: "2026-10-20", spend_id: e.id });
  let d = r.report(f, "ng", 30);
  assert.equal(d.totals.forecast_minor, 10000);
  assert.equal(d.totals.forecast_estimates_minor, 0);
  settle(s, e.id);
  assert.equal(r.report(f, "ng", 30).totals.forecast_minor, 0);
  assert.throws(() => r.report(f, "ng", 31), /horizon/);
});
test("refund requires matched credit, posts once, caps total and preserves original expense", (t) => {
  const { s, r, f, report } = fixture(t);
  const e = expense(s);
  assert.throws(
    () =>
      r.createRefund(f, {
        spend_id: e.id,
        amount_minor: 100,
        reference: "EARLY",
        reason: "Test refund",
        date: "2026-10-19",
      }),
    /settled/,
  );
  settle(s, e.id);
  const base = report();
  const input = {
    spend_id: e.id,
    amount_minor: 4000,
    reference: "REFUND-A",
    reason: "Returned equipment",
    date: "2026-10-19",
  };
  const refund = r.createRefund(f, input);
  assert.equal(r.createRefund(f, input).id, refund.id);
  assert.equal(
    report().totals.net_posted_cost_minor,
    base.totals.net_posted_cost_minor,
  );
  assert.throws(
    () =>
      r.createRefund(f, {
        ...input,
        reference: "REFUND-B",
        amount_minor: 6001,
      }),
    /exceed/,
  );
  assert.throws(
    () => r.refundAction(f, refund.id, { action: "post" }),
    /available/,
  );
  statement(s, "WRONG-DEBIT", 4000);
  assert.throws(
    () =>
      r.refundAction(s.actor("reconciler"), refund.id, {
        action: "reconcile",
        reference: "WRONG-DEBIT",
      }),
    /credit/,
  );
  statement(s, "CREDIT-A", 4000, "credit");
  r.refundAction(s.actor("reconciler"), refund.id, {
    action: "reconcile",
    reference: "CREDIT-A",
  });
  r.refundAction(f, refund.id, { action: "post" });
  r.refundAction(f, refund.id, { action: "post" });
  assert.equal(
    report().totals.net_posted_cost_minor,
    base.totals.net_posted_cost_minor - 4000,
  );
  assert.equal(
    report().totals.gross_posted_cost_minor,
    base.totals.gross_posted_cost_minor,
  );
  assert.equal(
    s.get(
      "SELECT COUNT(*) n FROM journals WHERE idempotency_key=?",
      `${refund.id}:refund`,
    ).n,
    1,
  );
  assert.equal(s.spend(f, e.id).amount_minor, 10000);
  assert.equal(s.spend(f, e.id).outstanding_minor, 0);
  const second = r.createRefund(f, {
    ...input,
    reference: "REFUND-B",
    amount_minor: 4000,
  });
  assert.throws(
    () =>
      r.refundAction(s.actor("reconciler"), second.id, {
        action: "reconcile",
        reference: "CREDIT-A",
      }),
    /unmatched/,
  );
  r.refundAction(f, second.id, { action: "cancel" });
  r.createRefund(f, { ...input, reference: "REFUND-C", amount_minor: 6000 });
  assert.ok(s.verifyAudit());
});
test("credits cannot settle expenses and statement direction is immutable on reimport", (t) => {
  const { s, f } = fixture(t);
  const e = expense(s);
  approve(s, e.id);
  s.action(f, e.id, "schedule");
  s.action(s.actor("payer"), e.id, "confirm", { reference: "OUT" });
  statement(s, "IN", 10000, "credit");
  assert.throws(
    () =>
      s.action(s.actor("reconciler"), e.id, "reconcile", { reference: "IN" }),
    /debit/,
  );
  assert.throws(() => statement(s, "IN", 10000, "debit"), /different/);
  assert.throws(
    () => statement(s, "BAD", 10000, "credit", "2026-02-30"),
    /CSV/,
  );
});
test("report/refunds enforce roles and entity access; closed refund period rolls back", (t) => {
  const { s, r, f } = fixture(t);
  assert.throws(() => r.report(s.actor("employee"), "ng"), /role/);
  assert.throws(() => r.report({ ...f, entities: ["inc"] }, "ng"), /entity/);
  const e = expense(s);
  settle(s, e.id);
  const input = {
    spend_id: e.id,
    amount_minor: 1000,
    reference: "CLOSED",
    reason: "Refund testing",
    date: "2026-10-19",
  };
  assert.throws(() => r.createRefund(s.actor("auditor"), input), /role/);
  const refund = r.createRefund(f, input);
  statement(s, "CLOSED-CREDIT", 1000, "credit");
  assert.throws(
    () =>
      r.refundAction(f, refund.id, {
        action: "reconcile",
        reference: "CLOSED-CREDIT",
      }),
    /role/,
  );
  r.refundAction(s.actor("reconciler"), refund.id, {
    action: "reconcile",
    reference: "CLOSED-CREDIT",
  });
  s.run(
    "UPDATE periods SET status='closed' WHERE entity_id='ng' AND period='2026-10'",
  );
  assert.throws(
    () => r.refundAction(f, refund.id, { action: "post" }),
    /period/,
  );
  assert.equal(
    s.get("SELECT status FROM refunds WHERE id=?", refund.id).status,
    "reconciled",
  );
  assert.equal(
    s.get(
      "SELECT COUNT(*) n FROM journals WHERE idempotency_key=?",
      `${refund.id}:refund`,
    ).n,
    0,
  );
});

test("report/refund HTTP endpoints require sessions and persist credit matching", async (t) => {
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
  const login = async (id: string) =>
    (await call("/demo/login", "", { user_id: id })).headers
      .get("set-cookie")!
      .split(";")[0];
  assert.equal((await call("/reports/operations?entity=ng")).status, 401);
  const finance = await login("finance"),
    reconciler = await login("reconciler"),
    employee = await login("employee");
  assert.equal(
    (await call("/reports/operations?entity=ng", employee)).status,
    403,
  );
  assert.equal(
    (await call("/reports/operations?entity=ng&days=90", finance)).status,
    200,
  );
  const e = expense(s);
  settle(s, e.id);
  const response = await call("/refunds", finance, {
    spend_id: e.id,
    amount_minor: 1500,
    reference: "HTTP-REFUND",
    reason: "HTTP test refund",
    date: "2026-10-19",
  });
  assert.equal(response.status, 201);
  const refund: any = await response.json();
  statement(s, "HTTP-CREDIT", 1500, "credit");
  assert.equal(
    (
      await call(`/refunds/${refund.id}/action`, finance, {
        action: "reconcile",
        reference: "HTTP-CREDIT",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/refunds/${refund.id}/action`, reconciler, {
        action: "reconcile",
        reference: "HTTP-CREDIT",
      })
    ).status,
    201,
  );
  assert.equal(
    (await call(`/refunds/${refund.id}/action`, finance, { action: "post" }))
      .status,
    201,
  );
  const report: any = await (
    await call("/reports/operations?entity=ng", finance)
  ).json();
  assert.equal(report.refunds[0].status, "posted");
  assert.equal(report.totals.posted_refunds_minor, 1500);
});
