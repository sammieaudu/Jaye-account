# Decisions

- 2026-10-25: Build inside existing application on `Jaye-financial-model`; retain UI tokens and components. No separate deployment or copied live database.
- 2026-10-25: Use posted GL as actual-cost authority; keep imported commercial activity in a management subledger. No automated posting of forecast amounts.
- 2026-10-25: Founder prices supersede historical skill assumptions. Courier mode is fixed or percentage, value unconfirmed. All MVP services planned in Lagos.
- 2026-10-25: NGN 60m–70m describes planned funding, not actual opening cash. Funding scenarios remain independent of operating cases.
- 2026-10-25: Preserve historical financial records. Planning drafts support CRUD; accepted imports use increasing revisions and voids; referenced configuration archives; snapshots freeze.
- 2026-10-25: Runtime Excel generation uses deployable ExcelJS. Independent artifact-tool recalculation/rendering validates the exported product workbook; deployment must not depend on a workstation-only runtime path.
- 2026-10-25: Tax is not hardcoded from a historical rate. Official sources differ in published versions; company classification and taxable-profit bridge remain unresolved. Unprovided tax is explicitly flagged.
- 2026-10-26: PMF evidence is reported on a weekly axis from the period start, per service and in aggregate, from imported records only. Early CAC payback is shown but labelled immature below 90 average observed days; mature LTV is never derived from the pilot alone.
- 2026-10-26: When no completeness date is configured, the earliest source `coverage_through` is the completeness date. A CRM feed must therefore maintain its coverage date for cohort, renewal and growth figures to be measurable.
- 2026-10-26: Duplicate dashboard panels were removed rather than kept in sync: acquisition economics lives only in the PMF tab, and service performance is folded into PMF by service. Scorecard targets remain configurable management judgments, now including a count-based utilisation target.
- 2026-10-26: Executive management views exclude explicit local fixtures while preserving original accounting journals and old snapshots. Legacy sample budgets are hidden by default, not deleted.
- 2026-10-26: Executive evidence coverage uses ten equally weighted checks. Seven-day cash freshness and thirty-day service evidence freshness are proposed management policies, explicitly disclosed and not external standards. No score substitutes for founder go/no-go decisions.
