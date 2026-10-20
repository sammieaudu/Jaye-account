import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FinanceStore, csv } from "../src/domain";

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-test-"));
  const s = new FinanceStore(join(dir, "test.db"));
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return s;
}
function claim(s: FinanceStore, extra: any = {}) {
  return s.createSpend(s.actor("employee"), {
    entity_id: "ng",
    kind: "expense",
    vendor_id: "ng-v0",
    description: "Fuel for local test",
    purpose: "Testing the evidence and approval controls",
    amount_minor: 123456,
    currency: "NGN",
    department: "Operations",
    category: "Operations",
    date: "2026-10-19",
    ...extra,
  });
}
function evidence(
  s: FinanceStore,
  id: string,
  bytes = "%PDF-1.4\nSYNTHETIC TEST ONLY",
) {
  s.upload(s.actor("employee"), id, {
    originalname: "test.pdf",
    mimetype: "application/pdf",
    buffer: Buffer.from(bytes),
  });
}
function approve(s: FinanceStore, id: string) {
  s.action(s.actor("employee"), id, "submit");
  s.action(s.actor("manager"), id, "approve");
  s.action(s.actor("finance"), id, "approve");
  if (s.spend(s.actor("finance"), id).status === "cfo_review")
    s.action(s.actor("cfo"), id, "approve");
}
function statement(s: FinanceStore, c: any, reference = "TEST-STMT-001") {
  return s.importStatement(
    s.actor("finance"),
    c.entity_id,
    `reference,date,currency,amount_minor,description\n${reference},${c.date},${c.currency},${c.amount_minor},Synthetic test debit`,
  );
}
function journal(extra: any = {}) {
  return {
    entity_id: "ng",
    date: "2026-10-19",
    description: "Golden test journal",
    idempotency_key: "test-journal",
    approved_by: "cfo",
    lines: [
      { account: "6300", debit: 100, credit: 0 },
      { account: "2100", debit: 0, credit: 100 },
    ],
    ...extra,
  };
}

