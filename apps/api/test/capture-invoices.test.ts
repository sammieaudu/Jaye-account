import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FinanceStore } from "../src/domain";
import { BookkeepingService } from "../src/bookkeeping";
import { InvoiceService } from "../src/invoices";
import { receiptSuggestions } from "../../web/lib/receipt";
function setup(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-invoices-"));
  const s = new FinanceStore(join(dir, "test.db"), "empty");
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { s, a: s.actor("finance") };
}
const invoice = () => ({
  entity_id: "ng",
  request_key: randomUUID(),
  date: "2026-10-20",
  due_date: "2026-10-30",
  customer: "Customer",
  customer_email: "customer@example.com",
  customer_address: "Abuja",
  business_name: "GoJaye Nigeria Ltd",
  business_address: "Abuja",
  business_contact: "support@gojaye.com",
  payment_details: "",
  notes: "Thank you",
  currency: "NGN",
  tax_basis_points: 750,
  items: [{ description: "Delivery service", quantity: 3, unit_minor: 10001 }],
});
test("invoices number once, calculate tax, persist, and do not post expenses", (t) => {
  const { s, a } = setup(t),
    svc = new InvoiceService(s),
    v = invoice();
  const first = svc.save(a, v),
    retry = svc.save(a, v),
    second = svc.save(a, invoice());
  assert.equal(first.id, retry.id);
  assert.equal(first.number, "JAYE-00001");
  assert.equal(second.number, "JAYE-00002");
  assert.equal(first.total_minor, 32253);
  assert.equal(svc.list(a, "ng").length, 2);
  assert.equal(s.get("SELECT COUNT(*) AS n FROM journals").n, 0);
  const issued = svc.action(a, first.id, { action: "issue", revision: 0 });
  assert.equal(issued.document.status, "issued");
  assert.throws(
    () => svc.save(a, { ...v, revision: 1 }, first.id),
    /current draft/,
  );
  assert.throws(
    () => svc.action(a, first.id, { action: "cancel", revision: 0 }),
    /changed/,
  );
  assert.equal(
    svc.action(a, first.id, { action: "cancel", revision: 1 }).document.status,
    "cancelled",
  );
  assert.throws(
    () => svc.save(a, { ...invoice(), due_date: "2026-01-01" }),
    /Due date/,
  );
  assert.throws(() =>
    svc.save(a, {
      ...invoice(),
      items: [{ description: "Bad", quantity: 1.5, unit_minor: 100 }],
    }),
  );
});
test("shared custom categories remain balanced for costs and refunds", (t) => {
  const { s, a } = setup(t);
  s.addCategory(a, {
    entity_id: "ng",
    name: "Office supplies",
    accounting_category: "Operations",
  });
  assert.throws(
    () =>
      s.addCategory(a, {
        entity_id: "ng",
        name: "office SUPPLIES",
        accounting_category: "Operations",
      }),
    /already exists/,
  );
  assert.equal(s.categoryAccount("ng", "Office supplies"), "6300");
  assert.throws(
    () => s.categoryAccount("inc", "Office supplies"),
    /saved expense category/,
  );
  const b = new BookkeepingService(s);
  const r = b.record(a, {
    entity_id: "ng",
    kind: "expense",
    description: "Stationery",
    payee: "Shop",
    category: "Office supplies",
    department: "Operations",
    amount_minor: 100000,
    date: "2026-10-01",
    due_date: "2026-10-01",
    request_key: randomUUID(),
    payment: {
      amount_minor: 100000,
      date: "2026-10-01",
      reference: "CAT-1",
      method: "Bank transfer",
      request_key: randomUUID(),
    },
  });
  const refund = b.refund(a, r.id, {
    amount_minor: 20000,
    date: "2026-10-02",
    reference: "CAT-REF",
    method: "Bank transfer",
    reason: "Returned items",
    request_key: randomUUID(),
  });
  assert.equal(refund.amount_minor, 80000);
  assert.equal(
    s.get("SELECT SUM(debit-credit) AS balance FROM lines WHERE entity_id='ng'")
      .balance,
    0,
  );
  assert.equal(
    s.categoryList(a, "ng").filter((x) => x.name === "Office supplies").length,
    1,
  );
});
test("receipt suggestions avoid subtotal and leave absent or invalid dates blank", () => {
  const r = receiptSuggestions(
    "SHOP LIMITED\nReceipt # REC-12\n20/10/2026\nSubtotal 9,000.00\nTax 1,000.00\nTOTAL 10,000.00",
  );
  assert.equal(r.amount, "10000.00");
  assert.equal(r.date, "2026-10-20");
  assert.equal(r.reference, "REC-12");
  assert.equal(r.payee, "SHOP LIMITED");
  assert.equal(receiptSuggestions("SHOP\n31/02/2026").date, "");
  assert.equal(receiptSuggestions("Subtotal 9.00").amount, "");
});

