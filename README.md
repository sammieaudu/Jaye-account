# Jaye Finance

A working **local shadow environment** for GoJaye Nigeria Ltd (NGN). This is the first spend-and-ledger implementation slice from [the master brief](docs/MASTER_PROMPT.md), not the completed six-phase platform or approved books of record.

## Run locally

Requires Node.js 24.13+ (tested here on 25.6.1) and npm. Docker is optional.

```bash
npm ci
npm run dev
```

Open **http://localhost:3000**. The NestJS API listens on `127.0.0.1:3001`. Both services bind to loopback. No credentials, bank connection or Docker daemon are needed.

The app starts with an **empty workspace** and a local **Workspace owner** account. The workspace uses GoJaye Nigeria Ltd only, with its chart of accounts, but no sample employees, vendors, transactions, budgets, subscriptions or opening balances are loaded. The owner is a bootstrap account, not SSO/MFA. Real team accounts and approval-policy setup are still required before operational use. Bank transfers are not connected. Synthetic fixtures remain only for isolated automated tests; the historical test walkthrough below requires those fixtures and does not describe the empty workspace.

## Everyday bookkeeping

The main navigation now starts with Overview, Expenses, Employees, Payroll and Reports. Advanced approval queues, reimbursements, recoveries and the ledger are under **More tools**.

- **Vendors:** use Vendors → Add vendor to save a supplier name and category. Saved suppliers appear in the Expenses supplier selector; names can still be entered directly for one-off purchases. Duplicate names are rejected within the company. Engineering is now called Product in department choices.
- **Expenses:** enter a supplier name directly, the cost and date. An unpaid bill is simply a record with no payment yet. For an employee-funded purchase, select the person owed. Record partial repayments on the original record, not as a second expense.
- **Employees:** add staff or founders, an automatically assigned staff ID (JAYE-0001 onwards), department, start date and agreed monthly salary. These records do not create login accounts. Editing a salary only changes the default for future salary records; historical records retain their amounts and names.
- **Payroll:** record one agreed salary per person and month, then add payments and references. Payroll here documents agreed amounts; it does not calculate gross-to-net pay, statutory taxes, deductions or filings.
- **Documents:** attach encrypted PDF/JPEG/PNG receipts, payslips and payment confirmations from a saved record.
- **Reports:** the Recorded expenses & payroll report shows cost, payments and outstanding balances, with CSV export. Costs enter the ledger once at recording; payments debit the payable and credit bank or cash. Salary costs use account 6700. Budgets include these costs by department/category/record month.

Only finance can enter these documentation records. They record existing obligations or payments and do not execute transfers or replace approval of future spending. New accounting months initialize open on the first record; already closed periods stay blocked. Corrections are available from record details and each payment row. A reason is required; the original journal is reversed and its replacement is posted atomically. A zero amount voids an erroneous entry; it does not record a refund. Both original and corrected periods must be open. Revision checks prevent stale overwrites and request keys prevent duplicate correction postings. Correction history is immutable. Bank-statement matching for this new documentation register is not yet exposed; the existing advanced refund/reconciliation flows apply to approval-workflow records. Do not re-enter the same cost in both registers.

## What you can test

- The normal workspace is fixed to GoJaye Nigeria Ltd in NGN. Existing records for other entities are retained but unavailable through this workspace; a fresh database initializes only Nigeria. Multi-entity fixtures remain isolated to tests.
- Create expense claims, vendor bills and pre-approval spend requests; attach encrypted PDF/JPEG/PNG evidence.
- Submit → manager review → finance review → conditional CFO review → approved.
- Schedule a test payment; export an explicitly non-bank-executable CSV; confirm a simulated bank payment using a separate Payment releaser identity.
- Import debit statement CSVs in Payments; match an exact entity/currency/amount once as the Reconciler.
- Post the expense and settlement journals as Finance. Inspect trial balance, P&L and balance sheet; download spend and trial-balance CSVs.
- Review budgets, commitments, source documents, approvals and the verified hash-chained audit trail.
- Add vendors. Check that Investor and Technical admin identities cannot access financial records.