test("golden scenario 2: evidence → approvals → simulated confirmation → reconciliation → balanced journals", (t) => {
  const s = fixture(t),
    c = claim(s);
  evidence(s, c.id);
  approve(s, c.id);
  s.action(s.actor("finance"), c.id, "schedule");
  s.action(s.actor("payer"), c.id, "confirm", { reference: "TEST-BANK-001" });
  statement(s, c);
  s.action(s.actor("reconciler"), c.id, "reconcile", {
    reference: "TEST-STMT-001",
  });
  const before = s.dashboard(s.actor("finance"), "ng").cash_minor;
  s.action(s.actor("finance"), c.id, "post");
  assert.equal(s.spend(s.actor("finance"), c.id).status, "posted");
  assert.equal(
    s.dashboard(s.actor("finance"), "ng").cash_minor,
    before - c.amount_minor,
  );
  assert.equal(
    s.trialBalance(s.actor("finance"), "ng").reduce((n, r) => n + r.balance, 0),
    0,
  );
  assert.equal(
    s.all("SELECT * FROM journals WHERE source_id=?", c.id).length,
    2,
  );
  assert.equal(s.verifyAudit(), true);
});
test("golden scenario 3 subset: approved request commitment becomes matched bill without double count", (t) => {
  const s = fixture(t),
    r = claim(s, {
      kind: "request",
      vendor_id: "ng-v1",
      category: "Marketing",
      department: "Marketing",
    });
  const before = s
    .budgetsRaw("ng")
    .find((b) => b.category === "Marketing").committed_minor;
  approve(s, r.id);
  assert.equal(
    s.budgetsRaw("ng").find((b) => b.category === "Marketing").committed_minor,
    before + r.amount_minor,
  );
  const b = claim(s, {
    kind: "bill",
    parent_id: r.id,
    vendor_id: r.vendor_id,
    category: r.category,
    department: r.department,
    invoice_number: "TEST-PO-001",
    date: "2026-10-20",
  });
  evidence(s, b.id);
  approve(s, b.id);
  assert.equal(
    s.budgetsRaw("ng").find((b) => b.category === "Marketing").committed_minor,
    before + r.amount_minor,
  );
  assert.throws(
    () => s.action(s.actor("finance"), r.id, "schedule"),
    /expenses or bills/,
  );
  assert.throws(
    () =>
      claim(s, {
        kind: "bill",
        parent_id: r.id,
        vendor_id: r.vendor_id,
        category: r.category,
        department: r.department,
        invoice_number: "TEST-PO-002",
      }),
    /UNIQUE/,
  );
});
test("missing receipt blocks submission and direct payment bypass", (t) => {
  const s = fixture(t),
    c = claim(s);
  assert.throws(() => s.action(s.actor("employee"), c.id, "submit"), /Receipt/);
  assert.throws(
    () => s.action(s.actor("payer"), c.id, "confirm", { reference: "TEST" }),
    /Schedule/,
  );
  assert.throws(() => s.action(s.actor("finance"), c.id, "post"), /Reconcile/);
});
test("requester cannot approve even after role elevation", (t) => {
  const s = fixture(t),
    c = claim(s);
  evidence(s, c.id);
  s.action(s.actor("employee"), c.id, "submit");
  s.run("UPDATE users SET role='manager' WHERE id='employee'");
  assert.throws(
    () => s.action(s.actor("employee"), c.id, "approve"),
    /Separation of duties/,
  );
});
test("approver cannot release or reconcile after role elevation", (t) => {
  const s = fixture(t),
    c = claim(s);
  evidence(s, c.id);
  approve(s, c.id);
  s.action(s.actor("finance"), c.id, "schedule");
  s.run("UPDATE users SET role='payer' WHERE id='manager'");
  assert.throws(
    () => s.action(s.actor("manager"), c.id, "confirm", { reference: "TEST" }),
    /Separation of duties/,
  );
  s.action(s.actor("payer"), c.id, "confirm", { reference: "TEST" });
  s.run("UPDATE users SET role='reconciler' WHERE id='payer'");
  assert.throws(
    () => s.action(s.actor("payer"), c.id, "reconcile", { reference: "TEST" }),
    /Separation of duties/,
  );
});
test("approval threshold is configuration, routing to CFO at the boundary", (t) => {
  const s = fixture(t);
  s.run("UPDATE policies SET cfo_threshold=? WHERE entity_id=?", 100000, "ng");
  const c = claim(s, { amount_minor: 100000 });
  evidence(s, c.id);
  s.action(s.actor("employee"), c.id, "submit");
  s.action(s.actor("manager"), c.id, "approve");
  s.action(s.actor("finance"), c.id, "approve");
  assert.equal(s.spend(s.actor("finance"), c.id).status, "cfo_review");
  assert.throws(() => s.action(s.actor("finance"), c.id, "schedule"));
});
test("duplicate invoice and duplicate same-day spend are blocked", (t) => {
  const s = fixture(t);
  claim(s, { kind: "bill", invoice_number: "TEST-UNIQUE" });
  assert.throws(
    () => claim(s, { kind: "bill", invoice_number: "TEST-UNIQUE" }),
    /UNIQUE/,
  );
  const c = claim(s);
  evidence(s, c.id);
  assert.throws(
    () => s.action(s.actor("employee"), c.id, "submit"),
    /Possible duplicate/,
  );
});
test("duplicate receipt content flagged and mismatched upload MIME blocked", (t) => {
  const s = fixture(t),
    a = claim(s),
    b = claim(s, { amount_minor: 99999 });
  evidence(s, a.id);
  evidence(s, b.id);
  assert.throws(
    () => s.action(s.actor("employee"), b.id, "submit"),
    /Duplicate receipt/,
  );
  assert.throws(
    () =>
      s.upload(s.actor("employee"), a.id, {
        originalname: "bad.png",
        mimetype: "image/png",
        buffer: Buffer.from("<script>test</script>"),
      }),
    /signature/,
  );
});
test("evidence decrypts, stays immutable after submission, and investor download denied", (t) => {
  const s = fixture(t),
    c = claim(s);
  evidence(s, c.id);
  const r = s.get("SELECT id FROM receipts WHERE spend_id=?", c.id);
  assert.equal(
    s.receipt(s.actor("employee"), r.id).content.toString(),
    "%PDF-1.4\nSYNTHETIC TEST ONLY",
  );
  s.action(s.actor("employee"), c.id, "submit");
  assert.throws(() => evidence(s, c.id), /draft or returned/);
  assert.throws(() => s.receipt(s.actor("investor"), r.id), /Investors/);
  assert.throws(
    () => s.run("DELETE FROM receipts WHERE id=?", r.id),
    /immutable/,
  );
});
test("government fees cannot submit without configured controls", (t) => {
  const s = fixture(t),
    c = claim(s, { category: "Government fees" });
  evidence(s, c.id);
  assert.throws(
    () => s.action(s.actor("employee"), c.id, "submit"),
    /Government payment gated/,
  );
});
test("foreign currency gated, wrong entity vendor and invalid money rejected", (t) => {
  const s = fixture(t);
  assert.throws(() => claim(s, { currency: "USD" }), /Cross-currency/);
  assert.throws(() => claim(s, { vendor_id: "inc-v0" }), /does not belong/);
  for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER])
    assert.throws(() => claim(s, { amount_minor: amount }));
});
test("employees are scoped to own records; entity permission holds for direct access", (t) => {
  const s = fixture(t);
  const c = s.createSpend(s.actor("finance"), {
    entity_id: "ng",
    kind: "request",
    vendor_id: "ng-v0",
    description: "Private finance request",
    purpose: "Testing access restriction",
    amount_minor: 99,
    currency: "NGN",
    department: "Finance",
    category: "Operations",
    date: "2026-10-19",
  });
  assert.throws(() => s.spend(s.actor("employee"), c.id), /own expenses/);
  const a = { ...s.actor("finance"), entities: ["inc"] };
  assert.throws(() => s.spend(a, c.id), /legal entity/);
  assert.throws(() => s.list(a, "ng"), /legal entity/);
});
test("investors and technical admins cannot read financial APIs", (t) => {
  const s = fixture(t);
  for (const role of ["investor", "admin"]) {
    const a = s.actor(role);
    for (const call of [
      () => s.dashboard(a, "ng"),
      () => s.list(a, "ng"),
      () => s.budgets(a, "ng"),
      () => s.journals(a, "ng"),
      () => s.auditLog(a, "ng"),
      () => s.vendors(a, "ng"),
    ])
      assert.throws(call);
  }
});
test("unbalanced, unapproved and closed-period journal rejected atomically", (t) => {
  const s = fixture(t),
    n = s.all("SELECT * FROM journals").length;
  assert.throws(
    () =>
      s.postJournal(
        s.actor("finance"),
        journal({
          lines: [
            { account: "6300", debit: 100, credit: 0 },
            { account: "2100", debit: 0, credit: 99 },
          ],
        }),
      ),
    /unbalanced/,
  );
  assert.throws(
    () => s.postJournal(s.actor("finance"), journal({ approved_by: null })),
    /approved/,
  );
  s.run("UPDATE periods SET status='closed' WHERE entity_id='ng'");
  assert.throws(() => s.postJournal(s.actor("finance"), journal()), /not open/);
  assert.equal(s.all("SELECT * FROM journals").length, n);
});
test("posted header and lines cannot change, delete, or receive extra lines via direct SQL", (t) => {
  const s = fixture(t),
    j = s.postJournal(s.actor("finance"), journal());
  assert.throws(
    () =>
      s.run("UPDATE journals SET description=? WHERE id=?", "changed", j.id),
    /immutable/,
  );
  assert.throws(
    () => s.run("DELETE FROM journals WHERE id=?", j.id),
    /immutable/,
  );
  assert.throws(
    () => s.run("UPDATE lines SET debit=999 WHERE journal_id=?", j.id),
    /immutable/,
  );
  assert.throws(
    () => s.run("DELETE FROM lines WHERE journal_id=?", j.id),
    /immutable/,
  );
  assert.throws(
    () =>
      s.run(
        "INSERT INTO lines(journal_id,entity_id,account,debit,credit) VALUES(?,?,?,?,?)",
        j.id,
        "ng",
        "6300",
        99,
        0,
      ),
    /Cannot add/,
  );
});
test("database posting guard rejects an unbalanced draft even through direct SQL", (t) => {
  const s = fixture(t);
  s.run(
    "INSERT INTO journals(id,entity_id,number,year,date,description,idempotency_key,posted_by,approved_by,posted_at) VALUES('direct','ng',99,'2026','2026-10-19','Direct SQL','direct','finance','cfo','now')",
  );
  s.run(
    "INSERT INTO lines(journal_id,entity_id,account,debit,credit) VALUES('direct','ng','6300',100,0)",
  );
  s.run(
    "INSERT INTO lines(journal_id,entity_id,account,debit,credit) VALUES('direct','ng','2100',0,99)",
  );
  assert.throws(
    () => s.run("UPDATE journals SET status='posted' WHERE id='direct'"),
    /balance/,
  );
  assert.equal(
    s.trialBalance(s.actor("finance"), "ng").reduce((n, r) => n + r.balance, 0),
    0,
  );
});
test("posting idempotency and gap-free numbering survive rejected entries", (t) => {
  const s = fixture(t);
  const a = s.postJournal(s.actor("finance"), journal());
  const b = s.postJournal(s.actor("finance"), journal());
  assert.equal(a.id, b.id);
  assert.throws(() =>
    s.postJournal(
      s.actor("finance"),
      journal({ idempotency_key: "fail", date: "2027-01-01" }),
    ),
  );
  const c = s.postJournal(
    s.actor("finance"),
    journal({ idempotency_key: "next" }),
  );
  assert.equal(c.number, a.number + 1);
});
test("audit rows are immutable and complete hash chain verifies", (t) => {
  const s = fixture(t);
  claim(s);
  assert.equal(s.verifyAudit(), true);
  assert.throws(
    () => s.run("UPDATE audit SET details=? WHERE id=1", "{}"),
    /append only/,
  );
  assert.throws(() => s.run("DELETE FROM audit"), /append only/);
});
test("returned expenses keep history, require reason, and cannot be approved from draft", (t) => {
  const s = fixture(t),
    c = claim(s);
  evidence(s, c.id);
  s.action(s.actor("employee"), c.id, "submit");
  assert.throws(() => s.action(s.actor("manager"), c.id, "return"), /reason/);
  s.action(s.actor("manager"), c.id, "return", {
    comment: "Please confirm the date",
  });
  assert.equal(s.spend(s.actor("employee"), c.id).status, "returned");
  assert.throws(() => s.action(s.actor("manager"), c.id, "approve"));
  assert.ok(
    s
      .details(s.actor("employee"), c.id)
      .history.some((h) => h.action === "spend.return"),
  );
});
test("session tokens are persisted as hashes and CSV neutralizes formula injection", (t) => {
  const s = fixture(t),
    { token } = s.login("finance");
  assert.equal(s.session(token).id, "finance");
  assert.notEqual(s.get("SELECT token_hash FROM sessions").token_hash, token);
  s.logout(token);
  assert.throws(() => s.session(token));
  assert.match(csv(["x"], [["=1+2"]]), /"'=1\+2"/);
});
test("data and audit survive closing and reopening the database", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jaye-persist-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, "test.db");
  const a = new FinanceStore(filename),
    c = claim(a);
  evidence(a, c.id);
  a.db.close();
  const b = new FinanceStore(filename);
  assert.equal(
    b.spend(b.actor("employee"), c.id).description,
    "Fuel for local test",
  );
  assert.equal(b.verifyAudit(), true);
  assert.equal(b.get("SELECT COUNT(*) AS count FROM entities").count, 2);
  b.db.close();
});

