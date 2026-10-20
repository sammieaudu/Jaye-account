"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Plus,
  ArrowLeft,
  Download,
  FileText,
  Users,
  Wallet,
} from "lucide-react";
import Select from "./select";
import Correction from "./correction";
import RecordSettlement from "./record-settlement";
type Row = Record<string, any>;
type Props = {
  initialQuery?: string;
  initialRecordId?: string;
  entity: string;
  currency: string;
  page: string;
  user: Row;
  request: (p: string, o?: RequestInit) => Promise<any>;
  navigate: (p: string) => void;
};
const departments = ["Operations", "Product", "Marketing", "Finance"];
const categories = [
  "Operations",
  "Cloud & software",
  "Marketing",
  "Professional fees",
  "Travel",
  "Government fees",
];
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const money = (n: number, c: string) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: c }).format(
    n / 100,
  );
const displayDate = (value: string, monthOnly = false) => {
  if (!value) return "Not set";
  const date = new Date(
    `${value.length === 7 ? `${value}-01` : value}T00:00:00Z`,
  );
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        ...(monthOnly ? {} : { day: "numeric" as const }),
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
};
function minor(value: FormDataEntryValue | null) {
  const v = String(value || "");
  if (!/^\d+(\.\d{1,2})?$/.test(v))
    throw Error("Enter an amount with up to two decimal places");
  const [w, d = ""] = v.split(".");
  const n = Number(BigInt(w) * 100n + BigInt(d.padEnd(2, "0")));
  if (!Number.isSafeInteger(n) || n > 1e12) throw Error("Amount is too large");
  return n;
}
export default function Bookkeeping({
  entity,
  currency,
  page,
  user,
  request,
  navigate,
  initialQuery = "",
  initialRecordId = "",
}: Props) {
  const [records, setRecords] = useState<Row[]>([]),
    [employees, setEmployees] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState(false),
    [edit, setEdit] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [query, setQuery] = useState(initialQuery),
    [filter, setFilter] = useState("All"),
    [paid, setPaid] = useState("unpaid"),
    [personal, setPersonal] = useState("company"),
    [person, setPerson] = useState(""),
    [paymentForm, setPaymentForm] = useState(false);
  const [correction, setCorrection] = useState<{
    kind: "record" | "payment";
    source: Row;
  } | null>(null);
  const [vendorChoice, setVendorChoice] = useState("");
  const [vendors, setVendors] = useState<Row[]>([]);
  useEffect(() => {
    let active = true;
    request(`/vendors?entity=${entity}`)
      .then((v) => {
        if (active) setVendors(v);
      })
      .catch((e) => {
        if (active) setError(`Could not load saved vendors: ${e.message}`);
      });
    return () => {
      active = false;
    };
  }, [entity, request]);
  const submitKey = useRef("");
  const canWrite = user.role === "finance",
    team = page === "Employees",
    payroll = page === "Payroll";
  useEffect(() => setQuery(initialQuery), [initialQuery]);
  async function reload() {
    const [r, e] = await Promise.all([
      request(`/records?entity=${entity}`),
      request(`/employees?entity=${entity}`),
    ]);
    setRecords(r);
    setEmployees(e);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      request(`/records?entity=${entity}`),
      request(`/employees?entity=${entity}`),
    ])
      .then(([r, e]) => {
        if (active) {
          setRecords(r);
          setEmployees(e);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [entity, request]);
  useEffect(() => {
    if (!initialRecordId) return;
    let active = true;
    setError("");
    request(`/records/${initialRecordId}`)
      .then((record) => {
        if (active) {
          setDetail(record);
          setForm(false);
          setPaymentForm(false);
          setCorrection(null);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [initialRecordId, request]);
  function start(employee?: Row) {
    setError("");
    setNotice("");
    setEdit(employee || null);
    setCorrection(null);
    setVendorChoice("");
    setPerson("");
    setPaid("unpaid");
    setPersonal("company");
    setDetail(null);
    setForm(true);
    submitKey.current = crypto.randomUUID();
  }
  async function open(id: string) {
    setError("");
    setCorrection(null);
    try {
      setDetail(await request(`/records/${id}`));
      setForm(false);
      setPaymentForm(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    try {
      if (team) {
        await request(edit ? `/employees/${edit.id}/edit` : "/employees", {
          method: "POST",
          body: JSON.stringify({
            entity_id: entity,
            name: f.get("name"),

            job_title: f.get("job_title"),
            department: f.get("department"),
            kind: f.get("kind"),
            salary_minor: minor(f.get("salary")),
            start_date: f.get("start_date"),
            active: f.get("active") === "yes",
            revision: edit?.revision || 0,
          }),
        });
        setForm(false);
        setNotice(
          "Employee saved. Salary changes apply to future records only.",
        );
      } else {
        const salaryEmployee = employees.find((e) => e.id === person);
        const body = {
          entity_id: entity,
          kind: payroll ? "salary" : "expense",
          description: payroll
            ? `Salary · ${salaryEmployee?.name || ""} · ${f.get("month")}`
            : f.get("description"),
          payee: f.get("payee") || "",
          employee_id: payroll || personal === "person" ? person : "",
          category: payroll ? "Salaries" : f.get("category"),
          department:
            (payroll ? salaryEmployee?.department : f.get("department")) ||
            "Operations",
          amount_minor: minor(f.get("amount")),
          date: f.get("date"),
          due_date: f.get("due_date") || f.get("date"),
          payroll_month: payroll ? f.get("month") : undefined,
          reference: f.get("reference") || "",
          note: f.get("note") || "",
          request_key: submitKey.current,
          payment:
            paid === "paid"
              ? {
                  amount_minor: minor(f.get("amount")),
                  date: f.get("payment_date"),
                  reference: f.get("payment_reference"),
                  method: f.get("method"),
                  note: "",
                }
              : undefined,
        };
        const saved = await request("/records", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setDetail(saved);
        setForm(false);
        setNotice(
          "Record saved. The cost is counted once; payments only reduce the balance owed.",
        );
      }
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !detail) return;
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    try {
      setDetail(
        await request(`/records/${detail.id}/payments`, {
          method: "POST",
          body: JSON.stringify({
            amount_minor: minor(f.get("amount")),
            date: f.get("date"),
            reference: f.get("reference"),
            method: f.get("method"),
            note: f.get("note") || "",
            request_key: submitKey.current,
          }),
        }),
      );
      setPaymentForm(false);
      await reload();
      setNotice("Payment recorded. The outstanding balance has been updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rows = records.filter(
    (r) => r.kind === (payroll ? "salary" : "expense"),
  );
  const visible = rows.filter(
    (r) =>
      (filter === "All" || r.status === filter) &&
      [r.description, r.payee, r.reference, r.payroll_month].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
  );
  const total = (field: string) => rows.reduce((n, r) => n + r[field], 0);
  const staff = employees.filter((e) =>
    [e.name, e.employee_code, e.department].some((v) =>
      String(v).toLowerCase().includes(query.toLowerCase()),
    ),
  );
  function download() {
    const data = team
      ? [
          [
            "Name",
            "Staff ID",
            "Department",
            "Type",
            "Monthly salary",
            "Currency",
            "Active",
          ],
          ...staff.map((e) => [
            e.name,
            e.employee_code,
            e.department,
            e.kind,
            (e.salary_minor / 100).toFixed(2),
            currency,
            e.active ? "Yes" : "No",
          ]),
        ]
      : [
          [
            "Description",
            "Payee",
            "Date",
            "Salary month",
            "Net cost",
            "Net paid",
            "Refunds received",
            "Outstanding",
            "Currency",
            "Status",
          ],
          ...visible.map((r) => [
            r.description,
            r.payee,
            r.date,
            r.payroll_month || "",
            (r.amount_minor / 100).toFixed(2),
            (r.paid_minor / 100).toFixed(2),
            (r.refunded_minor / 100).toFixed(2),
            (r.outstanding_minor / 100).toFixed(2),
            currency,
            r.status,
          ]),
        ];
    const content = data
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v)
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `jaye-${page.toLowerCase()}-${entity}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  if (loading)
    return <div className="panel simple-loading">Loading records…</div>;
  return (
    <div className="bookkeeping-workspace finance-workspace">
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="simple-notice">
          {notice}
        </p>
      )}
      {!detail && !form && (
        <>
          <div className="simple-guide">
            <div>
              {team ? (
                <Users size={24} />
              ) : payroll ? (
                <Wallet size={24} />
              ) : (
                <FileText size={24} />
              )}
            </div>
            <div>
              <h2>
                {team
                  ? "Your people, in one place"
                  : payroll
                    ? "Record a salary, then its payments"
                    : "Record what the business spends"}
              </h2>
              <p>
                {team
                  ? "Add employees and founders once. Keep their agreed monthly salary here for payroll."
                  : payroll
                    ? "Choose a person and month, record the amount owed, then add payments as they happen. This records agreed salary amounts; it does not calculate taxes or deductions."
                    : "Enter the cost and who is owed. If it has already been paid, record the payment too. A bill is just an expense that is not paid yet."}
              </p>
            </div>
          </div>
          {!team && (
            <div className="simple-totals">
              <div>
                <span>Total recorded</span>
                <strong>{money(total("amount_minor"), currency)}</strong>
              </div>
              <div>
                <span>Net payments</span>
                <strong>{money(total("paid_minor"), currency)}</strong>
              </div>
              <div>
                <span>Remaining balance</span>
                <strong>{money(total("outstanding_minor"), currency)}</strong>
              </div>
            </div>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>
                {team
                  ? "Employees & founders"
                  : payroll
                    ? "Salary records"
                    : "Expense records"}
              </h2>
              <div className="action-buttons">
                <button className="button" onClick={download}>
                  <Download size={16} />
                  Export CSV
                </button>
                {canWrite && (
                  <button className="button primary" onClick={() => start()}>
                    <Plus size={16} />
                    {team
                      ? "Add employee"
                      : payroll
                        ? "Record salary"
                        : "Record expense"}
                  </button>
                )}
              </div>
            </div>
            <div className="simple-filters">
              <label>
                Search
                <input
                  placeholder={
                    team
                      ? "Name or staff ID"
                      : "Payee, description or reference"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {!team && (
                <label>
                  Payment status
                  <Select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {[
                      "All",
                      "Unpaid",
                      "Part paid",
                      "Paid",
                      "Refunded",
                      "Voided",
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                </label>
              )}
            </div>
            {(team ? staff.length : visible.length) ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {(team
                        ? ["Name", "Department", "Monthly salary", "Status", ""]
                        : [
                            "Description",
                            payroll ? "Month" : "Payee",
                            "Cost",
                            "Paid",
                            "Still owed",
                            "Status",
                            "",
                          ]
                      ).map((x, i) => (
                        <th key={i}>{x}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {team
                      ? staff.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <strong>{e.name}</strong>
                              <small>
                                {e.employee_code} · {e.kind}
                              </small>
                            </td>
                            <td>{e.department}</td>
                            <td>{money(e.salary_minor, currency)}</td>
                            <td>{e.active ? "Active" : "Inactive"}</td>
                            <td>
                              {canWrite && (
                                <button
                                  className="button"
                                  onClick={() => start(e)}
                                  aria-label={`Edit ${e.name}`}
                                >
                                  Edit
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      : visible.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <strong>{r.description}</strong>
                              <small>{r.date}</small>
                            </td>
                            <td>{payroll ? r.payroll_month : r.payee}</td>
                            <td>{money(r.amount_minor, currency)}</td>
                            <td>{money(r.paid_minor, currency)}</td>
                            <td>{money(r.outstanding_minor, currency)}</td>
                            <td>
                              <span
                                className={`simple-status ${r.status === "Paid" ? "settled" : ""}`}
                              >
                                {r.status}
                              </span>
                            </td>
                            <td>
                              <button
                                className="button"
                                onClick={() => open(r.id)}
                                aria-label={`View ${r.description}`}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <h3>
                  {query || filter !== "All"
                    ? "No matching records"
                    : team
                      ? "Add your first employee"
                      : payroll
                        ? "No salaries recorded yet"
                        : "No expenses recorded yet"}
                </h3>
                <p>
                  {team
                    ? "Start with a name and agreed salary. Staff IDs are generated automatically."
                    : payroll
                      ? "Add employees first, then record the salary owed for each month."
                      : "Start with a purchase, an unpaid invoice or an expense someone paid for Jaye."}
                </p>
                {payroll && !employees.length && (
                  <button
                    className="button"
                    onClick={() => navigate("Employees")}
                  >
                    Go to employees
                  </button>
                )}
              </div>
            )}
          </section>
        </>
      )}
      {form && (
        <section
          className={`panel simple-editor ${!team && !payroll ? "expense-entry" : ""}`}
        >
          <div className="panel-heading">
            <div>
              <h2>
                {team
                  ? edit
                    ? "Edit employee"
                    : "Add employee"
                  : payroll
                    ? "Record salary"
                    : "Record expense"}
              </h2>
              <p>
                {team
                  ? "These are employee records, not login accounts."
                  : payroll
                    ? "Record the salary and whether it has been paid."
                    : "Add the cost, choose who to pay, then record any payment."}
              </p>
            </div>
            <button
              disabled={busy}
              className="button"
              onClick={() => {
                setForm(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
          <form className="simple-form" onSubmit={save}>
            {!team &&
              (payroll || personal === "person") &&
              !employees.some((e) => e.active) && (
                <div className="simple-notice full-width">
                  Add an active employee or founder before recording their
                  salary or reimbursement.{" "}
                  <button
                    className="button"
                    type="button"
                    onClick={() => navigate("Employees")}
                  >
                    Go to employees
                  </button>
                </div>
              )}
            {team ? (
              <>
                <label>
                  Full name
                  <input
                    name="name"
                    defaultValue={edit?.name}
                    required
                    maxLength={180}
                  />
                </label>
                <label>
                  Staff ID
                  <input
                    value={
                      edit?.employee_code || "Assigned automatically when saved"
                    }
                    readOnly
                    aria-label="Staff ID"
                  />
                </label>
                <label>
                  Department
                  <Select
                    name="department"
                    defaultValue={edit?.department || "Operations"}
                  >
                    {departments.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </Select>
                </label>
                <label>
                  Job title <span>(optional)</span>
                  <input name="job_title" defaultValue={edit?.job_title} />
                </label>
                <label>
                  Person type
                  <Select name="kind" defaultValue={edit?.kind || "employee"}>
                    <option value="employee">Employee</option>
                    <option value="founder">Founder</option>
                  </Select>
                </label>
                <label>
                  Monthly salary ({currency})
                  <input
                    name="salary"
                    inputMode="decimal"
                    defaultValue={edit ? String(edit.salary_minor / 100) : "0"}
                    required
                  />
                  <small>
                    Agreed amount to be paid. Use 0 if no regular salary.
                  </small>
                </label>
                <label>
                  Start date
                  <input
                    type="date"
                    name="start_date"
                    defaultValue={edit?.start_date || today()}
                    required
                  />
                </label>
                <label>
                  Status
                  <Select
                    name="active"
                    defaultValue={edit?.active === 0 ? "no" : "yes"}
                  >
                    <option value="yes">Active</option>
                    <option value="no">Inactive</option>
                  </Select>
                </label>
              </>
            ) : (
              <>
                {payroll ? (
                  <>
                    <label>
                      Employee
                      <Select
                        value={person}
                        onChange={(e) => setPerson(e.target.value)}
                        required
                      >
                        <option value="">Choose an employee</option>
                        {employees
                          .filter((e) => e.active)
                          .map((e) => (
                            <option value={e.id} key={e.id}>
                              {e.name} · {e.employee_code}
                            </option>
                          ))}
                      </Select>
                    </label>
                    <label>
                      Salary month
                      <input
                        name="month"
                        type="month"
                        defaultValue={today().slice(0, 7)}
                        required
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <div className="expense-section-title full-width">
                      <span>1</span>
                      <h3>Expense details</h3>
                    </div>
                    <label className="full-width">
                      What was the expense?
                      <input
                        name="description"
                        required
                        maxLength={180}
                        placeholder="e.g. Office internet for October"
                      />
                    </label>
                    <label>
                      {payroll ? "Salary owed" : "Expense amount"} ({currency})
                      <input
                        key={payroll ? person : "amount"}
                        name="amount"
                        inputMode="decimal"
                        required
                        defaultValue={
                          payroll && person
                            ? String(
                                employees.find((e) => e.id === person)
                                  ?.salary_minor / 100,
                              )
                            : ""
                        }
                        placeholder="0.00"
                      />
                    </label>
                    <label>
                      Expense date
                      <input
                        name="date"
                        type="date"
                        defaultValue={today()}
                        required
                      />
                      <small>When the expense was incurred.</small>
                    </label>
                    <label>
                      Category
                      <Select name="category">
                        {categories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    </label>
                    <label>
                      Department
                      <Select name="department">
                        {departments.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </Select>
                    </label>
                  </>
                )}
                {payroll && (
                  <>
                    <label>
                      {payroll ? "Salary owed" : "Expense amount"} ({currency})
                      <input
                        key={payroll ? person : "amount"}
                        name="amount"
                        inputMode="decimal"
                        required
                        defaultValue={
                          payroll && person
                            ? String(
                                employees.find((e) => e.id === person)
                                  ?.salary_minor / 100,
                              )
                            : ""
                        }
                        placeholder="0.00"
                      />
                    </label>
                    <label>
                      Record date
                      <input
                        name="date"
                        type="date"
                        defaultValue={today()}
                        required
                      />
                      <small>The date this cost belongs in the books.</small>
                    </label>
                  </>
                )}
                {!payroll && (
                  <>
                    <div className="expense-section-title full-width">
                      <span>2</span>
                      <h3>Who should Jaye pay?</h3>
                    </div>
                    <label>
                      Payment recipient
                      <Select
                        value={personal}
                        onChange={(e) => {
                          setPersonal(e.target.value);
                          setPerson("");
                          setPaid("unpaid");
                        }}
                      >
                        <option value="company">
                          Pay the supplier directly
                        </option>
                        <option value="person">
                          Reimburse an employee or founder
                        </option>
                      </Select>
                    </label>
                    {personal === "person" ? (
                      <label>
                        Person to reimburse
                        <Select
                          value={person}
                          onChange={(e) => setPerson(e.target.value)}
                          required
                        >
                          <option value="">Choose a person</option>
                          {employees
                            .filter((e) => e.active)
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                        </Select>
                        <small>
                          Choose the person who used their own money.
                        </small>
                      </label>
                    ) : (
                      <>
                        <label>
                          Supplier name
                          {vendors.length > 0 && (
                            <Select
                              value={vendorChoice}
                              onChange={(e) => setVendorChoice(e.target.value)}
                            >
                              <option value="">New or one-off supplier</option>
                              {vendors.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name}
                                </option>
                              ))}
                            </Select>
                          )}
                          {vendorChoice ? (
                            <input
                              type="hidden"
                              name="payee"
                              value={
                                vendors.find((v) => v.id === vendorChoice)
                                  ?.name || ""
                              }
                            />
                          ) : (
                            <input
                              name="payee"
                              aria-label="Supplier name"
                              required
                              placeholder="e.g. Internet provider"
                              maxLength={180}
                            />
                          )}
                        </label>
                      </>
                    )}
                  </>
                )}
                <div className="expense-section-title full-width">
                  <span>{payroll ? "" : "3"}</span>
                  <h3>Payment details</h3>
                </div>
                <label>
                  {payroll
                    ? "Has this salary been paid?"
                    : personal === "person"
                      ? "Has Jaye repaid this person?"
                      : "Has Jaye paid for this?"}
                  <Select
                    value={paid}
                    onChange={(e) => setPaid(e.target.value)}
                  >
                    <option value="unpaid">Not paid yet</option>
                    <option value="paid">Yes, paid in full</option>
                  </Select>
                </label>
                {paid === "unpaid" ? (
                  <label>
                    Due date <span>(optional)</span>
                    <input name="due_date" type="date" />
                    <small>
                      Already paid part of it? Save this as unpaid, then open
                      the record and choose Record payment to add the amount
                      paid.
                    </small>
                  </label>
                ) : (
                  <>
                    <label>
                      Payment date
                      <input
                        name="payment_date"
                        type="date"
                        defaultValue={today()}
                        required
                      />
                    </label>
                    <label>
                      Payment reference
                      <input
                        name="payment_reference"
                        required
                        placeholder="Bank reference or unique voucher number"
                        maxLength={180}
                      />
                    </label>
                    <label>
                      Payment method
                      <Select name="method">
                        <option>Bank transfer</option>
                        <option>Cash</option>
                        <option>Debit card</option>
                      </Select>
                    </label>
                  </>
                )}
                <details className="expense-optional full-width">
                  <summary>
                    Additional details{" "}
                    <span>Invoice number and notes · optional</span>
                  </summary>
                  <div className="expense-optional-fields">
                    {!payroll && (
                      <label>
                        Invoice / receipt number <span>(optional)</span>
                        <input name="reference" maxLength={180} />
                      </label>
                    )}
                    <label className="full-width">
                      Notes <span>(optional)</span>
                      <textarea
                        name="note"
                        rows={3}
                        maxLength={2000}
                        placeholder="Add context or an evidence reference"
                      />
                    </label>
                  </div>
                </details>
              </>
            )}
            <div className="simple-form-footer full-width">
              <p>
                {team
                  ? "You can update employee details later."
                  : "This documents expenses and payments. It does not send money."}
              </p>
              <button
                className="button primary"
                disabled={
                  busy ||
                  (!team && (payroll || personal === "person") && !person)
                }
              >
                {busy
                  ? "Saving…"
                  : team
                    ? "Save employee"
                    : payroll
                      ? "Save salary record"
                      : "Save expense"}
              </button>
            </div>
          </form>
        </section>
      )}
      {detail && !form && (
        <section className="panel simple-editor bookkeeping-detail">
          <div className="panel-heading record-overview-heading">
            <div>
              <button
                className="text-button"
                onClick={() => {
                  setDetail(null);
                  setError("");
                  setNotice("");
                }}
              >
                <ArrowLeft size={16} />
                Back to {detail.payroll_month ? "payroll" : "expenses"}
              </button>
              <span className="record-eyebrow">
                {detail.payroll_month ? "Salary record" : "Expense record"}
              </span>
              <h2>
                {detail.payroll_month ? detail.payee : detail.description}
              </h2>
              <p>
                {detail.payroll_month
                  ? displayDate(detail.payroll_month, true)
                  : detail.payee}
                {" · "}
                {detail.department} department
              </p>
            </div>
            {canWrite && !detail.voided && !correction && (
              <button
                className="button"
                disabled={!!detail.refunded_minor}
                title={
                  detail.refunded_minor
                    ? "Reverse a mistaken refund before correcting this record"
                    : undefined
                }
                onClick={() => {
                  setPaymentForm(false);
                  setCorrection({ kind: "record", source: detail });
                }}
              >
                Correct record
              </button>
            )}
            <span
              className={`simple-status ${detail.status === "Paid" ? "settled" : ""}`}
            >
              {detail.status}
            </span>
          </div>
          {correction && (
            <Correction
              key={`${correction.kind}:${correction.source.id}`}
              source={correction.source}
              kind={correction.kind}
              currency={currency}
              employees={employees}
              request={request}
              onCancel={() => setCorrection(null)}
              onSaved={(r) => {
                setDetail(r);
                setCorrection(null);
                setNotice(
                  "Correction saved. Balances and history are updated.",
                );
                void reload();
              }}
            />
          )}
          <div className="simple-totals">
            <div>
              <span>
                {detail.payroll_month ? "Salary amount" : "Expense amount"}
              </span>
              <strong>{money(detail.amount_minor, currency)}</strong>
            </div>
            <div>
              <span>{detail.refunded_minor ? "Net paid" : "Total paid"}</span>
              <strong>{money(detail.paid_minor, currency)}</strong>
            </div>
            <div>
              <span>Remaining balance</span>
              <strong>{money(detail.outstanding_minor, currency)}</strong>
            </div>
          </div>
          {!!detail.refunded_minor && (
            <p className="simple-evidence">
              Original recorded cost:{" "}
              {money(detail.original_amount_minor, currency)} · Returned to
              Jaye: {money(detail.refunded_minor, currency)}. The totals above
              show net cost and net money paid.
            </p>
          )}
          <dl className="simple-details">
            <div>
              <dt>Recorded on</dt>
              <dd>{displayDate(detail.date)}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{detail.category}</dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd>{displayDate(detail.due_date)}</dd>
            </div>
            <div>
              <dt>
                {detail.payroll_month
                  ? "Record reference"
                  : "Invoice reference"}
              </dt>
              <dd>{detail.reference || "—"}</dd>
            </div>
            <div className="full-width">
              <dt>Notes</dt>
              <dd>{detail.note || "No notes added"}</dd>
            </div>
          </dl>
          <div className="panel-heading">
            <div>
              <h3>Payment history</h3>
              <p>
                {detail.payments.length} payment
                {detail.payments.length === 1 ? "" : "s"} recorded · Payments
                reduce the remaining balance.
              </p>
            </div>
            {canWrite &&
              !correction &&
              detail.outstanding_minor > 0 &&
              !paymentForm && (
                <button
                  className="button primary"
                  onClick={() => {
                    setPaymentForm(true);
                    submitKey.current = crypto.randomUUID();
                  }}
                >
                  Record payment
                </button>
              )}
          </div>
          {paymentForm && (
            <form className="simple-form payment-form" onSubmit={pay}>
              <label>
                Amount paid ({currency})
                <input
                  name="amount"
                  inputMode="decimal"
                  defaultValue={String(detail.outstanding_minor / 100)}
                  required
                />
              </label>
              <label>
                Payment date
                <input
                  name="date"
                  type="date"
                  defaultValue={today()}
                  required
                  min={detail.date}
                />
              </label>
              <label>
                Payment reference
                <input
                  name="reference"
                  required
                  maxLength={180}
                  placeholder="Bank reference or unique voucher number"
                />
              </label>
              <label>
                Method
                <Select name="method">
                  <option>Bank transfer</option>
                  <option>Cash</option>
                  <option>Debit card</option>
                </Select>
              </label>
              <label className="full-width">
                Notes <span>(optional)</span>
                <textarea name="note" maxLength={2000} />
              </label>
              <div className="simple-form-footer full-width">
                <p>Only record a payment that has already been made.</p>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => setPaymentForm(false)}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? "Saving…" : "Save payment"}
                </button>
              </div>
            </form>
          )}
          {detail.payments.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.payments.map((p: Row) => (
                    <tr key={p.id}>
                      <td>{displayDate(p.date)}</td>
                      <td>{p.reference}</td>
                      <td>{p.voided ? "Voided" : p.method}</td>
                      <td>
                        {money(p.amount_minor, currency)}
                        {!!p.voided && <small>Excluded from balance</small>}
                      </td>
                      <td>
                        {canWrite && !p.voided && !detail.voided && (
                          <button
                            className="button"
                            disabled={
                              !!detail.refunded_minor || !!p.bank_transaction_id
                            }
                            title={
                              detail.refunded_minor
                                ? "Reverse a mistaken refund before correcting payments"
                                : p.bank_transaction_id
                                  ? "Remove the bank match before correcting this payment"
                                  : undefined
                            }
                            onClick={() => {
                              setPaymentForm(false);
                              setCorrection({ kind: "payment", source: p });
                            }}
                          >
                            Correct payment
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="simple-loading">No payments recorded yet.</p>
          )}
          <div className="simple-evidence">
            <h3>
              {detail.payroll_month
                ? "Payslip & supporting documents"
                : "Receipts & supporting documents"}
            </h3>
            <p>
              Keep the{" "}
              {detail.payroll_month
                ? "payslip and payment confirmation"
                : "invoice or receipt"}{" "}
              with this record. PDF, PNG or JPG, up to 8 MB.
            </p>
            {detail.attachments?.map((f: Row) => (
              <a
                key={f.id}
                className="button"
                href={`/api/record-attachments/${f.id}`}
              >
                {f.filename}
              </a>
            ))}
            {canWrite && (
              <label className="simple-upload">
                <span>
                  <FileText size={20} />{" "}
                  {busy ? "Uploading…" : "Attach a document"}
                </span>
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setError("");
                    setBusy(true);
                    try {
                      const body = new FormData();
                      body.append("file", file);
                      await request(`/records/${detail.id}/attachments`, {
                        method: "POST",
                        body,
                      });
                      setDetail(await request(`/records/${detail.id}`));
                      setNotice("Document attached.");
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
            )}
          </div>
          <RecordSettlement
            key={detail.id}
            record={detail}
            currency={currency}
            user={user}
            request={request}
            onSaved={(r) => {
              setDetail(r);
              void reload();
            }}
          />
          {!!detail.corrections?.length && (
            <div className="simple-evidence">
              <h3>Correction history</h3>
              {detail.corrections.map((c: Row) => (
                <details key={c.id}>
                  <summary>
                    {c.kind === "payment" ? "Payment" : "Expense / salary"} ·{" "}
                    {c.reason}
                  </summary>
                  <p>
                    {c.actor} · {c.created_at.slice(0, 10)}
                  </p>
                  <p>
                    {money(c.before.amount_minor, currency)} →{" "}
                    {c.after.voided
                      ? "Voided"
                      : money(c.after.amount_minor, currency)}
                  </p>
                  <p>
                    Date: {c.before.date} → {c.after.date}
                  </p>
                  <p>
                    Reference: {c.before.reference || "None"} →{" "}
                    {c.after.reference || "None"}
                  </p>
                  {[
                    "description",
                    "payee",
                    "category",
                    "department",
                    "payroll_month",
                    "method",
                    "note",
                  ]
                    .filter((f) => c.before[f] !== c.after[f])
                    .map((f) => (
                      <p key={f}>
                        {f.replaceAll("_", " ")}: {c.before[f] || "None"} →{" "}
                        {c.after[f] || "None"}
                      </p>
                    ))}
                </details>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
