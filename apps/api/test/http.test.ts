import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FinanceStore } from "../src/domain";
import { createFinanceApp } from "../src/main";

test("HTTP boundary: sessions, permissions, uploads, approval flow, imported reconciliation and posting", async (t) => {
  process.env.JAYE_TEST = "1";
  const dir = mkdtempSync(join(tmpdir(), "jaye-http-")),
    store = new FinanceStore(join(dir, "test.db"));
  const app = await createFinanceApp(store);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  t.after(async () => {
    await app.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const call = (path: string, cookie = "", body?: any) =>
    fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(body !== undefined
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
  const login = async (id: string) => {
    const r = await call("/demo/login", "", { user_id: id });
    assert.equal(r.status, 201);
    return r.headers.get("set-cookie")!.split(";")[0];
  };
  assert.equal((await call("/spends?entity=ng")).status, 401);
  const forbidden = await fetch(base + "/api/demo/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://other-site.example",
    },
    body: JSON.stringify({ user_id: "cfo" }),
  });
  assert.equal(forbidden.status, 403);
  const investor = await login("investor");
  assert.equal((await call("/spends?entity=ng", investor)).status, 403);
  assert.equal(
    (await call("/receipts/receipt-ng-SP-0001", investor)).status,
    403,
  );
  assert.deepEqual(
    (await (await call("/investor/snapshots", investor)).json()).snapshots,
    [],
  );
  const employee = await login("employee"),
    manager = await login("manager"),
    finance = await login("finance"),
    payer = await login("payer"),
    reconciler = await login("reconciler");
  const response = await call("/spends", employee, {
    entity_id: "ng",
    kind: "expense",
    vendor_id: "ng-v0",
    description: "HTTP golden fuel expense",
    purpose: "Synthetic API end-to-end control test",
    amount_minor: 76543,
    currency: "NGN",
    department: "Operations",
    category: "Operations",
    date: "2026-10-19",
  });
  assert.equal(response.status, 201);
  const c = await response.json();
  assert.equal(
    (await call(`/spends/${c.id}/action`, employee, { action: "submit" }))
      .status,
    400,
  );
  const f = new FormData();
  f.append(
    "file",
    new Blob(["%PDF-1.4\nSYNTHETIC HTTP FIXTURE"], { type: "application/pdf" }),
    "synthetic.pdf",
  );
  assert.equal(
    (await call(`/spends/${c.id}/receipt`, employee, f)).status,
    201,
  );
  for (const [cookie, action, reference] of [
    [employee, "submit", undefined],
    [manager, "approve", undefined],
    [finance, "approve", undefined],
    [finance, "schedule", undefined],
    [payer, "confirm", "HTTP-TEST-BANK"],
  ]) {
    const r = await call(`/spends/${c.id}/action`, cookie, {
      action,
      reference,
    });
    assert.equal(r.status, 201, await r.text());
  }
  const imported = await call("/banking/import", finance, {
    entity_id: "ng",
    csv: "reference,date,currency,amount_minor,description\nHTTP-STMT,2026-10-19,NGN,76543,Synthetic debit",
  });
  assert.equal(imported.status, 201);
  assert.equal(
    (
      await call(`/spends/${c.id}/action`, reconciler, {
        action: "reconcile",
        reference: "HTTP-STMT",
      })
    ).status,
    201,
  );
  assert.equal(
    (await call(`/spends/${c.id}/action`, finance, { action: "post" })).status,
    201,
  );
  const details = await (await call(`/spends/${c.id}`, finance)).json();
  assert.equal(details.status, "posted");
  assert.equal(details.journals.length, 2);
  const tb = await (
    await call("/reports/trial-balance?entity=ng", finance)
  ).json();
  assert.equal(
    tb.reduce((n: number, r: any) => n + r.balance, 0),
    0,
  );
  const exportResponse = await call("/exports/spend?entity=ng", finance);
  assert.match(exportResponse.headers.get("content-type")!, /text\/csv/);
  assert.match(await exportResponse.text(), /HTTP golden fuel expense/);
  store.run("UPDATE users SET entities='[\"inc\"]' WHERE id='finance'");
  assert.equal((await call(`/spends/${c.id}`, finance)).status, 403);
});