test("invoice partial receipts are persistent, idempotent and never duplicate costs", (t) => {
  const { s, a } = setup(t),
    svc = new InvoiceService(s),
    r = svc.save(a, {
      ...invoice(),
      tax_basis_points: 0,
      items: [{ description: "Service", quantity: 1, unit_minor: 100000 }],
    });
  const payload = {
    request_key: randomUUID(),
    revision: 0,
    amount_minor: 40000,
    date: "2026-10-20",
    reference: "BANK-1",
    method: "Bank transfer",
    notes: "",
  };
  assert.throws(() => svc.payment(a, r.id, payload), /Issue the invoice/);
  const issued = svc.action(a, r.id, { action: "issue", revision: 0 });
  const p = { ...payload, revision: issued.revision };
  const part = svc.payment(a, r.id, p);
  assert.equal(part.received_minor, 40000);
  assert.equal(part.balance_minor, 60000);
  assert.equal(part.payment_status, "part paid");
  assert.equal(svc.payment(a, r.id, p).payments.length, 1);
  assert.throws(
    () => svc.payment(a, r.id, { ...p, amount_minor: 50000 }),
    /different details/,
  );
  assert.throws(
    () => svc.payment(a, r.id, { ...p, request_key: randomUUID() }),
    /changed/,
  );
  assert.throws(
    () =>
      svc.payment(a, r.id, {
        ...p,
        request_key: randomUUID(),
        revision: part.revision,
      }),
    /already recorded/,
  );
  assert.throws(
    () =>
      svc.payment(a, r.id, {
        ...p,
        request_key: randomUUID(),
        revision: part.revision,
        reference: "BANK-2",
        amount_minor: 60001,
      }),
    /exceeds/,
  );
  assert.throws(
    () => svc.action(a, r.id, { action: "cancel", revision: part.revision }),
    /has payments/,
  );
  const full = svc.payment(a, r.id, {
    ...p,
    request_key: randomUUID(),
    revision: part.revision,
    reference: "BANK-2",
    amount_minor: 60000,
  });
  assert.equal(full.balance_minor, 0);
  assert.equal(full.payment_status, "paid");
  assert.equal(svc.list(a, "ng")[0].received_minor, 100000);
  const voided = svc.voidPayment(a, r.id, part.payments[0].id, {
    revision: full.revision,
    reason: "Duplicate entered by mistake",
  });
  assert.equal(voided.received_minor, 60000);
  assert.equal(voided.balance_minor, 40000);
  assert.equal(voided.payments.length, 2);
  assert.equal(
    svc.voidPayment(a, r.id, part.payments[0].id, {
      revision: full.revision,
      reason: "Retry",
    }).balance_minor,
    40000,
  );
  assert.equal(s.get("SELECT COUNT(*) AS n FROM journals").n, 0);
  assert.throws(() =>
    svc.payment(s.actor("auditor"), r.id, {
      ...p,
      request_key: randomUUID(),
      revision: voided.revision,
      reference: "BANK-3",
    }),
  );
});
