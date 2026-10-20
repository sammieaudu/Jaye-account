import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinanceStore, csv } from "../src/domain";
import { createFinanceApp } from "../src/main";
import { ReportingService } from "../src/reporting";
import { parse } from "csv-parse/sync";

test("full HTTP lifecycle: company bills, grouped employee and founder reimbursements, refunds and partial recoveries agree with reports and ledger", async (t) => {
  process.env.JAYE_TEST = "1";
  const dir = mkdtempSync(join(tmpdir(), "jaye-full-workflow-"));
  const store = new FinanceStore(join(dir, "test.db"));
  const app = await createFinanceApp(store);
  await app.listen(0, "127.0.0.1");
  const base = `${await app.getUrl()}/api`;
  t.after(async () => {
    await app.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const cookies: Record<string, string> = {};
  const raw = (path: string, who = "finance", body?: any) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookies[who] || "",
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
  const call = async (
    path: string,
    who = "finance",
    body?: any,
  ): Promise<any> => {
    const response = await raw(path, who, body);
    const text = await response.text();
    assert.equal(
      response.status,
      body === undefined ? 200 : 201,
      `${who} ${path}: ${text}`,
    );
    return JSON.parse(text);
  };
  const rejected = async (
    path: string,
    who: string,
    body: any,
    status: number,
  ) => {
    const response = await raw(path, who, body);
    assert.equal(response.status, status, await response.text());
  };
  for (const who of [
    "employee",
    "manager",
    "finance",
    "payer",
    "reconciler",
    "cfo",
    "investor",
  ]) {
    const response = await raw("/demo/login", who, { user_id: who });
    assert.equal(response.status, 201);
    cookies[who] = response.headers.get("set-cookie")!.split(";")[0];
  }
  const report = () => call("/reports/operations?entity=ng");
  const trial = () => call("/reports/trial-balance?entity=ng");
  const balance = (rows: any[], code: string) =>
    rows.find((row) => row.code === code)?.balance || 0;
  const initialReport = await report();
  const initialTrial = await trial();
  const otherEntity = await call("/reports/trial-balance?entity=inc");
  const checkpoints: any[] = [];
  type Expected = {
    cost: number;
    cash: number;
    payable: number;
    bills?: number;
    owed?: number;
    recovery?: number;
    pending?: number;
  };
  const check = async (stage: string, expected: Expected) => {
    const r = await report(),
      tb = await trial();
    const delta = (field: string) =>
      r.totals[field] - initialReport.totals[field];
    assert.equal(
      delta("net_posted_cost_minor"),
      expected.cost,
      `${stage}: net costs`,
    );
    assert.equal(
      balance(tb, "1100") - balance(initialTrial, "1100"),
      expected.cash,
      `${stage}: bank cash`,
    );
    assert.equal(
      balance(tb, "2100") - balance(initialTrial, "2100"),
      expected.payable,
      `${stage}: payables`,
    );
    assert.equal(
      balance(tb, "1200") - balance(initialTrial, "1200"),
      expected.recovery || 0,
      `${stage}: recovery receivable`,
    );
    assert.equal(
      delta("bills_minor"),
      expected.bills || 0,
      `${stage}: vendor bills`,
    );
    assert.equal(
      delta("reimbursements_minor"),
      expected.owed || 0,
      `${stage}: owed to people`,
    );
    assert.equal(
      delta("recoverable_minor"),
      expected.recovery || 0,
      `${stage}: recovery report`,
    );
    if (expected.pending !== undefined)
      assert.equal(
        delta("pending_minor"),
        expected.pending,
        `${stage}: pending approval`,
      );
    assert.equal(
      tb.reduce((n: number, row: any) => n + row.balance, 0),
      0,
      `${stage}: trial balance`,
    );
    assert.equal(
      r.totals.net_posted_cost_minor,
      tb
        .filter((row: any) => row.type === "expense")
        .reduce((n: number, row: any) => n + row.balance, 0),
      `${stage}: costs tie to ledger`,
    );
    assert.equal(
      r.totals.gross_posted_cost_minor -
        r.totals.posted_refunds_minor -
        r.totals.posted_adjustments_minor,
      r.totals.net_posted_cost_minor,
      `${stage}: refunds deducted once`,
    );
    for (const j of await call("/journals?entity=ng"))
      assert.equal(
        j.lines.reduce(
          (n: number, line: any) => n + line.debit - line.credit,
          0,
        ),
        0,
        `${stage}: journal ${j.id}`,
      );
    assert.deepEqual(
      await call("/reports/trial-balance?entity=inc"),
      otherEntity,
      `${stage}: other entity unchanged`,
    );
    assert.equal(
      (await call("/audit?entity=ng")).valid,
      true,
      `${stage}: audit integrity`,
    );
    checkpoints.push({ stage, ...expected });
  };
  const date = "2026-10-19";
  const statement = (reference: string, amount: number, direction: string) =>
    call("/banking/import", "finance", {
      entity_id: "ng",
      csv: `reference,date,currency,amount_minor,description,direction\n${reference},${date},NGN,${amount},Full workflow fixture,${direction}`,
    });
  const create = async (
    label: string,
    amount: number,
    source = "company",
    who = "employee",
    expenseDate = date,
  ) => {
    const e = await call("/spends", who, {
      entity_id: "ng",
      kind: source === "company" ? "bill" : "expense",
      vendor_id: "ng-v0",
      description: `E2E ${label}`,
      purpose: "Isolated full workflow regression scenario",
      amount_minor: amount,
      currency: "NGN",
      department: "Operations",
      category: "Operations",
      date: expenseDate,
      due_date: date,
      invoice_number: `E2E-${label}`,
      payment_source: source,
      payment_method: "card",
      ...(source === "company"
        ? {}
        : { paid_by_id: who, original_paid_date: expenseDate }),
    });
    await rejected(`/spends/${e.id}/action`, who, { action: "submit" }, 400);
    const file = new FormData();
    file.append(
      "file",
      new Blob([`%PDF-1.4\nSynthetic E2E evidence for ${label}`], {
        type: "application/pdf",
      }),
      `${label}.pdf`,
    );
    await call(`/spends/${e.id}/receipt`, who, file);
    return e;
  };
  const approve = async (path: string, who = "employee") => {
    await call(`${path}/action`, who, { action: "submit" });
    await rejected(`${path}/action`, who, { action: "approve" }, 403);
    await call(`${path}/action`, "manager", { action: "approve" });
    const approved = await call(`${path}/action`, "finance", {
      action: "approve",
    });
    assert.equal(approved.status, "approved");
  };
  const postTwice = async (path: string) => {
    await call(path, "finance", { action: "post" });
    const before = await trial(),
      journals = await call("/journals?entity=ng");
    if (path.startsWith("/spends/") || path.startsWith("/repayments/")) {
      await rejected(path, "finance", { action: "post" }, 400);
    } else {
      await call(path, "finance", { action: "post" });
    }
    assert.deepEqual(
      await trial(),
      before,
      `${path}: retry does not change ledger`,
    );
    assert.equal((await call("/journals?entity=ng")).length, journals.length);
  };
  const adjustment = async (
    expense: any,
    kind: string,
    amount: number,
    ref: string,
  ) => {
    const body = {
      spend_id: expense.id,
      kind,
      amount_minor: amount,
      reference: ref,
      reason: "Returned unused services",
      evidence_reference: `Synthetic supporting document ${ref}`,
      date,
    };
    const a = await call("/adjustments", "finance", body);
    assert.equal((await call("/adjustments", "finance", body)).id, a.id);
    await rejected(
      `/adjustments/${a.id}/action`,
      "finance",
      { action: "verify" },
      403,
    );
    return a;
  };
  const postAdjustment = async (a: any) => {
    await call(`/adjustments/${a.id}/action`, "reconciler", {
      action: "verify",
    });
    await postTwice(`/adjustments/${a.id}/action`);
  };
  const group = async (items: any[], who = "employee") => {
    const c = await call("/reimbursements", who, {
      entity_id: "ng",
      title: `E2E ${who} grouped claim`,
      spend_ids: items.map((e) => e.id),
    });
    await approve(`/reimbursements/${c.id}`, who);
    return c;
  };
  const schedule = async (c: any, amount: number) => {
    const result = await call(`/reimbursements/${c.id}/repayments`, "finance", {
      amount_minor: amount,
      date,
    });
    return result.payments.find((p: any) => p.status === "scheduled");
  };
  const payClaim = async (payment: any, amount: number, reference: string) => {
    assert.ok(payment?.id);
    await rejected(
      `/repayments/${payment.id}/action`,
      "employee",
      { action: "confirm", reference },
      403,
    );
    await call(`/repayments/${payment.id}/action`, "payer", {
      action: "confirm",
      reference,
    });
    await statement(reference, amount, "debit");
    await call(`/repayments/${payment.id}/action`, "reconciler", {
      action: "reconcile",
      reference,
    });
    await postTwice(`/repayments/${payment.id}/action`);
  };

  // Company bill: an unpaid credit reduces its liability, then a bank refund reduces cost.
  const company = await create("company-bill", 100000);
  await check("Company draft", {
    cost: 0,
    cash: 0,
    payable: 0,
    pending: 100000,
  });
  await approve(`/spends/${company.id}`);
  await check("Company approved", {
    cost: 0,
    cash: 0,
    payable: 0,
    bills: 100000,
  });
  const credit = await adjustment(company, "credit_note", 20000, "E2E-CREDIT");
  await rejected(
    `/spends/${company.id}/action`,
    "finance",
    { action: "schedule" },
    400,
  );
  await check("Credit pending", {
    cost: 0,
    cash: 0,
    payable: 0,
    bills: 100000,
  });
  await postAdjustment(credit);
  await check("Credit posted", {
    cost: 80000,
    cash: 0,
    payable: -80000,
    bills: 80000,
  });
  await call(`/spends/${company.id}/action`, "finance", { action: "schedule" });
  await rejected(
    `/spends/${company.id}/action`,
    "finance",
    { action: "confirm", reference: "E2E-COMPANY-PAY" },
    403,
  );
  await call(`/spends/${company.id}/action`, "payer", {
    action: "confirm",
    reference: "E2E-COMPANY-PAY",
  });
  await statement("E2E-COMPANY-PAY", 80000, "debit");
  await call(`/spends/${company.id}/action`, "reconciler", {
    action: "reconcile",
    reference: "E2E-COMPANY-PAY",
  });
  await postTwice(`/spends/${company.id}/action`);
  await check("Company payment posted", {
    cost: 80000,
    cash: -80000,
    payable: 0,
  });
  const refundBody = {
    spend_id: company.id,
    amount_minor: 10000,
    reference: "E2E-BANK-REFUND",
    reason: "Vendor returned unused service charge",
    date,
  };
  const refund = await call("/refunds", "finance", refundBody);
  assert.equal((await call("/refunds", "finance", refundBody)).id, refund.id);
  await check("Bank refund pending", { cost: 80000, cash: -80000, payable: 0 });
  await statement("E2E-BANK-REFUND", 10000, "credit");
  await call(`/refunds/${refund.id}/action`, "reconciler", {
    action: "reconcile",
    reference: "E2E-BANK-REFUND",
  });
  await check("Bank refund matched", { cost: 80000, cash: -80000, payable: 0 });
  await postTwice(`/refunds/${refund.id}/action`);
  await check("Bank refund posted", { cost: 70000, cash: -70000, payable: 0 });

  // Employee claim: oldest expense repaid first; its later refund must not offset a different expense.
  const first = await create(
    "employee-first",
    100000,
    "employee",
    "employee",
    "2026-10-17",
  );
  const second = await create(
    "employee-second",
    50000,
    "employee",
    "employee",
    "2026-10-18",
  );
  const employeeClaim = await group([first, second]);
  await check("Employee claim approved", {
    cost: 70000,
    cash: -70000,
    payable: 0,
    owed: 150000,
  });
  await rejected(
    `/reimbursements/${employeeClaim.id}/repayments`,
    "finance",
    { amount_minor: 150001, date },
    400,
  );
  const partial = await schedule(employeeClaim, 100000);
  await check("Employee partial scheduled", {
    cost: 220000,
    cash: -70000,
    payable: -150000,
    owed: 150000,
  });
  await payClaim(partial, 100000, "E2E-EMPLOYEE-PART");
  await check("Employee partial posted", {
    cost: 220000,
    cash: -170000,
    payable: -50000,
    owed: 50000,
  });
  const personalRefund = await adjustment(
    first,
    "personal_refund",
    30000,
    "E2E-PERSONAL-REFUND",
  );
  await postAdjustment(personalRefund);
  await check("Employee refund creates debt", {
    cost: 190000,
    cash: -170000,
    payable: -50000,
    owed: 50000,
    recovery: 30000,
  });
  const person = (await report()).people.find((p: any) => p.id === "employee");
  assert.equal(person.owed_minor, 50000);
  assert.equal(person.recoverable_minor, 30000);
  assert.equal(
    Object.values(person.buckets).reduce(
      (n: number, value: any) => n + value,
      0,
    ),
    50000,
  );
  await payClaim(
    await schedule(employeeClaim, 50000),
    50000,
    "E2E-EMPLOYEE-FINAL",
  );
  await check("Employee claim settled", {
    cost: 190000,
    cash: -220000,
    payable: 0,
    recovery: 30000,
  });
  for (const [amount, remaining, cash, reference] of [
    [10000, 20000, -210000, "E2E-REC-PART"],
    [20000, 0, -190000, "E2E-REC-FINAL"],
  ] as const) {
    const before = await trial();
    const body = {
      adjustment_id: personalRefund.id,
      amount_minor: amount,
      date,
      reference,
      note: "Synthetic employee repayment to Jaye",
    };
    const payment = await call("/recoveries", "employee", body);
    assert.equal((await call("/recoveries", "employee", body)).id, payment.id);
    assert.deepEqual(
      await trial(),
      before,
      "Recording recovery does not clear ledger debt",
    );
    await rejected(
      `/recoveries/${payment.id}/action`,
      "employee",
      { action: "reconcile", reference },
      403,
    );
    if (amount === 10000) {
      await rejected(
        `/recoveries/${payment.id}/action`,
        "reconciler",
        { action: "reconcile", reference: "E2E-BANK-REFUND" },
        400,
      );
    }
    await check(`${reference} recorded`, {
      cost: 190000,
      cash: cash - amount,
      payable: 0,
      recovery: remaining + amount,
    });
    const obligation = (await call("/recoveries?entity=ng")).obligations.find(
      (o: any) => o.id === personalRefund.id,
    );
    assert.equal(obligation.pending_minor, amount);
    assert.equal(obligation.available_minor, remaining);
    await statement(reference, amount + 1, "credit");
    await rejected(
      `/recoveries/${payment.id}/action`,
      "reconciler",
      { action: "reconcile", reference },
      400,
    );
    await statement(`${reference}-EXACT`, amount, "credit");
    await call(`/recoveries/${payment.id}/action`, "reconciler", {
      action: "reconcile",
      reference: `${reference}-EXACT`,
    });
    assert.deepEqual(
      await trial(),
      before,
      "Matching recovery does not clear ledger debt",
    );
    await check(`${reference} matched`, {
      cost: 190000,
      cash: cash - amount,
      payable: 0,
      recovery: remaining + amount,
    });
    await postTwice(`/recoveries/${payment.id}/action`);
    await check(reference, {
      cost: 190000,
      cash,
      payable: 0,
      recovery: remaining,
    });
  }
  await rejected(
    "/recoveries",
    "employee",
    {
      adjustment_id: personalRefund.id,
      amount_minor: 1,
      date,
      reference: "E2E-OVER-RECOVERY",
      note: "Must reject overpayment",
    },
    400,
  );

  // Founder refund against an unpaid balance reduces what Jaye owes, without creating cash or recovery.
  const founder = await create("founder-expense", 60000, "founder", "cfo");
  const founderClaim = await group([founder], "cfo");
  await check("Founder claim approved", {
    cost: 190000,
    cash: -190000,
    payable: 0,
    owed: 60000,
  });
  await payClaim(
    await schedule(founderClaim, 20000),
    20000,
    "E2E-FOUNDER-PART",
  );
  await check("Founder partially repaid", {
    cost: 250000,
    cash: -210000,
    payable: -40000,
    owed: 40000,
  });
  const founderRefund = await adjustment(
    founder,
    "personal_refund",
    10000,
    "E2E-FOUNDER-REFUND",
  );
  await postAdjustment(founderRefund);
  await check("Founder refund reduces owed", {
    cost: 240000,
    cash: -210000,
    payable: -30000,
    owed: 30000,
  });
  await payClaim(
    await schedule(founderClaim, 30000),
    30000,
    "E2E-FOUNDER-FINAL",
  );
  await check("All obligations cleared", {
    cost: 240000,
    cash: -240000,
    payable: 0,
    pending: 0,
  });

  const finalReport = await report();
  assert.equal(
    finalReport.totals.unmatched_credits_minor -
      initialReport.totals.unmatched_credits_minor,
    30002,
    "Rejected amount-mismatch bank rows remain visible for reconciliation",
  );
  assert.equal(
    finalReport.totals.pending_refunds_minor -
      initialReport.totals.pending_refunds_minor,
    0,
  );
  const banks = await call("/banking/transactions?entity=ng");
  assert.equal(
    banks.find((b: any) => b.reference === "E2E-BANK-REFUND").matched_refund_id,
    refund.id,
  );
  for (const reference of ["E2E-REC-PART-EXACT", "E2E-REC-FINAL-EXACT"])
    assert.ok(
      banks.find((b: any) => b.reference === reference).matched_recovery_id,
    );
  assert.equal(
    finalReport.totals.gross_posted_cost_minor -
      initialReport.totals.gross_posted_cost_minor,
    310000,
  );
  assert.equal(
    finalReport.totals.posted_adjustments_minor -
      initialReport.totals.posted_adjustments_minor,
    60000,
  );
  assert.equal(
    finalReport.totals.posted_refunds_minor -
      initialReport.totals.posted_refunds_minor,
    10000,
  );
  for (const c of [employeeClaim, founderClaim])
    assert.equal((await call(`/reimbursements/${c.id}`)).outstanding_minor, 0);
  assert.equal(
    (await raw("/reports/operations?entity=ng", "investor")).status,
    403,
  );
  const exportResponse = await raw("/exports/trial-balance?entity=ng");
  assert.equal(exportResponse.status, 200);
  const exportedRows = parse(await exportResponse.text(), { columns: true });
  const finalTrial = await trial();
  assert.equal(exportedRows.length, finalTrial.length);
  for (const row of exportedRows) {
    const account = finalTrial.find((entry: any) => entry.code === row.code);
    assert.ok(account);
    assert.equal(Number(row.debit_minor), account.debit);
    assert.equal(Number(row.credit_minor), account.credit);
    assert.equal(Number(row.balance_minor), account.balance);
  }
  const spendExport = await raw("/exports/spend?entity=ng");
  assert.equal(spendExport.status, 200);
  assert.match(await spendExport.text(), /E2E founder-expense/);
  const reopened = new FinanceStore(join(dir, "test.db"));
  try {
    assert.deepEqual(
      reopened
        .trialBalance(reopened.actor("finance"), "ng")
        .map((row: any) => ({ ...row })),
      await trial(),
    );
    assert.equal(reopened.verifyAudit(), true);
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          new ReportingService(reopened).report(
            reopened.actor("finance"),
            "ng",
          ),
        ),
      ),
      finalReport,
      "Operational reports survive reopening the database",
    );
  } finally {
    reopened.db.close();
  }
  t.diagnostic(
    `${checkpoints.length} reconciled checkpoints; gross costs 310000, credits/personal refunds 60000, bank refunds 10000, net costs and cash outflow 240000 minor units.`,
  );
});

test("CSV keeps numeric credits summable while neutralizing formula-like text", () => {
  const values = parse(
    csv(
      ["value"],
      [
        [-12345],
        [0],
        [12345],
        ["-1+2"],
        ["=1+2"],
        ["+1+2"],
        ["@SUM(A1)"],
        ["\t=1+2"],
        ["\r=1+2"],
      ],
    ),
    { columns: true },
  );
  assert.deepEqual(
    values.map((r: any) => r.value),
    [
      "-12345",
      "0",
      "12345",
      "'-1+2",
      "'=1+2",
      "'+1+2",
      "'@SUM(A1)",
      "'\t=1+2",
      "'\r=1+2",
    ],
  );
  assert.equal(
    values
      .slice(0, 3)
      .reduce((n: number, row: any) => n + Number(row.value), 0),
    0,
  );
});