## Expense foundation (milestone 1)

Spend now records company-direct, employee-paid and founder-paid purchases. Personal purchases require a named reimbursement recipient, original payment date and method. Founder purchases here are repayable business expenses, not loans or capital contributions. Company purchases may be unpaid or already paid; already-paid records require an original reference, are excluded from payment exports, and must be verified against that reference before reconciliation.

Requesters can edit their own draft or returned records. Receipts remain attached, field changes are audited, concurrent stale edits are rejected, and submitted records are locked. Approval and settlement are shown separately, with outstanding amounts and evidence counts. Filter Spend by payment source, category, dates, missing receipts or approved reimbursements due; search also covers invoice numbers and reimbursement recipients. CSV exports include all accessible entity expenses, regardless of screen filters.

The existing full-payment simulation now names personal reimbursement recipients in exports and prevents those recipients from approving or releasing their own reimbursement. Grouped claims and partial reimbursements are available as described below. Category splits and approval-time accruals remain future work. Subscription tracking is described below. Existing sample records retain their company-payment workflow. Database migration 4 preserves existing records and adds expense metadata.

## Reimbursements (milestone 2)

Open **Reimbursements** to see each employee or founder's pending expenses, approved outstanding balance, scheduled repayments, confirmed reimbursements and oldest unpaid expense. Totals are entity/currency-specific and include both grouped and individual personal expenses. Employees see their own records, including expenses submitted on their behalf.

1. Create personal expense drafts with receipts in Spend. Choose employee-paid or founder-paid and the person owed.
2. As their requester, choose **New claim** and select draft/returned expenses for the same person, payment source, entity and currency. An expense can only belong to one claim. Draft/returned claims can change membership; submitted claims are locked.
3. Submit the whole claim. Manager and Finance review it; the combined claim amount (and item policies) can require CFO review. Missing evidence or failed checks roll back the entire submission. A returned claim retains history and can be corrected and resubmitted.
4. As a separate Finance identity, schedule any positive amount up to the approved unscheduled balance. This reserves the amount but does not reduce what is owed. Scheduled repayments can be cancelled; cancelled records remain in history. Payment CSVs include scheduled claim repayments with the person's name.
5. A separate Payment releaser confirms a synthetic bank reference. The balance falls only when confirmed. A Reconciler matches an imported statement debit for that repayment's exact amount and currency; Finance posts it. Repeat for the remaining balance.

On the **first scheduling**, the full approved expense liability is recorded once using each expense date. Each posted repayment then reduces the payable and bank account using the repayment date. Budgets and category totals reflect recognized expenses even while only partly reimbursed. This is not approval-time recognition. Operational confirmed balances can differ from ledger balances until repayment journals are posted. Repayment allocations follow expense date then record ID, and the record shows each item's remaining balance.

Grouped items cannot be paid again through individual expense actions. Over-scheduling, reused references/statement rows, cross-entity grouping and self-approval/release are blocked. There are no live transfers, FX repayments, reimbursement reversals or bank-provider integration in this local slice.

## Subscriptions (milestone 3)

Open **Subscriptions** for the recurring bill register, owner filters, upcoming payments and renewal/cancellation reminders. Each subscription records its vendor, responsible person, plan, seats, **total price per billing cycle**, entity/currency, department/category, purpose, payment method/account label, billing dates and renewal details.

