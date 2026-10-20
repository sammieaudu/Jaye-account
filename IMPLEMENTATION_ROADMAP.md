# Implementation roadmap and acceptance gates

## Delivered: local spend/ledger foundation slice

Next/Nest workspace, persistent SQLite, two entity fixtures, synthetic identities, expenses/requests/bills, encrypted uploads, sequential approvals, commitments, test payment export/confirmation, statement debit import/exact matching, balanced immutable posted journals, source drill-down, management reports/CSV, vendor directory and hash-chained audit. Automated local invariant tests accompany these workflows.

## Expense foundation added

Company-direct, employee-paid and founder-paid expense metadata; original payment references/methods; invoice and due dates; requester draft/returned editing with audited changes and revision conflicts; separate approval/settlement display; expense filters and expanded CSV; reimbursement payee exports and beneficiary segregation; already-paid company payment verification without duplicate export. Approval-time accruals and category splits remain outstanding.

## Reimbursement workflow added

Grouped draft claims, atomic submission and reviews, aggregate CFO threshold, return/reject and audited membership editing. Per-person balances include grouped and individual expenses. Partial repayments reserve funds when scheduled, reduce operational balances when confirmed, require exact statement reconciliation, and post settlement journals independently. Group expenses are recognized once at first scheduling; budgets and reports use recognized expenses. Self-payment, duplicate grouping, overpayment and reused references are blocked. Founder and employee personal purchases share the workflow. Payments remain synthetic; reversals and approval-time accruals remain future work.

## Subscription tracking added

Subscription register with ownership, plan/seats, payment labels, renewal/cancellation deadlines and monthly/annual/custom-day schedules. On-screen charge forecasts, monthly equivalents and renewal/missing-invoice/price-change alerts. Each billing cycle links to one existing expense or explicitly created draft invoice, with retry protection and no forecast double-counting. Versioned terms preserve prior billing on pause, resume, cancellation and price changes; non-renewing estimates stop at the end date. No vendor sync, background invoice generation or external reminder delivery is implemented.

## Finish Phase 0 and Phase 1 before claiming completion

- Human sign-off on OPEN_DECISIONS; expand chart, classification dimensions and expense policies.
- Production SSO/MFA and entity/department grants; PostgreSQL migrations, locks, app-role restrictions and concurrent invariants.
- Approval-time draft journals/accrual recognition, journal reversals and accounting-period close/reopen.
- Full PO, received goods/services, bill matching, recurring templates, missing-receipt affidavits, split-spend/perceptual duplicate policies, vendor bank changes and holds.
- Evidence scanner/OCR with human confirmation; camera PWA/offline queue/email intake.
- Bank accounts, credit-note adjustments, closing-balance validation, partial/failure/reversal payment tracking; provider-specific file/sandbox integration.
- Approved FX/tax handling; reports with date/dimension filters, cash flow, XLSX/PDF/evidence exports; performance, security, restore and complete golden datasets.

## Later phases, gated

2: agreements, capital/CCI, bilateral intercompany, USD consolidation/elimination/CTA, constant-currency, approved snapshots and board/data-room access.
3: commercial events, revenue/deferred revenue, AR, processor settlement and levy policy.
4: effective payroll packs, protected employee records, deterministic trace, segregated payroll/remittance flow and parallel run.
5: fixed assets/accruals/revaluation, feeds, compliance packs, full close, independent records and audit walkthrough; explicit CFO go-live.
6: configurable new entities, currencies, jurisdiction packs and product lines.

Nothing in this roadmap declares unimplemented work complete or permits skipping human exit gates. Staging/production infrastructure has not been modified.

## Expense milestone 4 — implemented locally

- Current outstanding vendor bills and approved/pending balances, with overdue and missing-date visibility.
- Per-person reimbursement ageing (current, 1–30, 31–60, 61–90, 90+) and individual expense drill-down, using remaining balances after partial repayments.
- 30/90/365-day recurring forecasts with actual invoice replacement and explicit overlap disclosure.
- Refund register against settled/posted expenses, partial refunds, cancellation before matching, duplicate-reference/cumulative-cap checks, independent credit matching and idempotent journal posting.
- Debit/credit statement import with legacy debit defaults, one-use matching, unmatched cash rows and payments/refunds awaiting posting.
- Per-view CSV exports, entity/role restrictions, ledger-derived net cost metrics, transactional audit history and regression coverage.

Deferred: refund reversals, historical reporting snapshots, full bank balance reconciliation, richer filters and XLSX/PDF exports. These controls remain local synthetic implementations and do not remove production gates above.


### Milestone 4 extension — credits and personal refunds

Implemented local document verification and posting of unpaid vendor credit notes and refunds received by employees/founders. Original expense values are retained; net balances propagate through repayments, payment files, reconciliation, forecasts and reports. Excess personal refunds create a separately reported receivable instead of offsetting unrelated claims. Pending adjustments hold payment scheduling, in-flight payments block adjustment creation, and combined refund/credit caps prevent double reduction. Posted-adjustment reversal and document-file upload for adjustment evidence remain deferred (supporting document references are recorded and independently verified).


### Recovery settlement — implemented locally

Own-person repayment entry for employees/founders, Finance entry on behalf of a debtor, partial repayments with reserved capacity, cancellation before matching, independent exact bank-credit reconciliation, and idempotent receivable clearing. Current debts update across expense positions, claim balances, reports and the dedicated Recoveries screen. Original recoverable balances and complete repayment/audit history remain visible after clearing. Shared bank-credit reuse checks cover vendor refunds and recoveries. Transfers spanning multiple obligations, matched/posted recovery reversal, attachments and live bank integrations remain deferred.
