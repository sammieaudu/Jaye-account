# Test plan and evidence

`npm test` runs isolated temporary SQLite fixtures in `apps/api/test/domain.test.ts`. It does not change the interactive app's records or move money.

Covered: full expense approval/evidence/simulated-payment/imported-statement/posting flow; subset of request→matched-bill commitment flow; missing evidence; direct-state bypass; role elevation/self-approval; approver/releaser/reconciler separation; configured threshold routing; exact duplicate receipt/invoice/spend; MIME validation; encrypted download; government payment block; original currency validation; invalid minor units; own-record/entity scope; investor/admin API denial; unbalanced/unapproved/closed-period posting; SQL immutability; database-level balance guard; idempotency and rolled-back numbering; append-only hash chain; return reason/history; session hashing/logout; CSV formula escaping; persistence; atomic/idempotent statement imports and exact one-time matching.

The local golden flows use synthetic expected outcomes, not adviser-signed reference datasets. The matched request/bill test is not full purchase-order/goods-receipt golden scenario 3. Passing these tests does NOT satisfy all Phase 1 or production exit gates.

Also run `npm run typecheck`, `npm run build`, dependency audit, HTTP checks and browser checks for dashboard/entity switch, draft submission, role switch and reports. Production gaps include PostgreSQL concurrent posting and restricted SQL role; real SSO/MFA; provider sandbox/webhook replay; missing tax/FX packs; PWA/offline; malicious document scanning; performance; statutory exports; full recovery; two-month parallel run and external audit.
