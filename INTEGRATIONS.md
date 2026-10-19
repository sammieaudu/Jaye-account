# Integration boundaries

Enabled: local debit statement CSV import and explicitly synthetic/non-bank-executable payment CSV export. No provider integration has been tested or claimed functional. No bank, card, OCR, cap-table, commercial-event or filing connection is configured. No real money is held or moved.

Provider contracts to implement: PaymentProvider (prepare/export/status with idempotency, no inferred paid status); BankFeedProvider (signed statements/events, source refs, original currencies); CardProvider; OcrProvider (human-confirmed candidates); EvidenceScanner; identity claims verifier. Sandbox credentials must be managed outside this repository. Replayed events must not duplicate records; invalid signatures must fail before any mutation. Approval and evidence remain mandatory regardless of provider result.
