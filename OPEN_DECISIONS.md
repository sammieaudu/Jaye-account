# Open decisions and release gates

All policies below are **unapproved**. Sample configuration exists only for synthetic testing. No adviser or founder sign-off is implied.

| Decision | Local default | Required owner / gate |
|---|---|---|
| Legal entities | GoJaye Inc. USD parent; GoJaye Nigeria Ltd NGN subsidiary | Founders/counsel confirm registrations and ownership |
| Fiscal year / period | Calendar year; October 2026 open for tests | US CPA + Nigerian accountant |
| Framework and account mappings | Minimal management-test chart | Both accountants approve full chart and statutory mapping |
| Expense policy / thresholds | Policy table: USD 1,000; NGN 500,000 routes to CFO | CFO/founders approve entity/category/department bands and delegations |
| Budgets | Synthetic October lines, stored in database | CFO approves real budgets, overrun and threshold behavior |
| Segregation | Requester, manager, finance reviewer, CFO, releaser and reconciler distinct; finance may schedule and post | CFO approves role matrix and privileged access |
| Approval exceptions | No missing-receipt exception; government fees blocked | CFO + counsel approve exception/government controls |
| Recognition timing | Local slice posts expense and settlement together after reconciliation | Accountants approve accrual-first posting before production |
| Tax on bills | VAT/WHT calculations disabled | Tax adviser supplies effective-dated approved packs |
| FX / constant currency | Cross-currency spend and consolidated figures blocked | Accountants approve rate providers, rounding, translation and reference rate |
| Parent funding / CCI | No capital-transfer feature | Counsel/accountants approve capital, loan and CCI workflows |
| IP / intercompany | No charging or elimination feature | Counsel signs agreements; CPAs approve transfer pricing |
| Revenue / ₦30 levy | Disabled; no rider fare assumptions | Accountant/counsel approve recognition, principal/agent and levy policy |
| Payroll | Disabled, no employee salary data | Payroll adviser approves rules and exact golden datasets |
| Production identity | Local identity selector only | Security owner supplies SSO + enforced MFA and entity-scoped claims |
| PostgreSQL | Local SQLite only | Engineer ports migrations/transactions, adds restricted app role and concurrency tests |
| Evidence | Local AES-GCM encryption and MIME signature validation | Security owner integrates scanner, object storage, retention and managed keys |
| Personal-data region / NDPA | Real PII excluded | Counsel approves data classes, locations and transfer basis |
| Investor snapshots | Empty approved-only workspace | CFO approves frozen snapshots after consolidation implementation |
| Provider integrations | No live provider connected | Provider sandbox tests + separate authorization for real disbursement |
| Go-live | Prohibited; API refuses production mode | CFO after parallel runs, auditor walkthrough and recovery rehearsal |

Staging cannot be treated as authorized by this local build. Its environment, region, budget and access must be agreed separately. Do not add tax identifiers, EINs, credentials or bank details to this file.