test("bank CSV import is atomic and idempotent; references cannot change content", (t) => {
  const s = fixture(t),
    c = claim(s);
  assert.equal(statement(s, c).added, 1);
  assert.equal(statement(s, c).skipped, 1);
  assert.throws(
    () => statement(s, { ...c, amount_minor: 77 }),
    /different contents/,
  );
  const before = s.all("SELECT * FROM bank_transactions").length;
  assert.throws(() =>
    s.importStatement(
      s.actor("finance"),
      "ng",
      "reference,date,currency,amount_minor,description\nVALID,2026-10-19,NGN,100,Valid row\nINVALID,2026-10-19,USD,100,Wrong currency",
    ),
  );
  assert.equal(s.all("SELECT * FROM bank_transactions").length, before);
});
test("reconciliation requires an imported debit and prevents statement reuse", (t) => {
  const s = fixture(t),
    c = claim(s);
  evidence(s, c.id);
  approve(s, c.id);
  s.action(s.actor("finance"), c.id, "schedule");
  s.action(s.actor("payer"), c.id, "confirm", { reference: "TEST-BANK" });
  assert.throws(
    () =>
      s.action(s.actor("reconciler"), c.id, "reconcile", {
        reference: "NONEXISTENT",
      }),
    /Import an unmatched/,
  );
  statement(s, c);
  s.action(s.actor("reconciler"), c.id, "reconcile", {
    reference: "TEST-STMT-001",
  });
  assert.equal(
    s.get(
      "SELECT matched_spend_id FROM bank_transactions WHERE reference=?",
      "TEST-STMT-001",
    ).matched_spend_id,
    c.id,
  );
});

