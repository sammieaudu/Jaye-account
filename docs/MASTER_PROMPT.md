# Jaye Finance — Master Engineering Prompt v4 (GoJaye Inc. and GoJaye Nigeria Ltd)

Oct 19, 2026 · @Sammie

## 0. How to use this prompt

Paste everything from Section 1 onward into the coding agent as one prompt. It replaces v1–v3.

What changed from v3:

- **Final group structure.** GoJaye Inc. (Delaware C-corporation, USD) is the parent, fundraising entity and IP owner. GoJaye Nigeria Ltd (NGN) is the 100%-owned operating subsidiary. Ash Capital & Technology Ltd is outside the GoJaye group unless it is renamed to become GoJaye Nigeria Ltd.
- **Spend management first.** Tracking every naira and dollar spent — with receipts, approvals, budgets and an audit trail — is the first thing the platform must do well.
- **Investor transparency is a product, not a report.** A dedicated investor workspace shows USD consolidated results, a constant-currency view, use of funds and frozen monthly snapshots.
- **US and Nigerian compliance packs** replace the Nigerian-parent rules.
- **In-house ledger and payroll remain** the books of record, gated by a parallel run and auditor walkthrough.

Placeholders in `{{double braces}}` are filled in by the founders before use. Keep tax IDs, EINs and bank details in system configuration, never in this prompt.

## 1. Group structure (read this first)

Jaye Finance serves a two-entity group from day one and must add more countries by configuration. Every record, report, permission and test belongs to exactly one legal entity; the group view is a consolidation.

| Entity | Role | Jurisdiction | Functional currency |
| --- | --- | --- | --- |
| **GoJaye Inc.** | Parent. Issues all shares, SAFEs and options; raises investor capital; owns all IP (code, brand, domains, designs); pays some USD costs (cloud, software, US advisers) | Delaware C-corporation; US federal taxpayer | USD |
| **GoJaye Nigeria Ltd** | 100%-owned operating subsidiary. Employs all staff; contracts with drivers, riders and Nigerian vendors; earns revenue; holds Nigerian licences and bank accounts | Nigeria (CAC); NRS and Lagos State taxpayer | NGN |
| {{Future GoJaye subsidiaries}} | Ghana, Kenya and others, each owned by GoJaye Inc. | Host country | Local currency |

**Group reporting currency:** USD for investor and board reporting. GoJaye Nigeria's statutory books stay in NGN.

### How money and IP move

1. Investors fund **GoJaye Inc.** only (SAFEs, priced rounds). Investor money never lands directly in a Nigerian account.
2. GoJaye Inc. funds GoJaye Nigeria as share capital or a documented intercompany loan. Each foreign-currency inflow into Nigeria goes through a CBN-authorized dealer bank with a **Certificate of Capital Importation (CCI / e-CCI)**.
3. GoJaye Nigeria builds software for GoJaye Inc. under a **development services agreement** (cost plus markup); all work product belongs to GoJaye Inc.
4. GoJaye Inc. licenses the platform and brand to GoJaye Nigeria under an **IP licence agreement** (royalty or fee), registered with NOTAP.
5. Costs one entity pays for the other (e.g. USD cloud bills) are **recharged** under a cost-recharge agreement and allocation key.

### Rules that follow

- Equity, SAFEs, options and the cap table exist only on GoJaye Inc.'s books.
- On GoJaye Nigeria's books, money from the parent is share capital or an intercompany loan — never revenue.
- Every intercompany transaction is recorded on both entities with a shared reference and eliminates exactly on consolidation.
- An intercompany charge cannot post without an active agreement; a capital transfer cannot complete without its CCI reference.
- Fiscal year end ({{default 31 December for both}}), accounting framework per entity, and exchange-rate policy are confirmed by the US CPA and Nigerian accountant and recorded in `OPEN_DECISIONS.md`.

## 2. Your role, the product and its users

Act as a combined team: principal software architect, senior full-stack engineer, accounting systems architect, payroll systems engineer, US–Nigeria cross-border compliance analyst, security architect and DevSecOps/SRE lead.

You design and build **Jaye Finance**, GoJaye's in-house accounting and spend platform. It is the books of record for GoJaye Inc. and GoJaye Nigeria Ltd, the place every expense is requested, approved, evidenced and paid, and the single source of truth investors see. It is a working, production-grade system with persistent storage, real business logic, permissions, controls, integrations, automated tests and an immutable audit trail — not a prototype or static dashboard.

### Who uses it

| User | What they need |
| --- | --- |
| Employees | Submit expenses and receipts in seconds from a phone; see reimbursement status; see their own payslips |
| Department managers | Approve their team's spend; see budget vs. actual |
| Finance team / accountant | Classify, reconcile, post, close the month, prepare filings |
| CFO / founders | Control spend, cash, runway and approvals across both entities |
| Board members | Board packs, government-payments and related-party reports |
| Investors | Approved USD reporting, use of funds, KPIs — nothing confidential |
| Auditors, US CPA, Nigerian accountant | Read-only access to records, evidence and exports |

### Questions the platform must answer at any time

For GoJaye Inc., GoJaye Nigeria and the consolidated group:

