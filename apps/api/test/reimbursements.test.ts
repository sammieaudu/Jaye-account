import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinanceStore } from "../src/domain";
import { createFinanceApp } from "../src/main";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-claims-"));
  const s = new FinanceStore(join(dir, "test.db"));
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return s;
}
function expense(s: FinanceStore, n: number, extra: any = {}) {
  const c = s.createSpend(s.actor("employee"), {
    entity_id: "ng",
    kind: "expense",
    vendor_id: "ng-v0",
    description: `Personal purchase ${n}`,
    purpose: "Business travel expense for claim testing",
    amount_minor: n,
    currency: "NGN",
    department: "Operations",
    category: "Operations",
    date: "2026-10-19",
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-10-19",
    payment_method: "card",
    ...extra,
  });
  s.upload(s.actor("employee"), c.id, {
    originalname: `receipt-${n}.pdf`,
    mimetype: "application/pdf",
    buffer: Buffer.from(`%PDF-1.4\nSynthetic claim receipt ${n}`),
  });
  return c;
}
function group(s: FinanceStore, amounts = [10000, 20000]) {
  const items = amounts.map((n) => expense(s, n));
  return s.saveClaim(s.actor("employee"), {
    entity_id: "ng",
    title: "October travel claim",
    spend_ids: items.map((s) => s.id),
  });
}
function approve(s: FinanceStore, id: string) {
  for (const [actor, action] of [
    ["employee", "submit"],
    ["manager", "approve"],
    ["finance", "approve"],
  ])
    s.claimAction(s.actor(actor), id, { action });
  if (s.claim(s.actor("finance"), id).status === "cfo_review")
    s.claimAction(s.actor("cfo"), id, { action: "approve" });
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
  s.importStatement(
    s.actor("finance"),
    "ng",
    `reference,date,currency,amount_minor,description\nSTMT-${ref},2026-10-19,NGN,${amount},Synthetic repayment`,
  );
  s.repaymentAction(s.actor("reconciler"), p.id, {
    action: "reconcile",
    reference: `STMT-${ref}`,
  });
  return {
    payment: p,
    claim: s.repaymentAction(s.actor("finance"), p.id, { action: "post" }),
  };
}
test("grouped claim: two partial repayments settle exact balances and book expenses only once", (t) => {
  const s = fixture(t),
    c = group(s);
  approve(s, c.id);
  const baseline = s.trialBalance(s.actor("finance"), "ng");
  const oldCash = baseline.find((r) => r.code === "1100").balance;
  const first = repay(s, c.id, 12000, "FIRST");
  assert.equal(first.claim.reimbursed_minor, 12000);
  assert.equal(first.claim.outstanding_minor, 18000);
  assert.equal(first.claim.settlement_status, "Partially reimbursed");
  assert.equal(
    first.claim.items.reduce((n: number, r: any) => n + r.outstanding_minor, 0),
    18000,
  );
  let summary = s
    .reimbursements(s.actor("employee"), "ng")
    .balances.find((b) => b.person_id === "employee");
  assert.equal(summary.owed_minor, 18000);
  const mid = s.trialBalance(s.actor("finance"), "ng");
  assert.equal(mid.find((r) => r.code === "1100").balance, oldCash - 12000);
  assert.equal(mid.find((r) => r.code === "2100").balance, -18000);
  const budget = s
    .budgets(s.actor("finance"), "ng")
    .find((b) => b.department === "Operations" && b.category === "Operations");
  assert.equal(budget.actual_minor, 30000);
  assert.equal(
    s
      .dashboard(s.actor("finance"), "ng")
      .by_category.find((c) => c.category === "Operations")!.amount_minor,
    30000,
  );
  const second = repay(s, c.id, 18000, "SECOND");
  assert.equal(second.claim.outstanding_minor, 0);
  assert.equal(second.claim.settlement_status, "Reimbursed");
  assert.ok(second.claim.items.every((s: any) => s.status === "posted"));
  const totals = s.get(
    "SELECT SUM(l.debit) AS total FROM lines l JOIN journals j ON j.id=l.journal_id WHERE j.source_id IN (SELECT spend_id FROM reimbursement_items WHERE claim_id=?) AND l.account='6300'",
    c.id,
  );
  assert.equal(totals.total, 30000);
  assert.equal(
    s.trialBalance(s.actor("finance"), "ng").find((r) => r.code === "2100")
      .balance,
    0,
  );
  assert.equal(s.verifyAudit(), true);
  assert.throws(
    () =>
      s.repaymentAction(s.actor("finance"), second.payment.id, {
        action: "post",
      }),
    /not ready/,
  );
  assert.throws(
    () =>
      s.scheduleRepayment(s.actor("finance"), c.id, {
        amount_minor: 1,
        date: "2026-10-19",
      }),
    /exceeds/,
  );
});
test("scheduled repayments reserve balance; cancellation frees it without deleting history", (t) => {
  const s = fixture(t),
    c = group(s);
  approve(s, c.id);
  let updated = s.scheduleRepayment(s.actor("finance"), c.id, {
    amount_minor: 20000,
    date: "2026-10-19",
  });
  assert.equal(updated.outstanding_minor, 30000);
  assert.equal(updated.available_minor, 10000);
  assert.throws(
    () =>
      s.scheduleRepayment(s.actor("finance"), c.id, {
        amount_minor: 10001,
        date: "2026-10-19",
      }),
    /exceeds/,
  );
  assert.equal(s.claim(s.actor("finance"), c.id).payments.length, 1);
  updated = s.repaymentAction(s.actor("finance"), updated.payments[0].id, {
    action: "cancel",
  });
  assert.equal(updated.available_minor, 30000);
  assert.equal(updated.payments[0].status, "cancelled");
  assert.throws(
    () =>
      s.repaymentAction(s.actor("payer"), updated.payments[0].id, {
        action: "confirm",
        reference: "BAD",
      }),
    /not ready/,
  );
  assert.throws(
    () =>
      s.run(
        "DELETE FROM reimbursement_payments WHERE id=?",
        updated.payments[0].id,
      ),
    /immutable/,
  );
});
test("whole-claim approval threshold, evidence and independent actors are enforced", (t) => {
  const s = fixture(t);
  s.run("UPDATE budgets SET amount_minor=1000000000");
  const c = group(s, [26000000, 25000000]);
  for (const [actor, action] of [
    ["employee", "submit"],
    ["manager", "approve"],
    ["finance", "approve"],
  ])
    s.claimAction(s.actor(actor), c.id, { action });
  const current = s.claim(s.actor("finance"), c.id);
  assert.equal(current.status, "cfo_review");
  assert.ok(current.items.every((s: any) => s.status === "cfo_review"));
  assert.throws(
    () =>
      s.scheduleRepayment(s.actor("finance"), c.id, {
        amount_minor: 100,
        date: "2026-10-19",
      }),
    /exceeds/,
  );
  s.claimAction(s.actor("cfo"), c.id, { action: "approve" });
  const p = s.scheduleRepayment(s.actor("finance"), c.id, {
    amount_minor: 100,
    date: "2026-10-19",
  }).payments[0];
  assert.throws(
    () =>
      s.repaymentAction({ ...s.actor("employee"), role: "payer" }, p.id, {
        action: "confirm",
        reference: "SELF",
      }),
    /Separation/,
  );
  assert.throws(
    () =>
      s.repaymentAction({ ...s.actor("finance"), role: "payer" }, p.id, {
        action: "confirm",
        reference: "SELF2",
      }),
    /Separation/,
  );
  assert.throws(
    () => s.action(s.actor("finance"), c.items[0].id, "schedule"),
    /through its reimbursement claim/,
  );
  const missing = s.createSpend(s.actor("employee"), {
    entity_id: "ng",
    kind: "expense",
    vendor_id: "ng-v0",
    description: "Missing receipt",
    purpose: "Expense without evidence for test",
    amount_minor: 4321,
    currency: "NGN",
    department: "Operations",
    category: "Operations",
    date: "2026-10-19",
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-10-19",
    payment_method: "cash",
  });
  const clean = expense(s, 7654);
  const pending = s.saveClaim(s.actor("employee"), {
    entity_id: "ng",
    title: "Evidence missing",
    spend_ids: [clean.id, missing.id],
  });
  assert.throws(
    () => s.claimAction(s.actor("employee"), pending.id, { action: "submit" }),
    /Receipt/,
  );
  assert.ok(
    s
      .claim(s.actor("employee"), pending.id)
      .items.every((s: any) => s.status === "draft"),
  );
});
test("group membership prevents duplicates and cross-person/entity claims; returned claims can change with audit", (t) => {
  const s = fixture(t),
    c = group(s);
  assert.throws(
    () =>
      s.saveClaim(s.actor("employee"), {
        entity_id: "ng",
        title: "Duplicate group",
        spend_ids: [c.items[0].id],
      }),
    /another claim/,
  );
  const other = expense(s, 5432, {
    entity_id: "inc",
    currency: "USD",
    vendor_id: "inc-v0",
  });
  assert.throws(
    () =>
      s.saveClaim(
        s.actor("employee"),
        {
          entity_id: "ng",
          title: "Mixed group",
          spend_ids: [c.items[0].id, other.id],
        },
        c.id,
      ),
    /Reload/,
  );
  assert.throws(
    () =>
      s.saveClaim(
        s.actor("employee"),
        {
          entity_id: "ng",
          title: "Mixed group",
          expected_revision: 0,
          spend_ids: [c.items[0].id, other.id],
        },
        c.id,
      ),
    /one person/,
  );
  s.claimAction(s.actor("employee"), c.id, { action: "submit" });
  assert.throws(
    () =>
      s.saveClaim(
        s.actor("employee"),
        {
          entity_id: "ng",
          title: "Change locked",
          expected_revision: 1,
          spend_ids: [c.items[0].id],
        },
        c.id,
      ),
    /draft or returned/,
  );
  s.claimAction(s.actor("manager"), c.id, {
    action: "return",
    comment: "Remove second expense",
  });
  const returned = s.claim(s.actor("employee"), c.id);
  const edited = s.saveClaim(
    s.actor("employee"),
    {
      entity_id: "ng",
      title: "Corrected claim",
      expected_revision: returned.revision,
      spend_ids: [c.items[0].id],
    },
    c.id,
  );
  assert.equal(edited.total_minor, c.items[0].amount_minor);
  assert.equal(s.spend(s.actor("employee"), c.items[1].id).claim_id, undefined);
  approve(s, c.id);
  assert.equal(s.claim(s.actor("finance"), c.id).status, "approved");
});
test("statement and bank references cannot be reused across expenses and repayments", (t) => {
  const s = fixture(t),
    c = group(s);
  approve(s, c.id);
  const p = s.scheduleRepayment(s.actor("finance"), c.id, {
    amount_minor: 10000,
    date: "2026-10-19",
  }).payments[0];
  s.repaymentAction(s.actor("payer"), p.id, {
    action: "confirm",
    reference: "UNIQUE-PAY",
  });
  s.importStatement(
    s.actor("finance"),
    "ng",
    "reference,date,currency,amount_minor,description\nUNIQUE-STMT,2026-10-19,NGN,10000,Repayment",
  );
  s.repaymentAction(s.actor("reconciler"), p.id, {
    action: "reconcile",
    reference: "UNIQUE-STMT",
  });
  const p2 = s
    .scheduleRepayment(s.actor("finance"), c.id, {
      amount_minor: 10000,
      date: "2026-10-19",
    })
    .payments.find((p: any) => p.status === "scheduled");
  assert.throws(
    () =>
      s.repaymentAction(s.actor("payer"), p2.id, {
        action: "confirm",
        reference: "UNIQUE-PAY",
      }),
    /already been used/,
  );
  s.repaymentAction(s.actor("payer"), p2.id, {
    action: "confirm",
    reference: "UNIQUE-PAY-2",
  });
  assert.throws(
    () =>
      s.repaymentAction(s.actor("reconciler"), p2.id, {
        action: "reconcile",
        reference: "UNIQUE-STMT",
      }),
    /unmatched/,
  );
  assert.equal(
    s
      .bankTransactions(s.actor("finance"), "ng")
      .find((b) => b.reference === "UNIQUE-STMT").matched_repayment_id,
    p.id,
  );
  s.run(
    "UPDATE spends SET status='paid',amount_minor=10000 WHERE id='ng-SP-0006'",
  );
  assert.throws(
    () =>
      s.action(s.actor("reconciler"), "ng-SP-0006", "reconcile", {
        reference: "UNIQUE-STMT",
      }),
    /unmatched/,
  );
});
test("HTTP reimbursement routes protect access and support grouping and partial scheduling", async (t) => {
  const s = fixture(t);
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
  assert.equal((await call("/reimbursements?entity=ng")).status, 401);
  const investor = await login("investor");
  assert.equal((await call("/reimbursements?entity=ng", investor)).status, 403);
  const employee = await login("employee"),
    finance = await login("finance");
  const items = [expense(s, 10100), expense(s, 20200)];
  const response = await call("/reimbursements", employee, {
    entity_id: "ng",
    title: "HTTP claim",
    spend_ids: items.map((c) => c.id),
  });
  assert.equal(response.status, 201);
  const c: any = await response.json();
  approve(s, c.id);
  assert.equal(
    (
      await call(`/reimbursements/${c.id}/repayments`, employee, {
        amount_minor: 100,
        date: "2026-10-19",
      })
    ).status,
    403,
  );
  const partial = await call(`/reimbursements/${c.id}/repayments`, finance, {
    amount_minor: 100,
    date: "2026-10-19",
  });
  assert.equal(partial.status, 201);
  assert.equal((await partial.json()).available_minor, 30200);
  assert.equal(
    (
      await call(`/reimbursements/${c.id}/action`, employee, {
        action: "submit",
      })
    ).status,
    400,
  );
});

