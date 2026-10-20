import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinanceStore } from "../src/domain";
import { SubscriptionService, occurrence } from "../src/subscriptions";
import { createFinanceApp } from "../src/main";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-subscriptions-"));
  const store = new FinanceStore(join(dir, "test.db"));
  let today = "2026-10-19";
  const service = new SubscriptionService(store, () => today);
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    service,
    setDate: (v: string) => {
      today = v;
    },
  };
}
const input = (extra: any = {}) => ({
  entity_id: "ng",
  vendor_id: "ng-v0",
  owner_id: "employee",
  name: "Cloud subscription",
  purpose: "Engineering collaboration and hosting",
  plan: "Business",
  seats: 5,
  department: "Engineering",
  category: "Cloud & software",
  currency: "NGN",
  amount_minor: 10000,
  cadence: "monthly",
  interval_count: 1,
  billing_anchor: "2026-10-20",
  renewal_date: "2027-10-20",
  cancellation_deadline: "2027-09-20",
  auto_renew: true,
  payment_method: "card",
  payment_account: "Company card",
  ...extra,
});
function invoice(
  service: SubscriptionService,
  store: FinanceStore,
  id: string,
  extra: any = {},
) {
  return service.record(store.actor("finance"), id, {
    due_date: "2026-10-20",
    invoice_number: "SUB-INVOICE-001",
    invoice_date: "2026-10-19",
    payment_due: "2026-10-20",
    amount_minor: 10000,
    ...extra,
  });
}
test("billing recurrence preserves anchors across month ends, leap years and custom intervals", () => {
  assert.equal(occurrence("2024-01-31", "monthly", 1, 1), "2024-02-29");
  assert.equal(occurrence("2024-01-31", "monthly", 1, 2), "2024-03-31");
  assert.equal(occurrence("2025-01-31", "monthly", 1, 1), "2025-02-28");
  assert.equal(occurrence("2024-02-29", "annual", 1, 1), "2025-02-28");
  assert.equal(occurrence("2024-02-29", "annual", 1, 4), "2028-02-29");
  assert.equal(occurrence("2026-10-19", "custom_days", 14, 2), "2026-11-16");
});
test("register forecasts charges without creating expenses; monthly equivalent uses total price, not seats", (t) => {
  const { store, service } = fixture(t);
  service.save(store.actor("finance"), input());
  const before = store.list(store.actor("finance"), "ng").length;
  const list = service.list(store.actor("finance"), "ng");
  assert.equal(list.subscriptions.length, 1);
  assert.equal(list.charges.length, 3);
  assert.equal(list.totals.upcoming_minor, 30000);
  assert.equal(list.totals.monthly_equivalent_minor, 10000);
  assert.equal(list.subscriptions[0].next_billing_date, "2026-10-20");
  assert.equal(store.list(store.actor("finance"), "ng").length, before);
  service.save(
    store.actor("finance"),
    input({ name: "Annual tool", cadence: "annual", amount_minor: 120000 }),
  );
  assert.equal(
    service.list(store.actor("finance"), "ng").totals.monthly_equivalent_minor,
    20000,
  );
  assert.throws(
    () => service.list(store.actor("finance"), "ng", 800),
    /horizon/,
  );
});
test("recording invoices is retry-safe, prevents duplicate cycles and counts actual unpaid amount once", (t) => {
  const { store, service } = fixture(t);
  const s = service.save(store.actor("finance"), input());
  const spend = invoice(service, store, s.id, { amount_minor: 12000 });
  assert.equal(
    invoice(service, store, s.id, { amount_minor: 12000 }).id,
    spend.id,
  );
  assert.throws(
    () => invoice(service, store, s.id, { invoice_number: "SECOND" }),
    /already has an expense/,
  );
  let list = service.list(store.actor("finance"), "ng");
  assert.equal(list.totals.upcoming_minor, 32000);
  assert.equal(list.charges[0].expense.id, spend.id);
  assert.ok(
    list.charges[0].alerts.includes("Charge differs from expected price"),
  );
  assert.ok(list.charges[0].alerts.includes("Missing invoice attachment"));
  assert.equal(
    store.spend(store.actor("employee"), spend.id).subscription_id,
    s.id,
  );
  assert.ok(
    store.list(store.actor("employee"), "ng").some((r) => r.id === spend.id),
  );
  store.run("UPDATE spends SET status='paid' WHERE id=?", spend.id);
  list = service.list(store.actor("finance"), "ng");
  assert.equal(list.totals.upcoming_minor, 20000);
  assert.equal(
    store.all("SELECT * FROM journals WHERE source_id=?", spend.id).length,
    0,
  );
});
test("existing personal expenses link without creating new spend and cannot be reused across cycles", (t) => {
  const { store, service } = fixture(t);
  const s = service.save(store.actor("employee"), input());
  const spend = store.createSpend(store.actor("employee"), {
    entity_id: "ng",
    kind: "expense",
    vendor_id: "ng-v0",
    description: "Personal subscription purchase",
    purpose: "Cloud software used for business",
    amount_minor: 10000,
    currency: "NGN",
    department: "Engineering",
    category: "Cloud & software",
    date: "2026-10-20",
    payment_source: "employee",
    paid_by_id: "employee",
    original_paid_date: "2026-10-20",
    payment_method: "card",
  });
  const count = store.list(store.actor("finance"), "ng").length;
  service.record(store.actor("employee"), s.id, {
    due_date: "2026-10-20",
    spend_id: spend.id,
  });
  assert.equal(store.list(store.actor("finance"), "ng").length, count);
  assert.throws(
    () =>
      service.record(store.actor("employee"), s.id, {
        due_date: "2026-11-20",
        spend_id: spend.id,
      }),
    /already linked/,
  );
  const list = service.list(store.actor("employee"), "ng");
  assert.equal(list.charges[0].status, "Reimbursement pending approval");
});
test("pause, resume and cancellation stop future expectations while retaining historical and recorded obligations", (t) => {
  const { store, service, setDate } = fixture(t);
  const s = service.save(
    store.actor("finance"),
    input({ billing_anchor: "2026-10-01" }),
  );
  let updated = service.action(store.actor("finance"), s.id, {
    action: "pause",
    expected_revision: 0,
  });
  let list = service.list(store.actor("finance"), "ng");
  assert.equal(list.charges.length, 1);
  assert.equal(list.totals.overdue_minor, 10000);
  assert.equal(list.totals.upcoming_minor, 0);
  assert.equal(list.totals.monthly_equivalent_minor, 0);
  assert.throws(
    () =>
      service.action(store.actor("finance"), s.id, {
        action: "resume",
        expected_revision: updated.revision,
        next_billing_date: "2026-10-01",
      }),
    /today onward/,
  );
  setDate("2026-10-22");
  updated = service.action(store.actor("finance"), s.id, {
    action: "resume",
    expected_revision: updated.revision,
    next_billing_date: "2026-11-03",
  });
  list = service.list(store.actor("finance"), "ng");
  assert.ok(!list.charges.some((c) => c.due_date === "2026-11-01"));
  assert.ok(list.charges.some((c) => c.due_date === "2026-11-03"));
  invoice(service, store, s.id, {
    due_date: "2026-11-03",
    payment_due: "2026-11-03",
  });
  service.action(store.actor("finance"), s.id, {
    action: "cancel",
    expected_revision: updated.revision,
  });
  list = service.list(store.actor("finance"), "ng");
  assert.equal(list.subscriptions[0].status, "cancelled");
  assert.equal(list.totals.upcoming_minor, 10000);
  assert.ok(
    list.charges
      .find((c) => c.due_date === "2026-11-03")!
      .alerts.includes("Charge outside active billing schedule"),
  );
  assert.throws(
    () =>
      invoice(service, store, s.id, {
        due_date: "2026-12-03",
        invoice_number: "CANCELLED",
      }),
    /No active billing cycle/,
  );
  assert.equal(store.verifyAudit(), true);
});
test("price revisions retain history, protect stale edits and persist across database reopen", (t) => {
  const { store, service, setDate } = fixture(t);
  const s = service.save(
    store.actor("finance"),
    input({ billing_anchor: "2026-09-20" }),
  );
  const bill = invoice(service, store, s.id, {
    due_date: "2026-09-20",
    payment_due: "2026-09-20",
    invoice_date: "2026-09-20",
  });
  service.save(
    store.actor("finance"),
    input({
      billing_anchor: "2026-10-20",
      amount_minor: 15000,
      expected_revision: 0,
    }),
    s.id,
  );
  assert.throws(
    () =>
      service.save(
        store.actor("finance"),
        input({ expected_revision: 0 }),
        s.id,
      ),
    /changed/,
  );
  const list = service.list(store.actor("finance"), "ng");
  assert.equal(list.charges[0].expected_minor, 10000);
  assert.equal(list.charges[0].spend_id, bill.id);
  assert.equal(list.charges[1].expected_minor, 15000);
  const reopened = new FinanceStore(join(store.dir, "test.db"));
  try {
    const d = new SubscriptionService(reopened, () => "2026-10-19").list(
      reopened.actor("finance"),
      "ng",
    );
    assert.equal(d.subscriptions[0].amount_minor, 15000);
    assert.equal(d.charges[0].spend_id, bill.id);
    assert.equal(reopened.verifyAudit(), true);
  } finally {
    reopened.db.close();
  }
  setDate("2026-11-21");
  const late = service.list(store.actor("finance"), "ng");
  assert.ok(
    late.charges
      .find((c) => c.due_date === "2026-11-20")!
      .alerts.includes("Invoice not recorded"),
  );
});
test("ownership, entity boundaries and real calendar dates are enforced", (t) => {
  const { store, service } = fixture(t);
  const s = service.save(store.actor("finance"), input());
  assert.throws(() => service.list(store.actor("investor"), "ng"), /Investors/);
  assert.throws(
    () => service.save(store.actor("employee"), input({ owner_id: "cfo" })),
    /must own/,
  );
  assert.throws(
    () =>
      service.save(
        store.actor("finance"),
        input({ billing_anchor: "2026-02-30" }),
      ),
    /Invalid date/,
  );
  assert.throws(
    () => service.save(store.actor("finance"), input({ currency: "USD" })),
    /currency/,
  );
  assert.throws(
    () => service.save(store.actor("finance"), input({ vendor_id: "inc-v0" })),
    /Vendor/,
  );
  assert.throws(
    () =>
      service.save(
        store.actor("finance"),
        input({
          renewal_date: "2026-11-01",
          cancellation_deadline: "2026-11-02",
        }),
      ),
    /deadline/,
  );
  assert.throws(
    () =>
      service.action(store.actor("payer"), s.id, {
        action: "pause",
        expected_revision: 0,
      }),
    /owner/,
  );
  store.run(
    "INSERT INTO users VALUES(?,?,?,?)",
    "other-employee",
    "Other Employee",
    "employee",
    JSON.stringify(["ng"]),
  );
  assert.equal(
    service.list(store.actor("other-employee"), "ng").subscriptions.length,
    0,
  );
  assert.throws(
    () =>
      service.record(store.actor("other-employee"), s.id, {
        due_date: "2026-10-20",
        spend_id: "ng-SP-0001",
      }),
    /only access/,
  );
});
test("renewal alerts, unexpected cancellation charges and prepaid invoice due dates remain visible", (t) => {
  const { store, service } = fixture(t);
  const s = service.save(
    store.actor("finance"),
    input({
      billing_anchor: "2027-01-20",
      renewal_date: "2026-11-01",
      cancellation_deadline: "2026-10-20",
    }),
  );
  const bill = invoice(service, store, s.id, {
    due_date: "2027-01-20",
    payment_due: "2026-10-25",
  });
  let list = service.list(store.actor("finance"), "ng", 30);
  assert.equal(list.totals.upcoming_minor, 10000);
  assert.equal(list.charges[0].spend_id, bill.id);
  assert.equal(list.subscriptions[0].alerts.length, 2);
  service.action(store.actor("finance"), s.id, {
    action: "cancel",
    expected_revision: 0,
  });
  const extra = store.createSpend(store.actor("finance"), {
    entity_id: "ng",
    kind: "expense",
    vendor_id: "ng-v0",
    description: "Charge after cancellation",
    purpose: "Unexpected vendor charge for review",
    amount_minor: 7777,
    currency: "NGN",
    department: "Engineering",
    category: "Cloud & software",
    date: "2026-10-21",
  });
  service.record(store.actor("finance"), s.id, {
    due_date: "2026-10-21",
    spend_id: extra.id,
  });
  list = service.list(store.actor("finance"), "ng", 30);
  assert.equal(list.totals.upcoming_minor, 17777);
  assert.ok(
    list.charges
      .find((c) => c.spend_id === extra.id)!
      .alerts.includes("Charge outside active billing schedule"),
  );
});
test("subscription HTTP endpoints enforce authentication and create a linked bill", async (t) => {
  const { store } = fixture(t);
  process.env.JAYE_TEST = "1";
  const app = await createFinanceApp(store);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const base = await app.getUrl();
  const call = (path: string, cookie = "", body?: any) =>
    fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await call("/subscriptions?entity=ng")).status, 401);
  const login = await call("/demo/login", "", { user_id: "finance" });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const created = await call("/subscriptions", cookie, input());
  assert.equal(created.status, 201);
  const s: any = await created.json();
  const billed = await call(`/subscriptions/${s.id}/invoices`, cookie, {
    due_date: "2026-10-20",
    invoice_number: "HTTP-SUB",
    invoice_date: "2026-10-19",
    payment_due: "2026-10-20",
    amount_minor: 10000,
  });
  assert.equal(billed.status, 201);
  const b: any = await billed.json();
  assert.equal(b.subscription_id, s.id);
  const listed: any = await (
    await call("/subscriptions?entity=ng&days=30", cookie)
  ).json();
  assert.equal(listed.charges[0].spend_id, b.id);
});

