// Isolated QA artifact; never writes to the workspace database.
import { mkdirSync, writeFileSync } from "node:fs";
import { defaults, eventSchema, addDays, days } from "../src/financial/types";
import { calculate, Input } from "../src/financial/engine";
import { exportInvestorWorkbook } from "../src/financial/investor-workbook";
import { exportFinancialWorkbook } from "../src/financial/workbook";
async function main() {
  const input: Input = {
    resources: defaults().map((r) => ({
      ...r,
      revision: 1,
      archived: false,
      updated_at: "2026-10-25",
    })),
    events: [],
    ledger: [],
    pending: [],
    invoiceReceipts: [],
    captured_at: "2026-10-25T12:00:00Z",
  };
  const add = (id: string, kind: any, data: any) =>
    input.resources.push({
      id,
      kind,
      data,
      revision: 1,
      archived: false,
      updated_at: input.captured_at,
    });
  add("fund", "funding", {
    name: "QA funding",
    date: "2026-12-01",
    amount_minor: 6500000000,
    kind: "equity",
    status: "planned",
    reference: "",
    source: "Synthetic QA only",
  });
  for (const [id, initial] of [
    ["conservative", 5],
    ["base", 10],
    ["aggressive", 20],
  ] as const)
    add(`assumption-${id}`, "assumption", {
      name: "QA car cohort",
      scenario_id: id,
      service_id: "car",
      price_id: "car-month",
      initial_paying: initial,
      new_drivers_daily: 2,
      activation: 0.8,
      paid_conversion: 0.5,
      renewal: 0.9,
      daily_purchase_rate: 1,
      jobs_per_driver: 2,
      available_hours: 8,
      hours_per_job: 1,
      average_booking_minor: 100000,
      direct_cost_per_job_minor: 50,
      collection_delay: 1,
      launch_delay: 87,
      source: "Synthetic QA only",
      confidence: "estimate",
    });
  add("cost", "cost", {
    name: "QA rent",
    scenario_id: "",
    service_id: "",
    category: "prepayment",
    amount_minor: 900000,
    start_date: "2026-12-01",
    end_date: "2027-02-28",
    pay_date: "2026-12-01",
    cadence: "once",
    useful_life_months: 12,
  });
  add("capex", "cost", {
    name: "QA equipment",
    scenario_id: "",
    service_id: "",
    category: "capex",
    amount_minor: 120000,
    start_date: "2026-12-01",
    end_date: "2026-12-01",
    pay_date: "2026-12-01",
    cadence: "once",
    useful_life_months: 12,
  });
  if (process.env.JAYE_QA_MIXED === "1") {
    input.resources[0].data.cutoff = "2027-02-25";
    input.resources.find((r) => r.id === "fund")!.data.status = "confirmed";
    input.resources.find((r) => r.id === "fund")!.data.reference = "QA-receipt";
    for (const r of input.resources) {
      if (r.kind === "assumption") r.data.launch_delay = 0;
      if (r.kind === "cost") {
        r.data.start_date = "2027-02-26";
        r.data.pay_date = "2027-02-26";
        r.data.end_date = "2027-02-28";
      }
    }
    const sub = eventSchema.parse({
      source_id: "qa",
      external_id: "subscription",
      revision: 1,
      type: "subscription",
      date: "2027-02-20",
      service_id: "car",
      driver_id: "qa-driver",
      price_id: "car-month",
      status: "paid",
      amount_minor: 2000000,
      currency: "NGN",
      coverage_end: "2027-03-20",
    });
    const receipt = eventSchema.parse({
      source_id: "qa",
      external_id: "receipt",
      revision: 1,
      type: "collection",
      date: "2027-02-20",
      service_id: "car",
      status: "paid",
      amount_minor: 2000000,
      currency: "NGN",
      related_id: "subscription",
    });
    input.events = [
      {
        ...sub,
        price_snapshot: input.resources.find((r) => r.id === "car-month")!.data,
      },
      receipt,
    ];
  }
  if (process.env.JAYE_QA_START && process.env.JAYE_QA_END) {
    const start = process.env.JAYE_QA_START,
      end = process.env.JAYE_QA_END;
    Object.assign(input.resources.find((r) => r.kind === "config")!.data, {
      start_date: start,
      end_date: end,
      cutoff: addDays(start, -1),
    });
    for (const r of input.resources) {
      if (r.kind === "funding")
        Object.assign(r.data, { date: start, status: "planned" });
      if (r.kind === "cost")
        Object.assign(r.data, {
          start_date: start,
          pay_date: start,
          end_date: end,
        });
      if (r.kind === "assumption")
        r.data.launch_delay = Math.max(0, days(start, end) - 2);
    }
  }
  const out = process.env.JAYE_QA_DIR || "/tmp/jaye-fm-validation";
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/input.json`, JSON.stringify(input));
  const edited = structuredClone(input);
  edited.resources.find(
    (r) => r.id === "assumption-base",
  )!.data.initial_paying = 15;
  edited.resources.find((r) => r.id === "car-month")!.data.amount_minor =
    3000000;
  edited.resources.find((r) => r.id === "cost")!.data.quantity = 2;
  writeFileSync(
    `${out}/expected-edited.json`,
    JSON.stringify(calculate(edited, "base")),
  );
  writeFileSync(
    `${out}/expected.json`,
    JSON.stringify(
      Object.fromEntries(
        ["conservative", "base", "aggressive"].map((s) => [
          s,
          calculate(input, s),
        ]),
      ),
    ),
  );
  writeFileSync(
    `${out}/model.xlsx`,
    Buffer.from(
      await exportFinancialWorkbook(input, "synthetic-validation", "base"),
    ),
  );
  writeFileSync(
    `${out}/investor.xlsx`,
    Buffer.from(
      await exportInvestorWorkbook({ input, result: calculate(input, "base") }),
    ),
  );
  console.log(out);
}
void main();
