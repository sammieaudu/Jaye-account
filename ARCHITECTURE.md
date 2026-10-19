# Application architecture

Browser → Next.js (`apps/web`, loopback 3000) → same-origin `/api/*` rewrite → NestJS (`apps/api`, loopback 3001) → SQLite WAL + encrypted local evidence. HttpOnly SameSite Strict random sessions resolve a stored actor. Demo login is public to the local machine by design, not a production identity implementation.

`FinanceStore` implements organization, policies, spend, approvals, vendors, budgets, banking, ledger and audit behavior behind the API. Every mutation involving financial state and audit is wrapped in a synchronous `BEGIN IMMEDIATE` transaction. Nested posting joins that transaction. All money is validated integer minor units; aggregate balancing uses BigInt. Original and functional currencies must match until the FX pack exists.

Posting inserts a draft journal and lines, verifies account/period/balance/approval, and marks it posted. Database triggers independently enforce balance and prevent posted header/line updates, deletes and new lines. Reports include posted entries only. Failed transactions roll back numbering and events. SQLite's file lock serializes writes; PostgreSQL sequences/locks and restricted DB roles still require migration and tests.

Boundary evolution: extract identity, organization, spend, approvals, ledger, banking, reporting and audit Nest modules; retain one transactional finance service. Add queues only for external work; never split posting consistency across queues. Planned PostgreSQL + Redis + encrypted object storage is described in discovery; it is not provisioned.