test("non-renewing subscriptions stop estimates at the end date and rejected invoices remain expected obligations", (t) => {
  const { store, service, setDate } = fixture(t);
  const s = service.save(
    store.actor("finance"),
    input({
      auto_renew: false,
      renewal_date: "2026-11-20",
      cancellation_deadline: "2026-11-01",
    }),
  );
  assert.equal(service.list(store.actor("finance"), "ng").charges.length, 1);
  assert.throws(
    () =>
      service.save(
        store.actor("finance"),
        input({
          auto_renew: false,
          renewal_date: "",
          cancellation_deadline: "",
        }),
      ),
    /end date/,
  );
  const old = invoice(service, store, s.id);
  store.run("UPDATE spends SET status='rejected' WHERE id=?", old.id);
  assert.equal(
    service.list(store.actor("finance"), "ng").totals.upcoming_minor,
    10000,
  );
  const replacement = invoice(service, store, s.id, {
    invoice_number: "REPLACEMENT",
  });
  assert.notEqual(old.id, replacement.id);
  assert.equal(
    store.spend(store.actor("finance"), old.id).subscription_id,
    undefined,
  );
  assert.equal(
    service.list(store.actor("finance"), "ng").charges[0].spend_id,
    replacement.id,
  );
  setDate("2026-11-21");
  const expired = service.list(store.actor("finance"), "ng");
  assert.equal(expired.totals.monthly_equivalent_minor, 0);
  assert.equal(expired.subscriptions[0].next_billing_date, null);
  assert.equal(expired.totals.overdue_minor, 10000);
});

