# Implementation roadmap and acceptance gates

## Delivered: local spend/ledger foundation slice

Next/Nest workspace, persistent SQLite, two entity fixtures, synthetic identities, expenses/requests/bills, encrypted uploads, sequential approvals, commitments, test payment export/confirmation, statement debit import/exact matching, balanced immutable posted journals, source drill-down, management reports/CSV, vendor directory and hash-chained audit. Automated local invariant tests accompany these workflows.

## Finish Phase 0 and Phase 1 before claiming completion

- Human sign-off on OPEN_DECISIONS; expand chart, classification dimensions and expense policies.
- Production SSO/MFA and entity/department grants; PostgreSQL migrations, locks, app-role restrictions and concurrent invariants.
- Approved-scope draft editing, approval-time draft journals/accrual recognition, journal reversals and accounting-period close/reopen.
- Full PO, received goods/services, bill matching, recurring templates, missing-receipt affidavits, split-spend/perceptual duplicate policies, vendor bank changes and holds.
- Evidence scanner/OCR with human confirmation; camera PWA/offline queue/email intake.
- Bank accounts, credits, closing-balance validation, partial/failure/reversal payment tracking; provider-specific file/sandbox integration.
- Approved FX/tax handling; reports with date/dimension filters, cash flow, XLSX/PDF/evidence exports; performance, security, restore and complete golden datasets.

## Later phases, gated

2: agreements, capital/CCI, bilateral intercompany, USD consolidation/elimination/CTA, constant-currency, approved snapshots and board/data-room access.
3: commercial events, revenue/deferred revenue, AR, processor settlement and levy policy.
4: effective payroll packs, protected employee records, deterministic trace, segregated payroll/remittance flow and parallel run.
5: fixed assets/accruals/revaluation, feeds, compliance packs, full close, independent records and audit walkthrough; explicit CFO go-live.
6: configurable new entities, currencies, jurisdiction packs and product lines.

Nothing in this roadmap declares unimplemented work complete or permits skipping human exit gates. Staging/production infrastructure has not been modified.
