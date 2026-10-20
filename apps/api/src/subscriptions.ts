import { BookkeepingService } from "./bookkeeping";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FinanceStore, DomainError, type Actor } from "./domain";

export const localDate = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const stamp = () => new Date().toISOString();
const key = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
const optionalDate = z.union([date, z.literal("")]);
const money = z.number().int().positive().max(1_000_000_000_000);
export const shiftDays = (value: string, days: number) =>
  new Date(Date.parse(value + "T12:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
export function occurrence(
  anchor: string,
  cadence: string,
  interval: number,
  index: number,
) {
  if (cadence === "custom_days") return shiftDays(anchor, interval * index);
  const [year, month, day] = anchor.split("-").map(Number);
  const months = (cadence === "annual" ? 12 : 1) * interval * index;
  const start = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  const last = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate();
  start.setUTCDate(Math.min(day, last));
  return start.toISOString().slice(0, 10);
}
const subscriptionInput = z
  .object({
    entity_id: z.enum(["ng", "inc"]),
    vendor_id: z.string().min(1),
    owner_id: z.string().min(1),
    name: z.string().trim().min(3).max(120),
    purpose: z.string().trim().max(1000),
    plan: z.string().trim().max(100),
    seats: z.number().int().min(1).max(100000),
    department: z.enum([
      "Product",
      "Engineering",
      "Marketing",
      "Operations",
      "Finance",
    ]),
    category: z.string().trim().min(1).max(60),
    currency: z.enum(["NGN", "USD"]),
    amount_minor: money,
    cadence: z.enum(["monthly", "annual", "custom_days"]),
    interval_count: z.number().int().min(1).max(365),
    billing_anchor: date,
    renewal_date: optionalDate,
    cancellation_deadline: optionalDate,
    auto_renew: z.boolean(),
    payment_method: z.enum(["", "card", "bank_transfer", "cash", "other"]),
    payment_account: z.string().trim().max(100),
    expected_revision: z.number().int().optional(),
  })
  .strict();
export class SubscriptionService {
  constructor(
    private store: FinanceStore,
    private today: () => string = localDate,
  ) {}
  get(a: Actor, id: string, write = false) {
    const s = this.store.get(
      "SELECT s.*,u.name AS owner,v.name AS vendor,d.start_date,d.employee_id,d.users_count,c.name AS category_name,e.name AS responsible_employee FROM subscriptions s JOIN users u ON u.id=s.owner_id JOIN vendors v ON v.id=s.vendor_id LEFT JOIN subscription_details d ON d.subscription_id=s.id LEFT JOIN subscription_categories c ON c.id=d.category_id LEFT JOIN employees e ON e.id=d.employee_id WHERE s.id=?",
      id,
    );
    if (!s) throw new DomainError("Subscription not found", 404);
    this.store.authorize(a, s.entity_id);
    if (a.role === "employee" && s.owner_id !== a.id && s.created_by !== a.id)
      throw new DomainError(
        "You may only access subscriptions you own or created",
        403,
      );
    if (
      write &&
      (!["employee", "manager", "finance", "cfo"].includes(a.role) ||
        (a.role === "manager" && s.owner_id !== a.id && s.created_by !== a.id))
    )
      throw new DomainError(
        "Only the owner, creator or Finance can change this subscription",
        403,
      );
    return s;
  }
  private addTerms(s: any, starts: string) {
    this.store.run(
      "INSERT INTO subscription_terms(subscription_id,starts_on,anchor,amount_minor,cadence,interval_count) VALUES(?,?,?,?,?,?)",
      s.id,
      starts,
      s.billing_anchor,
      s.amount_minor,
      s.cadence,
      s.interval_count,
    );
  }
  saveSetup(a: Actor, input: unknown, id?: string): any {
    const parsed = subscriptionInput
      .omit({ vendor_id: true, owner_id: true })
      .extend({
        provider_name: z.string().trim().min(2).max(120),
        start_date: date,
        employee_id: z.string().default(""),
        category_name: z.string().trim().max(80).default(""),
        users_count: z
          .number()
          .int()
          .min(1)
          .max(100000)
          .nullable()
          .default(null),
      })
      .safeParse(input);
    if (!parsed.success)
      throw new DomainError(
        parsed.error.issues
          .map((i) => `${i.path.join(" ")}: ${i.message}`)
          .join("; "),
      );
    return this.store.tx(() => {
      const {
        provider_name,
        start_date,
        employee_id,
        category_name,
        users_count,
        ...v
      } = parsed.data;
      this.store.authorize(a, v.entity_id, [
        "employee",
        "manager",
        "finance",
        "cfo",
      ]);
      const old = id ? this.get(a, id, true) : null;
      if (start_date > v.billing_anchor)
        throw new DomainError(
          "Start date must be on or before the billing date",
        );
      if (
        v.renewal_date &&
        (v.renewal_date < start_date || v.renewal_date < v.billing_anchor)
      )
        throw new DomainError(
          "Renewal or expiry must be on or after the start and billing dates",
        );
      if (v.cancellation_deadline && v.cancellation_deadline < start_date)
        throw new DomainError("Cancel-by date cannot be before the start date");
      if (
        employee_id &&
        !this.store.get(
          "SELECT id FROM employees WHERE id=? AND entity_id=? AND department=? AND active=1",
          employee_id,
          v.entity_id,
          v.department,
        )
      )
        throw new DomainError(
          "Choose an active employee in the selected department",
        );
      let provider = this.store.get(
        "SELECT * FROM vendors WHERE entity_id=? AND lower(trim(name))=lower(?)",
        v.entity_id,
        provider_name,
      );
      if (old && provider?.id !== old.vendor_id)
        throw new DomainError(
          "The provider of an existing subscription cannot change. Create a new subscription for a different provider.",
        );
      if (!provider)
        provider = this.store.createVendor(a, {
          entity_id: v.entity_id,
          name: provider_name,
          category: v.category,
        });
      let categoryId = null;
      if (category_name) {
        let category = this.store.get(
          "SELECT * FROM subscription_categories WHERE entity_id=? AND name=? COLLATE NOCASE",
          v.entity_id,
          category_name,
        );
        if (category && category.accounting_category !== v.category)
          throw new DomainError(
            "This category already uses a different accounting group",
          );
        if (!category) {
          category = { id: randomUUID() };
          this.store.run(
            "INSERT INTO subscription_categories VALUES(?,?,?,?)",
            category.id,
            v.entity_id,
            category_name,
            v.category,
          );
        }
        categoryId = category.id;
      }
      const result = this.save(
        a,
        {
          ...v,
          vendor_id: provider.id,
          owner_id: old?.owner_id || a.id,
          payment_account: ["card", "bank_transfer", "other"].includes(
            v.payment_method,
          )
            ? v.payment_account
            : "",
        },
        id,
      );
      this.store.run(
        "INSERT INTO subscription_details VALUES(?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET start_date=excluded.start_date,employee_id=excluded.employee_id,category_id=excluded.category_id,users_count=excluded.users_count",
        result.id,
        start_date,
        employee_id || null,
        categoryId,
        users_count,
      );
      this.store.audit(
        v.entity_id,
        a,
        "subscription.tracking_details_saved",
        result.id,
        { start_date, employee_id, category_id: categoryId, users_count },
      );
      return this.get(a, result.id);
    });
  }
  save(a: Actor, input: unknown, id?: string): any {
    if (input && typeof input === "object" && "provider_name" in input)
      return this.saveSetup(a, input, id);
    const p = subscriptionInput.safeParse(input);
    if (!p.success)
      throw new DomainError(
        p.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    const v = p.data,
      today = this.today();
    this.store.authorize(a, v.entity_id, [
      "employee",
      "manager",
      "finance",
      "cfo",
    ]);
    const owner = this.store.actor(v.owner_id);
    this.store.authorize(owner, v.entity_id);
    if (a.role === "employee" && v.owner_id !== a.id)
      throw new DomainError(
        "Employees must own the subscriptions they register",
        403,
      );
    if (
      !this.store.get(
        "SELECT id FROM vendors WHERE id=? AND entity_id=?",
        v.vendor_id,
        v.entity_id,
      )
    )
      throw new DomainError("Vendor must belong to this entity");
    if (
      this.store.get("SELECT currency FROM entities WHERE id=?", v.entity_id)
        .currency !== v.currency
    )
      throw new DomainError("Subscription currency must match its entity");
    if (
      v.cancellation_deadline &&
      v.renewal_date &&
      v.cancellation_deadline > v.renewal_date
    )
      throw new DomainError(
        "Cancellation deadline must be on or before renewal",
      );
    if (!v.auto_renew && !v.renewal_date)
      throw new DomainError(
        "Set a renewal / end date when auto-renew is disabled",
      );
    if (v.cadence !== "custom_days" && v.interval_count !== 1)
      throw new DomainError("Use custom days for custom billing intervals");
    if (
      v.billing_anchor < shiftDays(today, -3660) ||
      v.billing_anchor > shiftDays(today, 3660)
    )
      throw new DomainError("Billing date must be within ten years of today");
    return this.store.tx(() => {
      const old = id ? this.get(a, id, true) : null;
      if (
        old &&
        (old.entity_id !== v.entity_id ||
          old.vendor_id !== v.vendor_id ||
          old.currency !== v.currency)
      )
        throw new DomainError(
          "Entity, vendor and currency cannot change; create a separate subscription",
        );
      if (old && old.revision !== v.expected_revision)
        throw new DomainError(
          "Subscription changed. Reopen it before saving.",
          409,
        );
      this.store.categoryAccount(v.entity_id, v.category);
      if (old?.status === "cancelled")
        throw new DomainError(
          "Cancelled subscriptions are read-only; create a new subscription to restart",
        );
      const scheduleChanged =
        old &&
        ["amount_minor", "cadence", "interval_count", "billing_anchor"].some(
          (k) => old[k] !== v[k as keyof typeof v],
        );
      if (scheduleChanged && old.status !== "active")
        throw new DomainError(
          "Resume the subscription before changing its billing schedule",
        );
      if (scheduleChanged && v.billing_anchor < today)
        throw new DomainError("Changed schedules must start today or later");
      const { expected_revision, ...values } = v;
      const fields = Object.keys(values);
      const params = fields.map((k) =>
        typeof values[k as keyof typeof values] === "boolean"
          ? Number(values[k as keyof typeof values])
          : values[k as keyof typeof values],
      );
      const sid = id || key("SUB");
      if (old)
        this.store.run(
          `UPDATE subscriptions SET ${fields.map((k) => `${k}=?`).join(",")},revision=revision+1,updated_at=? WHERE id=?`,
          ...params,
          stamp(),
          sid,
        );
      else
        this.store.run(
          `INSERT INTO subscriptions(id,created_by,${fields.join(",")},created_at,updated_at) VALUES(${Array(
            fields.length + 4,
          )
            .fill("?")
            .join(",")})`,
          sid,
          a.id,
          ...params,
          stamp(),
          stamp(),
        );
      if (scheduleChanged)
        this.store.run(
          "UPDATE subscription_terms SET ends_before=? WHERE subscription_id=? AND ends_before IS NULL",
          today,
          sid,
        );
      const saved = this.get(a, sid);
      if (!old || scheduleChanged)
        this.addTerms(saved, old ? today : v.billing_anchor);
      this.store.audit(
        v.entity_id,
        a,
        old ? "subscription.edited" : "subscription.created",
        sid,
        {
          before: old
            ? Object.fromEntries(fields.map((k) => [k, old[k]]))
            : null,
          after: values,
          schedule_effective: scheduleChanged ? today : undefined,
        },
      );
      return saved;
    });
  }
  action(a: Actor, id: string, input: unknown) {
    const p = z
      .object({
        action: z.enum(["pause", "resume", "cancel"]),
        expected_revision: z.number().int(),
        next_billing_date: date.optional(),
      })
      .strict()
      .safeParse(input);
    if (!p.success) throw new DomainError("Invalid subscription action");
    return this.store.tx(() => {
      const s = this.get(a, id, true),
        v = p.data,
        today = this.today();
      if (s.revision !== v.expected_revision)
        throw new DomainError("Subscription changed. Reopen it first.", 409);
      if (
        s.status === "cancelled" ||
        (v.action === "pause" && s.status !== "active") ||
        (v.action === "resume" && s.status !== "paused")
      )
        throw new DomainError("Invalid subscription status transition");
      const status =
        v.action === "pause"
          ? "paused"
          : v.action === "cancel"
            ? "cancelled"
            : "active";
      if (v.action === "resume") {
        if (
          !v.next_billing_date ||
          v.next_billing_date < today ||
          v.next_billing_date > shiftDays(today, 3660)
        )
          throw new DomainError(
            "Choose a next billing date from today onward, within ten years",
          );
        this.store.run(
          "UPDATE subscriptions SET billing_anchor=? WHERE id=?",
          v.next_billing_date,
          id,
        );
        this.addTerms({ ...s, billing_anchor: v.next_billing_date }, today);
      } else
        this.store.run(
          "UPDATE subscription_terms SET ends_before=? WHERE subscription_id=? AND ends_before IS NULL",
          today,
          id,
        );
      this.store.run(
        "UPDATE subscriptions SET status=?,revision=revision+1,updated_at=? WHERE id=?",
        status,
        stamp(),
        id,
      );
      this.store.audit(s.entity_id, a, `subscription.${v.action}`, id, {
        effective_date: today,
        next_billing_date: v.next_billing_date,
      });
      return this.get(a, id);
    });
  }
  private expected(s: any, through: string) {
    const charges = new Map<string, any>();
    const terms = this.store.all(
      "SELECT * FROM subscription_terms WHERE subscription_id=? ORDER BY id",
      s.id,
    );
    for (const term of terms)
      for (let i = 0; i < 5000; i++) {
        const due = occurrence(
          term.anchor,
          term.cadence,
          term.interval_count,
          i,
        );
        if (
          due > through ||
          (term.ends_before && due >= term.ends_before) ||
          (!s.auto_renew && s.renewal_date && due >= s.renewal_date)
        )
          break;
        if (due >= term.starts_on)
          charges.set(due, {
            due_date: due,
            expected_minor: term.amount_minor,
            spend_id: null,
          });
        if (i === 4999)
          throw new DomainError(
            "Billing schedule exceeds the supported history",
          );
      }
    return charges;
  }
  charges(a: Actor, s: any, through: string) {
    const expected = this.expected(s, through),
      today = this.today();
    for (const row of this.store.all(
      "SELECT sc.* FROM subscription_charges sc JOIN spends expense ON expense.id=sc.spend_id WHERE sc.subscription_id=? AND (sc.due_date<=? OR (expense.due_date<>'' AND expense.due_date<=?))",
      s.id,
      through,
      through,
    ))
      expected.set(row.due_date, row);
    for (const row of this.store.all(
      "SELECT sr.* FROM subscription_records sr JOIN bookkeeping_records r ON r.id=sr.record_id WHERE sr.subscription_id=? AND (sr.due_date<=? OR r.due_date<=?)",
      s.id,
      through,
      through,
    ))
      expected.set(row.due_date, row);
    return [...expected.values()]
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .map((c) => {
        const record = c.record_id
          ? this.store.get(
              "SELECT r.*,COALESCE((SELECT SUM(p.amount_minor) FROM bookkeeping_payments p WHERE p.record_id=r.id AND p.voided=0),0) AS gross_paid_minor,COALESCE((SELECT SUM(f.amount_minor) FROM bookkeeping_refunds f WHERE f.record_id=r.id AND f.voided=0),0) AS refunded_minor FROM bookkeeping_records r WHERE r.id=?",
              c.record_id,
            )
          : null;
        const expense = record
          ? {
              ...record,
              amount_minor: record.voided
                ? 0
                : record.amount_minor - record.refunded_minor,
              paid_minor: record.gross_paid_minor - record.refunded_minor,
              outstanding_minor: record.voided
                ? 0
                : record.amount_minor - record.gross_paid_minor,
              settlement_status: record.voided
                ? "Voided"
                : record.refunded_minor === record.amount_minor
                  ? "Refunded"
                  : record.gross_paid_minor === record.amount_minor
                    ? "Paid"
                    : record.gross_paid_minor
                      ? "Part paid"
                      : "Unpaid",
            }
          : c.spend_id
            ? this.store.spend(a, c.spend_id)
            : null;
        const receiptCount = record
          ? this.store.get(
              "SELECT COUNT(*) AS n FROM record_attachments WHERE record_id=?",
              record.id,
            ).n
          : expense
            ? this.store.get(
                "SELECT COUNT(*) AS n FROM receipts WHERE spend_id=?",
                expense.id,
              ).n
            : 0;
        const alerts: string[] = [];
        if (!expense && c.due_date <= today)
          alerts.push("Invoice not recorded");
        if (expense && !record && !receiptCount)
          alerts.push("Missing invoice attachment");
        if (expense && expense.amount_minor !== c.expected_minor)
          alerts.push("Charge differs from expected price");
        if (expense?.status === "rejected")
          alerts.push("Invoice rejected — review before replacing");
        if (expense && !this.expected(s, c.due_date).has(c.due_date))
          alerts.push("Charge outside active billing schedule");
        return {
          ...c,
          subscription_id: s.id,
          subscription: s.name,
          owner: s.owner,
          department: s.department,
          responsible_employee: s.responsible_employee,
          vendor: s.vendor,
          currency: s.currency,
          expense,
          receipt_count: receiptCount,
          alerts,
          payment_due: expense?.due_date || c.due_date,
          outstanding_minor:
            expense && expense.status !== "rejected"
              ? expense.outstanding_minor
              : c.expected_minor,
          status:
            expense?.status === "rejected"
              ? "Rejected invoice · replacement needed"
              : expense
                ? expense.settlement_status
                : c.due_date < today
                  ? "Overdue · invoice missing"
                  : "Expected",
        };
      });
  }
  list(a: Actor, entity: string, days = 90) {
    this.store.authorize(a, entity);
    if (![30, 90, 365].includes(days))
      throw new DomainError("Choose a 30, 90 or 365 day horizon");
    const today = this.today(),
      through = shiftDays(today, days);
    const rows = this.store
      .all(
        "SELECT id,owner_id,created_by FROM subscriptions WHERE entity_id=? ORDER BY created_at DESC",
        entity,
      )
      .filter(
        (s) =>
          a.role !== "employee" || s.owner_id === a.id || s.created_by === a.id,
      );
    const subscriptions = rows.map((row) => {
      const s = this.get(a, row.id);
      const charges = this.charges(a, s, through);
      const future = [...this.expected(s, shiftDays(today, 366)).values()]
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .find((c) => c.due_date >= today);
      const monthly =
        s.cadence === "annual"
          ? s.amount_minor / 12
          : s.cadence === "custom_days"
            ? (s.amount_minor * 365.25) / (12 * s.interval_count)
            : s.amount_minor;
      const alerts: string[] = [];
      if (
        s.status === "active" &&
        s.renewal_date &&
        s.renewal_date <= shiftDays(today, 30)
      )
        alerts.push(
          s.renewal_date < today
            ? "Renewal date passed — review"
            : "Renewal within 30 days",
        );
      if (
        s.status === "active" &&
        s.cancellation_deadline &&
        s.cancellation_deadline <= shiftDays(today, 30)
      )
        alerts.push(
          s.cancellation_deadline < today
            ? "Cancellation deadline passed"
            : "Cancellation deadline within 30 days",
        );
      if (s.status === "active" && !s.renewal_date)
        alerts.push("Renewal date not set");
      return {
        ...s,
        monthly_equivalent_minor:
          s.status === "active" &&
          (s.auto_renew || !s.renewal_date || s.renewal_date > today)
            ? Math.round(monthly)
            : 0,
        next_billing_date:
          s.status === "active" ? future?.due_date || null : null,
        charges,
        alerts,
        history: this.store.all(
          "SELECT a.*,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE resource_id=? ORDER BY a.id",
          s.id,
        ),
      };
    });
    const charges = subscriptions
      .flatMap((s) => s.charges)
      .sort((a, b) => a.payment_due.localeCompare(b.payment_due));
    return {
      today,
      through,
      subscription_categories: this.store.all(
        "SELECT * FROM subscription_categories WHERE entity_id=? ORDER BY name",
        entity,
      ),
      employees:
        a.role === "finance"
          ? this.store.all(
              "SELECT id,name,department,active FROM employees WHERE entity_id=? ORDER BY name",
              entity,
            )
          : [],
      subscriptions,
      charges,
      totals: {
        active: subscriptions.filter((s) => s.status === "active").length,
        monthly_equivalent_minor: subscriptions.reduce(
          (n, s) => n + s.monthly_equivalent_minor,
          0,
        ),
        upcoming_minor: charges
          .filter((c) => c.payment_due >= today && c.payment_due <= through)
          .reduce((n, c) => n + c.outstanding_minor, 0),
        overdue_minor: charges
          .filter((c) => c.payment_due < today)
          .reduce((n, c) => n + c.outstanding_minor, 0),
      },
    };
  }
  recordExpense(a: Actor, id: string, input: unknown) {
    const p = z
      .object({
        due_date: date,
        actual_bill: z.boolean().default(false),
        request_key: z.string().uuid(),
        record_id: z.string().optional(),
        amount_minor: money.optional(),
        date: date.optional(),
        reference: z.string().trim().max(180).default(""),
        payment: z
          .object({
            amount_minor: money,
            date,
            reference: z.string().trim().min(1).max(180),
            method: z.enum(["Bank transfer", "Cash", "Debit card"]),
          })
          .optional(),
      })
      .strict()
      .safeParse(input);
    if (!p.success)
      throw new DomainError(
        "Enter a valid billing date, amount and payment details",
      );
    return this.store.tx(() => {
      const s = this.get(a, id, true),
        v = p.data,
        books = new BookkeepingService(this.store);
      books.access(a, s.entity_id, true);
      const linked = this.store.get(
        "SELECT record_id FROM subscription_records WHERE subscription_id=? AND due_date=?",
        id,
        v.due_date,
      );
      if (linked) {
        const r = books.detail(a, linked.record_id);
        if (r.request_key === v.request_key || v.record_id === r.id) return r;
        throw new DomainError(
          "This billing cycle is already in Expenses. Open its record to add or correct a payment.",
          409,
        );
      }
      if (
        this.store.get(
          "SELECT id FROM subscription_charges WHERE subscription_id=? AND due_date=?",
          id,
          v.due_date,
        )
      )
        throw new DomainError(
          "This cycle already has an approval-workflow bill. Use that bill to avoid recording the cost twice.",
          409,
        );
      const expected = this.expected(s, v.due_date).get(v.due_date);
      if (!expected && !v.actual_bill)
        throw new DomainError("Choose an active billing cycle");
      if (!expected && v.due_date > this.today())
        throw new DomainError(
          "An unscheduled bill must be dated today or earlier",
        );
      if (v.due_date > shiftDays(this.today(), 365))
        throw new DomainError("Choose a billing cycle within the next year");
      let record;
      if (v.record_id) {
        record = books.detail(a, v.record_id);
        if (
          record.entity_id !== s.entity_id ||
          record.kind !== "expense" ||
          record.voided ||
          record.payee.trim().toLowerCase() !== s.vendor.trim().toLowerCase()
        )
          throw new DomainError(
            "Choose an active expense for this supplier and company",
          );
        if (
          this.store.get(
            "SELECT record_id FROM subscription_records WHERE record_id=?",
            record.id,
          )
        )
          throw new DomainError(
            "This expense is already linked to a billing cycle",
            409,
          );
        if (v.payment)
          throw new DomainError("Add payments from the existing expense");
      } else {
        if (!v.amount_minor || !v.date)
          throw new DomainError("Enter the expense amount and date");
        if (
          this.store.get(
            "SELECT id FROM bookkeeping_records WHERE request_key=?",
            v.request_key,
          )
        )
          throw new DomainError(
            "This request already belongs to another expense",
            409,
          );
        record = books.record(a, {
          entity_id: s.entity_id,
          kind: "expense",
          description: `${s.name} · ${v.due_date}`,
          payee: s.vendor,
          category: s.category,
          department: s.department,
          amount_minor: v.amount_minor,
          date: v.date,
          due_date: v.due_date > v.date ? v.due_date : v.date,
          reference: v.reference,
          request_key: v.request_key,
          payment: v.payment,
        });
      }
      this.store.run(
        "INSERT INTO subscription_records(subscription_id,due_date,record_id,expected_minor) VALUES(?,?,?,?)",
        id,
        v.due_date,
        record.id,
        expected?.expected_minor ?? record.amount_minor,
      );
      this.store.audit(s.entity_id, a, "subscription.expense_recorded", id, {
        record_id: record.id,
        due_date: v.due_date,
      });
      return record;
    });
  }
  record(a: Actor, id: string, input: unknown) {
    const p = z
      .object({
        due_date: date,
        spend_id: z.string().optional(),
        invoice_number: z.string().trim().min(1).max(100).optional(),
        invoice_date: date.optional(),
        payment_due: date.optional(),
        amount_minor: money.optional(),
      })
      .strict()
      .safeParse(input);
    if (!p.success)
      throw new DomainError("Provide a valid billing date and invoice details");
    return this.store.tx(() => {
      const s = this.get(a, id, true),
        v = p.data;
      if (
        this.store.get(
          "SELECT record_id FROM subscription_records WHERE subscription_id=? AND due_date=?",
          id,
          v.due_date,
        )
      )
        throw new DomainError(
          "This billing cycle is already recorded in Expenses",
          409,
        );
      const existing = this.store.get(
        "SELECT * FROM subscription_charges WHERE subscription_id=? AND due_date=?",
        id,
        v.due_date,
      );
      if (existing) {
        const linked = this.store.spend(a, existing.spend_id);
        if (linked.status !== "rejected") {
          if (
            v.spend_id === linked.id ||
            (!v.spend_id &&
              v.invoice_number === linked.invoice_number &&
              v.amount_minor === linked.amount_minor &&
              v.invoice_date === linked.invoice_date &&
              v.payment_due === linked.due_date)
          )
            return linked;
          throw new DomainError(
            "This billing cycle already has an expense. Open that expense instead.",
            409,
          );
        }
      }
      const expected = this.expected(s, v.due_date).get(v.due_date);
      // Existing expenses may be linked after cancellation to surface unexpected charges.
      if (!expected && !v.spend_id)
        throw new DomainError(
          "No active billing cycle on this date. Link an existing expense to record an unexpected charge.",
        );
      if (v.due_date > shiftDays(this.today(), 365))
        throw new DomainError("Record invoices within the next year");
      let spend: any;
      if (v.spend_id) {
        spend = this.store.spend(a, v.spend_id);
        if (
          spend.entity_id !== s.entity_id ||
          spend.vendor_id !== s.vendor_id ||
          spend.currency !== s.currency ||
          spend.kind === "request" ||
          spend.status === "rejected"
        )
          throw new DomainError(
            "Link a non-rejected expense or bill for the same vendor, entity and currency",
          );
        if (
          this.store.get(
            "SELECT id FROM subscription_charges WHERE spend_id=?",
            spend.id,
          )
        )
          throw new DomainError(
            "Expense is already linked to a subscription cycle",
          );
      } else {
        if (
          !v.invoice_number ||
          !v.invoice_date ||
          !v.payment_due ||
          !v.amount_minor
        )
          throw new DomainError(
            "Invoice number, invoice date, due date and amount are required",
          );
        spend = this.store.createSpend(a, {
          entity_id: s.entity_id,
          kind: "bill",
          vendor_id: s.vendor_id,
          description: `${s.name} · ${v.due_date}`,
          purpose: s.purpose,
          amount_minor: v.amount_minor,
          currency: s.currency,
          department: s.department,
          category: s.category,
          date: v.invoice_date,
          invoice_number: v.invoice_number,
          invoice_date: v.invoice_date,
          due_date: v.payment_due,
          payment_source: "company",
          payment_method: s.payment_method,
          payment_account: s.payment_account,
        });
      }
      if (existing)
        this.store.run(
          "UPDATE subscription_charges SET spend_id=? WHERE id=?",
          spend.id,
          existing.id,
        );
      else
        this.store.run(
          "INSERT INTO subscription_charges VALUES(?,?,?,?,?,?)",
          key("SC"),
          id,
          v.due_date,
          expected?.expected_minor || s.amount_minor,
          spend.id,
          stamp(),
        );
      this.store.audit(
        s.entity_id,
        a,
        existing
          ? "subscription.invoice_replaced"
          : "subscription.invoice_linked",
        id,
        {
          due_date: v.due_date,
          spend_id: spend.id,
          previous_spend_id: existing?.spend_id,
          expected_minor:
            existing?.expected_minor ||
            expected?.expected_minor ||
            s.amount_minor,
          actual_minor: spend.amount_minor,
        },
      );
      return this.store.spend(a, spend.id);
    });
  }
}
