# CFO handoff

Initial release merged to `main`; the custom-period and budget-CRUD follow-up is implemented locally on `main`. Open **Planning & reports → Financial Model** in the existing application. The user authorized merging to main and deployment on 25 October 2026. Release validation passed again; production deployment is pending access to the existing Vercel and Railway projects. No money movement, external communications or production-record tests were performed.

## What is available

- Persistent services, effective-dated pricing, scenarios, assumptions, costs/hiring/marketing/capex, funding, allocations, KPI thresholds and source configuration. Drafts support edits, history, cloning where appropriate, archive/restore and unreferenced deletion.
- Custom inclusive start/end dates support 1–366 days. Legacy configurations retain their original 90-day end date. Statements, checkpoints and Excel exports follow the selected window; changing dates does not move dated funding, costs or pricing, or rewrite frozen snapshots.
- Monthly departmental budgets now support create/read/update, archive/restore, deletion of unused lines and revision history. Permissions, retry protection and stale-edit checks apply. Recorded activity prevents deletion or changing the month/department/category; amount revisions retain history. Monthly budgets are separate from financial-model cost schedules and frozen scenario snapshots; changes do not post ledger entries.
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
- `npm test`: 144 tests pass, including custom-period, leap-year, budget CRUD/persistence, permissions, history and hosted individual-attribution checks.
- `npm run build`: API and optimized Next.js production build pass.
- Browser QA used a separate temporary SQLite database: navigation, funding creation/persistence, snapshot creation, Excel download, CSV preview/acceptance, provenance and narrow-screen layout. Existing screens remain in the original shell.
- Independent artifact-tool recalculation reconciled all three scenarios for both a full forecast fixture and a mixed actual/forecast fixture: monthly revenue/profit, 90-day revenue/profit/cash, operating/investing/financing cash and balance checks. Editing volume, price and cost quantity recalculated to the same engine results. No formula errors found. All 17 worksheet preview renders inspected.

Follow-up verification: custom date and budget forms were inspected locally without saving changes to existing records. The budget layout was checked at 390px width. Independent Excel recalculation passed all three scenarios for a 3-day leap-year window and a 136-day window, including monthly totals, cash, balance checks and changed volume/price/quantity inputs; no formula errors were found. All 17 sheets were rendered for both fixtures; period-dependent statement previews were inspected.

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

Custom-range reproduction: supply `JAYE_QA_START`, `JAYE_QA_END` and a distinct `JAYE_QA_DIR` to the fixture exporter. Pass the resulting directories as comma-separated `JAYE_QA_DATASETS` to the verifier; `JAYE_QA_RENDER=1` also renders previews. Latest local verification artifacts: `/tmp/jaye-range-validation`. This follow-up has not been deployed.

## Investor workspace scoping — 25 October 2026

User requested a detailed implementation prompt, including investor Excel export; no investor feature implementation or publication was requested in this turn. Inspection confirmed `InvestorWorkspace` in `apps/web/app/governance.tsx` is a static placeholder and `GET /api/investor/snapshots` always returns an empty list. Existing immutable financial-model snapshots and formula exports are reusable foundations, not an implemented investor publication workflow.

Proposed scope: preserve UI, add investor reporting from explicitly approved immutable snapshots, scenario/PMF/funding explanations, scoped read-only access, review/publication history and a reconciled, privacy-filtered Excel pack. Separate the custom 1–366-day operating window from any explicitly configured long-term investor-return model. Valuation, ownership, dilution, FX paths and exit assumptions remain unconfirmed; do not derive a meaningful equity IRR from the pilot alone. The $1m raise and annual nominal USD 25% hurdle are historical provisional context, not confirmed funding or promised returns.

Next action: implement the agreed prompt beginning with snapshot permissions and reporting definitions, then shared calculations, dashboard, Excel parity and validation. No code changed or tests rerun for this scope-only review. Custom-period/budget changes were pushed to main as `ce2ad82`; deployment remains unverified.

## Financial reporting expansion — 25 October 2026

Implemented locally as model 1.2.0, reusing the existing calculation engine and interface. Added Performance, Revenue & economics, Cash & funding, Schedules, Review & actions and Reports views. The original scenario controls now include seven independently recalculated operating sensitivities. No investment-return model or automatic tax calculation was introduced.

