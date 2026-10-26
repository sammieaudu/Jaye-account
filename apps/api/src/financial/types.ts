import { z } from "zod";

export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Use a valid calendar date",
  );
export const money = z.number().int().min(0).max(1e13);
const fraction = z.number().min(0).max(1);
const name = z.string().trim().min(1).max(180);
const note = z.string().max(2000).default("");
export const accounts = [
  "cash",
  "restricted_cash",
  "receivables",
  "prepayments",
  "deposits",
  "fixed_assets",
  "accumulated_depreciation",
  "payables",
  "deferred_revenue",
  "settlements",
  "tax_payable",
  "debt",
  "equity",
  "retained_earnings",
  "subscription_revenue",
  "commission_revenue",
  "direct_cost",
  "marketing",
  "payroll",
  "overhead",
  "depreciation",
  "tax",
  "interest",
] as const;
export type Account = (typeof accounts)[number];
export const resourceSchemas = {
  config: z
    .object({
      name,
      start_date: day,
      end_date: day.optional(),
      cutoff: day,
      city: z.literal("Lagos"),
      opening_confirmed: z.boolean(),
      operating_data_complete_through: day.nullable(),
      tax_reviewed: z.boolean(),
      tax_note: note,
      planned_funding_minor: money,
      minimum_cash_minor: money,
      opening: z.partialRecord(
        z.enum(accounts),
        z.number().int().min(-1e13).max(1e13),
      ),
      source: note,
    })
    .transform((v) => ({
      ...v,
      end_date: v.end_date ?? addDays(v.start_date, 89),
    }))
    .superRefine((v, c) => {
      const length = days(v.start_date, v.end_date) + 1;
      if (length < 1 || length > 366)
        c.addIssue({
          code: "custom",
          path: ["end_date"],
          message: "Choose a date range of 1–366 days, inclusive",
        });
    }),
  service: z.object({
    name,
    vehicle: z.enum(["car", "keke", "bike", "shared"]),
    city: z.literal("Lagos"),
    start_date: day,
    actual_launch: day.nullable(),
    eligibility: note,
    subscription_eligible: z.boolean(),
    active: z.boolean(),
    source: note,
  }),
  price: z
    .object({
      name,
      service_id: name,
      effective_from: day,
      effective_to: day.nullable(),
      mode: z.enum(["daily", "weekly", "monthly", "percent", "fixed"]),
      amount_minor: money.nullable(),
      rate: fraction.nullable(),
      basis: z.enum(["coverage", "eligible_net_booking"]),
      refund_policy: note,
      source: note,
    })
    .superRefine((v, c) => {
      if (v.effective_to && v.effective_to < v.effective_from)
        c.addIssue({ code: "custom", message: "End precedes start" });
      if (v.mode === "percent" && v.amount_minor !== null)
        c.addIssue({
          code: "custom",
          message: "Percentage rules cannot also charge a fixed fee",
        });
      if (v.mode !== "percent" && v.rate !== null)
        c.addIssue({
          code: "custom",
          message: "Fixed/coverage rules cannot also charge a percentage",
        });
    }),
  scenario: z.object({ name, description: note, source: note }),
  assumption: z.object({
    name,
    scenario_id: name,
    service_id: name,
    price_id: name,
    initial_paying: z.number().min(0).max(1e6).nullable(),
    new_drivers_daily: z.number().min(0).max(1e5).nullable(),
    activation: fraction.nullable(),
    paid_conversion: fraction.nullable(),
    renewal: fraction.nullable(),
    daily_purchase_rate: fraction.nullable(),
    jobs_per_driver: z.number().min(0).max(100).nullable(),
    available_hours: z.number().min(0).max(24).nullable(),
    hours_per_job: z.number().positive().max(24).nullable(),
    average_booking_minor: money.nullable(),
    direct_cost_per_job_minor: money.nullable(),
    collection_delay: z.number().int().min(0).max(365),
    launch_delay: z.number().int().min(0).max(365),
    source: note,
    confidence: z.enum(["unconfirmed", "estimate", "observed"]),
  }),
  cost: z
    .object({
      name,
      scenario_id: z.string(),
      service_id: z.string(),
      category: z.enum([
        "direct_cost",
        "marketing",
        "payroll",
        "overhead",
        "capex",
        "prepayment",
        "deposit",
        "tax",
        "interest",
      ]),
      amount_minor: money,
      quantity: z.number().min(0).max(1e6).default(1),
      department: z.string().max(120).default("Operations"),
      start_date: day,
      end_date: day,
      pay_date: day,
      cadence: z.enum(["once", "monthly"]),
      useful_life_months: z.number().int().min(1).max(600),
      owner: note,
      source: note,
    })
    .refine((v) => v.end_date >= v.start_date, "End precedes start"),
  funding: z
    .object({
      name,
      date: day,
      amount_minor: money,
      kind: z.enum(["equity", "debt"]),
      status: z.enum(["planned", "committed", "confirmed"]),
      reference: note,
      source: note,
    })
    .refine(
      (v) => v.status !== "confirmed" || v.reference.length > 0,
      "Confirmed funding needs a receipt reference",
    ),
  allocation: z.object({
    name,
    category: z.enum(["direct_cost", "marketing", "payroll", "overhead"]),
    service_id: name,
    share: fraction,
    source: note,
  }),
  threshold: z
    .object({
      name,
      metric: z.enum([
        "customer_d30",
        "driver_renewal",
        "fulfilment",
        "contribution_margin",
        "driver_d30_active",
        "paying_driver_growth_weekly",
        "jobs_per_paying_driver_week",
      ]),
      // Rate metrics take a 0–1 share; jobs_per_paying_driver_week is a count.
      minimum: z.number().min(0).max(1000),
      minimum_sample: z.number().int().min(1),
      source: note,
    })
    .refine(
      (v) => v.metric === "jobs_per_paying_driver_week" || v.minimum <= 1,
      "Rate targets must be between 0 and 1",
    ),
  budget_link: z.object({ name, budget_id: name, cost_id: name, source: note }),
  action_item: z.object({
    name,
    description: note,
    owner: note,
    due_date: day,
    status: z.enum(["open", "in_progress", "resolved"]),
    priority: z.enum(["low", "medium", "high"]),
    evidence: note,
    source: note,
  }),
  tax_policy: z
    .object({
      name,
      treatment: z.enum(["unconfirmed", "applicable", "not_applicable"]),
      effective_from: day,
      effective_to: day.nullable(),
      rate: fraction.nullable(),
      reviewed: z.boolean(),
      reviewer: note,
      evidence: note,
      source: note,
      description: note,
    })
    .superRefine((v, c) => {
      if (v.effective_to && v.effective_to < v.effective_from)
        c.addIssue({ code: "custom", message: "End precedes start" });
      if (v.reviewed && (!v.reviewer || !v.evidence || !v.source))
        c.addIssue({
          code: "custom",
          message:
            "Reviewed tax policies require reviewer, evidence and source",
        });
    }),
  funding_use: z.object({
    name,
    funding_id: name,
    cost_id: name,
    amount_minor: money,
    milestone: note,
    owner: note,
    due_date: day,
    source: note,
  }),
  report_draft: z.object({
    name,
    snapshot_id: name,
    description: note,
    disclosures: note,
    audience: z.literal("investor"),
    source: note,
  }),
  mapping: z.object({
    name,
    source_account: name,
    model_account: z.enum(accounts),
    source: note,
  }),
  source: z.object({
    name,
    method: z.enum(["csv", "api"]),
    coverage_through: day.nullable(),
    status: z.enum(["unconfigured", "healthy", "failed"]),
    cursor: note,
    source: note,
  }),
};
export type Kind = keyof typeof resourceSchemas;
export type Resource = {
  id: string;
  kind: Kind;
  revision: number;
  archived: boolean;
  data: any;
  updated_at: string;
};
export const eventSchema = z
  .object({
    source_id: name,
    external_id: name,
    revision: z.number().int().min(1),
    type: z.enum([
      "driver",
      "customer",
      "subscription",
      "booking",
      "collection",
      "refund",
      "settlement",
      "campaign",
      "opening",
    ]),
    date: day,
    service_id: z.string().default(""),
    driver_id: z.string().default(""),
    customer_id: z.string().default(""),
    price_id: z.string().default(""),
    status: z.enum([
      "registered",
      "verified",
      "active",
      "requested",
      "accepted",
      "completed",
      "cancelled",
      "paid",
      "void",
    ]),
    amount_minor: money.default(0),
    currency: z.literal("NGN"),
    coverage_end: day.nullable().default(null),
    related_id: z.string().default(""),
    reference: z.string().max(180).default(""),
    account: z.enum(accounts).nullable().default(null),
    offset_account: z.enum(accounts).nullable().default(null),
    available_hours: z.number().min(0).max(24).nullable().default(null),
    job_hours: z.number().min(0).max(24).nullable().default(null),
    match_minutes: z.number().min(0).nullable().default(null),
    campaign_id: z.string().default(""),
    audience: z.enum(["driver", "customer"]).nullable().default(null),
    invoice_payment_id: z.string().default(""),
    note,
  })
  .superRefine((v, c) => {
    const fail = (message: string) => c.addIssue({ code: "custom", message });
    if (
      v.type === "subscription" &&
      (!v.driver_id ||
        !v.price_id ||
        !v.coverage_end ||
        v.coverage_end <= v.date)
    )
      fail(
        "Subscription needs driver, price and exclusive coverage end after start",
      );
    if (
      v.type === "subscription" &&
      v.coverage_end &&
      days(v.date, v.coverage_end) > 366
    )
      fail("Coverage cannot exceed 366 days per purchase");
    if (v.invoice_payment_id && v.type !== "collection")
      fail("Only collections can link customer invoice receipts");
    if (
      v.type === "booking" &&
      (!v.service_id || !v.driver_id || !v.customer_id || !v.price_id)
    )
      fail("Booking needs service, driver, customer and price IDs");
    if (
      ["collection", "refund", "settlement"].includes(v.type) &&
      !v.related_id
    )
      fail("Settlement/refund/collection needs related source external ID");
    if (v.type === "driver" && !v.driver_id) fail("Driver ID required");
    if (v.type === "customer" && !v.customer_id) fail("Customer ID required");
    if (
      v.type === "opening" &&
      (!v.account || !v.offset_account || v.account === v.offset_account)
    )
      fail("Opening adjustment requires distinct debit and credit accounts");
  });
