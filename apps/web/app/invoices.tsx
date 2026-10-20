"use client";
import { useEffect, useState } from "react";
import Select from "./select";
type Row = Record<string, any>;
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
function toMinor(v: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(v))
    throw Error("Enter prices with up to two decimal places");
  const [w, d = ""] = v.split(".");
  return Number(BigInt(w) * 100n + BigInt(d.padEnd(2, "0")));
}
export default function Invoices({
  entity,
  request,
}: {
  entity: string;
  request: (p: string, o?: RequestInit) => Promise<any>;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState<Row | null>(null),
    [draft, setDraft] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [payment, setPayment] = useState<Row | null>(null),
    [voiding, setVoiding] = useState<Row | null>(null);
  const summary = rows
    .filter((r) => r.document.status === "issued")
    .reduce((all: Row, r) => {
      const c = r.document.currency;
      all[c] ||= { total: 0, received: 0, owed: 0 };
      all[c].total += r.total_minor;
      all[c].received += r.received_minor;
      all[c].owed += r.balance_minor;
      return all;
    }, {});
  const load = () => request(`/sales-invoices?entity=${entity}`).then(setRows);
  useEffect(() => {
    let active = true;
    request(`/sales-invoices?entity=${entity}`)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [entity, request]);
  function start(r?: Row) {
    setError("");
    setNotice("");
    const previous = rows[0]?.document;
    setDraft(
      r
        ? {
            ...r.document,
            id: r.id,
            revision: r.revision,
            items: r.document.items.map((i: Row) => ({
              ...i,
              price: (i.unit_minor / 100).toFixed(2),
            })),
          }
        : {
            entity_id: entity,
            request_key: crypto.randomUUID(),
            revision: 0,
            date: today(),
            due_date: today(),
            customer: "",
            customer_email: "",
            customer_address: "",
            business_name: previous?.business_name || "GoJaye Nigeria Ltd",
            business_address:
              previous?.business_address ||
              "Hse 1, DQ, Von Garden, Lugbe, Abuja, FCT, Nigeria",
            business_contact:
              previous?.business_contact ||
              "support@gojaye.com · +234-9168561171",
            payment_details: previous?.payment_details || "",
            notes: "Thank you for choosing Jaye.",
            currency: "NGN",
            tax_basis_points: 0,
            items: [{ description: "", quantity: 1, price: "" }],
          },
    );
    setSelected(null);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        ...draft,
        items: draft.items.map((i: Row) => ({
          description: i.description,
          quantity: Number(i.quantity),
          unit_minor: toMinor(i.price),
        })),
        tax_basis_points: Number(draft.tax_basis_points),
      };
      const r = await request(
        draft.id ? `/sales-invoices/${draft.id}/edit` : "/sales-invoices",
        { method: "POST", body: JSON.stringify(body) },
      );
      setSelected(r);
      setDraft(null);
      await load();
      setNotice("Invoice saved. Review it, then issue and export it.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await request(`/sales-invoices/${selected.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action, revision: selected.revision }),
      });
      setSelected(r);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function savePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !payment || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await request(`/sales-invoices/${selected.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          ...payment,
          amount_minor: toMinor(payment.amount),
          revision: selected.revision,
        }),
      });
      setSelected(r);
      setPayment(null);
      setNotice("Payment saved. The amount still owed has been updated.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function voidPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !voiding || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await request(
        `/sales-invoices/${selected.id}/payments/${voiding.id}/void`,
        {
          method: "POST",
          body: JSON.stringify({
            reason: voiding.reason,
            revision: selected.revision,
          }),
        },
      );
      setSelected(r);
      setVoiding(null);
      setNotice(
        "Incorrect payment voided. The balance is updated and history retained.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function pdf(r: Row) {
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const d = r.document;
    const doc = new jsPDF();
    doc.setFillColor(24, 68, 56);
    doc.rect(0, 0, 210, 45, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(27);
    doc.setFont("helvetica", "bold");
    try {
      const svg = (await (await fetch("/brand/jaye.svg")).text()).replaceAll(
        "#0F2A24",
        "#FFFFFF",
      );
      const image = new Image();
      const url = URL.createObjectURL(
        new Blob([svg], { type: "image/svg+xml" }),
      );
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = reject;
          image.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = 552;
        canvas.height = 160;
        canvas.getContext("2d")!.drawImage(image, 0, 0, 552, 160);
        doc.addImage(canvas.toDataURL("image/png"), "PNG", 16, 15, 38, 11);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      doc.text("JAYE", 16, 24);
    }

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Move. Earn. Grow.", 16, 33);
    doc.setFontSize(20);
    doc.text(
      d.status === "draft"
        ? "DRAFT INVOICE"
        : d.status === "cancelled"
          ? "CANCELLED INVOICE"
          : "INVOICE",
      194,
      24,
      { align: "right" },
    );
    doc.setFontSize(11);
    doc.text(r.number, 194, 34, { align: "right" });
    doc.setTextColor(30, 36, 33);
    doc.setFontSize(11);
    let y = 56;
    const block = (label: string, value: string) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, 16, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(value, 175);
      doc.text(lines, 16, y);
      y += lines.length * 5 + 7;
    };
    block(
      d.business_name,
      [d.business_address, d.business_contact].filter(Boolean).join("\n"),
    );
    block(
      "BILL TO",
      [d.customer, d.customer_email, d.customer_address]
        .filter(Boolean)
        .join("\n"),
    );
    doc.text(
      `Invoice date: ${d.date}     Due date: ${d.due_date}     Currency: ${d.currency}`,
      16,
      y,
    );
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [
        [
          "Description",
          "Qty",
          `Unit price (${d.currency})`,
          `Amount (${d.currency})`,
        ],
      ],
      body: d.items.map((i: Row) => [
        i.description,
        String(i.quantity),
        (i.unit_minor / 100).toLocaleString("en-US", {
          minimumFractionDigits: 2,
        }),
        ((i.quantity * i.unit_minor) / 100).toLocaleString("en-US", {
          minimumFractionDigits: 2,
        }),
      ]),
      theme: "striped",
      headStyles: { fillColor: [43, 121, 102] },
      styles: { fontSize: 10, cellPadding: 4 },
      columnStyles: {
        0: { cellWidth: 85 },
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
      },
      margin: { left: 16, right: 16, bottom: 20 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
    function space(height: number) {
      if (y + height > 275) {
        doc.addPage();
        y = 20;
      }
    }
    space(28);
    doc.text(
      `Subtotal: ${d.currency} ${(d.subtotal_minor / 100).toFixed(2)}`,
      194,
      y,
      { align: "right" },
    );
    y += 7;
    doc.text(
      `Tax (${d.tax_basis_points / 100}%): ${d.currency} ${(d.tax_minor / 100).toFixed(2)}`,
      194,
      y,
      { align: "right" },
    );
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.text(
      `TOTAL: ${d.currency} ${(r.total_minor / 100).toFixed(2)}`,
      194,
      y,
      { align: "right" },
    );
    y += 9;
    if (d.status === "issued") {
      space(23);
      doc.setFont("helvetica", "normal");
      doc.text(
        `RECEIVED: ${d.currency} ${(r.received_minor / 100).toFixed(2)}`,
        194,
        y,
        { align: "right" },
      );
      y += 7;
      doc.text(
        `BALANCE DUE: ${d.currency} ${(r.balance_minor / 100).toFixed(2)}`,
        194,
        y,
        { align: "right" },
      );
      y += 10;
    }
    for (const [label, value] of [
      ["Payment details", d.payment_details],
      ["Notes", d.notes],
    ]) {
      if (!value) continue;
      const lines = doc.splitTextToSize(value, 175);
      space(14);
      doc.setFont("helvetica", "bold");
      doc.text(label, 16, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      for (const line of lines) {
        space(6);
        doc.text(line, 16, y);
        y += 5;
      }
      y += 7;
    }
    const pages = doc.getNumberOfPages();
    for (let n = 1; n <= pages; n++) {
      doc.setPage(n);
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text("gojaye.com · " + r.number, 16, 288);
      doc.text(`${n} / ${pages}`, 194, 288, { align: "right" });
    }
    return doc;
  }
  async function exportInvoice(share = false) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const doc = await pdf(selected),
        file = new File([doc.output("blob")], `${selected.number}.pdf`, {
          type: "application/pdf",
        });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: selected.number });
      } else {
        doc.save(file.name);
        setNotice(
          share
            ? "PDF downloaded. Attach it in WhatsApp, email or your preferred app."
            : "Invoice PDF downloaded.",
        );
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setError("Could not export or share. Try Download PDF.");
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: string,
    label: string,
    required = false,
    type = "text",
  ) => (
    <label>
      {label}
      {required && <span className="required-asterisk"> *</span>}
      <input
        type={type}
        required={required}
        maxLength={key.includes("address") ? 600 : 180}
        value={draft?.[key] || ""}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <section className="invoice-workspace">
      {error && (
        <p className="simple-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {draft ? (
        <form onSubmit={save} className="invoice-editor">
          <div className="quick-guide-heading">
            <h2>{draft.id ? "Edit draft" : "New customer invoice"}</h2>
            <button
              type="button"
              className="button"
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
          <p>
            Create a bill for your customer. This does not create a company
            expense or record a payment.
          </p>
          <h3>Customer</h3>
          <div className="form-row">
            {field("customer", "Customer / company", true)}
            {field("customer_email", "Customer email", false, "email")}
            {field("customer_address", "Customer address")}
            {field("date", "Invoice date", true, "date")}
            {field("due_date", "Payment due date", true, "date")}
            <label>
              Currency
              <Select
                value={draft.currency}
                onChange={(e) =>
                  setDraft({ ...draft, currency: e.target.value })
                }
              >
                <option>NGN</option>
                <option>USD</option>
              </Select>
            </label>
          </div>
          <h3>What are you billing for?</h3>
          {draft.items.map((i: Row, index: number) => (
            <div className="invoice-line" key={index}>
              <label>
                Description <span className="required-asterisk">*</span>
                <input
                  required
                  maxLength={180}
                  value={i.description}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((x: Row, n: number) =>
                        n === index ? { ...x, description: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Quantity
                <input
                  required
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={i.quantity}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((x: Row, n: number) =>
                        n === index ? { ...x, quantity: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Unit price
                <input
                  required
                  inputMode="decimal"
                  value={i.price}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((x: Row, n: number) =>
                        n === index ? { ...x, price: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="button"
                disabled={draft.items.length === 1}
                onClick={() =>
                  setDraft({
                    ...draft,
                    items: draft.items.filter(
                      (_: Row, n: number) => n !== index,
                    ),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button"
            disabled={draft.items.length >= 100}
            onClick={() =>
              setDraft({
                ...draft,
                items: [
                  ...draft.items,
                  { description: "", quantity: 1, price: "" },
                ],
              })
            }
          >
            + Add item
          </button>
          <label>
            Tax rate (%)
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={draft.tax_basis_points / 100}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  tax_basis_points: Math.round(Number(e.target.value) * 100),
                })
              }
            />
            <small>
              Enter the rate that applies to this invoice. No tax is added by
              default.
            </small>
          </label>
          <h3>Jaye details</h3>
          <div className="form-row">
            {field("business_name", "Business name", true)}
            {field("business_address", "Business address")}
            {field("business_contact", "Email / phone")}
          </div>
          <label>
            Payment instructions / bank details
            <textarea
              maxLength={1000}
              value={draft.payment_details}
              onChange={(e) =>
                setDraft({ ...draft, payment_details: e.target.value })
              }
              placeholder="Bank name, account name and account number"
            />
          </label>
          <label>
            Notes / terms
            <textarea
              maxLength={2000}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save & preview invoice"}
          </button>
        </form>
      ) : selected ? (
        <>
          <div className="quick-guide-heading">
            <button
              className="button"
              onClick={() => {
                setSelected(null);
                setPayment(null);
                setVoiding(null);
              }}
            >
              ← Back to invoices
            </button>
            <div className="button-row">
              {selected.document.status === "draft" && (
                <>
                  <button className="button" onClick={() => start(selected)}>
                    Edit draft
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => action("issue")}
                  >
                    Issue invoice
                  </button>
                </>
              )}
              <button
                className="button"
                disabled={busy}
                onClick={() => exportInvoice()}
              >
                Download PDF
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => exportInvoice(true)}
              >
                Share PDF
              </button>
            </div>
          </div>
          {selected.document.status === "issued" && (
            <section className="invoice-editor">
              <div className="quick-guide-heading">
                <div>
                  <h3>Customer payments · {selected.payment_status}</h3>
                  <p>
                    Received{" "}
                    <strong>
                      {money(
                        selected.received_minor,
                        selected.document.currency,
                      )}
                    </strong>{" "}
                    · Still owed{" "}
                    <strong>
                      {money(
                        selected.balance_minor,
                        selected.document.currency,
                      )}
                    </strong>
                  </p>
                </div>
                {!payment && selected.balance_minor > 0 && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => {
                      setVoiding(null);
                      setPayment({
                        request_key: crypto.randomUUID(),
                        amount: (selected.balance_minor / 100).toFixed(2),
                        date: today(),
                        reference: "",
                        method: "Bank transfer",
                        notes: "",
                      });
                    }}
                  >
                    Record payment received
                  </button>
                )}
              </div>
              <p>
                Record money already received. Each payment reduces this
                invoice’s balance once. Customer receipts are tracked here
                separately from expense reports and the general ledger.
              </p>
              {payment && (
                <form onSubmit={savePayment}>
                  <div className="form-row">
                    <label>
                      Amount received ({selected.document.currency}){" "}
                      <span className="required-asterisk">*</span>
                      <input
                        required
                        inputMode="decimal"
                        value={payment.amount}
                        onChange={(e) =>
                          setPayment({ ...payment, amount: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Payment date <span className="required-asterisk">*</span>
                      <input
                        required
                        type="date"
                        min={selected.document.date}
                        value={payment.date}
                        onChange={(e) =>
                          setPayment({ ...payment, date: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Payment reference{" "}
                      <span className="required-asterisk">*</span>
                      <input
                        required
                        maxLength={180}
                        value={payment.reference}
                        onChange={(e) =>
                          setPayment({ ...payment, reference: e.target.value })
                        }
                      />
                      <small>
                        Use the bank reference or a unique receipt number.
                      </small>
                    </label>
                    <label>
                      Payment method
                      <Select
                        value={payment.method}
                        onChange={(e) =>
                          setPayment({ ...payment, method: e.target.value })
                        }
                      >
                        {["Bank transfer", "Card", "Cash", "Other"].map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </Select>
                    </label>
                  </div>
                  <label>
                    Notes (optional)
                    <textarea
                      maxLength={1000}
                      value={payment.notes}
                      onChange={(e) =>
                        setPayment({ ...payment, notes: e.target.value })
                      }
                    />
                  </label>
                  <div className="button-row">
                    <button className="button primary" disabled={busy}>
                      {busy ? "Saving…" : "Save payment"}
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => setPayment(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {voiding && (
                <form onSubmit={voidPayment}>
                  <h3>Void incorrect payment</h3>
                  <p>
                    This removes an entry made by mistake from the received
                    total. It does not record a customer refund.
                  </p>
                  <label>
                    Reason <span className="required-asterisk">*</span>
                    <input
                      required
                      maxLength={180}
                      value={voiding.reason}
                      onChange={(e) =>
                        setVoiding({ ...voiding, reason: e.target.value })
                      }
                    />
                  </label>
                  <div className="button-row">
                    <button className="button primary" disabled={busy}>
                      Void payment
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => setVoiding(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}
          {(selected.payments || []).length > 0 && (
            <section className="invoice-editor">
              <h3>Payment history</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reference</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.payments.map((p: Row) => (
                      <tr key={p.id}>
                        <td>{p.date}</td>
                        <td>
                          {p.reference}
                          {p.notes && <small>{p.notes}</small>}
                        </td>
                        <td>{p.method}</td>
                        <td>
                          {money(p.amount_minor, selected.document.currency)}
                        </td>
                        <td>
                          {p.voided_at
                            ? `Voided: ${p.void_reason}`
                            : "Recorded"}
                        </td>
                        <td>
                          {!p.voided_at && (
                            <button
                              className="button"
                              disabled={busy}
                              onClick={() => {
                                setPayment(null);
                                setVoiding({ ...p, reason: "" });
                              }}
                            >
                              Void incorrect payment
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <InvoicePreview record={selected} />
          {selected.document.status !== "cancelled" && (
            <details>
              <summary>More actions</summary>
              <p>
                Cancelling keeps this invoice and its number in your records.
                Invoices with recorded payments cannot be cancelled.
              </p>
              <button
                className="button"
                disabled={busy || selected.received_minor > 0}
                onClick={() => action("cancel")}
              >
                Cancel invoice
              </button>
            </details>
          )}
        </>
      ) : (
        <>
          <div className="quick-guide-heading">
            <div>
              <h2>Customer invoices</h2>
              <p>
                Create, save and share branded invoices. Invoice numbers are
                assigned automatically.
              </p>
            </div>
            <button className="button primary" onClick={() => start()}>
              + New invoice
            </button>
          </div>
          <p>
            Issue an invoice, then record payments as they arrive. Drafts and
            cancelled invoices are excluded from customer balances.
          </p>
          {Object.entries(summary).map(([currency, v]) => (
            <div className="invoice-editor" key={currency}>
              <strong>{currency} customer balances</strong>
              <p>
                Invoiced {money((v as Row).total, currency)} · Received{" "}
                {money((v as Row).received, currency)} · Still owed{" "}
                {money((v as Row).owed, currency)}
              </p>
            </div>
          ))}
          {rows.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Due date</th>
                    <th>Total</th>
                    <th>Received</th>
                    <th>Still owed</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setSelected(r)}
                        >
                          {r.number}
                        </button>
                      </td>
                      <td>{r.document.customer}</td>
                      <td>{r.document.due_date}</td>
                      <td>{money(r.total_minor, r.document.currency)}</td>
                      <td>{money(r.received_minor, r.document.currency)}</td>
                      <td>{money(r.balance_minor, r.document.currency)}</td>
                      <td>{r.payment_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No invoices yet. Create your first customer invoice above.</p>
          )}
        </>
      )}
    </section>
  );
}
function InvoicePreview({ record: r }: { record: Row }) {
  const d = r.document;
  return (
    <article className="invoice-paper">
      <header>
        <div>
          <img src="/brand/jaye.svg" alt="Jaye" />
          <p>Move. Earn. Grow.</p>
        </div>
        <div>
          <h2>INVOICE</h2>
          <p>{r.number}</p>
          <span>{(r.payment_status || d.status).toUpperCase()}</span>
        </div>
      </header>
      <div className="invoice-parties">
        <div>
          <h3>{d.business_name}</h3>
          <p>{d.business_address}</p>
          <p>{d.business_contact}</p>
        </div>
        <div>
          <small>BILL TO</small>
          <h3>{d.customer}</h3>
          <p>{d.customer_email}</p>
          <p>{d.customer_address}</p>
        </div>
      </div>
      <div className="invoice-dates">
        <span>Invoice date: {d.date}</span>
        <span>Due: {d.due_date}</span>
        <span>Currency: {d.currency}</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((i: Row, n: number) => (
              <tr key={n}>
                <td>{i.description}</td>
                <td>{i.quantity}</td>
                <td>{money(i.unit_minor, d.currency)}</td>
                <td>{money(i.quantity * i.unit_minor, d.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="invoice-totals">
        <p>
          Subtotal <strong>{money(d.subtotal_minor, d.currency)}</strong>
        </p>
        <p>
          Tax ({d.tax_basis_points / 100}%){" "}
          <strong>{money(d.tax_minor, d.currency)}</strong>
        </p>
        <h3>
          Total <strong>{money(r.total_minor, d.currency)}</strong>
        </h3>
        {d.status === "issued" && (
          <>
            <p>
              Received <strong>{money(r.received_minor, d.currency)}</strong>
            </p>
            <h3>
              Balance due <strong>{money(r.balance_minor, d.currency)}</strong>
            </h3>
          </>
        )}
      </div>
      {d.payment_details && (
        <section>
          <h3>Payment details</h3>
          <p>{d.payment_details}</p>
        </section>
      )}
      {d.notes && (
        <section>
          <h3>Notes</h3>
          <p>{d.notes}</p>
        </section>
      )}
      <footer>gojaye.com · Thank you for choosing Jaye.</footer>
    </article>
  );
}
