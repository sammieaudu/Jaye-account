# Local operations runbook

Start: `npm run dev` from repository root. Health: `http://127.0.0.1:3001/api/health`. Frontend: `http://localhost:3000`. Ctrl-C stops both services. Restarting preserves data. If ports conflict with the ride platform, stop that local service or configure both Next rewrite and API listen together; do not terminate an unrelated service blindly.

If API is down, the frontend can show an error; restart and press Refresh/Retry. If a state transition fails, inspect role, current state, evidence and SoD first. Use the actual statement amount in minor units; a bank row can match only once. Database constraints intentionally reject duplicates rather than infer replacements.

Backup local data: stop the app, copy the entire data directory (database, evidence and encryption key) to a private location, then restart. Restore only into an isolated local copy and compare entity trial balances and audit verification. Do not copy a database without its evidence key. No PITR/RPO/RTO has been measured.

The local database owner can bypass schema controls and the encryption key is on the same machine: keep real data out. Production key custody, monitoring, incident response, migration rollback and quarterly restore procedures must be established before deployment. Do not delete or reset this directory without preserving test work you need.