- Actual/remaining forecast separation; original-budget and latest-forecast comparisons; exact additive EBITDA revision bridge. Different calendars remain non-comparable.
- Explicit monthly budget-to-cost mappings with unmapped/ambiguous status. These mappings never create ledger expenses. Full-month expense comparisons are withheld for partial-month or mixed-cutoff periods; no arbitrary budget proration.
- Service revenue/collection/bookings/contribution detail; observed subscription purchases, first purchases, switches, coverage and same-plan renewal. Acquisition economics preserve existing PMF evidence definitions; mature LTV/payback remains unavailable.
- Cash runway and reserve tests include opening cash. Unrestricted operating burn excludes restricted balances and financing. Committed funding is separate from planned/received statuses but remains forecast cash until receipt confirmation.
- Existing cost rows support hiring/headcount and operating schedules. Working-capital balances and asset additions/disposals reconcile to existing flows. Actual asset disposal still belongs in accounting; no new forecast-disposal engine.
- Versioned funding allocations/milestones, budget mappings, tax-policy evidence, CFO actions/commentary and investor-report drafts reuse resource CRUD/history. Funding allocations cannot exceed the parent funding amount. Reviewed tax policies require reviewer, source and evidence, but do not automatically compute taxes or establish legal applicability.
- Report submission freezes the draft revision, disclosures and snapshot reference in an immutable internal review queue. This is report preparation; the separate investor publication/approval/access project remains unimplemented. No external reports were published.
- Existing editable management Excel now includes a clearly labelled frozen Management Review appendix (18 sheets total). New six-sheet investor draft is an explicit aggregate allowlist: financial statements, summary, service contribution and pricing, without raw records, free-text names/notes, personal identifiers, payroll detail or credentials. Its totals and summary links use formulas; operating what-if changes belong in the management model/app, not this aggregate investor draft. Downloads retain existing internal financial permissions; investor users cannot fetch drafts.

Verification: 155 tests passed, API/web type checks and optimized build passed. New tests cover mapping ambiguity/cutoffs, allocation caps/restore, persistence, snapshot submission/retry/immutability, permissions/entity isolation, actual-price preservation in sensitivities and investor export privacy across 1-day/366-day windows. Independent artifact-tool recalculation matched all three scenarios and edited volume/price/quantity for the management workbook; investor statement totals, summary links and balance check reconciled with no formula errors. All six investor sheets and the management appendix were rendered and inspected. Local browser checked panels/forms and 390px width without saving test records into the user's database.

Exact next action: open Financial Model, record dated costs/funding and evidence, map departmental budgets in Performance, save a snapshot in Exports, then prepare and submit a draft in Reports. Export either the editable management workbook or the aggregate investor draft from that snapshot. This expansion is not committed, pushed or deployed.

## Investor PMF view — 26 October 2026

Acting as a prospective investor, the Planning & reports workspace was reviewed for product-market-fit evidence. Finding: integrity was strong but the PMF tab showed period totals only, no driver activity or churn, no funnel, no per-service separation and a permanently null payback. Implemented locally as model 1.3.0 on the existing engine and interface:

- `pmf()` now returns `weekly`, `growth`, `driver_cohorts`, `funnel`, `utilisation`, `payback`, `complete_through` and `complete_through_basis` at top level and per service. Definitions are in `pmf.definitions`. Mature LTV stays null.
- The Product-market fit tab is an investor one-pager: evidence banner, eight tiles (paying drivers latest week, driver renewal, jobs per paying driver-day, median subscription burden, customer D30, fulfilment, blended contribution per job, driver CAC payback) each with sample and evidence label; weekly chart and table; PMF by service; scorecard; driver and customer cohorts; funnel; utilisation; acquisition and payback; driver economics; definitions.
- Scorecard metrics added: `driver_d30_active`, `paying_driver_growth_weekly`, `jobs_per_paying_driver_week` (count). Add targets under Scenarios → Thresholds with a source; none are seeded.
- Removed duplicate panels (Revenue & economics → Acquisition economics; PMF → Service performance · Lagos). Everything else in the workspace is unchanged.
- Management Excel: new "PMF Weekly" sheet (19 sheets). Investor draft: new "Traction" sheet and PMF evidence rows on Investor Summary (7 sheets), aggregates only.

