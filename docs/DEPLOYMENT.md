# Hosted Jaye Finance

## Architecture

Vercel serves the Next.js app. Clerk handles sign-in. The server checks for an authenticated Clerk user on every API request, then forwards it to Railway using a server-only shared secret. The backend only accepts the authenticated gateway; demo sign-in is disabled. Every signed-in user has the same finance access to the shared workspace: they can view and edit records without an allowlist or administrator approval. Signed-out visitors cannot access records.

Railway runs one Node 24 instance with a persistent volume mounted at `/data`. SQLite, encrypted receipts and their encryption key stay together on that volume. Do not scale to multiple replicas, use an ephemeral filesystem or import the local database without explicitly deciding to migrate those records. A fresh deployment starts empty.

## Railway

Use the repository Dockerfile and railway.json. Attach a volume at `/data` before starting the service. Configure:

- `JAYE_MODE=hosted`
- `JAYE_DB_PATH=/data/jaye.db`
- `JAYE_API_SECRET`: randomly generated secret of at least 64 characters
- `NODE_ENV=production`

Create a Railway public domain for Vercel to call. `/api/health` is public; all financial endpoints require the gateway secret. Configure persistent-volume backups in Railway and perform a restore rehearsal before relying on it as the only copy of business records. The encryption key must be included in backups alongside the database and receipts.

## Vercel

Use `apps/web` as the project root, Next.js framework and Node 24. Connect the Clerk Hobby integration and set:

