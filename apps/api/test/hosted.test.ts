import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { FinanceStore } from "../src/domain";
import { createFinanceApp } from "../src/main";
import { validateHosting } from "../src/hosted";
import { isWorkspaceOwner } from "../../web/lib/hosted-access";

test("hosted owner access requires an exact verified email and configured allowlist", () => {
  const user = (emailAddress: string, status: string) => ({
    emailAddresses: [{ emailAddress, verification: { status } }],
  });
  assert.equal(
    isWorkspaceOwner(
      user("OWNER@example.com", "verified"),
      "owner@example.com",
    ),
    true,
  );
  assert.equal(
    isWorkspaceOwner(
      user("owner@example.com", "unverified"),
      "owner@example.com",
    ),
    false,
  );
  assert.equal(
    isWorkspaceOwner(
      user("other@example.com", "verified"),
      "owner@example.com",
    ),
    false,
  );
  assert.equal(
    isWorkspaceOwner(
      user("owner@example.com.evil.test", "verified"),
      "owner@example.com",
    ),
    false,
  );
  assert.equal(isWorkspaceOwner(null, "owner@example.com"), false);
  assert.equal(isWorkspaceOwner(user("owner@example.com", "verified")), false);
});
test("hosted backend denies anonymous and local identity access, and preserves data across restart", async (t) => {
  const original = {
    mode: process.env.JAYE_MODE,
    secret: process.env.JAYE_API_SECRET,
    db: process.env.JAYE_DB_PATH,
    test: process.env.JAYE_TEST,
  };
  const dir = mkdtempSync(join(tmpdir(), "jaye-hosted-"));
  process.env.JAYE_MODE = "hosted";
  process.env.JAYE_TEST = "1";
  delete process.env.JAYE_API_SECRET;
  assert.throws(validateHosting, /strong/);
  process.env.JAYE_API_SECRET = randomBytes(32).toString("hex");
  process.env.JAYE_DB_PATH = "relative.db";
  assert.throws(validateHosting, /persistent/);
  process.env.JAYE_DB_PATH = join(dir, "workspace.db");
  const store = new FinanceStore(process.env.JAYE_DB_PATH, "empty", "ng");
  const app = await createFinanceApp(store);
  t.after(async () => {
    await app.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries({
      JAYE_MODE: original.mode,
      JAYE_API_SECRET: original.secret,
      JAYE_DB_PATH: original.db,
      JAYE_TEST: original.test,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const call = (path: string, headers: Record<string, string> = {}) =>
    fetch(base + "/api/" + path, { headers });
  assert.equal((await call("health")).status, 200);
  assert.equal((await call("me")).status, 401);
  assert.equal(
    (await call("entities", { "x-jaye-service-key": "wrong" })).status,
    401,
  );
  const local = store.login("finance");
  assert.equal(
    (await call("me", { cookie: `jaye_session=${local.token}` })).status,
    401,
  );
  const headers = { "x-jaye-service-key": process.env.JAYE_API_SECRET };
  assert.equal((await call("demo/users", headers)).status, 403);
  assert.equal(
    (
      await fetch(base + "/api/demo/login", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "finance" }),
      })
    ).status,
    403,
  );
  const me = await call("me", headers);
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.id, "finance");
  const vendor = await fetch(base + "/api/vendors", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      entity_id: "ng",
      name: "Hosted persistence test",
      category: "Operations",
      related_party: false,
    }),
  });
  assert.equal(vendor.status, 201);
  const reopened = new FinanceStore(process.env.JAYE_DB_PATH, "empty", "ng");
  try {
    assert.ok(
      reopened.get(
        "SELECT id FROM vendors WHERE name=?",
        "Hosted persistence test",
      ),
    );
  } finally {
    reopened.db.close();
  }
});
