import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinanceStore } from "../src/domain";
import { ReportingService } from "../src/reporting";
import { RecoveryService } from "../src/recoveries";
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
function expense(s: FinanceStore, extra: any = {}, requester = "employee") {
  const e = s.createSpend(s.actor(requester), {
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
  s.upload(s.actor(requester), e.id, {
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
function debt(s: FinanceStore) {
  const e = expense(s, {
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-10-01",
  });
  settle(s, e.id);
  return {
    e,
    ad: postAdjustment(s, e.id, {
      kind: "personal_refund",
      amount_minor: 6000,
    }),
  };
}
const transfer = (id: string, extra: any = {}) => ({
  adjustment_id: id,
  amount_minor: 2000,
  date: "2026-10-19",
  reference: "REC-001",
  note: "Synthetic transfer to Jaye",
  ...extra,
});
function recover(
  s: FinanceStore,
  svc: RecoveryService,
  id: string,
  amount: number,
  ref: string,
) {
  const p = svc.create(
    s.actor("employee"),
    transfer(id, { amount_minor: amount, reference: ref }),
  );
  statement(s, `BANK-${ref}`, amount, "credit");
  svc.action(s.actor("reconciler"), p.id, {
    action: "reconcile",
    reference: `BANK-${ref}`,
  });
  return svc.action(s.actor("finance"), p.id, { action: "post" });
}
test("partial recoveries clear receivable only after posting, without re-counting expense or reimbursement", (t) => {
  const { s, f, report } = fixture(t);
  const { e, ad } = debt(s);
  const svc = new RecoveryService(s, () => "2026-10-19");
  const cash = balance(s, "1100"),
    cost = report().totals.net_posted_cost_minor,
    owed = report().totals.reimbursements_minor;
  const p = svc.create(s.actor("employee"), transfer(ad.id));
  assert.equal(svc.create(s.actor("employee"), transfer(ad.id)).id, p.id);
  let o = svc.list(f, "ng").obligations[0];
  assert.equal(o.outstanding_minor, 6000);
  assert.equal(o.pending_minor, 2000);
  assert.equal(o.available_minor, 4000);
  statement(s, "BANK-ONE", 2000, "credit");
  svc.action(s.actor("reconciler"), p.id, {
    action: "reconcile",
    reference: "BANK-ONE",
  });
  assert.equal(s.spend(f, e.id).recoverable_minor, 6000);
  svc.action(f, p.id, { action: "post" });
  svc.action(f, p.id, { action: "post" });
  assert.equal(s.spend(f, e.id).recoverable_minor, 4000);
  assert.equal(balance(s, "1200"), 4000);
  assert.equal(balance(s, "1100"), cash + 2000);
  assert.equal(report().totals.net_posted_cost_minor, cost);
  recover(s, svc, ad.id, 4000, "SECOND");
  assert.equal(s.spend(f, e.id).recoverable_minor, 0);
  assert.equal(s.spend(f, e.id).reimbursed_minor, 10000);
  assert.equal(s.spend(f, e.id).settlement_status, "Settled after adjustment");
  assert.equal(balance(s, "1200"), 0);
  assert.equal(balance(s, "1100"), cash + 6000);
  assert.equal(report().totals.recoverable_minor, 0);
  assert.equal(report().totals.reimbursements_minor, owed);
  assert.equal(report().totals.net_posted_cost_minor, cost);
  assert.equal(svc.list(f, "ng").obligations[0].recovered_minor, 6000);
  assert.equal(
    s.get(
      "SELECT COUNT(*) n FROM journals WHERE idempotency_key=?",
      `${p.id}:recovery`,
    ).n,
    1,
  );
  assert.ok(s.verifyAudit());
});
test("pending reservations prevent overpayment, cancellation releases capacity, references cannot change", (t) => {
  const { s, f } = fixture(t);
  const { ad } = debt(s);
  const svc = new RecoveryService(s, () => "2026-10-19");
  const p = svc.create(f, transfer(ad.id, { amount_minor: 5000 }));
  assert.throws(
    () =>
      svc.create(
        f,
        transfer(ad.id, { reference: "EXCESS", amount_minor: 1001 }),
      ),
    /exceeds/,
  );
  assert.throws(
    () => svc.create(f, transfer(ad.id, { amount_minor: 4000 })),
    /different/,
  );
  svc.action(f, p.id, { action: "cancel" });
  assert.equal(svc.list(f, "ng").obligations[0].available_minor, 6000);
  const paid = recover(s, svc, ad.id, 6000, "FULL");
  assert.throws(
    () => svc.create(f, transfer(ad.id, { reference: "AFTER" })),
    /exceeds/,
  );
  assert.throws(
    () => svc.action(f, paid.id, { action: "cancel" }),
    /unmatched/,
  );
  assert.throws(
    () =>
      s.run("UPDATE recovery_payments SET amount_minor=1 WHERE id=?", paid.id),
    /immutable/,
  );
  assert.throws(
    () => s.run("DELETE FROM recovery_payments WHERE id=?", p.id),
    /immutable/,
  );
});
test("bank credits cannot be reused across recovery payments and vendor refunds in either direction", (t) => {
  const { s, f, r } = fixture(t);
  const { e, ad } = debt(s);
  const svc = new RecoveryService(s, () => "2026-10-19");
  const p = svc.create(f, transfer(ad.id));
  const q = svc.create(f, transfer(ad.id, { reference: "REC-002" }));
  statement(s, "CREDIT", 2000, "credit");
  svc.action(s.actor("reconciler"), p.id, {
    action: "reconcile",
    reference: "CREDIT",
  });
  assert.throws(
    () =>
      svc.action(s.actor("reconciler"), q.id, {
        action: "reconcile",
        reference: "CREDIT",
      }),
    /unmatched/,
  );
  const cash = r.createRefund(f, {
    spend_id: e.id,
    amount_minor: 2000,
    reference: "VENDOR",
    reason: "Other vendor refund",
    date: "2026-10-19",
  });
  assert.throws(
    () =>
      r.refundAction(s.actor("reconciler"), cash.id, {
        action: "reconcile",
        reference: "CREDIT",
      }),
    /unmatched/,
  );
  statement(s, "VENDOR-CREDIT", 2000, "credit");
  r.refundAction(s.actor("reconciler"), cash.id, {
    action: "reconcile",
    reference: "VENDOR-CREDIT",
  });
  assert.throws(
    () =>
      svc.action(s.actor("reconciler"), q.id, {
        action: "reconcile",
        reference: "VENDOR-CREDIT",
      }),
    /unmatched/,
  );
  assert.throws(
    () =>
      svc.create(f, transfer(ad.id, { reference: "VENDOR", amount_minor: 1 })),
    /vendor refund/,
  );
  assert.throws(
    () =>
      r.createRefund(f, {
        spend_id: e.id,
        amount_minor: 1,
        reference: "REC-001",
        reason: "Duplicate transfer",
        date: "2026-10-19",
      }),
    /recovery/,
  );
});
test("exact bank direction, date and amount; roles, own balance and separation of duties", (t) => {
  const { s, f } = fixture(t);
  const { ad } = debt(s);
  const svc = new RecoveryService(s, () => "2026-10-19");
  const p = svc.create(s.actor("employee"), transfer(ad.id));
  assert.equal(svc.list(s.actor("manager"), "ng").obligations.length, 0);
  assert.throws(() => svc.create(s.actor("manager"), transfer(ad.id)), /own/);
  assert.throws(
    () => svc.action(s.actor("employee"), p.id, { action: "post" }),
    /role/,
  );
  assert.throws(() => svc.list({ ...f, entities: ["inc"] }, "ng"), /entity/);
  assert.throws(
    () =>
      svc.create(
        f,
        transfer(ad.id, { reference: "BADDATE", date: "2026-10-18" }),
      ),
    /date/,
  );
  statement(s, "DEBIT", 2000, "debit");
  statement(s, "WRONGDATE", 2000, "credit", "2026-10-18");
  statement(s, "WRONGAMOUNT", 1000, "credit");
  for (const reference of ["DEBIT", "WRONGDATE", "WRONGAMOUNT"])
    assert.throws(
      () =>
        svc.action(s.actor("reconciler"), p.id, {
          action: "reconcile",
          reference,
        }),
      /exact/,
    );
  statement(s, "RIGHT", 2000, "credit");
  assert.throws(
    () =>
      svc.action({ ...s.actor("employee"), role: "reconciler" }, p.id, {
        action: "reconcile",
        reference: "RIGHT",
      }),
    /separate/,
  );
  svc.action(s.actor("reconciler"), p.id, {
    action: "reconcile",
    reference: "RIGHT",
  });
  assert.throws(
    () =>
      svc.action({ ...s.actor("reconciler"), role: "finance" }, p.id, {
        action: "post",
      }),
    /separate/,
  );
});
test("closed period rolls back recovery posting; matched repayment survives reopening database", (t) => {
  const { s, f } = fixture(t);
  const { ad } = debt(s);
  const svc = new RecoveryService(s, () => "2026-10-19");
  const p = svc.create(f, transfer(ad.id));
  statement(s, "CREDIT", 2000, "credit");
  svc.action(s.actor("reconciler"), p.id, {
    action: "reconcile",
    reference: "CREDIT",
  });
  s.run(
    "UPDATE periods SET status='closed' WHERE entity_id='ng' AND period='2026-10'",
  );
  assert.throws(() => svc.action(f, p.id, { action: "post" }), /period/);
  assert.equal(balance(s, "1200"), 6000);
  assert.equal(
    s.get("SELECT status FROM recovery_payments WHERE id=?", p.id).status,
    "reconciled",
  );
  const again = new FinanceStore(join(s.dir, "db"));
  try {
    assert.equal(
      new RecoveryService(again).list(f, "ng").obligations[0].pending_minor,
      2000,
    );
    assert.equal(
      again.bankTransactions(f, "ng").find((b) => b.reference === "CREDIT")
        .matched_recovery_id,
      p.id,
    );
  } finally {
    again.db.close();
  }
});
test("recovery HTTP routes allow own reporting and repay/match/post flow", async (t) => {
  const { s } = fixture(t);
  const { ad } = debt(s);
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
  assert.equal((await call("/recoveries?entity=ng")).status, 401);
  const emp = await login("employee"),
    fin = await login("finance"),
    rec = await login("reconciler");
  const created = await call("/recoveries", emp, transfer(ad.id));
  assert.equal(created.status, 201);
  const p: any = await created.json();
  statement(s, "HTTP-CREDIT", 2000, "credit");
  assert.equal(
    (
      await call(`/recoveries/${p.id}/action`, emp, {
        action: "reconcile",
        reference: "HTTP-CREDIT",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/recoveries/${p.id}/action`, rec, {
        action: "reconcile",
        reference: "HTTP-CREDIT",
      })
    ).status,
    201,
  );
  assert.equal(
    (await call(`/recoveries/${p.id}/action`, fin, { action: "post" })).status,
    201,
  );
  const data: any = await (await call("/recoveries?entity=ng", emp)).json();
  assert.equal(data.people[0].outstanding_minor, 4000);
  assert.equal(data.banks.length, 0);
});

test("founder can record their own recovery, but cannot post or record another person's repayment", (t) => {
  const { s, f } = fixture(t);
  const e = expense(
    s,
    {
      payment_source: "founder",
      paid_by_id: "cfo",
      original_paid_date: "2026-10-01",
    },
    "cfo",
  );
  s.action(s.actor("cfo"), e.id, "submit");
  s.action(s.actor("manager"), e.id, "approve");
  s.action(f, e.id, "approve");
  payRemaining(s, e.id, 10000);
  const ad = postAdjustment(s, e.id, {
    kind: "personal_refund",
    amount_minor: 5000,
  });
  const svc = new RecoveryService(s, () => "2026-10-19");
  const p = svc.create(s.actor("cfo"), transfer(ad.id));
  assert.equal(svc.list(s.actor("employee"), "ng").obligations.length, 0);
  assert.equal(
    svc.list(s.actor("cfo"), "ng").people[0].outstanding_minor,
    5000,
  );
  assert.throws(
    () =>
      svc.action({ ...s.actor("cfo"), role: "finance" }, p.id, {
        action: "post",
      }),
    /separate/,
  );
  svc.action(s.actor("cfo"), p.id, { action: "cancel" });
  assert.equal(svc.list(f, "ng").obligations[0].available_minor, 5000);
});
