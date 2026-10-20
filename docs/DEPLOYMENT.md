# Hosted Jaye Finance

## Architecture

Vercel serves the Next.js app. Clerk handles sign-in. The server checks the owner's verified email on every API request, then forwards it to Railway using a server-only shared secret. The backend only accepts the authenticated gateway; demo sign-in is disabled. The initial hosted release permits only the owner (finance role), not additional staff accounts.

Railway runs one Node 24 instance with a persistent volume mounted at `/data`. SQLite, encrypted receipts and their encryption key stay together on that volume. Do not scale to multiple replicas, use an ephemeral filesystem or import the local database without explicitly deciding to migrate those records. A fresh deployment starts empty.

## Railway

Use the repository Dockerfile and railway.json. Attach a volume at `/data` before starting the service. Configure:

- `JAYE_MODE=hosted`
- `JAYE_DB_PATH=/data/jaye.db`
- `JAYE_API_SECRET`: randomly generated secret of at least 64 characters
- `NODE_ENV=production`

Create a Railway public domain for Vercel to call. `/api/health` is public; all financial endpoints require the gateway secret. Configure persistent-volume backups in Railway and perform a restore rehearsal before relying on it as the only copy of business records. The encryption key must be included in backups alongside the database and receipts.

## Vercel

Use `apps/web` as the project root, Next.js framework and Node 24. Connect the Clerk Hobby integration and set:

- `JAYE_MODE=hosted`
- `JAYE_API_URL`: Railway HTTPS origin, without trailing slash
- `JAYE_API_SECRET`: same server-only secret as Railway
- `JAYE_OWNER_EMAIL`: owner's verified email
- `JAYE_APP_ORIGIN`: exact public Vercel/custom origin, without trailing slash
- `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: supplied by Clerk

Never prefix the gateway secret or Clerk secret with `NEXT_PUBLIC_`. Never commit secrets. Set preview environments separately; don't point an unreviewed preview at the live financial database. Configure Clerk's production domain and allowed sign-in methods before launch. Owner signs in personally and verifies their email.

## Acceptance checks

1. Anonymous browser sees sign-in, not financial data.
2. Unverified or different email cannot read/write the workspace.
3. Direct backend requests and demo login fail, even with an old local session cookie.
4. Owner can record and revisit an expense through Vercel.
5. Restart the backend and verify the record and its attachment persist.
6. Refund/payment retries and bank matching leave reports balanced (automated regression suite).
7. Check backups and restore before importing existing records.

Vercel functions impose a request body limit; large attachments may need direct object-storage uploads in a later release. This remains a management-recordkeeping system: it does not calculate statutory payroll deductions or send bank payments.
