"use client";
import { useState, type FormEvent } from "react";
import Select from "./select";
type Row = Record<string, any>;
const departments = ["Product", "Marketing", "Operations", "Finance"];
const groups = [
  "Cloud & software",
  "Marketing",
  "Operations",
  "Professional fees",
  "Travel",
  "Government fees",
];
export default function SubscriptionSetup({
  value,
  employees,
  categories,
  providers,
  currency,
  busy,
  onSave,
  onCancel,
}: {
  value: Row;
  employees: Row[];
  categories: Row[];
  providers: Row[];
  currency: string;
  busy: boolean;
  onSave: (v: Row) => Promise<void>;
  onCancel: () => void;
}) {
  const [department, setDepartment] = useState(value.department || "Product"),
    [employee, setEmployee] = useState(value.employee_id || ""),
    [cadence, setCadence] = useState(value.cadence || "monthly"),
    [method, setMethod] = useState(value.payment_method || ""),
    [renew, setRenew] = useState(!!value.auto_renew),
    [category, setCategory] = useState(
      value.category_name
        ? `custom:${value.category_name}`
        : value.category || "Cloud & software",
    ),
    [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget),
      get = (n: string) => String(f.get(n) || "");
    try {
      const amount = get("amount");
      if (!/^\d+(\.\d{1,2})?$/.test(amount))
        throw Error("Enter a valid total cost with up to two decimal places");
      const [w, d = ""] = amount.split(".");
      const amount_minor = Number(BigInt(w) * 100n + BigInt(d.padEnd(2, "0")));
      if (!Number.isSafeInteger(amount_minor) || amount_minor <= 0)
        throw Error("Total cost must be greater than zero");
      const custom = categories.find((c) => `custom:${c.name}` === category);
      await onSave({
        name: get("name"),
        provider_name: get("provider_name"),
        purpose: get("purpose") || "Subscription for business use",
        plan: get("plan"),
        seats: Number(get("users_count") || 1),
        users_count: get("users_count") ? Number(get("users_count")) : null,
        department,
        employee_id: employee,
        category:
          category === "new"
            ? get("accounting_category")
            : custom
              ? custom.accounting_category
              : category,
        category_name:
          category === "new" ? get("category_name") : custom?.name || "",
        amount_minor,
        cadence,
        interval_count:
          cadence === "custom_days" ? Number(get("interval_count")) : 1,
        start_date: get("start_date"),
        billing_anchor: get("billing_anchor"),
        renewal_date: get("renewal_date"),
        cancellation_deadline: get("cancellation_deadline"),
        auto_renew: renew,
        payment_method: method,
        payment_account: get("payment_account"),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form className="form subscription-setup" onSubmit={save}>
      <p className="micro">
        <span className="required-asterisk" aria-hidden="true">
          *
        </span>{" "}
        Required
      </p>
      {error && <p role="alert">{error}</p>}
      <h3>Subscription details</h3>
      <div className="form-row">
        <label>
          <span className="required-field-label">
            Subscription name{" "}
            <span className="required-asterisk" aria-hidden="true">
              *
            </span>
          </span>
          <input
            name="name"
            required
            minLength={3}
            maxLength={120}
            defaultValue={value.name}
            placeholder="e.g. Figma"
          />
        </label>
        <label>
          <span className="required-field-label">
            Who do you pay?{" "}
            <span className="required-asterisk" aria-hidden="true">
              *
            </span>
          </span>
          <input
            name="provider_name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={value.vendor || ""}
            list="subscription-providers"
            readOnly={!!value.id}
            placeholder="Type the company or person's name"
          />
          <small>
            {value.id
              ? "Provider is kept with the original billing history."
              : "The company or person charging you for this service."}
          </small>
          <datalist id="subscription-providers">
            {providers.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </label>
      </div>
      <label>
        <span className="required-field-label">
          Subscription category{" "}
          <span className="required-asterisk" aria-hidden="true">
            *
          </span>
        </span>
        <Select
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
          {categories.map((c) => (
            <option key={c.id} value={`custom:${c.name}`}>
              {c.name}
            </option>
          ))}
          <option value="new">+ Add category</option>
        </Select>
      </label>
      {category === "new" && (
        <div className="form-row">
          <label>
            <span className="required-field-label">
              New category name{" "}
              <span className="required-asterisk" aria-hidden="true">
                *
              </span>
            </span>
            <input
              name="category_name"
              required
              maxLength={80}
              placeholder="e.g. Design tools"
            />
            <small>Saved for use on other subscriptions.</small>
          </label>
          <label>
            <span className="required-field-label">
              Accounting group{" "}
              <span className="required-asterisk" aria-hidden="true">
                *
              </span>
            </span>
            <Select
              required
              name="accounting_category"
              defaultValue="Cloud & software"
            >
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
            <small>
              Where these costs appear in expense reports. Software services
              usually belong to Cloud & software.
            </small>
          </label>
        </div>
      )}
      <h3>Cost and billing</h3>
      <div className="form-row">
        <label>
          <span className="required-field-label">
            Total cost per payment ({currency}){" "}
            <span className="required-asterisk" aria-hidden="true">
              *
            </span>
          </span>
          <input
            name="amount"
            required
            inputMode="decimal"
            defaultValue={
              value.amount_minor ? String(value.amount_minor / 100) : ""
            }
            placeholder="0.00"
          />
          <small>
            The full bill for all users. We do not multiply it by the number of
            users.
          </small>
        </label>
        <label>
          <span className="required-field-label">
            How often do you pay?{" "}
            <span className="required-asterisk" aria-hidden="true">
              *
            </span>
          </span>
          <Select
            required
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Yearly</option>
            <option value="custom_days">Every specified number of days</option>
          </Select>
        </label>
      </div>
      {cadence === "custom_days" && (
        <label>
          <span className="required-field-label">
            Number of days between bills{" "}
            <span className="required-asterisk" aria-hidden="true">
              *
            </span>
          </span>
          <input
            type="number"
            name="interval_count"
            min={1}
            max={365}
            required
            defaultValue={value.interval_count || 30}
          />
          <small>For example, 30 means a new bill every 30 days.</small>
        </label>
      )}
      <div className="form-row">
        <label>
          <span className="required-field-label">
            Start date{" "}
            <span className="required-asterisk" aria-hidden="true">
              *
            </span>
          </span>
          <input
            name="start_date"
            type="date"
            required
            defaultValue={value.start_date || value.billing_anchor}
          />
          <small>When you began using this subscription.</small>
        </label>
        <label>
          <span className="required-field-label">
            {value.id ? "Billing schedule starts on" : "Next payment date"}{" "}
            <span className="required-asterisk" aria-hidden="true">
              *
            </span>
          </span>
          <input
            name="billing_anchor"
            type="date"
            required
            defaultValue={value.billing_anchor}
          />
          <small>
            {value.id
              ? "Keep this date unless changing the schedule. A changed schedule must begin today or later."
              : "The first bill to track here. Future bills follow the frequency above."}
          </small>
        </label>
      </div>
      <label className="subscription-check">
        <input
          type="checkbox"
          checked={renew}
          onChange={(e) => setRenew(e.target.checked)}
        />
        Renews automatically
      </label>
      <div className="form-row">
        <label>
          <span className="required-field-label">
            {renew ? "Next renewal date (optional)" : "Expiry date"}{" "}
            {!renew && (
              <span className="required-asterisk" aria-hidden="true">
                *
              </span>
            )}
          </span>
          <input
            type="date"
            name="renewal_date"
            required={!renew}
            defaultValue={value.renewal_date}
          />
          <small>
            {renew
              ? "When the service contract renews. This may differ from your monthly payment date."
              : "When access ends. No bills are forecast on or after this date."}
          </small>
        </label>
        {renew && (
          <label>
            Cancel-by date (optional)
            <input
              type="date"
              name="cancellation_deadline"
              defaultValue={value.cancellation_deadline}
            />
            <small>The last day to cancel before another renewal.</small>
          </label>
        )}
      </div>
      <h3>Who uses it</h3>
      <div className="form-row">
        <label>
          <span className="required-field-label">
            Department using it{" "}
            <span className="required-asterisk" aria-hidden="true">
              *
            </span>
          </span>
          <Select
            required
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setEmployee("");
            }}
          >
            {departments.map((d) => (
              <option value={d} key={d}>
                {d} department
              </option>
            ))}
          </Select>
        </label>
        <label>
          Employee responsible (optional)
          <Select
            value={employee}
            onChange={(e) => setEmployee(e.target.value)}
          >
            <option value="">No employee assigned</option>
            {employees
              .filter((e) => e.active && e.department === department)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </Select>
          <small>
            Your contact for usage, renewals and cancellation. Add employees in
            Employees.
          </small>
        </label>
      </div>
      <details className="expense-optional">
        <summary>
          Optional details{" "}
          <span>Package, number of users, payment method and notes</span>
        </summary>
        <div className="expense-optional-fields">
          <div className="form-row">
            <label>
              Package name (optional)
              <input
                name="plan"
                maxLength={100}
                defaultValue={value.plan}
                placeholder="e.g. Basic or Business"
              />
            </label>
            <label>
              Number of users (optional)
              <input
                type="number"
                name="users_count"
                min={1}
                max={100000}
                defaultValue={value.users_count ?? ""}
              />
              <small>How many people can use the subscription.</small>
            </label>
          </div>
          <div className="form-row">
            <label>
              Usual payment method (optional)
              <Select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="">Not set</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </Select>
            </label>
            {["card", "bank_transfer", "other"].includes(method) && (
              <label>
                {method === "card"
                  ? "Card nickname"
                  : method === "bank_transfer"
                    ? "Bank account nickname"
                    : "Payment source nickname"}{" "}
                (optional)
                <input
                  key={method}
                  name="payment_account"
                  maxLength={100}
                  defaultValue={
                    method === value.payment_method ? value.payment_account : ""
                  }
                  placeholder={
                    method === "card"
                      ? "e.g. Company card"
                      : "e.g. Operating account"
                  }
                />
                <small>
                  A name to recognise it; do not enter full card or account
                  details.
                </small>
              </label>
            )}
          </div>
          <label>
            Notes (optional)
            <textarea
              name="purpose"
              maxLength={1000}
              defaultValue={value.purpose}
              placeholder="What is this subscription used for?"
            />
          </label>
        </div>
      </details>
      <p className="micro">
        Saving sets up tracking only. Use Record bill / payment to add a paid or
        unpaid bill to Expenses once.
      </p>
      <div className="action-buttons">
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : "Save subscription"}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
