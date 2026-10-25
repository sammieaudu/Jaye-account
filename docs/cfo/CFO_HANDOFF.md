# CFO handoff

Implemented on `Jaye-financial-model`. Open **Planning & reports → Financial Model** in the existing application. The user authorized merging to main and deployment on 25 October 2026. Release validation passed again; production deployment is pending access to the existing Vercel and Railway projects. No money movement, external communications or production-record tests were performed.

## What is available

- Persistent services, effective-dated pricing, scenarios, assumptions, costs/hiring/marketing/capex, funding, allocations, KPI thresholds and source configuration. Drafts support edits, history, cloning where appropriate, archive/restore and unreferenced deletion.
- Lagos pilot defaults: 1 December 2026 through 28 February 2027, 90 inclusive days. Founder pricing is configured; courier fee remains blank. The NGN 65m planning midpoint never becomes received cash automatically.
- Pure daily financial engine with separate actual and forecast periods, earned/deferred subscription revenue, agent commissions, restricted settlement funds, collections, refunds, costs, payables, prepayments, depreciation and financing. P&L, balance sheet, cash flow, weekly/monthly/checkpoint views and service contribution use the same calculation output.
- Conservative/Base/Aggressive cases, independent funding sensitivity, frozen budgets and forecast snapshots. Unknown operations and expenses are not seeded with fictitious activity.
- Existing posted accounting integration, outstanding obligations and recurring vendor costs. Invoice receipts require an exact matching bridge; unresolved receipts remain exceptions. Campaign spend is attribution, not a second accounting expense.
- CSV upload/paste, column mapping, preview, row errors, transactional acceptance, retry-safe requests, revised drafts and source revisions. Accepted history and frozen snapshots are preserved.
- Authenticated JSON adapter contract, 30-second visible-workspace refresh, source freshness, coverage and reconciliation warnings. No third-party provider has been connected.
- Cohort maturity/retention, repeat usage, renewal, fulfilment/cancellation, attributed customer/driver CAC, driver earnings and configurable evidence thresholds.
- Downloadable 17-sheet formula-based Excel snapshot with editable volume, price, cost, quantity and funding inputs and active scenario selector. Actual source records and dates remain frozen. Add schedules/change dates in the application and export again; workbook edits never synchronize back.

## Verification

- `npm run typecheck`: API and web pass.
- `npm test`: 137 tests pass, including 24 financial tests and hosted individual-attribution checks.
- `npm run build`: API and optimized Next.js production build pass.
- Browser QA used a separate temporary SQLite database: navigation, funding creation/persistence, snapshot creation, Excel download, CSV preview/acceptance, provenance and narrow-screen layout. Existing screens remain in the original shell.
- Independent artifact-tool recalculation reconciled all three scenarios for both a full forecast fixture and a mixed actual/forecast fixture: monthly revenue/profit, 90-day revenue/profit/cash, operating/investing/financing cash and balance checks. Editing volume, price and cost quantity recalculated to the same engine results. No formula errors found. All 17 worksheet preview renders inspected.

Fixtures are synthetic verification data, not a Jaye forecast. No synthetic workbook is delivered as actual management accounts.

## Inputs and operating limitations

Opening balances, funding receipt evidence, actual service readiness, driver/customer cohorts, detailed spending, courier fee and tax applicability remain unconfirmed. Enter these through the workspace; results stay provisional until evidence is supplied. See OPEN_QUESTIONS.md and ASSUMPTION_REGISTER.csv.

Forecast assumptions represent mutually exclusive driver segments. The engine limits jobs by each segment's available hours; it does not infer the allocation of a shared driver pool across different service plans. Operations must allocate that pool before supplying segment counts. Actual subscription overlaps are rejected and actual identities are deduplicated.

Current PMF views do not establish product-market fit. Mature LTV and observed acquisition payback remain unavailable where evidence is insufficient. Tax is explicitly unresolved; the management model is not a statutory tax computation or audited statements. Asset additions/depreciation are modelled; detailed asset-register disposal and capitalized-development policy need accountant-approved source entries. Forecast rows do not post to the accounting ledger.

## Running and connecting

Use the repository's normal `npm run dev` command. Schema additions are initialized by FinanceStore; existing accounting tables are not replaced. Follow the existing database backup process before any later deployment.

In Data & reconciliation, create an operational source and download the CSV template or JSON contract. Dates are Lagos operating dates; amounts in adapter records are integer NGN kobo. Preview first, correct all errors, then accept. Same source/external ID plus a higher revision corrects an accepted record; use `void` revisions where appropriate. Dependencies must remain valid. Draft revisions create a replacement batch and retain the previous batch as superseded.

Hosted requests use verified Clerk identity forwarded only by the server gateway. API service credentials remain server-side. `JAYE_FINANCIAL_EDITORS` may restrict financial write access to comma-separated Clerk user IDs; other authenticated members then receive read-only access. Without that optional setting, the existing shared finance membership retains its edit permissions, with individual attribution for financial actions.

The exact HTTP schema and authentication notes are downloadable from the workspace. Configure a real upstream provider, its credentials, checkpoints and coverage only after its contract is known; the current adapter is not a running provider poller.

## Reproducing Excel validation

Run `npx tsx apps/api/test/export-financial-fixture.ts`, then run it with `JAYE_QA_DIR=/tmp/jaye-fm-validation/mixed JAYE_QA_MIXED=1`. Run `node apps/api/test/verify-financial-export.mjs` in an environment with `@oai/artifact-tool` available (or supply `JAYE_ARTIFACT_MODULE` pointing to its installed entry). This optional independent verifier is not a production dependency. It writes fixture workbooks, expected results, comparison results and sheet previews under `/tmp/jaye-fm-validation`.

Next management action: enter evidence-backed opening balances, dated funding, separate driver segments and cost schedules; import operational records; resolve exceptions; freeze the original budget. Deployment is authorized; complete it after access to the existing production projects is restored.