test("subscription invoice uses normal evidence, approvals and payment controls; owner changes preserve authorized access", (t) => {
  const { store, service } = fixture(t);
  const s = service.save(store.actor("employee"), input());
  const bill = service.record(store.actor("employee"), s.id, {
    due_date: "2026-10-20",
    invoice_number: "FULL-SUB",
    invoice_date: "2026-10-19",
    payment_due: "2026-10-20",
    amount_minor: 10000,
  });
  assert.throws(
    () => store.action(store.actor("employee"), bill.id, "submit"),
    /Receipt/,
  );
  store.upload(store.actor("employee"), bill.id, {
    originalname: "subscription.pdf",
    mimetype: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 subscription approval evidence"),
  });
  for (const [actor, action] of [
    ["employee", "submit"],
    ["manager", "approve"],
    ["finance", "approve"],
    ["finance", "schedule"],
  ])
    store.action(store.actor(actor), bill.id, action);
  store.action(store.actor("payer"), bill.id, "confirm", {
    reference: "SUB-PAID",
  });
  assert.equal(
    service.list(store.actor("employee"), "ng").totals.upcoming_minor,
    20000,
  );
  service.save(
    store.actor("finance"),
    input({ owner_id: "cfo", expected_revision: 0 }),
    s.id,
  );
  assert.equal(
    service.list(store.actor("employee"), "ng").subscriptions.length,
    1,
  );
  assert.equal(
    service.list(store.actor("cfo"), "ng").charges[0].spend_id,
    bill.id,
  );
  assert.equal(store.verifyAudit(), true);
});