1. How much cash do we hold, by entity, bank account and currency (USD and NGN)?
2. What did we spend today, this week, month, quarter and year — by department, category, vendor and project?
3. Who approved each expense, what evidence supports it, and has it been paid and reconciled?
4. How does spend compare with each approved budget, and what is committed but not yet paid?
5. How much investor capital has GoJaye Inc. raised, how much has moved to Nigeria, and is every transfer backed by a CCI?
6. What are gross burn, net burn and runway in USD — and what would they be at constant exchange rates?
7. What revenue did each Jaye product line earn, and how much is deferred?
8. What do the two companies owe each other, and do intercompany balances agree?
9. What is payroll cost and statutory liability, and has it been paid and remitted?
10. Which filings and remittances are due, filed or overdue in the US and Nigeria?
11. Are both companies' books closed, balanced and ready for investors and auditors?

Every figure must trace to a journal entry, its source transaction and supporting evidence. Never present invented or mocked data as real.

### Human authority (not delegated to you)

| Decision | Approver |
| --- | --- |
| Charts of accounts, expense categories, accounting policies, revenue recognition, ₦30 rider levy treatment, consolidation and exchange-rate policy | {{Nigerian chartered accountant}} and {{US CPA}} |
| Nigerian tax and payroll rule packs | {{Nigerian tax / payroll adviser}} |
| US filings, intercompany pricing, QSBS records | {{US CPA}} |
| Intercompany agreements, IP assignments, wallet/escrow licensing | {{Nigerian and US counsel}} |
| Expense policy, approval limits, budgets | {{CFO / founders}} |
| Reference test transactions ("golden datasets") | Accountant, US CPA and payroll adviser jointly |
| Go-live as the books of record | CFO, after the parallel run (Section 3) |

Where a decision is missing, choose a secure, reversible default, record it in `OPEN_DECISIONS.md`, and keep the affected feature off in production.

## 3. Scope and principles

Jaye Finance is built in-house and is the **books of record** for both companies, the **spend platform** for every employee, and the **payroll engine** for GoJaye Nigeria.

### Built in-house

General ledger and sub-ledgers; expense, bill and purchase-order workflows; approvals; budgets; AR and AP; revenue sub-ledgers; fixed assets; payroll calculation; intercompany and consolidation; tax and compliance tracking; investor and board reporting; audit trail.

### External (licensed or regulated parties)

- **Moving money:** banks or licensed payment providers execute payments through `PaymentProvider` adapters. Jaye Finance creates, approves and tracks payment instructions; it never holds funds.
- **Bank data:** open-banking adapters (e.g. Mono for Nigeria; a US bank feed provider for GoJaye Inc.) or statement imports.
- **Corporate cards** (if used): card provider feeds through a `CardProvider` adapter.
- **Filing:** tax returns and remittances are filed by the accountants on official portals or via approved intermediaries; Jaye Finance prepares schedules and stores evidence.
- **Cap table:** a cap-table tool is the system of record for equity; Jaye Finance holds the accounting.

### Principles

1. **Evidence before money.** No expense is paid without an approved request and a receipt or invoice (or an approved exception).
2. **Every number traces.** Any figure on any screen drills down to journals, source documents and approvals.
3. **Nothing is deleted.** Posted entries are immutable; corrections are reversals.
4. **Separation of duties.** Requester, approver, payer and reconciler are different people.
5. **Two currencies, one truth.** Every transaction keeps its original currency, the entity's currency and the exact rate.
6. **Investors see approved snapshots only.**

### Conditions for going live as the books of record

1. Golden datasets for ledger, expenses and payroll pass exactly.
2. Parallel run: for at least {{two}} month-ends, the accountant keeps an independent record, and Jaye Finance's trial balance, expense totals and payroll match it with every difference explained.
3. External auditor reviews controls, audit trail and exports.
4. GL, trial balance, journals, expense registers, payroll registers and evidence export in CSV, XLSX and PDF.
5. Backup restore and point-in-time recovery rehearsed.

Until then the system runs in shadow mode and the accountant's record is the official books.

## 4. Architecture discovery and stack

Inspect the existing Jaye repositories and infrastructure before writing code and produce `ARCHITECTURE_DISCOVERY.md`. Known context to verify, not assume: the Jaye MVP is a NestJS modular monolith; hosting is DigitalOcean (App Platform today; DOKS with Terraform, Helm, GitHub Actions, GitOps, Cloudflare and Gateway API targeted). Document frameworks, identity, databases, payment and subscription models, webhooks, secrets, observability, environments and deployment conventions. Reuse what exists; do not disrupt Jaye production services.

### Default stack (where discovery finds no convention)

- **Frontend:** Next.js + TypeScript, Tailwind, accessible component library, TanStack Query, React Hook Form + Zod, Recharts, TanStack Table for large financial tables. Responsive web plus an installable PWA for mobile receipt capture (camera upload, offline queue).
- **Backend:** NestJS + TypeScript, deployed separately from the ride platform; REST with OpenAPI and generated typed clients; background workers; domain modules: identity, entities, spend, ledger, banking, revenue, payroll, intercompany, compliance, reporting, investor, audit.
- **Data:** managed PostgreSQL in its own cluster; migration-capable ORM with raw SQL allowed on posting and reporting paths; Redis for queues; encrypted object storage for receipts, invoices, payslips and filings.
- **Documents:** OCR for receipts and invoices (amount, date, vendor, currency, VAT) via an `OcrProvider` adapter; humans confirm every extracted field.
- **Infrastructure:** whatever discovery confirms; no Traefik or NGINX unless discovery documents a need.