- Monthly and annual billing preserve the original day across short months and leap years. Custom schedules use 1–365 day intervals. Monthly cost equivalents are estimates (custom intervals use 365.25 days per year), not ledger entries or amounts multiplied by seat count.
- Expected charges are calculated automatically when the view is opened for 30, 90 or 365 days, with historical missing invoices shown as overdue. No expense or ledger entry is generated merely by forecasting a bill.
- **Record invoice** creates one draft bill linked to that billing cycle. Attach evidence, then use the existing approvals and payment workflow. Alternatively, link an existing vendor expense, including an employee/founder-paid purchase, without creating another expense. A bill can belong to only one cycle. Rejected invoices can be explicitly replaced while their original expense and audit history remain.
- Forecasts use the actual outstanding amount when an invoice is linked, replacing the estimate once. Confirmed payments/reimbursements reduce the forecast. An invoice due before its billing cycle remains in the appropriate payment horizon. Rejected invoices revert to the expected obligation until replaced.
- Reminders appear **inside the app** for renewal/cancellation dates within 30 days, missing invoice records/evidence, price differences and charges outside the active schedule. No email reminders, vendor sync, background invoice job or live payment connection is configured.
- Pausing/cancelling closes future expected billing from today; old obligations and recorded invoices remain. Resume requires an explicit next billing date, avoiding catch-up charges for paused time. Price/schedule changes preserve earlier terms and linked invoices. With auto-renew disabled, estimates stop at the renewal/end date; this does not cancel service with the vendor.
- Owners and creators can view related invoices; Finance/CFO can manage entity subscriptions. Employee users only see subscriptions they own or created. Vendor, entity and currency stay fixed after registration, and stale edits are rejected.

The register and reminders use Africa/Lagos calendar dates. Initial billing anchors are limited to ten years either side of today. This remains local synthetic tracking, not automatic billing or statutory accounting.

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

`data/jaye.db` contains the SQLite database; evidence is encrypted under `data/*.enc`, with a local encryption key in `data/.evidence-key`. These are ignored by Git. Keep the directory private. Copy the entire directory, including the key, for a local backup **after stopping the app**. This is not a production key-management or recovery implementation. The database initializes its empty configuration once; restarting preserves your entered records and does not add demo data. Tests use isolated temporary databases and leave your local records untouched.

The Docker daemon was unavailable during setup. SQLite makes the local app usable without it. PostgreSQL, managed object storage, production identity and production controls remain explicit migration gates. See [discovery](ARCHITECTURE_DISCOVERY.md), [open decisions](OPEN_DECISIONS.md), [test plan](TEST_PLAN.md) and [roadmap](IMPLEMENTATION_ROADMAP.md).

## Scope limits

This is **not Phase 1 complete**. SSO/MFA, approved policy packs, arbitrary-currency FX, OCR/scanning, PWA offline submission, email intake, automated recurring bill generation, card feeds, full PO matching, bank balance validation, vendor-bank change controls, accrual-first posting, journal reversal UI, period-close UI, XLSX/PDF reports, PostgreSQL migration and production backup/restore are not complete. Statutory payroll calculations, tax calculations/filings, capital/CCI workflows, intercompany, consolidation, investor snapshot publication and live payment adapters are gated. No real money moves. See `IMPLEMENTATION_ROADMAP.md` for acceptance gates.

## Expense milestone 4 — reporting and reconciliation

Reports now includes outstanding vendor bills, reimbursement ageing by person and expense, 30/90/365-day recurring forecasts, cash refunds, and reconciliation exceptions. Each view exports CSV. Balances are current as of the Lagos calendar date, scoped to one legal entity and its currency. Pending approval is separate from approved amounts owed. Reimbursement ageing starts at the original personal payment date and uses the remaining balance after confirmed partial repayments. Undated vendor bills remain visible in a separate bucket.

Forecasts reuse subscription cycles: an invoice replaces its estimate, and a settled invoice drops out. Forecast totals overlap outstanding balances and must not be added to them. Posted costs use the ledger; repayments settle payables and do not create another expense.

To test refunds: in Reports → Refunds as Finance, select a fully settled, posted expense and record a partial or full refund received by Jaye. Import its positive bank credit in Payments with an optional `direction` CSV column (`credit` or `debit`; omitted means debit). Switch to Reconciler and match the exact amount, currency, entity and received date. Switch to Finance and post the refund. It debits cash and credits the original expense category once; the original expense and audit history remain intact. Pending refunds reserve the refundable amount without reducing costs. Total non-cancelled refunds cannot exceed the original expense. Pending refunds may be cancelled; matched/posted refunds cannot be edited. Closed accounting periods block posting.