test("subscription payments create one documented expense and stay in sync through partial payments and corrections", async (t) => {
  const { BookkeepingService } = await import("../src/bookkeeping");
  const { randomUUID } = await import("node:crypto");
  const { store, service } = fixture(t),
    a = store.actor("finance"),
    books = new BookkeepingService(store);
  const sub = service.save(a, input());
  const payload = {
    due_date: "2026-10-20",
    date: "2026-10-19",
    amount_minor: 12000,
    request_key: randomUUID(),
    payment: {
      amount_minor: 4000,
      date: "2026-10-19",
      reference: "SUB-PART-1",
      method: "Bank transfer",
    },
  };
  const before = store.dashboard(a, "ng").spend_minor;
  const result = service.recordExpense(a, sub.id, payload);
  assert.equal(result.paid_minor, 4000);
  assert.equal(result.outstanding_minor, 8000);
  assert.equal(service.recordExpense(a, sub.id, payload).id, result.id);
  assert.equal(books.list(a, "ng").filter((r) => r.id === result.id).length, 1);
  assert.equal(store.dashboard(a, "ng").spend_minor - before, 12000);
  let charge = service
    .list(a, "ng")
    .charges.find((c) => c.due_date === "2026-10-20")!;
  assert.equal(charge.record_id, result.id);
  assert.equal(charge.outstanding_minor, 8000);
  assert.equal(charge.status, "Part paid");
  const { ReportingService } = await import("../src/reporting");
  const report = new ReportingService(store, () => "2026-10-20").report(
    a,
    "ng",
  );
  assert.equal(
    report.forecasts.filter((c: any) => c.record_id === result.id).length,
    1,
  );
  assert.equal(
    report.forecasts.find((c: any) => c.record_id === result.id)!
      .forecast_minor,
    8000,
  );
  assert.equal(report.documentation_totals.cost_minor, 12000);

  assert.throws(
    () =>
      service.recordExpense(a, sub.id, {
        ...payload,
        request_key: randomUUID(),
      }),
    /already in Expenses/,
  );
  assert.throws(
    () => invoice(service, store, sub.id),
    /already recorded in Expenses/,
  );
  books.pay(a, result.id, {
    amount_minor: 8000,
    date: "2026-10-19",
    reference: "SUB-PART-2",
    method: "Bank transfer",
    request_key: randomUUID(),
  });
  charge = service
    .list(a, "ng")
    .charges.find((c) => c.due_date === "2026-10-20")!;
  assert.equal(charge.outstanding_minor, 0);
  assert.equal(charge.status, "Paid");
  assert.equal(store.dashboard(a, "ng").spend_minor - before, 12000);
  const detail = books.detail(a, result.id);
  books.correct(a, "record", result.id, {
    revision: detail.revision,
    request_key: randomUUID(),
    reason: "Correct invoice total",
    amount_minor: 15000,
    date: "2026-10-19",
  });
  assert.equal(
    service.list(a, "ng").charges.find((c) => c.due_date === "2026-10-20")!
      .outstanding_minor,
    3000,
  );
  assert.equal(store.dashboard(a, "ng").spend_minor - before, 15000);
});