One modular service with clear domain boundaries, not microservices. Ledger posting is strongly consistent and safe under concurrency.

### Data location

The platform holds personal data (NIN, BVN, bank details, salaries) for Nigerian staff and drivers. Record in `SECURITY_MODEL.md` where each data class is stored and the legal basis for any cross-border transfer under the Nigeria Data Protection Act 2023; counsel signs off.

## 5. Spend management (build first)

Every naira and dollar GoJaye spends flows through this module. It must be fast for employees, strict for finance and fully traceable for investors.

### Spend types

| Type | Example | Flow |
| --- | --- | --- |
| Expense claim (reimbursement) | Staff pays for fuel or a client lunch personally | Claim + receipt → approval → reimbursement → posting |
| Spend request (pre-approval) | Marketing campaign, event, travel | Request with estimate → approval → commitment against budget → actual spend linked |
| Purchase order + vendor bill | Office equipment, agency retainer | PO → goods/services received → bill matched to PO → approval → payment |
| Recurring bill / subscription | AWS, Google Workspace, rent, software | Template → monthly bill auto-created as draft → review → payment |
| Corporate card transaction | Card used for SaaS or ads | Card feed → receipt matched → coded → approved → posted |
| Petty cash | Small office purchases in Lagos | Float issued → spends logged with receipts → float reconciled |
| Cash advance | Field operations advance to staff | Advance → spends with receipts → balance returned or reimbursed |
| Government or official payment | Permits, levies, regulator fees | Special category: legal basis + official receipt + CFO approval regardless of amount; no cash |

### Every spend record captures

ID; legal entity; requester; payee (employee or vendor); description and business purpose; transaction date; amount and original currency; entity-currency amount and FX rate with source; payment method and source account; category (mapped to a GL account); department, cost centre, product line, project; budget line; VAT/WHT metadata; receipt or invoice files; approval chain and comments; payment status; reconciliation status; posting status; created/updated timestamps; full audit history.

### Workflow and states

Draft → Submitted → Policy check → Manager approval → Finance review → (CFO approval when policy requires) → Approved → Scheduled for payment → Paid (confirmed by bank/provider) → Reconciled → Posted → Closed. Rejected and Returned-for-changes states keep full history.

- **Configurable approval policies** by entity, department, category, amount band, currency and requester. Never hardcode limits. Escalate when an approver is absent.
- **Policy checks on submit:** missing receipt, over category limit, weekend/holiday spend, duplicate amount and vendor within N days, split-transaction detection (several claims just under a limit), personal-looking merchants, out-of-budget, related-party payee, government-payment category.
- **Duplicate detection:** same receipt image (perceptual hash), same invoice number per vendor, same amount/date/vendor.
- **Separation of duties:** requester ≠ approver ≠ payment releaser ≠ reconciler; the system blocks violations, including for founders and admins.

### Receipts and evidence

- Capture by phone camera (PWA), upload, or forwarding email to a per-entity inbox address.
- OCR proposes merchant, date, amount, currency and VAT; the user confirms.
- Files are validated, virus-scanned, encrypted and immutable once the expense is approved; replacements create new versions.
- Missing-receipt affidavit flow for genuine losses, requiring extra approval and flagged in reports.

### Vendors

Vendor directory per entity: legal name, TIN/EIN, VAT status, WHT treatment, contact, payment terms, contracts, bank details (encrypted), related-party flag, due-diligence status for intermediaries dealing with officials. Bank-detail changes require a second person's approval, out-of-band verification, and an audit event; payments to newly changed details are held for {{24 hours}}.

### Budgets and commitments

Budgets per entity, department, category and project — monthly, quarterly, annual — in the entity's currency with USD view. Approved spend requests and POs become **commitments** that reduce available budget before money moves. Show budget, committed, actual, remaining and forecast per line; alert at {{80%}} and block or escalate at 100% per policy.

### Payments

Approved items are batched into payment runs per entity and currency, exported as bank files or sent through a `PaymentProvider`. A payment is "Paid" only when the bank or provider confirms it. Partial payments, failed payments and reversals are tracked. Start with file export; API disbursement needs separate authorization and testing. Never move money in a test.

### Accounting

Approved spend creates draft journals automatically using category-to-account mappings: expense or asset debit; payable, employee reimbursement payable or card clearing credit; VAT input and WHT payable lines where applicable; payment and reconciliation entries on settlement. Prepayments and capital items route to prepayment and fixed-asset schedules. Finance reviews postings in bulk.

### Employee experience

Submitting a typical expense must take under {{60 seconds}} on a phone. Employees see status, who it's waiting on, and expected reimbursement date. Notifications by email and in-app ({{WhatsApp optional}}).

## 6. Core ledger engine

The ledger is the books of record for both companies. Correctness outranks every other goal.

### Double-entry rules