test("resubmission resets the approval cycle while preserving earlier review history", (t) => {
  const s = fixture(t),
    c = claim(s);
  evidence(s, c.id);
  s.action(s.actor("employee"), c.id, "submit");
  s.action(s.actor("manager"), c.id, "approve");
  s.action(s.actor("finance"), c.id, "return", {
    comment: "Please attach another supporting document",
  });
  s.action(s.actor("employee"), c.id, "submit");
  s.action(s.actor("manager"), c.id, "approve");
  s.action(s.actor("finance"), c.id, "approve");
  assert.equal(s.spend(s.actor("finance"), c.id).status, "approved");
  assert.ok(
    s
      .details(s.actor("finance"), c.id)
      .history.some((h) => h.action === "spend.return"),
  );
});

test("receipt upload retries return the existing evidence without creating a false self-duplicate", (t) => {
  const s = fixture(t),
    c = claim(s);
  evidence(s, c.id);
  evidence(s, c.id);
  assert.equal(
    s.get("SELECT COUNT(*) AS n FROM receipts WHERE spend_id=?", c.id).n,
    1,
  );
  s.action(s.actor("employee"), c.id, "submit");
  assert.equal(s.spend(s.actor("employee"), c.id).status, "manager_review");
});

function editable(c: any, changes: any = {}) {
  const keys = [
    "entity_id",
    "kind",
    "vendor_id",
    "description",
    "purpose",
    "amount_minor",
    "currency",
    "department",
    "category",
    "date",
    "payment_source",
    "paid_by_id",
    "original_paid_date",
    "original_payment_reference",
    "payment_method",
    "payment_account",
    "invoice_date",
    "due_date",
  ];
  return {
    ...Object.fromEntries(keys.map((k) => [k, c[k]])),
    ...(c.invoice_number ? { invoice_number: c.invoice_number } : {}),
    ...(c.parent_id ? { parent_id: c.parent_id } : {}),
    expected_revision: c.revision,
    ...changes,
  };
}
test("personal purchase remains owed until reimbursement; export names the person and posting counts expense once", (t) => {
  const s = fixture(t),
    c = claim(s, {
      payment_source: "employee",
      paid_by_id: "employee",
      original_paid_date: "2026-10-19",
      payment_method: "card",
    });
  assert.equal(c.settlement_status, "Reimbursement pending approval");
  evidence(s, c.id);
  approve(s, c.id);
  assert.equal(
    s.spend(s.actor("finance"), c.id).settlement_status,
    "Reimbursement due",
  );
  s.action(s.actor("finance"), c.id, "schedule");
  assert.match(s.paymentFile(s.actor("finance"), "ng"), /Ada Okafor/);
  s.action(s.actor("payer"), c.id, "confirm", { reference: "PERSONAL-001" });
  assert.equal(s.spend(s.actor("finance"), c.id).outstanding_minor, 0);
  assert.equal(
    s.spend(s.actor("finance"), c.id).settlement_status,
    "Reimbursed",
  );
  statement(s, c);
  s.action(s.actor("reconciler"), c.id, "reconcile", {
    reference: "TEST-STMT-001",
  });
  s.action(s.actor("finance"), c.id, "post");
  assert.equal(
    s.get(
      "SELECT SUM(l.debit) AS total FROM lines l JOIN journals j ON l.journal_id=j.id WHERE j.source_id=? AND l.account=?",
      c.id,
      "6300",
    ).total,
    c.amount_minor,
  );
});
test("draft editing preserves evidence, audits changes, rejects stale writes and locks submitted records", (t) => {
  const s = fixture(t),
    c = claim(s);
  evidence(s, c.id);
  const edited = s.updateSpend(
    s.actor("employee"),
    c.id,
    editable(c, {
      description: "Updated business expense",
      amount_minor: 234567,
    }),
  );
  assert.equal(edited.revision, 1);
  assert.equal(s.details(s.actor("employee"), c.id).receipts.length, 1);
  assert.throws(
    () => s.updateSpend(s.actor("employee"), c.id, editable(c)),
    /changed/,
  );
  assert.throws(
    () => s.updateSpend(s.actor("finance"), c.id, editable(edited)),
    /Only the requester/,
  );
  s.action(s.actor("employee"), c.id, "submit");
  assert.throws(
    () => s.updateSpend(s.actor("employee"), c.id, editable(edited)),
    /Only the requester/,
  );
  s.action(s.actor("manager"), c.id, "return", { comment: "Clarify purchase" });
  s.updateSpend(
    s.actor("employee"),
    c.id,
    editable(edited, { purpose: "Updated purpose after manager review" }),
  );
  assert.equal(s.verifyAudit(), true);
  assert.match(
    s.get(
      "SELECT details FROM audit WHERE resource_id=? AND action='spend.edited' ORDER BY id LIMIT 1",
      c.id,
    ).details,
    /234567/,
  );
});
test("already-paid company purchase cannot enter export or confirm a different reference", (t) => {
  const s = fixture(t),
    c = claim(s, {
      original_paid_date: "2026-10-19",
      original_payment_reference: "EXISTING-001",
      payment_method: "bank_transfer",
    });
  evidence(s, c.id);
  approve(s, c.id);
  s.action(s.actor("finance"), c.id, "schedule");
  assert.ok(!s.paymentFile(s.actor("finance"), "ng").includes(c.id));
  assert.throws(
    () =>
      s.action(s.actor("payer"), c.id, "confirm", {
        reference: "SECOND-PAYMENT",
      }),
    /original reference/,
  );
  s.action(s.actor("payer"), c.id, "confirm", { reference: "EXISTING-001" });
  assert.equal(
    s.spend(s.actor("finance"), c.id).settlement_status,
    "Paid by Jaye",
  );
});
test("personal payment details and dates are validated; beneficiary cannot approve", (t) => {
  const s = fixture(t);
  assert.throws(
    () => claim(s, { payment_source: "employee", paid_by_id: "employee" }),
    /original payment/,
  );
  assert.throws(() => claim(s, { invoice_date: "2026-02-30" }), /Invalid date/);
  assert.throws(
    () => claim(s, { invoice_date: "2026-10-19", due_date: "2026-10-18" }),
    /Due date/,
  );
  assert.throws(
    () =>
      claim(s, {
        payment_source: "founder",
        paid_by_id: "cfo",
        original_paid_date: "2026-10-19",
        payment_method: "cash",
      }),
    /own personal/,
  );
  const base = claim(s);
  const { expected_revision, ...input } = editable(base, {
    payment_source: "founder",
    paid_by_id: "cfo",
    original_paid_date: "2026-10-19",
    payment_method: "cash",
    amount_minor: 60000000,
  });
  const c = s.createSpend(s.actor("manager"), input);
  s.upload(s.actor("manager"), c.id, {
    originalname: "founder.pdf",
    mimetype: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 founder"),
  });
  s.action(s.actor("manager"), c.id, "submit");
  s.run("UPDATE spends SET status='cfo_review' WHERE id=?", c.id);
  assert.throws(
    () => s.action(s.actor("cfo"), c.id, "approve"),
    /Separation of duties/,
  );
  assert.equal(c.payment_source, "founder");
});

