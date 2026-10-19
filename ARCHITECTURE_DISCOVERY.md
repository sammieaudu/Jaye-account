# Architecture discovery · 19 October 2026

## Evidence inspected

The current `Jaye-accountant` directory was empty before this implementation. No existing identity, schema, app, dependency lockfile or production configuration was inherited. The supplied v4 engineering brief is retained unchanged in `docs/MASTER_PROMPT.md`.

Read-only inspection of the neighboring `../jaye_iac` checkout found:

- `gojaye-backend/package.json`: TypeScript, pnpm workspace, NestJS-oriented services including auth, booking, payment, notification, static, analytics and API gateway. The package describes a microservices monorepo, so the brief's “modular monolith” assumption was not confirmed for the ride platform.
- `gojaye-backend/infra/docker-compose.dev.yml`: PostgreSQL 16 and Redis 7 local development services.
- `jaye-helm-deployment/README.md`: shared Helm chart, Argo CD, Gateway API, DOKS-related desired state; DEV/PROD/DR conventions. It explicitly says configuration is not proof of deployment and there is currently no staging environment.
- Terraform modules for DOKS, managed data, Spaces, networking and Cloudflare exist. Their deployment status was not queried.

No secrets, credentials spreadsheet, private employee records or live bank data were read. No neighboring repo or production service was changed. Actual SSO protocol, production databases, provider behavior, secrets bindings, telemetry and active deployments remain unverified.

## Local implementation decision

Separate Next.js + TypeScript frontend and NestJS API, in one npm workspace. Local ports 3000/3001 overlap the neighboring platform's default gateway/auth ports; do not run those simultaneously without reconfiguration. No ride-platform integration is enabled.

The Docker client is installed but the daemon was unavailable. Use Node's SQLite adapter for persistent, loopback-only local testing; PostgreSQL remains required before staging. SQLite transaction serialization and triggers provide a useful control test, not proof of PostgreSQL concurrency, privileges or recovery behavior.

## Production discovery still required

Confirm auth token validation, tenant/role source, MFA assurance, event/webhook signing, network boundaries, database isolation, queue conventions, object-storage region, CI image signing and secret rotation with the infrastructure owners. The finance environment needs its own data services and promotion gates; reuse approved platform conventions only after review.
