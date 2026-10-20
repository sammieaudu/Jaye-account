import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FinanceStore, DomainError, type Actor } from "./domain";
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
  );
const short = z.string().trim().min(1).max(180);
export const invoiceSchema = z
  .object({
    entity_id: z.enum(["ng", "inc"]),
    request_key: z.string().uuid(),
    revision: z.number().int().min(0).default(0),
    date: day,
    due_date: day,
    customer: short,
    customer_email: z.union([z.literal(""), z.string().email()]),
    customer_address: z.string().max(600),
    business_name: short,
    business_address: z.string().max(600),
    business_contact: z.string().max(300),
    payment_details: z.string().max(1000),
    notes: z.string().max(2000),
    currency: z.enum(["NGN", "USD"]),
    tax_basis_points: z.number().int().min(0).max(10000),
    items: z
      .array(
        z.object({
          description: short,
          quantity: z.number().int().min(1).max(100000),
          unit_minor: z.number().int().min(0).max(1e10),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine((v) => v.due_date >= v.date, {
    message: "Due date cannot be before invoice date",
  });
export class InvoiceService {
  constructor(private s: FinanceStore) {}
  list(a: Actor, entity: string) {
    this.s.authorize(a, entity, ["finance", "cfo", "auditor"]);
    return this.s
      .all(
        "SELECT * FROM sales_invoices WHERE entity_id=? ORDER BY created_at DESC",
        entity,
      )
      .map((r) => ({ ...r, document: JSON.parse(r.document) }));
  }
  save(a: Actor, input: unknown, id?: string) {
    const parsed = invoiceSchema.safeParse(input);
    if (!parsed.success)
      throw new DomainError(
        parsed.error.issues
          .map((i) => `${i.path.join(" ")}: ${i.message}`)
          .join("; "),
      );
    const v = parsed.data;
    this.s.authorize(a, v.entity_id, ["finance"]);
    const subtotal = v.items.reduce((n, i) => n + i.quantity * i.unit_minor, 0),
      tax = Math.round((subtotal * v.tax_basis_points) / 10000),
      total = subtotal + tax;
    if (!Number.isSafeInteger(total) || total <= 0 || total > 1e12)
      throw new DomainError(
        "Invoice total must be greater than zero and within the supported limit",
      );
    return this.s.tx(() => {
      const old = id
        ? this.s.get(
            "SELECT * FROM sales_invoices WHERE id=? AND entity_id=?",
            id,
            v.entity_id,
          )
        : null;
      if (id && !old) throw new DomainError("Invoice not found", 404);
      if (
        old &&
        (old.revision !== v.revision ||
          JSON.parse(old.document).status !== "draft")
      )
        throw new DomainError("Only the current draft can be edited", 409);
      const retry = this.s.get(
        "SELECT * FROM sales_invoices WHERE request_key=?",
        v.request_key,
      );
      if (!id && retry) {
        if (retry.entity_id !== v.entity_id)
          throw new DomainError("Request key already used", 409);
        return { ...retry, document: JSON.parse(retry.document) };
      }
      const key = id || randomUUID(),
        number =
          old?.number ||
          `JAYE-${String(this.s.get("SELECT COUNT(*) AS n FROM sales_invoices WHERE entity_id=?", v.entity_id).n + 1).padStart(5, "0")}`,
        now = new Date().toISOString();
      const document = {
        ...v,
        status: "draft",
        subtotal_minor: subtotal,
        tax_minor: tax,
      };
      if (old)
        this.s.run(
          "UPDATE sales_invoices SET document=?,total_minor=?,revision=revision+1,updated_at=? WHERE id=?",
          JSON.stringify(document),
          total,
          now,
          key,
        );
      else
        this.s.run(
          "INSERT INTO sales_invoices VALUES(?,?,?,?,?,?,?,?,?)",
          key,
          v.entity_id,
          number,
          v.request_key,
          0,
          JSON.stringify(document),
          total,
          now,
          now,
        );
      this.s.audit(
        v.entity_id,
        a,
        old ? "invoice.updated" : "invoice.created",
        key,
        { number, total_minor: total },
      );
      return {
        ...this.s.get("SELECT * FROM sales_invoices WHERE id=?", key),
        document,
      };
    });
  }
  action(a: Actor, id: string, input: any) {
    const p = z
      .object({
        action: z.enum(["issue", "cancel"]),
        revision: z.number().int().min(0),
      })
      .safeParse(input);
    if (!p.success) throw new DomainError("Invalid invoice action");
    return this.s.tx(() => {
      const r = this.s.get("SELECT * FROM sales_invoices WHERE id=?", id);
      if (!r) throw new DomainError("Invoice not found", 404);
      this.s.authorize(a, r.entity_id, ["finance"]);
      if (r.revision !== p.data.revision)
        throw new DomainError("Invoice changed; reload it", 409);
      const d = JSON.parse(r.document);
      if (
        d.status === "cancelled" ||
        (p.data.action === "issue" && d.status !== "draft")
      )
        throw new DomainError("This invoice cannot be changed", 409);
      d.status = p.data.action === "issue" ? "issued" : "cancelled";
      this.s.run(
        "UPDATE sales_invoices SET document=?,revision=revision+1,updated_at=? WHERE id=?",
        JSON.stringify(d),
        new Date().toISOString(),
        id,
      );
      this.s.audit(r.entity_id, a, `invoice.${d.status}`, id, {
        number: r.number,
      });
      return { ...r, revision: r.revision + 1, document: d };
    });
  }
}
