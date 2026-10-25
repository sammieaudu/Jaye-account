# Decisions

- 2026-10-25: Build inside existing application on `Jaye-financial-model`; retain UI tokens and components. No separate deployment or copied live database.
- 2026-10-25: Use posted GL as actual-cost authority; keep imported commercial activity in a management subledger. No automated posting of forecast amounts.
- 2026-10-25: Founder prices supersede historical skill assumptions. Courier mode is fixed or percentage, value unconfirmed. All MVP services planned in Lagos.
- 2026-10-25: NGN 60m–70m describes planned funding, not actual opening cash. Funding scenarios remain independent of operating cases.
- 2026-10-25: Preserve historical financial records. Planning drafts support CRUD; accepted imports use increasing revisions and voids; referenced configuration archives; snapshots freeze.
- 2026-10-25: Runtime Excel generation uses deployable ExcelJS. Independent artifact-tool recalculation/rendering validates the exported product workbook; deployment must not depend on a workstation-only runtime path.
- 2026-10-25: Tax is not hardcoded from a historical rate. Official sources differ in published versions; company classification and taxable-profit bridge remain unresolved. Unprovided tax is explicitly flagged.
