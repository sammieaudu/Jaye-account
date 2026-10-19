# Local REST API

Base `/api` on port 3001; frontend rewrites it on port 3000. JSON except multipart receipt upload, receipt download and CSV exports. Sessions are HttpOnly cookies; an error returns `{message}` with 400/401/403/404. Production mode is refused at startup.

| Route | Purpose / authorized actors |
|---|---|
| GET /health | Public local health and synthetic marker |
| GET /demo/users; POST /demo/login `{user_id}` | LOCAL ONLY test identities/session |
| GET /me; POST /logout; GET /entities | Current session and authorized entities |
| GET /dashboard?entity= | Finance/CFO/manager/auditor/releaser/reconciler |
| GET /spends?entity= | Authorized entity; employee own records only |
| POST /spends | Expense/bill/request input; requester recorded from session |
| GET /spends/:id | Evidence metadata, policy checks, history and journals |
| POST /spends/:id/action | `{action,comment?,reference?}`; state/role/SoD enforced |
| POST /spends/:id/receipt | Multipart `file`; requester draft/returned only |
| GET /receipts/:id | Authorized encrypted-evidence download, audit logged |
| GET /vendors?entity=; POST /vendors | Directory; creation finance only |
| GET /budgets?entity= | Manager/finance/CFO/auditor |
| GET /journals?entity= | Finance/CFO/auditor/reconciler |
| GET /reports/trial-balance?entity= | Posted ledger aggregation |
| GET /audit?entity= | Finance/CFO/auditor; chain validity + latest 200 events |
| GET /exports/spend,trial-balance,payments?entity= | Role-scoped CSV, formula-safe cells |
| GET /banking/transactions?entity= | Finance/reconciler/CFO/auditor |
| POST /banking/import `{entity_id,csv}` | Finance/reconciler; atomic idempotent import |
| GET /investor/snapshots | Investor/CFO; empty until approved snapshot feature |

Spend body fields: entity_id, kind, vendor_id, description, purpose, amount_minor, currency, department, category, date, optional invoice_number and parent_id. See Zod schemas in `domain.ts`. Valid workflow actions: submit, approve, return, reject, schedule, confirm, reconcile, post. No public manual-journal or arbitrary-SQL endpoint exists. OpenAPI generation/typed client packaging remains a future deliverable.