test("subscription links reuse existing expenses and reject other-cycle reuse, legacy bills, overpayments and unauthorized writes", async (t) => {
  const { BookkeepingService } = await import("../src/bookkeeping");
  const { randomUUID } = await import("node:crypto");
  const { store, service } = fixture(t),
    a = store.actor("finance"),
    books = new BookkeepingService(store),
    sub = service.save(a, input());
  const base = {
    due_date: "2026-10-20",
    date: "2026-10-19",
    amount_minor: 10000,
    request_key: randomUUID(),
  };
  assert.throws(() =>
    service.recordExpense(store.actor("employee"), sub.id, base),
  );
  assert.throws(() =>
    service.recordExpense(a, sub.id, {
      ...base,
      payment: {
        amount_minor: 11000,
        date: "2026-10-19",
        reference: "OVERPAY-SUB",
        method: "Cash",
      },
    }),
  );
  assert.equal(
    store.get("SELECT COUNT(*) AS n FROM subscription_records").n,
    0,
  );
  assert.equal(
    store.get(
      "SELECT COUNT(*) AS n FROM bookkeeping_records WHERE request_key=?",
      base.request_key,
    ).n,
    0,
  );
  const existing = books.record(a, {
    entity_id: "ng",
    kind: "expense",
    description: "Already entered subscription",
    payee: sub.vendor,
    category: "Cloud & software",
    department: "Product",
    amount_minor: 10000,
    date: "2026-10-19",
    due_date: "2026-10-20",
    request_key: randomUUID(),
  });
  const before = store.dashboard(a, "ng").spend_minor;
  service.recordExpense(a, sub.id, {
    due_date: "2026-10-20",
    record_id: existing.id,
    request_key: randomUUID(),
  });
  assert.equal(store.dashboard(a, "ng").spend_minor, before);
  assert.throws(
    () =>
      service.recordExpense(a, sub.id, {
        due_date: "2026-11-20",
        record_id: existing.id,
        request_key: randomUUID(),
      }),
    /already linked/,
  );
  const other = service.save(a, input({ name: "Legacy subscription" }));
  invoice(service, store, other.id);
  assert.throws(
    () =>
      service.recordExpense(a, other.id, {
        ...base,
        request_key: randomUUID(),
      }),
    /approval-workflow bill/,
  );
});