Verification: full `npm test` suite passes (see MODEL_CHANGELOG.md for the count), API and web type checks pass, optimized web build passes. A stale generated duplicate `apps/web/.next/types/routes.d 2.ts` was deleted to restore the web type check; other untracked `* 2.*` duplicates in `apps/api/src/financial`, `apps/api/test`, `apps/web/app` and `docs/cfo` were left in place and should be reviewed and removed by the user, since they differ from both HEAD and the working copies. No browser QA was run for this change; no records, snapshots or exports were created in a user database.

CRM connection requirements (the adapter contract is unchanged): every `driver`/`customer` registration must carry `campaign_id` matching a `campaign` record with the same `audience`; bookings must be sent as revisions of one `external_id` through `requested` → `accepted` → `completed`/`cancelled`, with `match_minutes` and `job_hours` where known; driver records should carry `available_hours`; the source's `coverage_through` must advance with each successful sync because it now defines completeness when the configured date is blank.

Next action: wire the Jaye CRM to the adapter (or its CSV template) with the fields above, import a first batch, set or let the source coverage date drive completeness, seed the three new scorecard targets with sources, then save a snapshot and export the investor draft. Commit and deploy remain pending user instruction.

## Release verification — 26 October 2026

User authorized pushing the latest financial management and PMF changes to `Jaye-financial-model` and merging into `main`. Release checks passed: 159 tests, API/web type checks and production build. The model version marker is aligned to the documented 1.3.0 release. Local web and API health checks passed. Existing untracked duplicate files ending in ` 2` are excluded from the release. Hosted deployment is not verified by this merge.

## Executive dashboard revamp — 26 October 2026

Implemented on the local working tree following the founder's CEO/CFO review request. The Nigeria finance/CFO/auditor landing page now prioritizes cash evidence, posted monthly costs, upcoming recorded obligations, operational coverage, funding/scenario completeness, service readiness and named actions. Existing styling, navigation, underlying journals and frozen snapshots are retained. The removed Expenses Import review tab stays removed; a focused executive historical-expense/budget resolution section uses the existing audited import service.

Explicit local fixture journals (including their reversals), workflow records and legacy seed-budget IDs are excluded from current executive/monthly/model management inputs. Their original records are not deleted or reclassified in the general ledger. Budget management hides legacy sample budgets by default with an explicit display toggle. Model and new management Excel outputs consume the same filtered input; historical exports are unchanged. Source exclusions are disclosed separately from incomplete-model warnings. Model overview and runway views no longer imply funding adequacy when inputs are missing. Revenue-based early acquisition recovery is labelled to distinguish it from contribution-based economic payback.

Cash reviews require dated supporting references and exact agreement with the non-sample cash ledger; restricted funds are stated separately. They record an accountable human review, not independent bank verification or money movement. Readiness gates require owners, evidence, verifiers and review dates; revisions and history are retained. The five gates per active service are product/reliability, eligibility, screening/safety, payments/support and operating funding. These are management evidence requirements, not legal clearance or automatic launch approval.

The executive evidence score gives 10 points to each of 10 disclosed checks. Its initial local value is 10/100 (sample isolation only). The proposed freshness windows are 7 days for cash reviews and 30 days for service-gate reviews. The score is not company valuation, product-market fit, regulatory approval or an investment recommendation. No costs, operational volumes, funding receipts or completed readiness evidence were invented.

Validation: 170 API tests, API/web type checks and production build passed. New regression checks cover fixture exclusion without ledger deletion, genuine expense preservation, cash mismatch rejection, restricted balances, invalidation after ledger changes, evidence/stale-revision enforcement, null operating metrics and role/entity boundaries. Desktop/mobile browser checks passed; isolated browser writes verified cash reviews, gate reviews and shared CFO action creation. The temporary QA database was removed; no QA cash or launch evidence was written into the local user database.

Next action: Finance should reconcile actual opening cash and the seven historical expenses; classify the outstanding budget line; populate dated funding and scenario schedules. Operations should supply source-covered activity and service acceptance evidence. Investor publication and actual provider activation remain unimplemented. No production deployment or new Git push was performed for this revamp.
