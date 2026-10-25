import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FinanceStore } from "../src/domain";
import { BudgetService } from "../src/budgets";
import { BookkeepingService } from "../src/bookkeeping";
import { createFinanceApp } from "../src/main";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "jaye-budget-"));
  const s = new FinanceStore(join(dir, "test.db"), "empty");
  s.run(
    "INSERT INTO users(id,name,role,entities) VALUES(?,?,?,?)",
    "qa-auditor",
    "QA auditor",
    "auditor",
    JSON.stringify(["ng"]),
  );
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { s, b: new BudgetService(s), a: s.actor("finance") };
}
const line = () => ({
  entity_id: "ng",
  department: "Operations",
  category: "Operations",
  period: "2026-10",
  amount_minor: 500000,
  revision: 0,
  request_key: randomUUID(),
});
test("budget CRUD is persistent, versioned, retry-safe and never posts accounting entries", (t) => {
  const { s, b, a } = fixture(t),
    input = line(),
    created = b.save(a, input);
  assert.equal(b.save(a, input).id, created.id);
  assert.equal(b.list(a, "ng").length, 1);
  assert.throws(() => b.save(a, { ...input, amount_minor: 1 }), /Request key/);
  const changed = b.save(
    a,
    {
      ...input,
      amount_minor: 600000,
      revision: created.revision,
      request_key: randomUUID(),
    },
    created.id,
  );
  assert.equal(changed.revision, 2);
  const reopened = new FinanceStore(join(s.dir, "test.db"), "empty");
  try { const persisted = new BudgetService(reopened).list(reopened.actor("finance"), "ng")[0]; assert.equal(persisted.amount_minor, 600000); assert.equal(persisted.revision, 2); } finally { reopened.db.close(); }
  assert.equal(b.list(a, "ng")[0].remaining_minor, 600000);
  assert.throws(
    () => b.save(a, { ...input, request_key: randomUUID() }, created.id),
    /Reload/,
  );
  const action = (action: string, revision: number) =>
    b.action(a, created.id, {
      entity_id: "ng",
      action,
      revision,
      request_key: randomUUID(),
    });
  action("archive", 2);
  assert.equal(b.list(a, "ng").length, 0);
  assert.equal(b.list(a, "ng", true)[0].archived, 1);
  action("restore", 3);
  assert.equal(b.list(a, "ng").length, 1);
  action("delete", 4);
  assert.equal(b.list(a, "ng", true).length, 0);
  assert.equal(b.history(a, "ng", created.id).length, 5);
  assert.equal(s.get("SELECT COUNT(*) n FROM journals").n, 0);
  assert.throws(() => s.run("DELETE FROM budget_history"), /immutable/);
});
test("used budgets preserve dimensions and cost history while allowing allocation changes", (t) => {
  const { s, b, a } = fixture(t),
    input = line(),
    created = b.save(a, input);
  new BookkeepingService(s).record(a, {
    entity_id: "ng",
    kind: "expense",
    description: "Budgeted internet",
    payee: "QA",
    category: "Operations",
    department: "Operations",
    amount_minor: 120000,
    date: "2026-10-10",
    due_date: "2026-10-11",
    request_key: randomUUID(),
  });
  assert.equal(b.list(a, "ng")[0].actual_minor, 120000);
  assert.throws(
    () =>
      b.action(a, created.id, {
        entity_id: "ng",
        action: "delete",
        revision: 1,
        request_key: randomUUID(),
      }),
    /Archive/,
  );
  assert.throws(
    () =>
      b.save(
        a,
        { ...input, period: "2026-11", revision: 1, request_key: randomUUID() },
        created.id,
      ),
    /keep its/,
  );
  b.save(
    a,
    { ...input, amount_minor: 100000, revision: 1, request_key: randomUUID() },
    created.id,
  );
  assert.equal(b.list(a, "ng")[0].remaining_minor, -20000);
  b.action(a, created.id, {
    entity_id: "ng",
    action: "archive",
    revision: 2,
    request_key: randomUUID(),
  });
  assert.equal(s.budgetsRaw("ng").length, 0);
  assert.equal(b.list(a, "ng", true)[0].actual_minor, 120000);
  assert.equal(
    s.get("SELECT SUM(amount_minor) n FROM bookkeeping_records").n,
    120000,
  );
});
test("budget validation, archived uniqueness and permissions preserve old records", (t) => {
  const { s, b, a } = fixture(t);
  s.run(
    "INSERT INTO budgets VALUES('legacy','ng','Finance','Salaries','2026-09',400000)",
  );
  assert.equal(b.list(a, "ng")[0].revision, 0);
  b.save(
    a,
    {
      ...line(),
      department: "Finance",
      category: "Salaries",
      period: "2026-09",
      revision: 0,
    },
    "legacy",
  );
  assert.equal(b.history(a, "ng", "legacy").at(-1)!.data.amount_minor, 400000);
  assert.throws(() => b.save(s.actor("qa-auditor"), line()), /role cannot/);
  assert.throws(() => b.save(a, { ...line(), period: "2026-13" }), /YYYY-MM/);
  assert.throws(() => b.save(a, { ...line(), amount_minor: -1 }), /Too small/);
  const c = b.save(a, line());
  b.action(a, c.id, {
    entity_id: "ng",
    action: "archive",
    revision: 1,
    request_key: randomUUID(),
  });
  assert.throws(() => b.save(a, line()), /already exists/);
  b.save(a, { ...line(), period: "2026-11" });
  assert.equal(b.list(a, "ng").length, 2);
});
test("budget HTTP controls require an identity and support create, edit, history and archive", async (t) => {
  const { s } = fixture(t),
    app = await createFinanceApp(s);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const root = await app.getUrl();
  assert.equal((await fetch(root + "/api/budgets?entity=ng")).status, 401);
  const headers = {
    cookie: `jaye_session=${s.login("finance").token}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(root + "/api/budgets", {
    method: "POST",
    headers,
    body: JSON.stringify(line()),
  });
  assert.equal(response.status, 201);
  const row = await response.json();
  assert.equal(
    (
      await (
        await fetch(root + "/api/budgets/access?entity=ng", { headers })
      ).json()
    ).can_write,
    true,
  );
  assert.equal(
    (
      await fetch(root + `/api/budgets/${row.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...line(), revision: 1, amount_minor: 700000 }),
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await (
        await fetch(root + `/api/budgets/${row.id}/history?entity=ng`, {
          headers,
        })
      ).json()
    ).length,
    2,
  );
  const ro = {
    cookie: `jaye_session=${s.login("qa-auditor").token}`,
    "Content-Type": "application/json",
  };
  assert.equal(
    (
      await (
        await fetch(root + "/api/budgets/access?entity=ng", { headers: ro })
      ).json()
    ).can_write,
    false,
  );
  assert.equal(
    (
      await fetch(root + "/api/budgets", {
        method: "POST",
        headers: ro,
        body: JSON.stringify(line()),
      })
    ).status,
    403,
  );
});
