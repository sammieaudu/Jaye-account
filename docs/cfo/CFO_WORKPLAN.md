# Lagos pilot financial workspace

Mandate: an editable, persistent operating model with a 90-day default and custom 1–366-day periods inside Jaye Finance, using the existing interface. Deployment was authorized on 25 October 2026. Real transfers and production-data replacement remain outside the mandate.

Target period: 1 December 2026–28 February 2027 (editable, provisional). NGN operations. Planned funding envelope NGN 60m–70m; NGN 65m midpoint, not received cash. Long-term investment returns and exit valuation are outside this pilot mandate.

| Stage | Status | Deliverable / acceptance |
|---|---|---|
| 0 Audit and mandate | Complete | Source map and assumptions documented; missing business evidence explicitly identified |
| 1 Persistence and commercial configuration | Implemented and verified | Additive tables; resource CRUD, versioning, clone/archive, request idempotency and permissions |
| 2 Integration | Implemented and verified | Posted-ledger actuals; preview/accept CSV and API contract; duplicate/revision checks; provenance and source coverage |
| 3 Integrated engine | Implemented and verified | Revenue, deferred revenue, commissions, restricted settlement funds, costs, capex, funding and cash; balanced daily statements |
| 4 Workspace and PMF | Implemented and verified | Existing UI components; cohort maturity, scenarios, source drilldowns, warnings and refresh |
| 5 Excel | Implemented and verified | Formula workbook, independent recalculation, scenario and input-change verification, visual QA |
| 6 Release validation | Implemented and verified | Existing regression suite, new financial tests, type checks, build and isolated browser verification |

Validation evidence is recorded in MODEL_CHANGELOG.md. Completion requires passed checks, not merely generated files. External operational-provider access and final business assumptions remain dependencies; they do not prevent building import/configuration interfaces.

Release verification: 144 tests, API/web type checks and production build pass. Independent formula parity and all 17 worksheet previews were checked. Configurable interfaces are delivered; operational evidence, provider activation, tax applicability and shared-driver segment allocation remain dependencies described in CFO_HANDOFF.md.

Custom-period follow-up: implemented and verified. Inclusive date controls, dynamic statements/Excel and monthly budget CRUD/history retain the existing interface. Budget amounts can be revised; used lines can be archived, with posted accounting records and frozen snapshots preserved. Follow-up changes are local and not deployed.

Financial management expansion (1.2.0): implemented locally. Shared reporting views, budget mapping, operating sensitivities, funding allocation controls, tax evidence, CFO actions, internal report preparation and aggregate investor-draft export are delivered. 155 tests and independent spreadsheet parity pass. Long-term valuation/returns, verified statutory tax automation and external investor approval/publication remain separate work; no unconfirmed inputs were invented. See CFO_HANDOFF.md for monthly comparison boundaries and next actions.

Investor PMF view (1.3.0, 26 October 2026): implemented locally. Weekly momentum, driver cohorts, funnel, utilisation, early payback and three new scorecard metrics extend the shared engine and both Excel exports; duplicate panels were removed. Next: connect the Jaye CRM to the existing adapter contract with campaign IDs, booking status revisions, match minutes, available hours and a maintained coverage date; then seed scorecard targets with sources. Not committed or deployed.

Executive dashboard follow-up (26 October): implemented and locally validated (170 tests, type checks, production build, desktop/mobile and isolated write-flow QA). Sample isolation and missing-data states are active. Current next stage is evidence onboarding: actual bank cash, historical expense resolution, dated funding/cost plans, source coverage and per-service readiness evidence. No financial assumptions were populated without support.
