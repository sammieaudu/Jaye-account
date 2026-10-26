import ExcelJS from "exceljs";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { FinanceStore, DomainError, categories, type Actor } from "./domain";
import { BookkeepingService } from "./bookkeeping";
import { BudgetService } from "./budgets";
import { localDate } from "./subscriptions";

const month = /^\d{4}-(0[1-9]|1[0-2])$/;
const validDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const digest = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const sum = (rows: any[], key: string) =>
  rows.reduce((n, r) => n + Number(r[key] || 0), 0);
const categoryMap: Record<string, string> = {
  Salaries: "Salaries",
  "Content & Social Media": "Marketing",
  "Software & Tools": "Cloud & software",
  "Marketing & Ads": "Marketing",
  "Insurance & Fixed": "Operations",
  "Business Admin": "Government fees",
  "Other Expense": "Operations",
};
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
function value(cell: ExcelJS.Cell): any {
  const v = cell.value;
  if (v && typeof v === "object" && "formula" in v) return v.result ?? null;
  if (v && typeof v === "object" && "sharedFormula" in v)
    return v.result ?? null;
  if (v && typeof v === "object" && "richText" in v)
    return v.richText.map((x) => x.text).join("");
  return v;
}
function minor(v: any): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e10
    ? Math.round(v * 100)
    : null;
}
export class MonthlyExpenseService {
  constructor(private s: FinanceStore) {}
  access(a: Actor, e: string, write = false) {
    this.s.authorize(
      a,
      e,
      write ? ["finance"] : ["finance", "cfo", "auditor", "reconciler"],
    );
  }
  rows(a: Actor, e: string) {
    this.access(a, e);
    return this.s
      .all(
        "SELECT r.*,b.filename,b.created_at FROM expense_import_rows r JOIN expense_import_batches b ON b.id=r.batch_id WHERE r.entity_id=? ORDER BY b.created_at DESC,r.rowid",
        e,
      )
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }
  source(a: Actor, e: string, id: string) {
    this.access(a, e);
    const batch = this.s.get(
      "SELECT filename,source_json,created_at FROM expense_import_batches WHERE id=? AND entity_id=?",
      id,
      e,
    );
    if (!batch) throw new DomainError("Import source not found", 404);
    return {
      filename: batch.filename,
      imported_at: batch.created_at,
      ...JSON.parse(batch.source_json),
    };
  }
  async preview(
    a: Actor,
    e: string,
    file: Buffer,
    filename: string,
    year: number,
  ) {
    this.access(a, e, true);
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      throw new DomainError("Choose the source year");
    if (file.length > 8 * 1024 * 1024)
      throw new DomainError("Workbook exceeds 8 MB");
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file as any);
    } catch {
      throw new DomainError("Upload a valid XLSX workbook");
    }
    const ledger = wb.getWorksheet("Ledger"),
      budget = wb.getWorksheet("Budget"),
      settings = wb.getWorksheet("Settings");
    if (!ledger && !budget)
      throw new DomainError("Workbook must contain a Ledger or Budget sheet");
    if (wb.worksheets.some((w) => w.rowCount > 5000 || w.columnCount > 100))
      throw new DomainError(
        "Workbook exceeds 5,000 rows or 100 columns per sheet",
      );
    const fx = Number(settings ? value(settings.getCell("C4")) : 0);
    const currency = this.s.get(
      "SELECT currency FROM entities WHERE id=?",
      e,
    ).currency;
    const raw: any[] = [];
    const rows: any[] = [];
    for (const sheet of wb.worksheets.filter(
      (w) => w.name !== "Contributions",
    )) {
      sheet.eachRow((row, index) => {
        const cells: Record<string, any> = {};
        row.eachCell((c) => {
          if (c.value !== null) cells[c.address] = c.value;
        });
        raw.push({ sheet: sheet.name, row: index, cells });
      });
    }
    const converted = (amount: number | null, ccy: string, rate: number) =>
      amount === null
        ? null
        : ccy === currency
          ? amount
          : rate > 0 &&
              ["USD", "NGN"].includes(ccy) &&
              ["USD", "NGN"].includes(currency)
            ? Math.round(ccy === "USD" ? amount * rate : amount / rate)
            : null;
    const add = (
      kind: string,
      sheet: string,
      row: number,
      data: any,
      column = "",
    ) => {
      const original = JSON.stringify({ sheet, row, column, year, data });
      rows.push({
        kind,
        source_key: digest(original),
        data: {
          ...data,
          source_sheet: sheet,
          source_row: row,
          source_column: column,
        },
      });
    };
    ledger?.eachRow((r, i) => {
      if (i < 5) return;
      const get = (n: number) => value(r.getCell(n));
      if (!get(3) && !get(5) && !get(8)) return;
      const amount = minor(get(8)),
        ccy = String(get(7) || ""),
        rate = Number(get(9) || fx);
      const monthIndex = months.findIndex(
        (m) => m.toLowerCase() === String(get(2) || "").toLowerCase(),
      );
      let date = "";
      const d = get(1);
      if (d instanceof Date) date = d.toISOString().slice(0, 10);
      else if (typeof d === "string" && validDate(d)) date = d;
      const period =
        monthIndex >= 0
          ? `${year}-${String(monthIndex + 1).padStart(2, "0")}`
          : date.slice(0, 7);
      const sourceCategory = String(get(4) || "");
      add(get(3) === "Out" ? "expense" : "money_in", "Ledger", i, {
        period,
        date,
        description: String(get(5) || sourceCategory || "Historical expense"),
        payee: String(get(5) || ""),
        source_category: sourceCategory,
        category: categoryMap[sourceCategory] || "",
        department:
          sourceCategory.includes("Marketing") ||
          sourceCategory.includes("Social")
            ? "Marketing"
            : "Operations",
        currency: ccy,
        original_minor: amount,
        fx_rate: rate || null,
        amount_minor: converted(amount, ccy, rate),
        paid_from: String(get(6) || ""),
        note: String(get(12) || ""),
        payment_status: "unknown",
      });
    });
    budget?.eachRow((r, i) => {
      if (i < 5) return;
      const get = (n: number) => value(r.getCell(n));
      if (!get(1) || /^total/i.test(String(get(1)))) return;
      let hasAmount = false;
      for (let c = 4; c <= budget.columnCount; c++) {
        const amount = minor(get(c));
        if (amount === null) continue;
        hasAmount = true;
        const label = String(value(budget.getCell(4, c)) || "");
        const mi = months.findIndex(
          (m) => m.toLowerCase() === label.toLowerCase(),
        );
        if (mi < 0) continue;
        const sourceCategory = String(get(2) || ""),
          ccy = String(get(3) || "");
        add(
          "budget",
          "Budget",
          i,
          {
            period: mi >= 0 ? `${year}-${String(mi + 1).padStart(2, "0")}` : "",
            description: String(get(1)),
            source_category: sourceCategory,
            category: categoryMap[sourceCategory] || "",
            department:
              sourceCategory.includes("Marketing") ||
              sourceCategory.includes("Social")
                ? "Marketing"
                : "Operations",
            currency: ccy,
            original_minor: amount,
            fx_rate: fx || null,
            amount_minor: converted(amount, ccy, fx),
          },
          String(c),
        );
      }
      if (!hasAmount && (get(2) || get(3)))
        add("reference", "Budget", i, {
          description: String(get(1)),
          note: "No monthly budget amounts supplied",
        });
    });
    return {
      filename,
      file_hash: digest(file),
      year,
      currency,
      fx_rate: fx,
      source: raw,
      rows: rows.map((r) => ({
        ...r,
        duplicate: !!this.s.get(
          "SELECT id FROM expense_import_rows WHERE entity_id=? AND source_key=?",
          e,
          r.source_key,
        ),
      })),
      excluded_sheets: wb.getWorksheet("Contributions")
        ? ["Contributions"]
        : [],
      warnings: [
        "Historical rows require review before posting. Summary formulas are reference data only.",
        "Blank budgets are not zero. Source currency conversions use the saved workbook rate, not a live market rate.",
      ],
    };
  }
  async stage(
    a: Actor,
    e: string,
    file: Buffer,
    filename: string,
    year: number,
  ) {
    const preview = await this.preview(a, e, file, filename, year);
    return this.s.tx(() => {
      const old = this.s.get(
        "SELECT id,source_json FROM expense_import_batches WHERE entity_id=? AND file_hash=?",
        e,
        preview.file_hash,
      );
      if (old) {
        if (JSON.parse(old.source_json).year !== year)
          throw new DomainError(
            "This workbook was already imported for a different source year. Review its existing batch.",
            409,
          );
        return { id: old.id, added: 0, duplicate: true };
      }
      const id = randomUUID();
      this.s.run(
        "INSERT INTO expense_import_batches VALUES(?,?,?,?,?,?,?)",
        id,
        e,
        filename,
        preview.file_hash,
        JSON.stringify({
          year,
          source: preview.source,
          warnings: preview.warnings,
        }),
        a.id,
        new Date().toISOString(),
      );
      let added = 0;
      for (const r of preview.rows) {
        if (r.duplicate) continue;
        this.s.run(
          "INSERT INTO expense_import_rows(id,batch_id,entity_id,source_key,kind,data) VALUES(?,?,?,?,?,?)",
          randomUUID(),
          id,
          e,
          r.source_key,
          r.kind,
          JSON.stringify(r.data),
        );
        added++;
      }
      this.s.audit(e, a, "expense_import.staged", id, {
        filename,
        added,
        excluded: preview.excluded_sheets,
      });
      return { id, added, duplicate: false };
    });
  }
  review(a: Actor, e: string, id: string, input: any) {
    this.access(a, e, true);
    const p = z
      .object({
        revision: z.number().int().min(0),
        action: z.enum(["save", "exclude", "restore", "post", "link"]),
        reason: z.string().trim().min(3).max(2000),
        data: z.record(z.string(), z.unknown()).optional(),
        target_id: z.string().optional(),
      })
      .safeParse(input);
    if (!p.success)
      throw new DomainError(
        "Choose an action, current revision and review reason",
      );
    return this.s.tx(() => {
      const row = this.rows(a, e).find((r) => r.id === id);
      if (!row) throw new DomainError("Import row not found", 404);
      if (row.revision !== p.data.revision)
        throw new DomainError("Row changed. Reload before editing.", 409);
      if (["posted", "linked"].includes(row.status))
        throw new DomainError(
          "Use the existing record’s audited correction workflow",
        );
      const data = {
        ...row.data,
        ...p.data.data,
        source_sheet: row.data.source_sheet,
        source_row: row.data.source_row,
        source_column: row.data.source_column,
      };
      if (
        !month.test(data.period || "") &&
        ["expense", "budget"].includes(row.kind) &&
        ["post", "link"].includes(p.data.action)
      )
        throw new DomainError("Enter an accounting month");
      let status = p.data.action === "exclude" ? "excluded" : "review",
        target: string | null = null;
      if (["post", "link"].includes(p.data.action)) {
        if (
          !Number.isSafeInteger(data.amount_minor) ||
          data.amount_minor < 0 ||
          data.amount_minor > 1e12
        )
          throw new DomainError("Enter a valid converted amount");
        if (!Object.hasOwn(categories, data.category))
          throw new DomainError("Choose an accounting category");
        if (
          !["Operations", "Product", "Marketing", "Finance"].includes(
            data.department,
          )
        )
          throw new DomainError("Choose a department");
        if (p.data.action === "link") {
          const existing =
            row.kind === "expense"
              ? this.s.get(
                  "SELECT * FROM bookkeeping_records WHERE id=? AND entity_id=? AND voided=0",
                  p.data.target_id || "",
                  e,
                )
              : this.s.get(
                  "SELECT * FROM budgets WHERE id=? AND entity_id=?",
                  p.data.target_id || "",
                  e,
                );
          if (!existing || !["expense", "budget"].includes(row.kind))
            throw new DomainError(
              "Choose an existing expense or budget in this entity",
            );
          if ((existing.period || existing.date.slice(0, 7)) !== data.period)
            throw new DomainError("Existing record belongs to another month");
          target = existing.id;
          status = "linked";
        } else if (row.kind === "expense") {
          if (!validDate(data.date) || data.date.slice(0, 7) !== data.period)
            throw new DomainError(
              "Confirm the actual expense date within the accounting month",
            );
          if (!["paid", "unpaid"].includes(data.payment_status))
            throw new DomainError(
              "Confirm whether this expense is paid or unpaid",
            );
          if (data.paid_from && data.paid_from !== "Company")
            throw new DomainError(
              "Personally paid bills must be recorded through Reimbursements, then linked here",
            );
          if (!Number.isFinite(data.fx_rate) || data.fx_rate <= 0)
            throw new DomainError("Confirm the historical conversion rate");
          const expected =
            data.currency ===
            this.s.get("SELECT currency FROM entities WHERE id=?", e).currency
              ? data.original_minor
              : Math.round(
                  data.currency === "USD"
                    ? data.original_minor * data.fx_rate
                    : data.original_minor / data.fx_rate,
                );
          if (
            !["USD", "NGN"].includes(data.currency) ||
            !Number.isSafeInteger(data.original_minor) ||
            expected !== data.amount_minor
          )
            throw new DomainError(
              "Original amount, currency and exchange rate must reconcile to the converted amount",
            );
          const duplicates = this.s.all(
            "SELECT id FROM bookkeeping_records WHERE entity_id=? AND substr(date,1,7)=? AND amount_minor=? AND lower(trim(payee))=lower(trim(?)) AND voided=0",
            e,
            data.period,
            data.amount_minor,
            data.payee,
          );
          if (duplicates.length)
            throw new DomainError(
              `Possible duplicate. Review and link existing record ${duplicates[0].id}`,
              409,
            );
          const record = new BookkeepingService(this.s).record(a, {
            entity_id: e,
            kind: "expense",
            description: data.description,
            payee: data.payee,
            category: data.category,
            department: data.department,
            amount_minor: data.amount_minor,
            date: data.date,
            due_date: data.due_date || data.date,
            note: `${data.note || ""}\nImported ${row.filename} · ${data.source_sheet} row ${data.source_row}. ${data.currency} ${(data.original_minor / 100).toFixed(2)}; rate ${data.fx_rate}. ${p.data.reason}`,
            request_key: randomUUID(),
            payment:
              data.payment_status === "paid"
                ? {
                    amount_minor: data.amount_minor,
                    date: data.payment_date,
                    reference: data.payment_reference,
                    method: data.payment_method || "Bank transfer",
                    note: "Historical payment confirmed during import",
                  }
                : undefined,
          });
          target = record.id;
          status = "posted";
        } else if (row.kind === "budget") {
          throw new DomainError(
            "Apply budget groups using the budget import action",
          );
        } else
          throw new DomainError(
            "Reference and money-in rows are preserved for review; they cannot be posted as expenses",
          );
      }
      this.s.run(
        "UPDATE expense_import_rows SET data=?,status=?,target_id=?,revision=revision+1 WHERE id=?",
        JSON.stringify(data),
        status,
        target,
        id,
      );
      this.s.audit(e, a, `expense_import.${p.data.action}`, id, {
        before: row.data,
        after: data,
        reason: p.data.reason,
        target_id: target,
      });
      return this.rows(a, e).find((r) => r.id === id);
    });
  }
  applyBudgets(a: Actor, e: string) {
    this.access(a, e, true);
    return this.s.tx(() => {
      const rows = this.rows(a, e).filter(
        (r) => r.kind === "budget" && r.status === "review",
      );
      const groups = new Map<string, any[]>();
      for (const r of rows) {
        const d = r.data;
        if (
          !month.test(d.period) ||
          !Object.hasOwn(categories, d.category) ||
          !["Operations", "Product", "Marketing", "Finance"].includes(
            d.department,
          ) ||
          !Number.isSafeInteger(d.amount_minor) ||
          d.amount_minor < 0
        )
          continue;
        const key = JSON.stringify([d.period, d.department, d.category]);
        groups.set(key, [...(groups.get(key) || []), r]);
      }
      let applied = 0;
      const conflicts: string[] = [];
      for (const [key, items] of groups) {
        const [period, department, category] = JSON.parse(key);
        if (
          this.s.get(
            "SELECT id FROM budgets WHERE entity_id=? AND period=? AND department=? AND category=?",
            e,
            period,
            department,
            category,
          )
        ) {
          conflicts.push(`${period} · ${department} · ${category}`);
          continue;
        }
        const amount_minor = items.reduce((n, r) => n + r.data.amount_minor, 0);
        const budget = new BudgetService(this.s).save(a, {
          entity_id: e,
          period,
          department,
          category,
          amount_minor,
          request_key: randomUUID(),
        });
        for (const r of items)
          this.s.run(
            "UPDATE expense_import_rows SET status='posted',target_id=?,revision=revision+1 WHERE id=?",
            budget.id,
            r.id,
          );
        applied += items.length;
      }
      this.s.audit(e, a, "expense_import.budgets_applied", e, {
        applied,
        conflicts,
      });
      return { applied, conflicts };
    });
  }
  report(
    a: Actor,
    e: string,
    from: string,
    to: string,
    category = "",
    department = "",
  ) {
    this.access(a, e);
    if (
      !validDate(from) ||
      !validDate(to) ||
      from > to ||
      Date.parse(to) - Date.parse(from) > 366 * 86400000
    )
      throw new DomainError("Select a valid range of at most one year");
    const currency = this.s.get(
      "SELECT currency FROM entities WHERE id=?",
      e,
    ).currency;
    const all = this.s
      .all(
        `SELECT j.id,j.date,j.description,j.idempotency_key,j.source_id,l.account,ac.name AS account_name,SUM(l.debit-l.credit) AS amount_minor,
      COALESCE(CASE WHEN j.idempotency_key LIKE '%:reversal' THEN json_extract(bc.before_json,'$.department') ELSE json_extract(bc.after_json,'$.department') END, CASE WHEN j.idempotency_key='record:'||r.id||':cost' THEN json_extract(first_c.before_json,'$.department') END,r.department,sp.department,'Unallocated') AS department, '' AS category,r.id AS record_id,COALESCE(r.payee,v.name,'') AS payee
      FROM journals j JOIN lines l ON l.journal_id=j.id JOIN accounts ac ON ac.entity_id=l.entity_id AND ac.code=l.account
      LEFT JOIN bookkeeping_corrections bc ON bc.entity_id=j.entity_id AND bc.kind='record' AND (j.idempotency_key='correction:record:'||bc.target_id||':'||bc.revision||':reversal' OR j.idempotency_key='correction:record:'||bc.target_id||':'||bc.revision||':replacement')
      LEFT JOIN bookkeeping_refunds bf ON bf.entity_id=j.entity_id AND (j.idempotency_key='record:'||bf.id||':refund' OR j.idempotency_key='record:'||bf.id||':refund-reversal')
      LEFT JOIN bookkeeping_records r ON r.entity_id=j.entity_id AND (j.idempotency_key='record:'||r.id||':cost' OR r.id=bc.target_id OR r.id=bf.record_id)
      LEFT JOIN bookkeeping_corrections first_c ON first_c.kind='record' AND first_c.target_id=r.id AND first_c.revision=1
      LEFT JOIN spends sp ON sp.id=j.source_id LEFT JOIN vendors v ON v.id=sp.vendor_id
      WHERE j.entity_id=? AND j.status='posted' AND ac.type='expense' GROUP BY j.id,l.account`,
        e,
      )
      .map((r) => ({
        ...r,
        category:
          r.category ||
          Object.keys(categories).find((k) => categories[k] === r.account) ||
          r.account_name,
      }));
    const match = (r: any) =>
      (!category || r.category === category) &&
      (!department || r.department === department);
    const expenses = all.filter(
      (r) => r.date >= from && r.date <= to && match(r),
    );
    let previousEnd = new Date(Date.parse(from) - 86400000)
      .toISOString()
      .slice(0, 10);
    const length =
      Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    let previousStart = new Date(Date.parse(from) - length * 86400000)
      .toISOString()
      .slice(0, 10);
    let comparisonLabel = "Previous equal-length period";
    const monthEnd = new Date(
      Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10);
    if (from.endsWith("-01") && to === monthEnd) {
      previousStart = previousEnd.slice(0, 7) + "-01";
      comparisonLabel = "Previous calendar month";
      if (from.slice(0, 7) === localDate().slice(0, 7)) {
        previousEnd =
          previousEnd.slice(0, 8) +
          String(
            Math.min(
              Number(localDate().slice(8)),
              Number(previousEnd.slice(8)),
            ),
          ).padStart(2, "0");
        comparisonLabel = "Previous month through the equivalent day";
      }
    }
    const prior = all.filter(
      (r) => r.date >= previousStart && r.date <= previousEnd && match(r),
    );
    const importRows = this.rows(a, e);
    const pending = importRows.filter(
      (r) =>
        r.status === "review" &&
        r.data.period >= from.slice(0, 7) &&
        r.data.period <= to.slice(0, 7) &&
        match(r.data),
    );
    const budgets = this.s
      .budgetsRaw(e)
      .filter(
        (r) =>
          r.period >= from.slice(0, 7) &&
          r.period <= to.slice(0, 7) &&
          match(r),
      );
    const payments = this.s
      .all(
        `SELECT p.id,p.record_id,p.date,p.reference,p.amount_minor,p.method,r.description,r.category,r.department,r.payee,m.bank_transaction_id FROM bookkeeping_payments p JOIN bookkeeping_records r ON r.id=p.record_id LEFT JOIN bookkeeping_bank_matches m ON m.payment_id=p.id WHERE p.entity_id=? AND p.voided=0 AND r.voided=0 AND p.date>=? AND p.date<=?`,
        e,
        from,
        to,
      )
      .filter(match);
    const refunds = this.s
      .all(
        `SELECT f.id,f.record_id,f.date,f.reference,-f.amount_minor AS amount_minor,f.method,r.description,r.category,r.department,r.payee,m.bank_transaction_id FROM bookkeeping_refunds f JOIN bookkeeping_records r ON r.id=f.record_id LEFT JOIN bookkeeping_bank_matches m ON m.refund_id=f.id WHERE f.entity_id=? AND f.voided=0 AND f.date>=? AND f.date<=?`,
        e,
        from,
        to,
      )
      .filter(match);
    const outstanding = this.s
      .all(
        `SELECT r.*,r.amount_minor-COALESCE((SELECT SUM(p.amount_minor) FROM bookkeeping_payments p WHERE p.record_id=r.id AND p.voided=0 AND p.date<=?),0) AS outstanding_minor FROM bookkeeping_records r WHERE r.entity_id=? AND r.voided=0 AND r.date<=?`,
        to,
        e,
        to,
      )
      .filter((r) => r.outstanding_minor > 0 && match(r));
    const byCategory = [
      ...new Set([
        ...expenses.map((r) => r.category),
        ...budgets.map((r) => r.category),
      ]),
    ].map((c) => {
      const b = budgets.filter((r) => r.category === c),
        actual = sum(
          expenses.filter((r) => r.category === c),
          "amount_minor",
        );
      return {
        category: c,
        actual_minor: actual,
        budget_minor: b.length ? sum(b, "amount_minor") : null,
        variance_minor: b.length ? sum(b, "amount_minor") - actual : null,
      };
    });
    const trend: any[] = [];
    const trendStart = new Date(from.slice(0, 7) + "-01T00:00:00Z");
    if (from.slice(0, 7) === to.slice(0, 7))
      trendStart.setUTCMonth(trendStart.getUTCMonth() - 5);
    const trendBudgets = this.s.budgetsRaw(e).filter(match);
    for (
      let d = trendStart;
      d.toISOString().slice(0, 7) <= to.slice(0, 7);
      d.setUTCMonth(d.getUTCMonth() + 1)
    ) {
      const period = d.toISOString().slice(0, 7),
        b = trendBudgets.filter((r) => r.period === period);
      trend.push({
        period,
        actual_minor: sum(
          all.filter((r) => r.date.startsWith(period) && match(r)),
          "amount_minor",
        ),
        budget_minor: b.length ? sum(b, "amount_minor") : null,
        historical_review_minor: importRows
          .filter(
            (r) =>
              r.status === "review" &&
              r.kind === "expense" &&
              r.data.period === period &&
              match(r.data),
          )
          .reduce((n, r) => n + (r.data.amount_minor || 0), 0),
      });
    }
    return {
      entity: e,
      currency,
      from,
      to,
      generated_at: new Date().toISOString(),
      comparison: {
        label: comparisonLabel,
        from: previousStart,
        to: previousEnd,
        actual_minor: sum(prior, "amount_minor"),
      },
      actual_minor: sum(expenses, "amount_minor"),
      budget_minor: budgets.length ? sum(budgets, "amount_minor") : null,
      cash_paid_minor: sum([...payments, ...refunds], "amount_minor"),
      outstanding_minor: sum(outstanding, "outstanding_minor"),
      historical_review_minor: pending
        .filter((r) => r.kind === "expense")
        .reduce((n, r) => n + (r.data.amount_minor || 0), 0),
      expenses,
      payments: [...payments, ...refunds],
      outstanding,
      budgets,
      by_category: byCategory,
      trend,
      pending,
      unmatched_payments: payments.filter(
        (r) => r.method !== "Cash" && !r.bank_transaction_id,
      ).length,
      review: this.s.get(
        "SELECT * FROM expense_month_reviews WHERE entity_id=? AND period=?",
        e,
        from.slice(0, 7),
      ) || { status: "open" },
      notes: [
        "Actuals use posted expense journal entries, including corrections and refunds.",
        "Cash and outstanding cards cover recorded bills and payroll; approval-workflow payments remain in Reporting & reconciliation.",
        "Budgets cover full calendar months touched by the selected range. Historical review amounts are unverified and excluded from actuals.",
        comparisonLabel +
          ". Trend rows show full calendar months; the current month contains recorded activity to date.",
        "Outstanding balances reflect current corrected records and payments through the selected end date.",
      ],
    };
  }
  close(a: Actor, e: string, input: any) {
    this.access(a, e, true);
    const p = z
      .object({
        period: z.string().regex(month),
        status: z.enum(["reviewed", "closed", "open"]),
        note: z.string().trim().min(5).max(2000),
      })
      .safeParse(input);
    if (!p.success)
      throw new DomainError("Choose a month, status and review note");
    const { period, status, note } = p.data;
    return this.s.tx(() => {
      if (status === "closed") {
        const end = new Date(
          Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0),
        )
          .toISOString()
          .slice(0, 10);
        if (end >= localDate())
          throw new DomainError("Close a month only after it has ended");
        const report = this.report(a, e, period + "-01", end);
        const unmatchedBank = this.s
          .bankTransactions(a, e)
          .filter(
            (b) =>
              b.date <= end &&
              b.date >= period + "-01" &&
              !b.matched_spend_id &&
              !b.matched_repayment_id &&
              !b.matched_refund_id &&
              !b.matched_recovery_id &&
              !b.matched_record_payment_id &&
              !b.matched_record_refund_id,
          );
        if (
          report.pending.length ||
          report.unmatched_payments ||
          unmatchedBank.length
        )
          throw new DomainError(
            "Resolve import review rows, unmatched bank transactions and non-cash payments before closing",
          );
      }
      this.s.run(
        "INSERT INTO periods VALUES(?,?,?) ON CONFLICT(entity_id,period) DO UPDATE SET status=excluded.status",
        e,
        period,
        status === "closed" ? "closed" : "open",
      );
      this.s.run(
        "INSERT INTO expense_month_reviews VALUES(?,?,?,?,?,?) ON CONFLICT(entity_id,period) DO UPDATE SET status=excluded.status,note=excluded.note,actor_id=excluded.actor_id,updated_at=excluded.updated_at",
        e,
        period,
        status,
        note,
        a.id,
        new Date().toISOString(),
      );
      this.s.audit(e, a, `expense_month.${status}`, period, { note });
      return { period, status };
    });
  }
  async workbook(
    a: Actor,
    e: string,
    from: string,
    to: string,
    category = "",
    department = "",
  ) {
    const r = this.report(a, e, from, to, category, department),
      w = new ExcelJS.Workbook();
    w.creator = "Jaye Finance";
    const sheet = (name: string, headers: string[], rows: any[][]) => {
      const s = w.addWorksheet(name);
      s.addRow(headers);
      for (const row of rows) s.addRow(row);
      s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      s.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF163D35" },
      };
      s.views = [{ state: "frozen", ySplit: 1 }];
      s.columns.forEach((c) => (c.width = 24));
      s.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, s.rowCount), column: headers.length },
      };
    };
    sheet(
      "Monthly Summary",
      ["Metric", "Value"],
      [
        ["From", from],
        ["Through", to],
        ["Currency", r.currency],
        ["Generated", r.generated_at],
        ["Status", r.review.status],
        ["Category", category || "All"],
        ["Department", department || "All"],
        ["Posted expenses", r.actual_minor / 100],
        ["Bill and payroll cash payments", r.cash_paid_minor / 100],
        ["Outstanding bills and payroll", r.outstanding_minor / 100],
        ["Budget", r.budget_minor === null ? "Not set" : r.budget_minor / 100],
        ["Historical review (unverified)", r.historical_review_minor / 100],
        ...r.notes.map((n) => ["Basis", n]),
      ],
    );
    sheet(
      "Expense Detail",
      [
        "Date",
        "Description",
        "Category",
        "Department",
        "Payee",
        "Amount",
        "Record ID",
        "Journal ID",
      ],
      r.expenses.map((x) => [
        x.date,
        x.description,
        x.category,
        x.department,
        x.payee,
        x.amount_minor / 100,
        x.record_id || x.source_id,
        x.id,
      ]),
    );
    sheet(
      "Budget vs Actual",
      ["Category", "Budget", "Actual", "Remaining"],
      r.by_category.map((x) => [
        x.category,
        x.budget_minor === null ? "Not set" : x.budget_minor / 100,
        x.actual_minor / 100,
        x.variance_minor === null ? "Not set" : x.variance_minor / 100,
      ]),
    );
    sheet(
      "Payments",
      ["Date", "Payee", "Reference", "Amount", "Method", "Bank match"],
      r.payments.map((x) => [
        x.date,
        x.payee,
        x.reference,
        x.amount_minor / 100,
        x.method,
        x.bank_transaction_id || "Unmatched",
      ]),
    );
    sheet(
      "Outstanding",
      ["Date", "Payee", "Description", "Outstanding"],
      r.outstanding.map((x) => [
        x.date,
        x.payee,
        x.description,
        x.outstanding_minor / 100,
      ]),
    );
    sheet(
      "Import Review",
      [
        "Source",
        "Sheet",
        "Row",
        "Type",
        "Month",
        "Description",
        "Currency",
        "Original amount",
        "FX rate",
        "Reporting amount",
        "Status",
      ],
      r.pending.map((x) => [
        x.filename,
        x.data.source_sheet,
        x.data.source_row,
        x.kind,
        x.data.period,
        x.data.description,
        x.data.currency,
        x.data.original_minor === null ? null : x.data.original_minor / 100,
        x.data.fx_rate,
        x.data.amount_minor === null ? null : x.data.amount_minor / 100,
        x.status,
      ]),
    );
    sheet(
      "Monthly Trend",
      ["Month", "Posted expenses", "Budget", "Historical review"],
      r.trend.map((x) => [
        x.period,
        x.actual_minor / 100,
        x.budget_minor === null ? "Not set" : x.budget_minor / 100,
        x.historical_review_minor / 100,
      ]),
    );
    return w.xlsx.writeBuffer();
  }
}