test("founder claims stay scoped, export the recipient and retain partial balances after reopening", (t) => {
  const s = fixture(t);
  s.run(
    "INSERT INTO users VALUES(?,?,?,?)",
    "founder-sample",
    "Founder Example",
    "employee",
    JSON.stringify(["ng"]),
  );
  const actor = s.actor("founder-sample");
  const draft = s.createSpend(actor, {
    entity_id: "ng",
    kind: "expense",
    vendor_id: "ng-v0",
    description: "Founder-funded business travel",
    purpose: "Repayable founder business expense for testing",
    amount_minor: 40000,
    currency: "NGN",
    department: "Operations",
    category: "Travel",
    date: "2026-10-19",
    payment_source: "founder",
    paid_by_id: actor.id,
    original_paid_date: "2026-10-19",
    payment_method: "card",
  });
  s.upload(actor, draft.id, {
    originalname: "founder.pdf",
    mimetype: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 founder reimbursement evidence"),
  });
  const c = s.saveClaim(actor, {
    entity_id: "ng",
    title: "Founder travel claim",
    spend_ids: [draft.id],
  });
  assert.throws(() => s.claim(s.actor("employee"), c.id), /own claims/);
  assert.equal(s.reimbursements(s.actor("employee"), "ng").claims.length, 0);
  assert.throws(
    () => s.reimbursements(s.actor("admin"), "ng"),
    /Technical administrators/,
  );
  s.claimAction(actor, c.id, { action: "submit" });
  s.claimAction(s.actor("manager"), c.id, { action: "approve" });
  s.claimAction(s.actor("finance"), c.id, { action: "approve" });
  const scheduled = s.scheduleRepayment(s.actor("finance"), c.id, {
    amount_minor: 15000,
    date: "2026-10-19",
  });
  assert.match(s.paymentFile(s.actor("finance"), "ng"), /Founder Example/);
  assert.throws(
    () =>
      s.repaymentAction({ ...actor, role: "payer" }, scheduled.payments[0].id, {
        action: "confirm",
        reference: "SELF",
      }),
    /Separation/,
  );
  s.repaymentAction(s.actor("payer"), scheduled.payments[0].id, {
    action: "confirm",
    reference: "FOUNDER-PARTIAL",
  });
  const reopened = new FinanceStore(join(s.dir, "test.db"));
  try {
    const persisted = reopened.claim(actor, c.id);
    assert.equal(persisted.outstanding_minor, 25000);
    assert.equal(persisted.reimbursed_minor, 15000);
    assert.equal(
      reopened.reimbursements(actor, "ng").balances[0].owed_minor,
      25000,
    );
    assert.equal(reopened.verifyAudit(), true);
  } finally {
    reopened.db.close();
  }
});
test("invalid repayment amounts and closed expense periods roll back scheduling atomically", (t) => {
  const s = fixture(t),
    c = group(s);
  approve(s, c.id);
  for (const amount of [0, -100, 1.5, Number.MAX_SAFE_INTEGER])
    assert.throws(
      () =>
        s.scheduleRepayment(s.actor("finance"), c.id, {
          amount_minor: amount,
          date: "2026-10-19",
        }),
      /positive repayment/,
    );
  assert.throws(
    () =>
      s.scheduleRepayment(s.actor("finance"), c.id, {
        amount_minor: 100,
        date: "2026-02-30",
      }),
    /valid payment date/,
  );
  s.run("UPDATE periods SET status='closed' WHERE entity_id='ng'");
  assert.throws(
    () =>
      s.scheduleRepayment(s.actor("finance"), c.id, {
        amount_minor: 100,
        date: "2026-10-19",
      }),
    /period is not open/i,
  );
  assert.equal(s.claim(s.actor("finance"), c.id).payments.length, 0);
  assert.equal(
    s.all("SELECT * FROM journals WHERE source_id=?", c.items[0].id).length,
    0,
  );
});