export type Event = z.infer<typeof eventSchema> & {
  id?: string;
  imported_at?: string;
  price_snapshot?: any;
};
export const version = "1.3.0";
export function addDays(d: string, n: number) {
  return new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
}
export function days(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
export function monthAfter(d: string, n = 1) {
  const x = new Date(d);
  const anchor = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const end = new Date(
    Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0),
  ).getUTCDate();
  x.setUTCDate(Math.min(anchor, end));
  return x.toISOString().slice(0, 10);
}
export function coverageEnd(d: string, mode: string) {
  return mode === "monthly"
    ? monthAfter(d)
    : addDays(d, mode === "weekly" ? 7 : 1);
}
export function defaults(): { id: string; kind: Kind; data: any }[] {
  const start = "2026-12-01";
  const resources: { id: string; kind: Kind; data: any }[] = [
    {
      id: "pilot",
      kind: "config",
      data: {
        name: "Lagos financial model",
        start_date: start,
        cutoff: "2026-11-30",
        city: "Lagos",
        opening_confirmed: false,
        operating_data_complete_through: null,
        tax_reviewed: false,
        tax_note:
          "Tax applicability and taxable-profit bridge require accountant review",
        planned_funding_minor: 6500000000,
        minimum_cash_minor: 0,
        opening: {},
        source:
          "Founder: target 1 December; NGN 60m–70m planned funding, not received",
      },
    },
  ];
  for (const id of ["conservative", "base", "aggressive"])
    resources.push({
      id,
      kind: "scenario",
      data: {
        name: id[0].toUpperCase() + id.slice(1),
        description: "Operating assumptions awaiting evidence",
        source: "Founder requested scenario",
      },
    });
  for (const [id, label, vehicle] of [
    ["car", "Car rides", "car"],
    ["keke", "Keke", "keke"],
    ["bike", "Bike", "bike"],
    ["chauffeur", "Jaye Chauffeur", "shared"],
    ["courier", "Courier / delivery", "shared"],
  ])
    resources.push({
      id,
      kind: "service",
      data: {
        name: label,
        vehicle,
        city: "Lagos",
        start_date: start,
        actual_launch: null,
        eligibility: "Confirm screening and service readiness",
        subscription_eligible: ["car", "keke", "bike"].includes(id),
        active: true,
        source: "Founder MVP scope",
      },
    });
  for (const [id, service, mode, amount, rate] of [
    ["car-day", "car", "daily", 100000, null],
    ["car-week", "car", "weekly", 550000, null],
    ["car-month", "car", "monthly", 2000000, null],
    ["keke-month", "keke", "monthly", 300000, null],
    ["bike-month", "bike", "monthly", 300000, null],
    ["chauffeur-fee", "chauffeur", "percent", null, 0.15],
    ["courier-fee", "courier", "fixed", null, null],
  ] as const)
    resources.push({
      id,
      kind: "price",
      data: {
        name: id === "car-month" ? "Car monthly · best value" : id,
        service_id: service,
        effective_from: start,
        effective_to: null,
        mode,
        amount_minor: amount,
        rate,
        basis: ["percent", "fixed"].includes(mode)
          ? "eligible_net_booking"
          : "coverage",
        refund_policy:
          "Refund original service fee proportionally; unused subscription coverage requires linked refund",
        source: "Founder confirmed pricing; courier value unresolved",
      },
    });
  return resources;
}
