# Model changelog

## 1.3.0 — investor PMF view, weekly momentum and CRM-ready evidence

- Extended the shared `pmf()` engine (top level and per service) with weekly momentum (new/paying/active drivers, completed jobs, requested bookings, fulfilment, paid driver-days, jobs per paying driver-day, week-over-week paying-driver growth), driver cohorts by registration month (paid conversion, D30/D60 active), a booking funnel (requested, accepted, completed, cancelled, acceptance and completion rates, median match minutes), driver utilisation (jobs per paying and per active driver-day, hours, median subscription burden, paying drivers with no jobs) and early CAC payback per audience labelled unavailable / immature (< 90 observed days) / observed. Mature LTV stays unavailable.
- The completeness date now falls back to the earliest `coverage_through` across active operational sources when the configured value is blank; `pmf.complete_through` and its basis are reported and the incomplete-actuals warning uses the same rule.
- Added scorecard metrics `driver_d30_active`, `paying_driver_growth_weekly` (average of the last four complete weeks) and `jobs_per_paying_driver_week` (a count target; rate targets stay 0–1 and are validated). Scorecard rows carry a `unit`.
- Rebuilt the Product-market fit tab as an investor view: evidence banner, eight tiles with sample sizes and evidence labels, weekly momentum chart and table, PMF by service (contribution per job beside fulfilment, repeat, D30, renewal and utilisation), scorecard, driver and customer cohorts, demand funnel, utilisation, acquisition and payback, driver economics, definitions.
- Removed duplicates: the "Service performance · Lagos" table (merged into PMF by service) and the "Acquisition economics" panel under Revenue & economics (now only in the PMF tab, with payback). The unused `management.acquisition` payload field was dropped.
- Management Excel gains a "PMF Weekly" sheet with formula growth, fulfilment and jobs-per-driver-day columns (19 sheets). The aggregate investor draft gains a "Traction" sheet and PMF evidence rows on Investor Summary (7 sheets); no identifiers are exported.
- Tests: 4 new (weekly/cohorts/funnel/utilisation, payback, completeness fallback, count/rate scorecard validation); investor sheet count updated. Full suite (159 tests), API/web type checks and the optimized web build pass. Local changes only; not committed or deployed.

## 1.2.0 — financial management views and investor draft export

- Reused shared engine results for actual/forecast reporting, budget/forecast comparisons, EBITDA bridge, service economics, subscription activity, working capital, payroll/cost schedules and asset rollforward.
- Added budget mappings, funding allocation/milestone records, tax-policy evidence, CFO actions and report drafts using existing resource persistence/history. Immutable internal report submissions preserve exact disclosures and snapshot references.
- Added committed funding and opening-cash reserve checks, plus seven one-driver sensitivities that preserve historical price terms.
- Extended management Excel with a frozen review appendix and added an aggregate investor draft export with formula totals, privacy allowlist and internal-only authorization. No investor publication or statutory tax automation.
- 155 tests, type checks and optimized build pass. Independent Excel recalculation and render review pass; 390px browser check showed no document overflow.
- Local changes only. See CFO_HANDOFF.md for scope and operating limitations.

## 1.1.0 — custom periods and editable monthly budgets

- Replaced the fixed 90-day calculation/export window with validated inclusive start/end dates (1–366 days); existing configurations keep their original 90-day default. Added a date selector and 90-day preset within the existing interface.
- Made daily rows, monthly statements, closing balances, checkpoints and Excel formulas follow the selected period. Actual cutoff is capped at period end; recurring vendor schedules cover the selected window.
- Added persistent monthly budget CRUD, archive/restore, immutable revision history, individual actor attribution, role checks, retry-safe writes and optimistic revision checks. Used budget lines cannot be deleted or reassigned; existing accounting records remain unchanged.
- Preserved original budget rows and history through additive metadata tables. Monthly budgets remain separate from forecast cost schedules and frozen snapshots.
- API/web type checks and production build pass; 144 tests pass. Local browser checks covered date controls, budget create/edit forms and 390px layout without saving synthetic records into the existing database.
- Independent Excel recalculation passed all three scenarios and input edits for 3-day and 136-day fixtures. Monthly/period revenue, profit, cash flow and balance checks match the engine with zero formula errors. Rendered all sheets and inspected period-dependent statement previews.
- Local follow-up only; no deployment or external provider activation.

## 1.0.0 — local implementation verified, business inputs provisional

- Added financial configuration, revision history, retry-safe imports, source events and immutable snapshots through additive schema changes. Existing accounting tables are not rewritten.
- Added daily financial engine, scenarios, funding sensitivities, earned/deferred subscriptions, refunds, restricted settlement balances, working capital, recurring vendors, existing obligations, costs and depreciation.
- Added an internal workspace using the existing shell, tables and controls; CSV preview/accept/revise/discard, JSON contract, provenance, missing-data states, PMF/cohorts, statements and exports.
- Retained posted GL as cost authority. Exact invoice payment links prevent duplicate receipt attribution. Campaign spend only attributes acquisitions. Confirmed funding linked to a posted journal is not counted twice.
- Existing paid subscription coverage survives the actual/forecast boundary without an early renewal. Subscription refund allocation reconciles to the kobo. Archived scenarios fall back to a remaining case; the last active case cannot be removed.
- Individual hosted financial actions use the verified gateway identity. Optional editor allowlist supports read-only members.
- 137 tests pass (24 new financial tests plus the existing suite), API/web type checks pass, and optimized production build passes.
- Browser checks on an isolated temporary database verified navigation, funding CRUD persistence, budget snapshot creation, real XLSX download, CSV preview/acceptance, provenance and narrow-screen layout. Visual review corrected primary-button styling and hidden accessibility labels without changing existing screens.
- Independent spreadsheet recalculation passed for all three scenarios on forecast-only and mixed actual/forecast fixtures. Monthly and total revenue/profit, cash flows, closing cash and accounting balance match the engine. Changes to volume, price and cost quantity match changed engine inputs. Formula scan found no errors; 17 worksheet previews visually inspected.
- Cleared duplicate generated Next.js cache files after a type-check conflict; regenerated builds pass. No live records or production databases were used in tests.

Remaining limits and exact reproduction instructions are in CFO_HANDOFF.md. No external operational provider is connected; tax/company inputs and driver segment allocation are not inferred. No deployment performed.