test("simple subscription setup saves provider, department contact, custom category and dates atomically", async (t) => {
  const { BookkeepingService } = await import("../src/bookkeeping");
  const { store, service } = fixture(t),
    a = store.actor("finance");
  const employee = new BookkeepingService(store).saveEmployee(a, {
    entity_id: "ng",
    name: "Product contact",
    department: "Product",
    kind: "employee",
    salary_minor: 0,
    start_date: "2026-01-01",
  });
  const { vendor_id, owner_id, ...base } = input({ department: "Product" });
  const setup = {
    ...base,
    provider_name: "Design Service Co",
    start_date: "2026-01-01",
    employee_id: employee.id,
    category_name: "Design tools",
    users_count: 4,
  };
  const before = store.dashboard(a, "ng").spend_minor;
  const saved = service.save(a, setup);
  assert.equal(saved.vendor, "Design Service Co");
  assert.equal(saved.responsible_employee, "Product contact");
  assert.equal(saved.category_name, "Design tools");
  assert.equal(saved.users_count, 4);
  assert.equal(saved.start_date, "2026-01-01");
  assert.equal(saved.owner_id, a.id);
  assert.equal(saved.category, "Cloud & software");
  assert.equal(store.dashboard(a, "ng").spend_minor, before);
  const second = service.save(a, {
    ...setup,
    name: "Another design tool",
    provider_name: "design service co",
    category_name: "design tools",
    employee_id: "",
    users_count: null,
  });
  assert.equal(second.vendor_id, saved.vendor_id);
  assert.equal(
    store.get(
      "SELECT COUNT(*) AS n FROM subscription_categories WHERE entity_id='ng'",
    ).n,
    1,
  );
  assert.equal(second.employee_id, null);
  const edited = service.save(
    a,
    {
      ...setup,
      expected_revision: saved.revision,
      payment_method: "cash",
      payment_account: "Old card",
    },
    saved.id,
  );
  assert.equal(edited.payment_account, "");
  assert.throws(
    () =>
      service.save(
        a,
        { ...setup, expected_revision: saved.revision },
        saved.id,
      ),
    /changed/,
  );
});

