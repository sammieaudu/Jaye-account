# Jaye Finance

A working **local shadow environment** for GoJaye Inc. (USD) and GoJaye Nigeria Ltd (NGN). This is the first spend-and-ledger implementation slice from [the master brief](docs/MASTER_PROMPT.md), not the completed six-phase platform or approved books of record.

## Run locally

Requires Node.js 24.13+ (tested here on 25.6.1) and npm. Docker is optional.

```bash
npm ci
npm run dev
```

Open **http://localhost:3000**. The NestJS API listens on `127.0.0.1:3001`. Both services bind to loopback. No credentials, bank connection or Docker daemon are needed.

The app opens as **Amara Eze · Finance manager**. Use **Test as** in the top banner to switch among synthetic local identities. This is explicitly a test login mechanism, not SSO/MFA. All sample names, amounts, vendors, receipts and capital balances are synthetic. Records you enter here are also test records.

## What you can test

- Switch between the US parent and Nigerian subsidiary; consolidated group view explains its approval gate.
- Create expense claims, vendor bills and pre-approval spend requests; attach encrypted PDF/JPEG/PNG evidence.
- Submit → manager review → finance review → conditional CFO review → approved.
- Schedule a test payment; export an explicitly non-bank-executable CSV; confirm a simulated bank payment using a separate Payment releaser identity.
- Import debit statement CSVs in Payments; match an exact entity/currency/amount once as the Reconciler.
- Post the expense and settlement journals as Finance. Inspect trial balance, P&L and balance sheet; download spend and trial-balance CSVs.
- Review budgets, commitments, source documents, approvals and the verified hash-chained audit trail.
- Add vendors. Check that Investor and Technical admin identities cannot access financial records.

## A complete expense walkthrough

1. Select **Ada Okafor · Employee**, open Spend and create an expense in October 2026. Upload a synthetic receipt, open the saved draft and submit.
2. Select **Tunde Bakare · Department manager** → Approvals → approve it.
3. Select **Amara Eze · Finance manager** → Approvals → approve it. If the sample policy routes to CFO, approve separately as **Sam Adeyemi**.
4. As Finance, open Payments and schedule it. Export the test run if desired.
5. As **David Chen · Payment releaser**, open it and confirm a synthetic bank reference, such as `TEST-BANK-001`.
6. In Payments, import a CSV as Finance or Reconciler. Header: `reference,date,currency,amount_minor,description`. Use the transaction’s exact currency and amount in integer minor units (₦1,000 = 100000). A unique reference is required; a repeated identical import is skipped.
7. As **Zainab Bello · Reconciler**, open the paid expense and select the matching imported row. Reconcile.
8. As Finance, post its journals. The budget moves from committed to actual, the ledger bank balance decreases, and reports remain balanced.

A sample CSV for the seeded paid transaction is downloadable from Payments. A spend request reserves budget after approval; **Record matched bill** links an invoice to it without double-counting the commitment. Full PO/goods-receipt matching is not implemented yet.

## Checks

```bash
npm test
npm run typecheck
npm run build
```

`npm start` runs the compiled local build after `npm run build`. Do not set `NODE_ENV=production` on the API: it intentionally refuses production operation. The frontend can be built with `next build` and served with `next start`; the API remains in local shadow mode.

## Persistent data

`data/jaye.db` contains the SQLite database; evidence is encrypted under `data/*.enc`, with a local encryption key in `data/.evidence-key`. These are ignored by Git. Keep the directory private. Copy the entire directory, including the key, for a local backup **after stopping the app**. This is not a production key-management or recovery implementation. The database seeds once; restarting preserves your test records. Tests use isolated temporary databases and leave your local records untouched.

The Docker daemon was unavailable during setup. SQLite makes the local app usable without it. PostgreSQL, managed object storage, production identity and production controls remain explicit migration gates. See [discovery](ARCHITECTURE_DISCOVERY.md), [open decisions](OPEN_DECISIONS.md), [test plan](TEST_PLAN.md) and [roadmap](IMPLEMENTATION_ROADMAP.md).

## Scope limits

This is **not Phase 1 complete**. SSO/MFA, approved policy packs, arbitrary-currency FX, OCR/scanning, PWA offline submission, email intake, recurring bills, card feeds, full PO matching, bank balance validation, vendor-bank change controls, accrual-first posting, journal reversal UI, period-close UI, XLSX/PDF reports, PostgreSQL migration and production backup/restore are not complete. Payroll, tax calculations/filings, capital/CCI workflows, intercompany, consolidation, investor snapshot publication and live payment adapters are gated. No real money moves. See `IMPLEMENTATION_ROADMAP.md` for acceptance gates.
