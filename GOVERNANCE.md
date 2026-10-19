# Governance controls

Implemented locally: entity-scoped APIs; employee-own-record access; distinct requester/reviewer/releaser/reconciler; technical administrator blocked from financial actions; investor live-data denial; immutable posted ledger/evidence/audit; exact duplicate detection; government-fee workflow disabled.

Not implemented: confidential whistleblower case channel, intermediary due diligence, out-of-band beneficiary verification, bank-mandate change controls, related-party register with approved ownership records, escalation/delegation, production MFA and privileged alerts. Related-party vendor flags route local requests to CFO. No vendor bank details are captured, so a missing bank-change hold cannot lead to a live payment.

No user can execute real payments or tax filings through this build. Production authority stays with the human decision owners in the master brief and OPEN_DECISIONS.md.