test("subscription setup rejects inconsistent dates and employees from another department without creating providers", async (t) => {
  const { BookkeepingService } = await import("../src/bookkeeping");
  const { store, service } = fixture(t),
    a = store.actor("finance");
  const employee = new BookkeepingService(store).saveEmployee(a, {
    entity_id: "ng",
    name: "Marketing contact",
    department: "Marketing",
    kind: "employee",
    salary_minor: 0,
    start_date: "2026-01-01",
  });
  const { vendor_id, owner_id, ...base } = input({ department: "Product" });
  const setup = {
    ...base,
    provider_name: "Should not be created",
    start_date: "2026-01-01",
  };
  assert.throws(
    () => service.save(a, { ...setup, employee_id: employee.id }),
    /selected department/,
  );
  assert.throws(
    () => service.save(a, { ...setup, start_date: "2026-11-01" }),
    /Start date/,
  );
  assert.throws(
    () => service.save(a, { ...setup, renewal_date: "2025-01-01" }),
    /Renewal or expiry/,
  );
  assert.equal(
    store.get(
      "SELECT COUNT(*) AS n FROM vendors WHERE name=?",
      setup.provider_name,
    ).n,
    0,
  );
  assert.throws(() => service.save(store.actor("auditor"), setup));
});

test("an actual subscription bill without a scheduled cycle creates one expense and keeps repayments in sync", async (t) => {
  const { randomUUID } = await import("node:crypto");
  const { BookkeepingService } = await import("../src/bookkeeping");
  const { store, service } = fixture(t),
    a = store.actor("finance"),
    books = new BookkeepingService(store);
  const sub = service.save(
    a,
    input({
      auto_renew: false,
      renewal_date: "2026-10-20",
      cancellation_deadline: "",
    }),
  );
  assert.equal(
    service.list(a, "ng").subscriptions.find((s: any) => s.id === sub.id)
      .charges.length,
    0,
  );
  const payload = {
    due_date: "2026-10-19",
    date: "2026-10-19",
    amount_minor: 20000,
    actual_bill: true,
    request_key: randomUUID(),
  };
  const before = store.dashboard(a, "ng").spend_minor;
  const record = service.recordExpense(a, sub.id, payload);
  assert.equal(record.outstanding_minor, 20000);
  assert.equal(record.paid_minor, 0);
  assert.equal(service.recordExpense(a, sub.id, payload).id, record.id);
  assert.throws(
    () =>
      service.recordExpense(a, sub.id, {
        ...payload,
        request_key: randomUUID(),
      }),
    /already in Expenses/,
  );
  assert.equal(store.dashboard(a, "ng").spend_minor - before, 20000);
  const charge = service
    .list(a, "ng")
    .subscriptions.find((s: any) => s.id === sub.id)
    .charges.find((c: any) => c.due_date === payload.due_date);
  assert.equal(charge.record_id, record.id);
  assert.equal(charge.outstanding_minor, 20000);
  assert.equal(books.detail(a, record.id).status, "Unpaid");
  assert.throws(
    () =>
      service.recordExpense(a, sub.id, {
        ...payload,
        due_date: "2026-10-21",
        request_key: randomUUID(),
      }),
    /today or earlier/,
  );
  assert.throws(() =>
    service.recordExpense(store.actor("employee"), sub.id, {
      ...payload,
      request_key: randomUUID(),
    }),
  );
});