test("migration upgrades old expense records and retains metadata across reopening", (t) => {
  const s = fixture(t);
  const fields = [
    "payment_source",
    "paid_by_id",
    "original_paid_date",
    "original_payment_reference",
    "payment_method",
    "payment_account",
    "invoice_date",
    "due_date",
    "revision",
  ];
  for (const field of fields)
    s.db.exec(`ALTER TABLE spends DROP COLUMN ${field}`);
  s.run("DELETE FROM migrations WHERE version=4");
  const upgraded = new FinanceStore(join(s.dir, "test.db"));
  const old = upgraded.spend(upgraded.actor("finance"), "ng-SP-0001");
  assert.equal(old.payment_source, "company");
  assert.equal(old.settlement_status, "Paid by Jaye");
  const c = claim(upgraded, {
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-10-19",
    payment_method: "cash",
    invoice_number: "EDIT-CLEAR",
  });
  const edited = upgraded.updateSpend(
    upgraded.actor("employee"),
    c.id,
    editable(c, { invoice_number: "" }),
  );
  assert.equal(edited.invoice_number, null);
  upgraded.db.close();
  const reopened = new FinanceStore(join(s.dir, "test.db"));
  assert.equal(
    reopened.spend(reopened.actor("employee"), c.id).payment_source,
    "employee",
  );
  assert.equal(reopened.verifyAudit(), true);
  reopened.db.close();
});

