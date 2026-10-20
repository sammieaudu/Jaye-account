"use client";
import { useEffect, useState } from "react";
import Select from "./select";
const defaults = [
  "Operations",
  "Cloud & software",
  "Marketing",
  "Professional fees",
  "Travel",
  "Government fees",
  "Salaries",
];
export default function CategorySelect({
  entity = "ng",
  name = "category",
  defaultValue = "Operations",
  value,
  onChange,
  disabled = false,
}: {
  entity?: string;
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<string[]>(defaults),
    [selected, setSelected] = useState(defaultValue),
    [adding, setAdding] = useState(false),
    [newName, setNewName] = useState(""),
    [group, setGroup] = useState("Operations"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/categories?entity=${entity}`)
      .then(async (r) => {
        if (!r.ok) throw Error("Could not load categories");
        return r.json();
      })
      .then((r) => {
        if (active) setRows(r.map((x: any) => x.name));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [entity]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: entity,
          name: newName,
          accounting_category: group,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.message);
      setRows([...rows, d.name]);
      setSelected(d.name);
      onChange?.({ target: { value: d.name } });
      setAdding(false);
      setNewName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="category-control">
      <Select
        aria-label="Category"
        name={name}
        value={value ?? selected}
        disabled={disabled || busy}
        onChange={(e) => {
          if (e.target.value === "__add") {
            setAdding(true);
            return;
          }
          setSelected(e.target.value);
          onChange?.(e);
        }}
      >
        {Array.from(new Set([...rows, value ?? selected]))
          .filter(Boolean)
          .map((n) => (
            <option key={n}>{n}</option>
          ))}
        <option value="__add">+ Add category</option>
      </Select>
      {adding && (
        <span className="category-create">
          <input
            ref={(input) => {
              input?.setCustomValidity("Save or cancel the new category before saving this record.");
            }}
            aria-label="New category name"
            placeholder="New category name"
            maxLength={60}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <span>Group in reports</span>
          <Select
            aria-label="Accounting group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            {defaults.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
          <span className="button-row">
            <button
              type="button"
              className="button primary"
              disabled={busy || newName.trim().length < 2}
              onClick={save}
            >
              {busy ? "Saving…" : "Add category"}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </span>
        </span>
      )}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
