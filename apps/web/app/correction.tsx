"use client";
import { useRef, useState, type FormEvent } from "react";
import Select from "./select";
import CategorySelect from "./category-select";
type Row = Record<string, any>;
export default function Correction({
  source,
  kind,
  currency,
  employees,
  request,
  onSaved,
  onCancel,
}: {
  source: Row;
  kind: "record" | "payment";
  currency: string;
  employees: Row[];
  request: (p: string, o?: RequestInit) => Promise<any>;
  onSaved: (r: Row) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const f = new FormData(e.currentTarget),
        v = String(f.get("amount"));
      if (!/^\d+(\.\d{1,2})?$/.test(v))
        throw Error("Enter an amount with up to two decimal places");
      const [w, d = ""] = v.split(".");
      const amount = Number(BigInt(w) * 100n + BigInt(d.padEnd(2, "0")));
      const body: Row = {
        amount_minor: amount,
        date: f.get("date"),
        reason: f.get("reason"),
        note: f.get("note"),
        revision: source.revision,
        request_key: key.current,
      };
      for (const field of [
        "description",
        "payee",
        "employee_id",
        "category",
        "department",
        "due_date",
        "payroll_month",
        "reference",
        "method",
      ])
        if (f.has(field)) body[field] = f.get(field);
      onSaved(
        await request(
          `/${kind === "record" ? "records" : "record-payments"}/${source.id}/correct`,
          { method: "POST", body: JSON.stringify(body) },
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="simple-correction">
      <div className="panel-heading">
        <div>
          <h3>
            Correct{" "}
            {kind === "payment"
              ? "payment"
              : source.kind === "salary"
                ? "salary record"
                : "expense"}
          </h3>
          <p>
            The original stays in history. Only the corrected amount affects
            balances.
          </p>
        </div>
        <button className="button" disabled={busy} onClick={onCancel}>
          Cancel correction
        </button>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <form className="simple-form" onSubmit={submit}>
        <label>
          Correct amount ({currency})
          <input
            autoFocus
            name="amount"
            inputMode="decimal"
            required
            defaultValue={String(source.amount_minor / 100)}
          />
          <small>
            Use 0 to void an entry made by mistake. This does not record a
            refund or send money.
          </small>
        </label>
        <label>
          Correct date
          <input name="date" type="date" required defaultValue={source.date} />
        </label>
        {kind === "record" ? (
          <>
            <label>
              Description
              <input
                name="description"
                required
                maxLength={180}
                defaultValue={source.description}
              />
            </label>
            {source.employee_id ? (
              <label>
                {source.kind === "salary" ? "Employee" : "Person to reimburse"}
                <Select name="employee_id" defaultValue={source.employee_id}>
                  {employees.map((e) => (
                    <option value={e.id} key={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <label>
                Supplier / payee
                <input name="payee" required defaultValue={source.payee} />
              </label>
            )}
            {source.kind === "salary" ? (
              <label>
                Salary month
                <input
                  name="payroll_month"
                  type="month"
                  required
                  defaultValue={source.payroll_month}
                />
              </label>
            ) : (
              <>
                <label>
                  Category
                  <CategorySelect entity={source.entity_id} defaultValue={source.category} />
                </label>
                <label>
                  Department
                  <Select
                    name="department"
                    defaultValue={
                      source.department === "Engineering"
                        ? "Product"
                        : source.department
                    }
                  >
                    {["Product", "Marketing", "Operations", "Finance"].map(
                      (x) => (
                        <option key={x}>{x}</option>
                      ),
                    )}
                  </Select>
                </label>
              </>
            )}
            <label>
              Due date
              <input
                name="due_date"
                type="date"
                required
                defaultValue={source.due_date}
              />
            </label>
          </>
        ) : (
          <label>
            Payment method
            <Select name="method" defaultValue={source.method}>
              {["Bank transfer", "Cash", "Debit card"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </label>
        )}
        <label>
          Reference
          <input
            name="reference"
            required={kind === "payment"}
            maxLength={180}
            defaultValue={source.reference}
          />
        </label>
        <label className="full-width">
          Reason for correction
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            placeholder="e.g. Amount was entered as 50,000 instead of 5,000"
          />
        </label>
        <label className="full-width">
          Notes
          <textarea name="note" maxLength={2000} defaultValue={source.note} />
        </label>
        <div className="simple-form-footer full-width">
          <p>
            If a payment was wrong, correct it before reducing the expense below
            the amount paid.
          </p>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save correction"}
          </button>
        </div>
      </form>
    </section>
  );
}