test("empty workspace starts without demo records and remains empty after reopening", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jaye-empty-"));
  const path = join(dir, "workspace.db");
  let store = new FinanceStore(path, "empty");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const table of [
    "spends",
    "vendors",
    "budgets",
    "journals",
    "lines",
    "receipts",
    "bank_transactions",
    "subscriptions",
    "refunds",
    "expense_adjustments",
    "reimbursement_claims",
    "reimbursement_payments",
    "recovery_payments",
    "audit",
  ]) {
    assert.equal(
      store.get(`SELECT count(*) AS total FROM ${table}`).total,
      0,
      table,
    );
  }
  assert.equal(store.actor("finance").name, "Workspace owner");
  assert.equal(store.get("SELECT count(*) AS total FROM users").total, 1);
  store.db.close();
  store = new FinanceStore(path, "empty");
  assert.equal(store.get("SELECT count(*) AS total FROM spends").total, 0);
  assert.equal(store.get("SELECT count(*) AS total FROM users").total, 1);
});

test("Nigeria-only workspace exposes and authorizes only Nigeria without deleting other records", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jaye-nigeria-"));
  const path = join(dir, "workspace.db");
  let store = new FinanceStore(path, "empty");
  store.db.close();
  store = new FinanceStore(path, "empty", "ng");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const actor = store.actor("finance");
  assert.deepEqual(
    store.entities(actor).map((e) => e.id),
    ["ng"],
  );
  assert.throws(() => store.dashboard(actor, "inc"), /Nigeria Ltd only/);
  assert.equal(store.get("SELECT count(*) AS n FROM entities").n, 2);
  assert.equal(store.dashboard(actor, "ng").spend_minor, 0);
  const fresh = new FinanceStore(join(dir, "fresh.db"), "empty", "ng");
  try {
    assert.equal(fresh.get("SELECT count(*) AS n FROM entities").n, 1);
    assert.deepEqual(fresh.actor("finance").entities, ["ng"]);
  } finally {
    fresh.db.close();
  }
});
