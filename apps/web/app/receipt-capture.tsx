"use client";
import { useRef, useState } from "react";
import { receiptSuggestions } from "../lib/receipt";
export default function ReceiptCapture({
  onFile,
}: {
  onFile: (file: File | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [suggestions, setSuggestions] = useState<ReturnType<
      typeof receiptSuggestions
    > | null>(null);
  async function read(file?: File) {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setStatus("Choose a receipt under 3 MB for upload.");
      return;
    }
    onFile(file);
    setText("");
    setSuggestions(null);
    if (file.type === "application/pdf") {
      setStatus(
        "PDF selected. Enter the details below; the PDF will be attached when you save. Automatic reading currently supports JPG and PNG photos.",
      );
      return;
    }
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      onFile(null);
      setStatus("Choose a JPG, PNG or PDF receipt.");
      return;
    }
    setBusy(true);
    setStatus("Reading receipt… This can take a moment.");
    let worker;
    try {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker("eng");
      const r = await worker.recognize(file);
      setText(r.data.text);
      setSuggestions(receiptSuggestions(r.data.text));
      setStatus(
        "Review these suggestions. Receipt reading can make mistakes; nothing is saved yet.",
      );
    } catch {
      setStatus(
        "Could not read this receipt. You can enter its details manually; the file will still be attached.",
      );
    } finally {
      await worker?.terminate();
      setBusy(false);
    }
  }
  function apply() {
    const form = root.current?.closest("form");
    if (form && suggestions) {
      for (const [name, value] of Object.entries(suggestions)) {
        const el = form.elements.namedItem(name);
        if (
          el instanceof HTMLInputElement &&
          !el.value &&
          !el.readOnly &&
          value
        ) {
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      setStatus(
        "Suggestions filled into empty fields. Check the expense date and amounts before saving.",
      );
    }
  }
  return (
    <div ref={root} className="receipt-capture full-width">
      <strong>Start with a receipt</strong>
      <p>
        Upload a photo to suggest the supplier, total and reference. Review the
        details before saving.
      </p>
      <input
        aria-label="Upload receipt"
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        disabled={busy}
        onChange={(e) => read(e.target.files?.[0])}
      />
      <small>
        JPG, PNG or PDF · up to 3 MB. Images are read in your browser.
      </small>
      {status && <p role="status">{status}</p>}
      {suggestions && (
        <>
          <div className="form-row">
            {Object.entries(suggestions).map(([key, value]) => (
              <label key={key}>
                {key === "payee"
                  ? "Supplier"
                  : key === "amount"
                    ? "Total amount"
                    : key === "date"
                      ? "Receipt date"
                      : key === "reference"
                        ? "Receipt number"
                        : "Description"}
                <input
                  value={value}
                  type={key === "date" ? "date" : "text"}
                  onChange={(e) =>
                    setSuggestions({ ...suggestions, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <button type="button" className="button" onClick={apply}>
            Use suggestions in empty fields
          </button>
          <details>
            <summary>Read receipt text</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{text}</pre>
          </details>
        </>
      )}
    </div>
  );
}
