import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FinanceStore, DomainError, type Actor } from "./domain";
import { FinancialService } from "./financial/service";
import { MonthlyExpenseService } from "./monthly-expenses";
import { managementExclusions } from "./provenance";
import { localDate } from "./subscriptions";
import { day, addDays } from "./financial/types";
export const launchGates = [
  "Product & reliability",
  "Service eligibility",
  "Driver screening & safety",
  "Payments & support",
  "Operating funding",
] as const;
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const p = schema.safeParse(input);
  if (!p.success)
    throw new DomainError(p.error.issues.map((i) => i.message).join("; "));
  return p.data;
};
export class ExecutiveService {
  constructor(private s: FinanceStore) {}
  private access(a: Actor, e: string, write = false) {
    this.s.authorize(a, e, write ? ["finance"] : ["finance", "cfo", "auditor"]);
  }
  private ledgerCash(e: string, date: string) {
    const excluded = managementExclusions(this.s, e);
    return this.s
      .all(
        "SELECT j.id,SUM(l.debit-l.credit) amount FROM journals j JOIN lines l ON l.journal_id=j.id WHERE j.entity_id=? AND j.status='posted' AND j.date<=? AND l.account IN ('1100','1010') GROUP BY j.id",
        e,
        date,
      )
      .filter((r) => !excluded.journals.includes(r.id))
      .reduce((n, r) => n + r.amount, 0);
  }
  cashReview(a: Actor, e: string, input: unknown) {
    this.access(a, e, true);
    const p = parse(
      z.object({
        as_of: day,
        bank_minor: z.number().int().min(0).max(1e13),
        restricted_minor: z.number().int().min(0).max(1e13),
        evidence: z.string().trim().min(10).max(2000),
      }),
      input,
    );
    return this.s.tx(() => {
      if (p.as_of > localDate())
        throw new DomainError(
          "Review an actual statement date, not a future date",
        );
      if (p.restricted_minor > p.bank_minor)
        throw new DomainError(
          "Restricted funds cannot exceed the reviewed balance",
        );
      const ledger = this.ledgerCash(e, p.as_of);
      if (ledger !== p.bank_minor)
        throw new DomainError(
          "Statement and non-sample ledger balances differ. Reconcile in Reports before confirming cash.",
        );
      const id = randomUUID();
      this.s.run(
        "INSERT INTO executive_cash_reviews VALUES(?,?,?,?,?,?,?,?)",
        id,
        e,
        p.as_of,
        p.bank_minor,
        p.restricted_minor,
        p.evidence,
        a.id,
        new Date().toISOString(),
      );
      this.s.audit(e, a, "executive.cash_reviewed", id, p);
      return { id };
    });
  }
  gate(a: Actor, e: string, input: unknown) {
    this.access(a, e, true);
    const p = parse(
      z.object({
        service_id: z.string().min(1),
        gate: z.enum(launchGates),
        status: z.enum(["unverified", "in_progress", "blocked", "verified"]),
        owner: z.string().trim().max(180),
        evidence: z.string().trim().max(2000),
        verifier: z.string().trim().max(180),
        verified_on: z.union([day, z.literal("")]),
        due_date: z.union([day, z.literal("")]),
        revision: z.number().int().min(0),
      }),
      input,
    );
    return this.s.tx(() => {
      const service = this.s.get(
        "SELECT id FROM fm_resources WHERE entity_id=? AND id=? AND kind='service' AND archived=0",
        e,
        p.service_id,
      );
      if (!service) throw new DomainError("Choose an active service");
      const old = this.s.get(
        "SELECT * FROM executive_gates WHERE entity_id=? AND service_id=? AND gate=?",
        e,
        p.service_id,
        p.gate,
      );
      if ((old?.revision || 0) !== p.revision)
        throw new DomainError(
          "Readiness evidence changed. Reload before saving.",
          409,
        );
      if (
        p.status === "verified" &&
        (!p.owner ||
          p.evidence.length < 10 ||
          !p.verifier ||
          !p.verified_on ||
          p.verified_on > localDate())
      )
        throw new DomainError(
          "Verification needs an owner, supporting evidence, verifier and completed review date",
        );
      const revision = p.revision + 1;
      this.s.run(
        "INSERT INTO executive_gates VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_id,service_id,gate) DO UPDATE SET status=excluded.status,owner=excluded.owner,evidence=excluded.evidence,verifier=excluded.verifier,verified_on=excluded.verified_on,due_date=excluded.due_date,revision=excluded.revision",
        e,
        p.service_id,
        p.gate,
        p.status,
        p.owner,
        p.evidence,
        p.verifier,
        p.verified_on,
        p.due_date,
        revision,
      );
      this.s.run(
        "INSERT INTO executive_gate_history(entity_id,service_id,gate,revision,data,actor_id,created_at) VALUES(?,?,?,?,?,?,?)",
        e,
        p.service_id,
        p.gate,
        revision,
        JSON.stringify(p),
        a.id,
        new Date().toISOString(),
      );
      this.s.audit(e, a, "executive.readiness_reviewed", p.service_id, {
        ...p,
        revision,
      });
      return { revision };
    });
  }
  overview(a: Actor, e: string, period = localDate().slice(0, 7)) {
    this.access(a, e);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
      throw new DomainError("Select a valid month");
    const today = localDate(),
      end = new Date(
        Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10);
    const f = new FinancialService(this.s),
      w = f.workspace(a, e),
      resources = w.resources.filter((r) => !r.archived),
      config = resources.find((r) => r.kind === "config")!.data;
    const excluded = managementExclusions(this.s, e),
      monthly = new MonthlyExpenseService(this.s).report(
        a,
        e,
        period + "-01",
        end,
      );
    const history = new MonthlyExpenseService(this.s)
      .rows(a, e)
      .filter((r) => r.status === "review");
    const cashReview = this.s.get(
      "SELECT * FROM executive_cash_reviews WHERE entity_id=? ORDER BY as_of DESC,created_at DESC LIMIT 1",
      e,
    );
    const cashFresh =
      !!cashReview &&
      cashReview.as_of >= addDays(today, -7) &&
      cashReview.bank_minor === this.ledgerCash(e, cashReview.as_of);
    const allRecords = this.s.all(
      "SELECT r.*,r.amount_minor-COALESCE((SELECT SUM(p.amount_minor) FROM bookkeeping_payments p WHERE p.record_id=r.id AND p.voided=0 AND p.date<=?),0) AS outstanding_minor FROM bookkeeping_records r WHERE r.entity_id=? AND r.voided=0 AND r.date<=?",
      today,
      e,
      today,
    );
    const payables = allRecords.filter((r) => r.outstanding_minor > 0);
    const due = payables.filter((r) => r.due_date <= addDays(today, 30));
    const events = w.events.filter(
        (r: any) => r.date <= today && r.status !== "void",
      ),
      sources = w.source_status;
    const coverage =
      sources.length > 0 &&
      sources.every(
        (r: any) =>
          r.status === "healthy" &&
          r.coverage_through &&
          r.coverage_through >= addDays(today, -1) &&
          !r.stale,
      );
    const freshEvents = events.filter(
      (r: any) => r.date >= addDays(today, -29),
    );
    const subscriptions = events.filter(
      (r: any) =>
        r.type === "subscription" && r.date <= today && r.coverage_end > today,
    );
    const bookings = freshEvents.filter((r: any) => r.type === "booking"),
      completed = bookings.filter((r: any) =>
        ["completed", "paid"].includes(r.status),
      );
    const gates = this.s.all(
      "SELECT * FROM executive_gates WHERE entity_id=?",
      e,
    );
    const services = resources
      .filter((r) => r.kind === "service" && r.data.active)
      .map((r) => {
        const checks = launchGates.map(
          (g) =>
            gates.find((x) => x.service_id === r.id && x.gate === g) || {
              service_id: r.id,
              gate: g,
              status: "unverified",
              owner: "",
              evidence: "",
              verifier: "",
              verified_on: "",
              due_date: "",
              revision: 0,
            },
        );
        const valid = checks.filter(
          (g) =>
            g.status === "verified" && g.verified_on >= addDays(today, -30),
        );
        const currentPrices = resources.filter(
          (x) =>
            x.kind === "price" &&
            x.data.service_id === r.id &&
            x.data.effective_from <= r.data.start_date &&
            (!x.data.effective_to || x.data.effective_to >= r.data.start_date),
        );
        const priced =
          currentPrices.length > 0 &&
          currentPrices.every((x) =>
            x.data.mode === "percent"
              ? x.data.rate !== null
              : x.data.amount_minor !== null,
          );
        return {
          id: r.id,
          name: r.data.name,
          target: r.data.start_date,
          actual_launch: r.data.actual_launch,
          checks,
          verified: valid.length,
          total: checks.length,
          pricing_complete: priced,
          status:
            valid.length === checks.length && priced && cashFresh
              ? "Evidence recorded · founder decision required"
              : "Not ready for sign-off",
          completed_jobs: coverage
            ? completed.filter((x: any) => x.service_id === r.id).length
            : null,
        };
      });
    const scenarios = resources
      .filter((r) => r.kind === "scenario")
      .map((r) => {
        const assumptions = resources.filter(
          (x) => x.kind === "assumption" && x.data.scenario_id === r.id,
        );
        const complete =
          services.length > 0 &&
          services.every((s) =>
            assumptions.some((x) => x.data.service_id === s.id),
          ) &&
          assumptions.every((x) =>
            [
              "initial_paying",
              "new_drivers_daily",
              "activation",
              "paid_conversion",
              "renewal",
              "jobs_per_driver",
              "average_booking_minor",
              "direct_cost_per_job_minor",
            ].every((k) => x.data[k] != null),
          );
        const costs = resources.filter(
          (x) =>
            x.kind === "cost" &&
            (!x.data.scenario_id || x.data.scenario_id === r.id),
        );
        const comparison: any = w.comparison.find((x) => x.id === r.id);
        return {
          id: r.id,
          name: r.data.name,
          complete: complete && costs.length > 0,
          assumptions: assumptions.length,
          costs: costs.length,
          revenue: complete && costs.length ? comparison?.revenue : null,
          ebitda: complete && costs.length ? comparison?.ebitda : null,
        };
      });
    const funding = resources.filter((r) => r.kind === "funding"),
      baseline = w.snapshots.some((r: any) => r.kind === "budget");
    const checks = [
      {
        name: "Sample data isolated",
        met: true,
        reason: `${excluded.journals.length} journals and ${excluded.budgets.length} legacy budgets excluded from management views.`,
        page: "General ledger",
      },
      {
        name: "Cash evidence current",
        met: cashFresh,
        reason:
          "A statement-backed review within 7 days must match the non-sample ledger.",
        page: "Reports",
      },
      {
        name: "Historical spending resolved",
        met:
          allRecords.length > 0 &&
          history.filter((r) => r.kind === "expense" || r.kind === "budget")
            .length === 0,
        reason:
          "Record actual expenses and resolve pending expense/budget source rows.",
        page: "Expenses",
      },
      {
        name: "Funding timing documented",
        met: funding.some((r) =>
          ["committed", "confirmed"].includes(r.data.status),
        ),
        reason:
          "At least one dated committed or received funding entry; a funding envelope is not cash.",
        page: "Financial Model",
      },
      {
        name: "Budget baseline frozen",
        met: baseline,
        reason:
          "Freeze the reviewed pilot budget for later variance comparisons.",
        page: "Financial Model",
      },
      {
        name: "Scenarios populated",
        met: scenarios.length >= 3 && scenarios.every((r) => r.complete),
        reason:
          "Each service needs operating drivers and each scenario needs cost schedules.",
        page: "Financial Model",
      },
      {
        name: "Operational coverage current",
        met: coverage,
        reason:
          "Healthy sources must cover through yesterday with a recent successful delivery.",
        page: "Financial Model",
      },
      {
        name: "Observed trading activity",
        met: completed.length > 0 && coverage,
        reason:
          "Completed jobs in the trailing 30 days with current source coverage.",
        page: "Financial Model",
      },
      {
        name: "Service gates evidenced",
        met:
          services.length > 0 &&
          services.every((r) => r.verified === r.total && r.pricing_complete),
        reason:
          "Each active service needs five reviewed gates (within 30 days) and configured pricing.",
        page: "Financial Model",
      },
      {
        name: "Reporting period closed",
        met: !!this.s.get(
          "SELECT period FROM expense_month_reviews WHERE entity_id=? AND status='closed' LIMIT 1",
          e,
        ),
        reason: "At least one month reviewed, reconciled and closed.",
        page: "Expenses",
      },
    ];
    return {
      today,
      period,
      currency: monthly.currency,
      can_write: a.role === "finance",
      generated_at: new Date().toISOString(),
      monthly,
      excluded,
      history: history.filter(
        (r) => r.kind === "expense" || r.kind === "budget",
      ),
      other_source_rows: history.filter(
        (r) => !["expense", "budget"].includes(r.kind),
      ).length,
      cash: {
        review: cashReview || null,
        current: cashFresh,
        operating_minor: cashFresh
          ? cashReview.bank_minor - cashReview.restricted_minor
          : null,
        ledger_minor: this.ledgerCash(e, today),
        due_minor: due.reduce((n, r) => n + r.outstanding_minor, 0),
        due,
        recorded_obligations: payables.length,
        complete: false,
      },
      pilot: {
        start: config.start_date,
        end: config.end_date || addDays(config.start_date, 89),
        funding_envelope: config.planned_funding_minor,
        reserve: config.minimum_cash_minor,
        opening_confirmed: config.opening_confirmed,
      },
      traction: {
        coverage,
        sources,
        from: addDays(today, -29),
        through: today,
        paying_drivers: coverage
          ? new Set(subscriptions.map((r: any) => r.driver_id)).size
          : null,
        completed_jobs: coverage ? completed.length : null,
        fulfilment:
          coverage && bookings.length
            ? completed.length / bookings.length
            : null,
        repeat_rate:
          coverage && completed.length
            ? new Set(
                completed
                  .filter(
                    (r: any) =>
                      completed.filter(
                        (x: any) => x.customer_id === r.customer_id,
                      ).length > 1,
                  )
                  .map((r: any) => r.customer_id),
              ).size / new Set(completed.map((r: any) => r.customer_id)).size
            : null,
      },
      services,
      scenarios,
      actions: resources
        .filter((r) => r.kind === "action_item")
        .map((r) => ({ id: r.id, revision: r.revision, ...r.data })),
      checks,
      score: checks.filter((c) => c.met).length * 10,
      score_note:
        "Evidence coverage: 10 equally weighted checks, 10 points each. Proposed management rubric; not a valuation, PMF verdict or permission to launch. Cash freshness is 7 days; gate evidence is 30 days.",
      snapshot_count: w.snapshots.length,
      submitted_reports: w.report_submissions.length,
    };
  }
}
