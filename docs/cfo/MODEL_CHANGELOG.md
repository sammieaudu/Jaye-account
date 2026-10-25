# Model changelog

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