- Every journal belongs to one entity and one period, has at least two lines, and balances in the entity's functional currency.
- Drafts are editable; posted journals are append-only and immutable. Corrections are reversing or adjusting journals linked to the original.
- Each journal stores: gap-free number per entity and year, transaction date, posting date, period, source module and document, currency and FX data, description, created-by, approved-by, posted-by, timestamps, idempotency key, reversal link.
- Posting checks run in one database transaction (balance, open period, active accounts, entity match, required dimensions, approval). Any failure posts nothing.
- Money is integer minor units or arbitrary-precision decimals with explicit currency and rounding rules — never binary floating point. Rounding differences go to a rounding account.
- Dimensions (department, cost centre, product line, project, country) are separate from accounts.

### Charts of accounts

A group master chart with entity extensions, mapped to US reporting lines (GoJaye Inc.) and Nigerian statutory lines (GoJaye Nigeria). Seed with:

- **Assets:** bank accounts by currency, petty cash, processor clearing, card clearing, receivables, intercompany receivable, intercompany loan receivable, investment in subsidiary (GoJaye Inc.), employee advances, prepayments, VAT recoverable, WHT receivable, fixed assets, accumulated depreciation.
- **Liabilities:** payables, accruals, employee reimbursements payable, intercompany payable, intercompany loan payable, salaries payable, PAYE, pension, NHF/NSITF/ITF payables, VAT payable, WHT payable, income tax and Development Levy payable, driver payables, levy clearing, deferred revenue, SAFE liability or equity per policy.
- **Equity:** common and preferred stock, additional paid-in capital, SAFEs (if equity-classified), retained earnings, current-year earnings, cumulative translation adjustment.
- **Revenue:** driver subscriptions, delivery fees, driver-hire booking fees, future product lines, intercompany income (development services, royalties, interest), other income.
- **Expenses:** salaries and employer contributions, contractors, cloud infrastructure, software, marketing and advertising, driver acquisition, customer support, operations, vehicle and fuel, legal and compliance, professional fees, government fees and permits, bank and processor fees, rent and utilities, travel, depreciation, intercompany charges, FX gains and losses, other admin.

### USD and NGN dual currency

