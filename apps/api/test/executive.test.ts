import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FinanceStore } from "../src/domain";
import { ExecutiveService } from "../src/executive";
import { FinancialService } from "../src/financial/service";
import { MonthlyExpenseService } from "../src/monthly-expenses";
import { BookkeepingService } from "../src/bookkeeping";
import { localDate } from "../src/subscriptions";
function fixture(t: any, seed: boolean | "empty" = "empty") {
  const dir = mkdtempSync(join(tmpdir(), "jaye-exec-")),
    s = new FinanceStore(join(dir, "db"), seed);
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    s,
    e: new ExecutiveService(s),
    f: new FinancialService(s),
    a: s.actor("finance"),
  };
}
test("explicit samples are excluded consistently without deleting accounting or changing genuine records", (t) => {
  const { s, e, f, a } = fixture(t, true);
  const count = s.get("SELECT count(*) n FROM journals").n;
  const r = e.overview(a, "ng", "2026-10");
  assert.equal(r.excluded.journals.length, 3);
  assert.equal(r.excluded.budgets.length, 5);
  assert.equal(r.monthly.actual_minor, 0);
  assert.equal(r.monthly.budget_minor, null);
  assert.equal(r.cash.operating_minor, null);
  assert.equal(r.score, 10);
  assert.equal(f.workspace(a, "ng").result.opening.cash, 0);
  assert.equal(f.workspace(a, "ng").result.summary.closing_cash, 0);
  assert.equal(s.get("SELECT count(*) n FROM journals").n, count);
  const b = new BookkeepingService(s);
  b.record(a, {
    entity_id: "ng",
    kind: "expense",
    payee: "Real provider",
    description: "Actual invoice",
    category: "Operations",
    department: "Operations",
    amount_minor: 90000,
    date: "2026-10-01",
    due_date: "2026-10-01",
    request_key: randomUUID(),
  });
  assert.equal(
    new MonthlyExpenseService(s).report(a, "ng", "2026-10-01", "2026-10-31")
      .actual_minor,
    90000,
  );
  assert.equal(e.overview(a, "ng", "2026-10").monthly.actual_minor, 90000);
  assert.equal(
    f
      .input("ng")
      .ledger.reduce((n, r) => (r.type === "expense" ? n + r.amount : n), 0),
    90000,
  );
});
test("cash reviews require real dates, matched ledger balances and explicit evidence; a changed ledger invalidates the review", (t) => {
  const { s, e, a } = fixture(t);
  const today = localDate();
  e.overview(a, "ng");
  assert.throws(
    () =>
      e.cashReview(a, "ng", {
        as_of: today,
        bank_minor: 10000,
        restricted_minor: 0,
        evidence: "Statement checked",
      }),
    /differ/,
  );
  assert.throws(
    () =>
      e.cashReview(a, "ng", {
        as_of: today,
        bank_minor: 0,
        restricted_minor: 100,
        evidence: "Statement checked",
      }),
    /Restricted/,
  );
  e.cashReview(a, "ng", {
    as_of: today,
    bank_minor: 0,
    restricted_minor: 0,
    evidence: "Zero-balance statement QA evidence",
  });
  assert.equal(e.overview(a, "ng").cash.operating_minor, 0);
  s.run(
    "INSERT OR IGNORE INTO periods VALUES(?,?,'open')",
    "ng",
    today.slice(0, 7),
  );
  s.postJournal(a, {
    entity_id: "ng",
    date: today,
    description: "Genuine funding receipt",
    idempotency_key: randomUUID(),
    approved_by: a.id,
    lines: [
      { account: "1100", debit: 10000, credit: 0 },
      { account: "3100", debit: 0, credit: 10000 },
    ],
  });
  assert.equal(e.overview(a, "ng").cash.current, false);
  e.cashReview(a, "ng", {
    as_of: today,
    bank_minor: 10000,
    restricted_minor: 2000,
    evidence: "Statement agrees to receipt reference QA",
  });
  assert.equal(e.overview(a, "ng").cash.operating_minor, 8000);
  assert.equal(
    s.all("SELECT * FROM audit WHERE action='executive.cash_reviewed'").length,
    2,
  );
});
test("readiness cannot be marked verified without evidence and stale updates cannot overwrite the review", (t) => {
  const { e, a, s } = fixture(t);
  e.overview(a, "ng");
  const gate = {
    service_id: "car",
    gate: "Product & reliability",
    status: "verified",
    owner: "Operations",
    evidence: "",
    verifier: "QA",
    verified_on: localDate(),
    due_date: "",
    revision: 0,
  };
  assert.throws(() => e.gate(a, "ng", gate), /Verification needs/);
  e.gate(a, "ng", { ...gate, evidence: "Signed end-to-end test report QA" });
  assert.equal(
    e.overview(a, "ng").services.find((r) => r.id === "car")!.verified,
    1,
  );
  assert.throws(
    () => e.gate(a, "ng", { ...gate, evidence: "Replacement test report" }),
    /changed/,
  );
  e.gate(a, "ng", {
    ...gate,
    revision: 1,
    status: "blocked",
    evidence: "Regression under investigation",
  });
  assert.equal(
    e.overview(a, "ng").services.find((r) => r.id === "car")!.verified,
    0,
  );
  assert.equal(s.all("SELECT * FROM executive_gate_history").length, 2);
});
test("unknown operating activity is null, empty scenarios remain unconfigured, and executive evidence is role scoped", (t) => {
  const { e, a } = fixture(t);
  const r = e.overview(a, "ng");
  assert.equal(r.traction.paying_drivers, null);
  assert.equal(r.traction.completed_jobs, null);
  assert.equal(
    r.scenarios.every((x) => !x.complete && x.revenue === null),
    true,
  );
  assert.equal(
    r.services.every((x) => x.status === "Not ready for sign-off"),
    true,
  );
  assert.throws(() => e.overview({ ...a, role: "employee" }, "ng"));
  assert.throws(() => e.overview({ ...a, entities: [] }, "ng"));
  assert.throws(() => e.cashReview({ ...a, role: "auditor" }, "ng", {}));
  assert.throws(() => e.overview(a, "ng", "2026-13"));
});
