# Database schema and migrations

Executable local DDL: `apps/api/src/schema.sql`. Version stamps: baseline 1, posted-state enforcement 2, statement imports 3. On first run schema and synthetic fixtures are created; restarts retain records. A local legacy migration adds the posted status and replaces old immutability triggers. Migrations were tested by reopen tests; this is not a PostgreSQL migration framework.

Tables: entities, users, sessions, policies, periods, accounts, vendors, budgets, spends, receipts, journals, lines, bank_transactions, audit, migrations. Financial rows have entity IDs and entity/account/source constraints. Sessions use SHA-256 token hashes. Evidence metadata includes content hash, encrypted path, MIME and synthetic marker. Unique indexes enforce invoice numbers, matched-request conversion, payment references and one-time statement matching.

Journals start as draft, then transition once to posted. Reports exclude drafts. Triggers protect posted journals and lines, evidence metadata and audit events. Strong write consistency uses BEGIN IMMEDIATE and atomic audit writes. SQLite has no restricted application DB role: filesystem/database-owner access is privileged and can drop triggers. Production must use a restricted PostgreSQL role, migrations, posting transaction/function and independent immutable evidence/audit retention.

Full normalized target model is in the master brief; it is not represented as implemented tables. Migration tests for PostgreSQL, malicious direct inserts, large concurrent workloads, recovery and production least privilege remain release gates.
