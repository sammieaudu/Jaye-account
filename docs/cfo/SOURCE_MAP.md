# Sources and financial definitions

| Input | Authoritative source | Use / boundary |
|---|---|---|
| Recorded costs and cash | Posted `journals` + `lines`, mapped by account | Read once. Never add bookkeeping subregister totals again. Dates through actual cutoff only. |
| Opening ledger position | Posted lines before pilot start | Combine with separately identified balanced opening adjustments; pre-pilot income closes to retained earnings. |
| Customer invoice receipts | `sales_invoice_payments` | Outside the GL today. Expose as exceptions until a matching bridge is supplied; do not assume new revenue/cash. |
| Unposted approval obligations | `spends` | Distinguish unposted commitments from recorded actuals. |
| Vendor subscriptions | Existing subscription register | Jaye costs, not driver subscription revenue. |
| Operational observations | `fm_events`, latest source revision | Driver/customer/job/subscription/cash events. Original versions in `fm_event_history`. Management subledger pending reconciliation. |
| Service and plan prices | Effective-dated `fm_resources` | Founder pricing defaults; actual events retain a price snapshot. Used prices cannot be rewritten. |
| Operating forecast | Scenario-specific assumptions | Distinct driver segments; observed actuals shared between cases. Unknown volumes remain unconfirmed. |
| Funding | Dated funding schedule | Equity/debt receipt separately from revenue; planned funding after cutoff only. |
| Forecast expenses / capex | Cost plans | Cost recognition and payment separated. Capex depreciates; prepayments release across service period. |
| Export | Frozen `fm_snapshots` input | One database capture; workbook edits never write back. |

Amounts stored/calculated in integer kobo; each journal pair balances. Subscription revenue uses daily coverage allocation with cumulative rounding so daily allocation equals billed amount. End of coverage is exclusive. Monthly coverage ends on corresponding calendar date clamped to month end. Percentage fees apply to eligible net booking value provided by the source; amounts must exclude components outside the fee basis.

Operational forecasts use fractional expected drivers, distinct supplied segments and available-hour capacity per segment. Shared identities in actuals are deduplicated; planning segments must not overlap. Gross bookings are operational volume, not platform revenue. Driver funds collected in excess of platform fees are restricted cash and settlement liability.

Cash flow uses direct cash classification: financing from equity/debt, investing from capex payments, remaining cash flows operating. A negative cash balance identifies an unfunded plan, never automatic borrowing. Balance checks establish arithmetic consistency, not evidence completeness.

Retention definition: a completed return job in the trailing seven-day window ending D7/D30/D60 after first completion. Only cohorts mature through both cutoff and explicitly confirmed source coverage enter the denominator. Renewal excludes daily subscriptions and requires next coverage beginning on expiry. LTV is unavailable without mature evidence.
