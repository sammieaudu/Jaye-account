# Local deployment and staging requirements

Run `npm ci && npm run dev` under Node 24.13+; web localhost:3000, API 127.0.0.1:3001. `npm run build && npm start` serves the compiled local app. Optional Docker: `docker compose up --build`, loopback port 3000, persistent named volume. Docker was not executable in this session because its daemon was stopped, so this path is configuration-only until tested.

Do not expose this build publicly. API refuses production environment. Demo identity, local key file, SQLite and synthetic fixtures are unsuitable for production. No infrastructure has been provisioned and existing GoJaye deployment configuration remains untouched.

Before staging: agree a finance-specific environment with infrastructure owner (neighboring repo currently lists DEV/PROD/DR, no staging); replace demo auth; enforce MFA and claims; port to isolated PostgreSQL with app-role restrictions; encrypted scanned object storage; managed secrets; approved policies; provider sandboxes; sanitized staging fixtures; CI threat/migration/integration tests. Route through approved platform Helm/Gateway conventions. A standalone local Docker image is not proof of staging readiness.

Before production: all master-brief acceptance gates, security and accounting sign-off, measured recovery tests, appropriate observability and alerting, signed releases, rollback/roll-forward rehearsal, accountant parallel run and explicit CFO go-live approval. No Terraform or cluster mutation is authorized or performed by this task.