Historical balance snapshots, bank closing-balance validation and external bank feeds are not included. Credit notes and personal refunds use the adjustment workflow below; they must not be entered as cash returned to Jaye.


## Credit notes and personal refunds

Reports → **Credits & personal refunds** records vendor credit notes against unpaid approved company bills, and refunds received by the original employee/founder against approved personal expenses. Finance supplies the amount, date, unique reference, reason and supporting document reference. A separate Reconciler verifies the document; Finance then posts the adjustment. The original invoice remains unchanged. Pending/verified adjustments hold payment scheduling until posted or cancelled; scheduled or unposted payments must be cancelled or completed before recording an adjustment.

Posting recognizes the original expense once if needed, then credits its expense category and debits the remaining payable. Any personal refund above the expense’s unpaid balance debits account 1200 (refunds recoverable from employees/founders). No Jaye bank movement is recorded. Amounts due back remain visible by person in Reports and Reimbursements and do not silently offset other expenses. Recoveries now handles partial repayments and clearing those receivables; reversing posted adjustments remains outside this slice.

Net balances flow into payment exports, exact bank-debit matching, grouped repayment allocations, subscription forecasts, expense CSVs and budget actuals. Original amounts remain available for audit. Combined cash refunds, credit notes and personal refunds, including pending records, cannot exceed the original expense. Duplicate references across adjustment/refund workflows are rejected. Posting is transactional, retry-safe and requires open accounting periods; fully credited expenses settle with zero cash. Test records and supporting references are synthetic.


## Recovery repayments

Open **Recoveries** to see original recoverable amounts, posted recoveries, the balance still owed and pending amounts awaiting bank matching or posting. Employees see and record their own transfers; founders using their CFO identity can record their own transfers too. Finance can record a repayment on behalf of a debtor. Each transfer is linked to one originating personal-refund adjustment; several partial repayments can settle it. Transfers covering multiple recovery balances require separately identified statement rows; split bank matching is not supported.

1. Record a transfer already made, with its amount, date, transfer reference and note. Pending repayments reserve capacity but do not clear the debt. The recorder or Finance can cancel an unmatched pending record, releasing that capacity without deleting history.
2. Import a synthetic bank statement credit from Payments. A Reconciler who is neither the debtor nor the recorder matches the exact entity, currency, amount and date. Credits already used for a vendor refund or another recovery cannot be reused.
3. A separate Finance user posts the recovery: debit bank 1100, credit recovery receivable 1200. This clears that portion of the debt in Recoveries, Reports, Reimbursements and expense details. It never credits an expense or changes the original reimbursement again.

Posting is transactional, retry-safe and blocked in closed periods. Pending plus posted repayments cannot exceed the original recoverable amount. Matched repayments cannot be cancelled, and posted records are immutable. Reversing a matched/posted recovery and direct bank integrations remain outside this local synthetic workflow.

### Refunds and bank matching for accountant records

Expense and salary details now include **Refunds & money returned** and **Bank reconciliation**. Record only money actually returned to Jaye. A refund reduces net expense cost and net money paid, leaving any previously unpaid balance unchanged. Partial refunds are capped to money paid and remaining cost. Refunds received by someone else, unpaid credit notes and payroll deductions are separate workflows, not this action.

Import the bank CSV from the record, then select the matching debit for a payment or credit for a refund. Matches require the same entity, currency, date and amount. Matching and unmatching create audit events, never additional financial journals. A statement entry cannot also match an approval-workflow payment, reimbursement, refund or recovery. Cash entries do not require bank matching.

Remove an incorrect match with a reason. A mistaken refund can be reversed after removing its match; its history is retained and the original period must be open. Payments must be unmatched before correction. Records with active refunds are protected from correction until a mistaken refund is reversed. Refunds appear in operational reports, net record totals, subscription balances and the refund month's budget actuals. `apps/api/test/record-settlement.test.ts` covers accounting, permissions, retry protection, closed periods and cross-workflow bank matching.