- GoJaye Inc.'s functional currency is USD; GoJaye Nigeria's is NGN.
- Every line stores original currency and amount, functional amount, rate, rate type (spot, average, closing, historical, manual override) and source (CBN, bank, approved provider), plus effective date. Manual overrides need an approver and reason.
- Bank accounts in a non-functional currency (e.g. GoJaye Nigeria's USD domiciliary account) are supported, with realized FX gain or loss on settlement and month-end revaluation of monetary balances (unrealized FX, auto-reversed).
- Currency conversions and internal transfers never create revenue.

### Consolidation (USD)

- Monthly consolidation of GoJaye Inc. and its subsidiaries into USD.
- Translate GoJaye Nigeria per the approved policy (typically closing rate for assets and liabilities, average or transaction rates for income and expenses, historical rates for equity); differences go to the cumulative translation adjustment, not profit.
- Eliminate intercompany balances, income and expense (development fees, royalties, recharges, loan interest) and investment against subsidiary equity. Unmatched intercompany items block the run.
- Approved runs are frozen with rates, eliminations and source balances.

### Period close

Period states: open → soft-closed → closed (reopen requires CFO approval and is audited). Month-end checklist per entity: bank and card reconciliations; all approved expenses posted; accruals and prepayments; depreciation; payroll posted and reconciled; FX revaluation; intercompany agreed; tax liabilities reviewed; trial balance signed off. Year-end close rolls profit to retained earnings and produces statutory statements.

### Statements

General ledger, trial balance, P&L, balance sheet, cash flow (indirect, with a direct cash view from bank data), changes in equity, AR/AP aging, fixed-asset register — per entity and consolidated, filterable by date, currency and dimension, exportable to CSV, XLSX and PDF.

## 7. Investor transparency

The investor experience is a first-class product. Investors should be able to understand where their money went without asking.

### Investor workspace

- Shows only **CFO-approved monthly snapshots**; live data is never exposed. Each snapshot is frozen with its data, exchange rates and approval record, and versioned if restated (with the reason shown).
- Consolidated in **USD**, with the NGN figures available beside them.
- **Constant-currency view:** NGN results restated at a fixed reference rate ({{e.g. the rate at the last fundraise or start of year}}) so investors can see real growth separately from naira movement. Show both views and the FX impact as its own line.
- Pages: summary dashboard; P\&L; balance sheet; cash flow; cash and runway; burn (gross and net); **use of funds** (capital raised vs. deployed by category, department and entity, against the approved use-of-funds plan); budget vs. actual; revenue by product line; KPIs from verified Jaye platform data (active paying drivers, churn, revenue per paying driver); monthly investor update text written by the CEO.
- Every number links to a definition and formula. Drill-down for investors stops at category and month level — never individual salaries, vendor bank details, receipts or personal data.
- Downloads (PDF and XLSX) are watermarked per investor and logged.

### Board pack

Generated per month or quarter from frozen snapshots: consolidated financials, cash and runway, budget variances, top vendors and spend categories, large and unusual transactions, government-payments report, related-party transactions, capital and CCI register status, compliance calendar status, payroll totals (aggregate only), open audit points.

### Data room

A restricted, read-only area for due diligence: incorporation documents, cap table export, IP assignments, intercompany agreements, CCIs, audited accounts, tax filings, board minutes, policies. Access is time-limited per party and every view and download is logged.

### Transparency controls

- Restatements of an approved period require CFO approval, a written reason and a new snapshot version; the previous version stays visible to the board.
- KPIs not backed by verified source data are labeled "not available" — never estimated from the books.
- A monthly "spend transparency" report: total spend by category, by department, top vendors, exceptions (missing receipts, policy overrides, late approvals) and how each was resolved.

## 8. Other modules

Every module is entity-aware: every screen, API and report filters by GoJaye Inc., GoJaye Nigeria or Consolidated, and permissions are scoped per entity.

### Module A — Intercompany, IP and capital

- **Agreements register:** development services (cost plus markup), IP licence (royalty or fee), cost recharge (allocation keys), intercompany loans (principal, currency, rate, schedule). Each stores NOTAP registration status and transfer pricing basis. No intercompany charge posts without an active agreement.
- **Intercompany transactions** post on both entities with a shared reference; matching runs daily and before consolidation.
- **Capital register:** every movement from GoJaye Inc. to GoJaye Nigeria records USD and NGN amounts, rate, date, banks, type (equity or loan) and CCI number and certificate. Report: capital sent vs. CCI-covered vs. outstanding.
- **Monthly intercompany billing:** generates the development-services invoice (Nigeria → Inc.), royalty invoice (Inc. → Nigeria) and recharges, with VAT and WHT per approved rules.

### Module B — Equity and fundraising (GoJaye Inc.)

Record share issues, SAFEs and convertible notes (classification per CPA policy), option grants and share-based compensation, and conversions; read-only sync with the cap-table tool. Equity and loan proceeds are never revenue. Feeds the use-of-funds report. Keep a QSBS evidence file: issue dates, aggregate gross assets at each issuance, active-business evidence.

### Module C — Revenue (GoJaye Nigeria)

`ProductRevenueAdapter` per product line; prices and plans come from versioned billing configuration.

- **JayeRide driver subscriptions:** daily, weekly, monthly plans; 30-day free trial (no revenue); renewals, failures, refunds, churn; revenue recognized over the service period, prepaid amounts deferred.
- **₦30 per-trip rider levy:** held in a clearing account until the accountant approves its treatment and VAT.
- **JayeSend, JayeDriver** fees, cancellations, refunds and payables; future lines (JayeFleet, JayeLux, JayeEat, JayeOwn) with principal-vs-agent and lease policies set before launch.
- Rider fares paid to drivers are not Jaye revenue. Customer wallets and escrow stay off until counsel approves a licensed structure.

### Module D — Banking, cards and reconciliation

`BankingProvider` and `CardProvider` adapters plus CSV/OFX/MT940 import and mocks; US accounts for GoJaye Inc., NGN and domiciliary accounts for GoJaye Nigeria. Processor settlement reconciliation (Paystack, Flutterwave or chosen processor): collections → fees → settlements → bank. Matching one-to-one, one-to-many and many-to-one with confidence scores; internal and intercompany transfer matching (linked to CCIs); bank fees; suspense; closing-balance checks. Suggestions never post without human approval. Never store banking passwords or OTPs; never scrape portals.

### Module E — Accounts receivable

Customer and corporate-client invoices, credit notes, receipts, aging and statements; invoices carry NRS e-invoicing fields when the mandate applies.

### Module F — Payroll (GoJaye Nigeria; any US staff via a US payroll provider)

- Versioned, effective-dated **Nigeria payroll rule pack** approved by the payroll adviser: PAYE under the Nigeria Tax Act 2025 (remitted to the state of residence), contributory pension to each employee's PFA, NHF, NSITF and ITF. No hardcoded rates.
- Employee records with encrypted identity and bank data; field-level salary protection.
- Deterministic gross-to-net with a calculation trace per payslip; pro-rating; arrears; bonuses; loans; final pay.
- Workflow: Draft → Inputs locked → Calculated → Finance review → CFO approval → Payment file → Release → Confirmation → Reconciliation → Remittances → Closed. Variance report required at review. Nobody prepares, approves and releases the same run.
- Outputs: payslips (each employee sees only their own), payroll register, statutory schedules, payroll journals (posted on approval; settled on payment and remittance).

### Module G — Compliance packs

Versioned, effective-dated, source-linked rule packs approved by the relevant adviser. Jaye Finance calculates, schedules, reminds and stores evidence; it never files or remits automatically.

- **United States (GoJaye Inc.):** Form 1120; Form 5471 for GoJaye Nigeria; Form 5472 if a foreign person owns 25% or more (flag from the cap table); Form 926 tracking for cash sent to the subsidiary; FBAR tracking; Delaware franchise tax (assumed par value capital method data) and annual report; 1099s for US contractors; state registrations if US staff or offices exist; CFC/GILTI inputs for the CPA.
- **Nigeria (GoJaye Nigeria):** under the Nigeria Tax Act 2025 and Nigeria Tax Administration Act 2025 (effective 1 January 2026; NRS formerly FIRS): company classification tracking, companies income tax, Development Levy, VAT input and output, WHT deducted and suffered, PAYE, transfer pricing declarations, NOTAP, CAC annual returns, audited statements, NRS e-invoicing via an approved access point provider (emerging taxpayers go live July 2027 — verify against current NRS notices), NDPA 2023.
- A compliance calendar per entity with owner, due date, status and filed evidence.

### Module H — Governance

Government and official payments control (Section 5); intermediary due diligence; related-party register with independent approval; founder and staff spend policy; bank mandates and dual signatories with change alerts; whistleblower channel visible only to a designated board member. Applies Nigerian anti-corruption law and, because the parent is a US company, the US FCPA.

### Module I — Roles and access

| Role | Access |
| --- | --- |
| Super Administrator | Technical configuration only; cannot approve, post, pay or view salaries |
| CEO / Founder | Dashboards, reports; approvals only where policy grants them |
| CFO | Approvals, close, consolidation, payroll approval, investor snapshot approval |
| Finance Manager / Accountant | Classify, reconcile, draft and post journals, prepare filings |
| Payroll Officer | Prepare payroll; cannot approve or release |
| Payment Releaser | Release approved payments; cannot create or approve |
| Department Manager | Own department's spend, approvals and budget |
| Employee | Own expenses, reimbursements, payslips |
| US CPA / Nigerian Accountant | Read-only for their entity, plus rule-pack approval |
| Board Member | Board packs; whistleblower cases (designated member only) |
| Investor | Investor workspace snapshots only |
| Auditor | Read-only records, audit log, exports |

MFA for all privileged roles; permission checks on every API; no cross-entity leakage; segregation of duties enforced by the system.

### Module J — Automation and optional AI assistant

Deterministic automation first: bank and card sync, receipt reminders, duplicate and policy alerts, recurring bills, budget thresholds, large or unusual transactions, intercompany billing, FX revaluation, missing CCIs, payroll and filing reminders, month-end checklist. An optional, feature-flagged assistant answers authorized read-only questions with cited periods and source records; it cannot post, approve, pay or change beneficiaries, and never invents figures.

## 9. Data model

Normalized PostgreSQL with foreign keys, unique and check constraints, indexes and explicit transaction boundaries. Every financial table carries `legal_entity_id`. Enforce balance and immutability in the database as well as the application (no UPDATE or DELETE on posted rows under the application role). Money is integer minor units or arbitrary-precision decimals with explicit currency. Secrets live in the secrets manager. Keep source payload references for audit and replay. Migrations are tested and non-destructive.

| Area | Tables (minimum to evaluate) |
| --- | --- |
| Organization and access | legal\_entities, entity\_ownership, users, roles, permissions, user\_entity\_roles, departments, cost\_centers, projects, dimensions |
| Spend | spend\_requests, expense\_claims, expense\_items, receipts, receipt\_versions, ocr\_extractions, purchase\_orders, po\_lines, goods\_receipts, bills, bill\_lines, recurring\_bill\_templates, card\_accounts, card\_transactions, petty\_cash\_floats, cash\_advances, spend\_categories, category\_account\_mappings, spend\_policies, policy\_violations, duplicate\_flags |
| Approvals | approval\_policies, approval\_requests, approval\_steps, approval\_actions, delegations |
| Vendors | vendors, vendor\_contacts, vendor\_bank\_accounts, vendor\_bank\_change\_requests, vendor\_contracts, intermediary\_due\_diligence |
| Budgets | budgets, budget\_lines, commitments, budget\_alerts, use\_of\_funds\_plans |
| Payments | payment\_runs, payment\_instructions, payment\_events, bank\_files |
| Ledger | chart\_of\_accounts, account\_mappings, fiscal\_years, accounting\_periods, journal\_entries, journal\_lines, journal\_sequences, recurring\_journals, accruals, prepayments |
| Currency | currencies, exchange\_rates (type, source, effective date, override approver), fx\_revaluations, constant\_currency\_rates |
| Consolidation | consolidation\_runs, translated\_balances, elimination\_entries, cta\_balances |
| Intercompany and capital | intercompany\_agreements, intercompany\_transactions, intercompany\_invoices, intercompany\_loans, allocation\_keys, capital\_transfers, capital\_importation\_certificates |
| Equity | share\_classes, share\_issues, safes, option\_grants, stock\_comp\_schedules, qsbs\_evidence |
| Fixed assets | fixed\_assets, depreciation\_schedules, disposals |
| Banking | bank\_connections, bank\_accounts, bank\_mandates, bank\_transactions, statement\_imports, reconciliation\_sessions, reconciliation\_matches |
| Revenue | billing\_plans, subscription\_events, customer\_invoices, invoice\_lines, processor\_events, settlement\_batches, revenue\_recognition\_schedules, levy\_clearing\_entries, e\_invoices |
| Payroll | employees, compensation\_records, pay\_components, payroll\_rule\_packs, payroll\_runs, payroll\_run\_versions, payroll\_items, payroll\_calculation\_traces, payslips, statutory\_remittances, pension\_fund\_administrators |
| Compliance | tax\_rule\_packs, tax\_calculations, tax\_liabilities, compliance\_obligations, filings, filing\_evidence |
| Governance | related\_parties, government\_payment\_records, whistleblower\_cases |
| Investor and reporting | report\_snapshots, snapshot\_versions, investor\_accounts, investor\_access\_grants, investor\_downloads, board\_packs, data\_room\_documents, data\_room\_access\_log, kpi\_sources |
| Audit | audit\_events (hash-chained, tamper-evident), integration\_sync\_runs, integration\_credentials\_metadata |

## 10. Security, deployment and testing

### Security

TLS everywhere; encryption at rest; managed secrets with rotation; SSO and MFA; least privilege; no routine human write access to the production database; validated, virus-scanned, encrypted uploads; signed and verified webhooks; idempotent financial operations; tamper-evident audit log; alerts on suspicious admin activity (role changes, bank-detail edits, period reopen, approval overrides); retention rules meeting US and Nigerian record-keeping law; NDPA privacy impact assessment; dependency, SAST and container scanning. Never log credentials, tokens, NIN, BVN, SSN, salaries or full bank details. Recovery: point-in-time recovery; RPO ≤ {{15 minutes}}; RTO ≤ {{4 hours}}; quarterly restore drill with a trial-balance check.

### Deployment

Follow conventions confirmed in discovery. Separate development, staging and production; production never uses development data or credentials. Pull requests run lint, type checks, unit, ledger-invariant, golden-dataset, integration, security and migration tests. Releases use signed artifacts where supported, image promotion, GitOps, health checks, migration safeguards and a rollback or roll-forward runbook. Monitor posting failures, unbalanced or closed-period posting attempts, approval-policy bypass attempts, sync failures, intercompany mismatches, duplicate payments, webhook failures, latency, errors and queues. Define SLOs, alerts and runbooks.

### Tests

**Spend**

- An expense cannot be paid without approval and evidence (or an approved missing-receipt exception).
- Requester, approver, releaser and reconciler must differ — including for founders and admins.
- Approval routing follows configured policy for each amount band, category, department and entity.
- Duplicate receipts, duplicate invoices and split transactions are flagged.
- Commitments reduce available budget; budget thresholds alert and escalate.
- Vendor bank-detail changes require second approval and hold payments for the configured period.
- Government or official payments cannot be released without legal basis, official receipt and CFO approval.
- Approved spend produces correct journals, including VAT input, WHT and FX.

**Ledger**

- Every posted journal balances; unbalanced, unapproved and closed-period postings are rejected; posted journals cannot be edited or deleted (including by direct SQL under the application role); reversals preserve history; numbering is gap-free under concurrency.
- Trial balance totals to zero; balance sheets balance per entity and consolidated.
- Transfers, conversions, equity and loan proceeds never create revenue; subscriptions defer correctly; trials recognize nothing; refunds reverse once.
- FX revaluation and reversal net to zero; realized FX correct on settlement.
- Reconciliation never double-counts.

**Multi-entity and investor**

- Intercompany balances eliminate to exactly zero; mismatches block consolidation.
- Consolidated USD balance sheet balances, differences in the CTA.
- Constant-currency figures recompute correctly from the reference rate, and the FX-impact line equals the difference.
- Equity instruments cannot post to GoJaye Nigeria; capital transfers require a CCI; intercompany charges require an agreement.
- Investors see only approved snapshots and cannot reach salaries, receipts, bank details or personal data by any API.
- Restating an approved period creates a new version and preserves the old one.

**Payroll**

- Gross-to-net matches the adviser's golden datasets exactly per rule-pack version; results are deterministic; payroll journals tie to the register; statutory payables clear only on remittance; no one person prepares, approves and releases a run; employees see only their own payslips.

**Integration and security**

Replayed webhooks, retries and duplicate statements or card feeds create no duplicates; invalid signatures are rejected; no cross-entity access without a role; direct API calls cannot bypass authorization.

**Golden datasets (end to end)**

1. Investor buys a SAFE in GoJaye Inc. → GoJaye Inc. sends USD to GoJaye Nigeria as share capital → CCI issued → converted to NGN.
2. Staff fuel expense in NGN with receipt → manager approval → reimbursement → bank reconciliation → posted.
3. Marketing spend request → approval → commitment → vendor bill matched → paid → budget updated.
4. AWS bill in USD paid by GoJaye Inc. → recharged to GoJaye Nigeria under the allocation key.
5. Monthly development-services invoice (Nigeria → Inc.) and royalty (Inc. → Nigeria) with VAT and WHT.
6. Driver subscription after a 30-day trial → processor collection → settlement → deferred revenue unwinds.
7. Monthly payroll with PAYE, pension, NHF, NSITF and ITF remittances.
8. Month-end close of both entities, USD consolidation, constant-currency view, investor snapshot approved, board pack generated.

## 11. Phases, deliverables and rules

### Phases

Each phase needs acceptance criteria and passing tests before the next starts.

| Phase | Delivers | Exit gate |
| --- | --- | --- |
| 0 — Discovery and policy | Architecture discovery; charts of accounts and expense categories; expense policy and approval matrix; accounting, FX, constant-currency and consolidation policies; threat model; `OPEN_DECISIONS.md` | Accountant, US CPA and founders sign off |
| 1 — Spend and ledger foundation | SSO/MFA and entity-scoped roles; both entities; chart of accounts; journals and periods; USD/NGN; vendors; expense claims, spend requests, bills and recurring bills with receipts, OCR, policy checks and approvals; budgets and commitments; bank accounts with statement import and reconciliation; payment runs via bank file; per-entity P&L, balance sheet and spend reports; audit log | Definition of done below; golden scenarios 2–3 pass |
| 2 — Group and investors | Intercompany agreements and billing; capital and CCI register; consolidation in USD; constant-currency view; investor workspace with approved snapshots; board pack; data room | Golden scenarios 1, 4, 5, 8 pass; first investor snapshot approved by CFO |
| 3 — Revenue | Subscription sub-ledger and deferred revenue; processor settlement reconciliation; AR | Golden scenario 6 passes before Jaye's public launch |
| 4 — Payroll | Nigeria rule pack; employee records; gross-to-net; workflow; payslips; payroll journals; remittance schedules | Golden scenario 7; payroll parallel run matches for {{two}} months |
| 5 — Go live as books of record | Bank and card feeds; fixed assets; accruals; FX revaluation; full close; compliance calendars and packs; NRS e-invoicing readiness | Ledger parallel run matches; auditor walkthrough complete; CFO approves go-live |
| 6 — Expansion | New country subsidiaries with their rule packs; new product lines | Local adviser sign-off; per-line accounting policy |

### Required documents

`ARCHITECTURE_DISCOVERY.md`, `ARCHITECTURE.md`, `PRODUCT_REQUIREMENTS.md`, `GROUP_STRUCTURE.md`, `EXPENSE_POLICY_AND_APPROVALS.md`, `ACCOUNTING_DESIGN.md`, `CHART_OF_ACCOUNTS.md`, `FX_AND_CONSOLIDATION_POLICY.md`, `INVESTOR_REPORTING.md` (definitions, formulas, snapshot process), `INTERCOMPANY_AND_TRANSFER_PRICING.md`, `PAYROLL_DESIGN.md`, `RULE_PACKS.md`, `US_COMPLIANCE.md`, `NIGERIA_COMPLIANCE.md`, `GOVERNANCE.md`, `DATABASE_SCHEMA.md`, `INTEGRATIONS.md`, `SECURITY_MODEL.md`, `API_SPECIFICATION.md`, `DEPLOYMENT_GUIDE.md`, `TEST_PLAN.md`, `PARALLEL_RUN_PLAN.md`, `EMPLOYEE_GUIDE.md`, `FINANCE_USER_GUIDE.md`, `INVESTOR_GUIDE.md`, `RUNBOOK.md`, `IMPLEMENTATION_ROADMAP.md`, `OPEN_DECISIONS.md`.

Also: working frontend (web + PWA) and backend; migrations; provider interfaces with mock and sandbox adapters; automated tests; Docker dev environment with clearly labeled synthetic data for both entities; Helm; Terraform only if new infrastructure is authorized; CI/CD; monitoring. Never use real credentials or employee data outside production.

### Definition of done (Phase 1)

An authorized user can:

1. Sign in with MFA and switch between GoJaye Inc., GoJaye Nigeria and Consolidated, seeing only entities they hold a role on.
2. As an employee, submit an expense with a phone photo of the receipt in under a minute and track its status.
3. As a manager, approve or return it; see policy warnings and budget impact.
4. As finance, create a vendor, enter a bill against a PO, approve it, include it in a payment run, export the bank file, mark it paid on confirmation and reconcile it to an imported statement.
5. Record a USD expense on GoJaye Inc. and an NGN expense on GoJaye Nigeria and see both currencies and the rate.
6. See budget vs. committed vs. actual by department and category.
7. Produce per-entity trial balance, P&L, balance sheet and spend reports that tie to the journals, and export them.
8. Trace any reported number to journals, the expense, its receipt and its approvals, and review the immutable audit history.

All spend and ledger invariant tests pass. No mocked data is shown as live.

### Non-negotiable rules

- Never pay an expense without approval and evidence; never let one person request, approve and pay the same item.
- Never use floating point for money; never post an unbalanced journal; never edit or delete a posted journal.
- Never treat transfers, conversions, equity, SAFEs or loan proceeds as revenue; never record equity on GoJaye Nigeria.
- Never move capital to Nigeria without its CCI, or post an intercompany charge without an agreement.
- Never treat rider fares or customer funds as Jaye revenue without an approved policy.
- Never double-count bank, card and processor events.
- Never expose salaries, receipts, bank details or personal data to investors or unauthorized users; never store banking passwords.
- Never hardcode tax or payroll rates, approval limits, prices or budgets.
- Never file, remit or pay automatically; never move money in a test.
- Never release a government or official payment without legal basis, receipt and CFO approval.
- Never show investors unapproved or live data, or silently change an approved snapshot.
- Never let AI suggestions post, approve or pay without human review.
- Never present invented results as actual.

The ledger is authoritative for balances. Bank, card and processor feeds are evidence. The Jaye platform is the source of commercial events. These are reconciled, never conflated.

### Start here

1. Produce the architecture discovery report.
2. Draft `OPEN_DECISIONS.md` (expense policy and approval limits, categories, fiscal year, accounting framework, FX and constant-currency reference rate, consolidation policy, processor, ₦30 levy policy).
3. Propose domain architecture, data model and application structure, with the spend workflow and ledger posting design reviewed first.
4. Build Phase 1 in small, independently testable increments.
5. Run all tests and explain any failures.
6. Provide a local dev environment with synthetic data for both entities.
7. Document exactly what is needed to deploy to staging and production.

Do not claim an integration works until it passes against the provider's sandbox. Do not claim production readiness until security, accounting, spend, payroll, recovery and end-to-end tests pass and the parallel run is complete.

**Mission:** every dollar and naira GoJaye spends is requested, approved, evidenced, paid, reconciled and reported — so founders control the business and investors can see exactly where their money went.
