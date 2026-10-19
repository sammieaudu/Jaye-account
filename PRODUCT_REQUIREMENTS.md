# Product requirements and implementation status

Primary task: an employee records spend quickly, reviewers inspect evidence and budgets, separate payment/reconciliation actors settle it, and finance can trace reports back to evidence. Both entities remain separate; the group is not a third legal entity.

Implemented local slice: expense/bill/request drafts, receipt upload, submission, three review stages, rejection/return with reasons, synthetic payment-run export and confirmation, debit statement import and exact matching, final posting, trial balance/P&L/balance sheet, budget commitments, vendor directory, role restrictions and audit verification. Responsive desktop/mobile layouts use a persistent local backend.

Acceptance is limited to the implemented test scenarios in TEST_PLAN.md. Phase 1's full definition of done is NOT met: SSO/MFA, OCR/PWA, complete purchase-order/receipt matching, tax metadata, recurring bills, true bank exports and all report formats remain outstanding. Payroll/revenue/group/investor features require later phases and human policy approvals.

Usability: receipt upload accepts phone-selected PNG/JPEG/PDF under 8 MB. Typical submission time has not been measured. No claim of the 60-second target or offline capture is made.
