# Security model · local shadow only

## Trust boundary

All identities are synthetic. Anyone on the local computer can choose a demo identity; this is not production authentication. API and web bind to loopback. Never expose this service with a tunnel, LAN binding or public reverse proxy. Privileged roles are validated by the API from a stored session, not from client-supplied role headers. Session tokens are cryptographically random, HttpOnly/SameSite Strict and hashed in SQLite; sessions expire after eight hours. Cross-origin browser mutations are rejected for unrecognized Origin headers.

## Data classes and location

SQLite records, encrypted evidence and key files remain in this machine's `data/` directory; no external provider is connected. Local fixture users/vendors/amounts are synthetic. Real NIN/BVN/SSN, payroll, bank details, tax identifiers and banking credentials are excluded. Fonts are bundled locally. NDPA lawful basis, country/region, processor contracts, retention and any cross-border transfer basis require counsel approval before real personal data is introduced.

## Evidence and ledger

Uploads: 8 MB cap, PNG/JPEG/PDF magic-byte/MIME checks, sanitized filenames, AES-256-GCM encryption with unique IV and private key/file permissions, SHA-256 duplicate hashes, authenticated download and immutable metadata. Files are not virus-scanned or structurally validated: do not upload untrusted real documents. Managed scanning/object storage/keys, quarantine and retention remain gates. Local filesystem administrator can tamper with files or schema; audit hash chaining is tamper-evident, not independent write-once retention.

## Required threat work

Replace demo login with SSO/MFA, add idle/risk session controls, rate limits, strict CSP, signed webhooks, object-storage access policies, restricted PostgreSQL roles, infrastructure isolation, secret rotation, backup encryption/restore drills, alerting and independent security review. No production security assessment or recovery SLA is claimed.
