# Model changelog

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