- `JAYE_MODE=hosted`
- `JAYE_API_URL`: Railway HTTPS origin, without trailing slash
- `JAYE_API_SECRET`: same server-only secret as Railway
- `JAYE_APP_ORIGIN`: exact public Vercel/custom origin, without trailing slash
- `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: supplied by Clerk

Never prefix the gateway secret or Clerk secret with `NEXT_PUBLIC_`. Never commit secrets. Set preview environments separately; don't point an unreviewed preview at the live financial database. Configure Clerk's production domain and allowed sign-in methods before launch. Users sign in personally through Clerk.

## Acceptance checks

1. Anonymous browser sees sign-in, not financial data.
2. A different signed-in account can read/write the same workspace without approval.
3. Direct backend requests and demo login fail, even with an old local session cookie.
4. Any signed-in user can record and revisit an expense through Vercel.
5. Restart the backend and verify the record and its attachment persist.
6. Refund/payment retries and bank matching leave reports balanced (automated regression suite).
7. Check backups and restore before importing existing records.

Vercel functions impose a request body limit; large attachments may need direct object-storage uploads in a later release. This remains a management-recordkeeping system: it does not calculate statutory payroll deductions or send bank payments.

## Receipt capture, categories and invoices — 20 October 2026

The next release adds `/api/categories` and `/api/sales-invoices` endpoints and additive SQLite tables. Deploy the API before the web app. Railway rejected this release upload with “Deploys have been paused temporarily”; the official status page confirmed a build outage. The existing live frontend was left unchanged. Resume backend deployment, verify its health and new authenticated endpoints, then deploy Vercel.

Validation: 112 automated tests passed; TypeScript and production builds passed. Browser checks verified image OCR suggestions, category creation, expense creation with its receipt attached, and branded invoice PDF export. The local test expense was voided to zero and the sample invoice cancelled; no live financial records were changed.

Receipt capture supports JPG/PNG OCR with review before saving; PDFs are attachment-only. New categories map to an existing accounting group. Customer invoices are numbered documents with draft/issued/cancelled states; they do not post revenue or record customer payments. Sharing uses the device share menu when supported, with PDF download as fallback. Invoice company details default to the contact details supplied by the user; bank instructions remain editable and blank by default.

### Release deployed; browser verification pending

The release through commit `54b1b6c` is now deployed:
- Railway: `83608554-73e6-4a24-9c40-55972f0fea97` — SUCCESS.
- Vercel: `dpl_EgM2dHZeU3ivdNmztHYDU1NbEnFP` — READY, aliased to https://jaye-finance.vercel.app.
- Backend health and authenticated category/invoice list endpoints returned HTTP 200. Anonymous requests to both backend and Vercel category/invoice endpoints returned HTTP 401.
- No database, receipts or encryption key were replaced. No live test records have been created in this release verification.
- Live browser verification is pending user sign-in. The in-app browser live tab was signed out. Do not redeploy this release merely because the monitoring automation runs again; resume browser checks after sign-in. Receipt attachment/OCR, category creation/reuse, invoice PDF export, persistence and cleanup remain to verify live.

### Live browser verification completed

Verified in the signed-in Chrome session on the production alias:
- PNG OCR extracted supplier, date, receipt reference and NGN 1,000 total. Saved one expense and its attachment, reloaded and reopened it, then downloaded the attachment; its bytes matched the source file.
- Created Office supplies category, reloaded and reused it in the expense correction form. Found a race where submitting the parent form during category creation retained the previous category; added native validation requiring category save/cancel before the record can submit. Verified this validation on production. Vercel follow-up release `jaye-finance-o3wv4718b-manoahumukoros-projects.vercel.app` is READY.
- Saved JAYE-00001 for a clearly labelled QA customer, two items at NGN 1,500 each, total NGN 3,000. Reopened after reload and exported a one-page PDF with the expected customer and total.
- Voided the test expense and cancelled the test invoice. Dashboard and expense totals returned to NGN 0; customer invoices did not add expense costs. Existing records were not altered. Office supplies remains as a reusable category, and test audit history is retained.
- TypeScript and Vercel production build passed. Browser export and save/persistence checks passed; device-specific native sharing was not exercised.

### Customer invoice payments

Invoice payments support partial receipts, currency-separated customer balances, received/balance figures on PDFs, payment history and voiding mistaken entries. Only issued invoices accept payments. Server transactions, request-key retries, revision checks, repeated-reference rejection and overpayment validation protect balances. Paid invoices cannot be cancelled until erroneous payments are voided. Customer receipts remain an invoice subregister; they do not yet post to the general ledger or match bank statements.

113 tests and production build passed. Railway deployment `adba7ff5-8b8d-4d59-b1bc-72e1fe27a969` succeeded. Vercel follow-up `dpl_2bz1oUfXj7GysaAZZmY5rn4ZzopN` is Ready and aliased to the live site; it avoids reporting a successful payment as failed when a subsequent list refresh has a network error. Live browser verification recorded 400 then 600 against a 1,000 test invoice, verified part-paid then paid and persistence after reload. Both test payments were voided and JAYE-00002 cancelled, leaving zero customer balances. No real receipts were changed.


### Financial Model release — 25 October 2026

The user authorized merging `Jaye-financial-model` into `main` and deployment. Release checks pass: 137 tests, API/web type checks and production build. The release adds the Financial Model workspace, additive SQLite tables, individual hosted financial attribution, CSV/API imports and formula-based Excel exports.

Deploy Railway first using the existing service and `/data` volume, verify health and the authenticated `/api/financial/contract?entity=ng` endpoint, then deploy the existing Vercel project (`jaye-finance`, team `manoahumukoros-projects`). Preserve all existing secrets, data and Clerk configuration. Do not create a replacement project.

Deployment is currently pending account access: the available Vercel CLI/browser account cannot access that team/project, and Railway is signed out. No production deployment has been triggered for this release. After access is restored, deploy both services and verify authenticated workspace access and anonymous denial. Financial business assumptions remain provisional; see `docs/cfo/CFO_HANDOFF.md`.

Release-check follow-up: the prior hosted test used the OS temp directory, which is `/tmp` on Linux and intentionally rejected in hosted mode. The isolated test now creates and removes its database beneath the test user's home directory; production validation is unchanged. Updated body-parser and the Nest Express patch, and pinned Multer 2.5.0 through a root override because Nest's pinned 2.4.0 has a high-severity advisory. Clean `npm ci` and the high-severity audit gate pass; ExcelJS's existing moderate uuid advisory remains reported.
