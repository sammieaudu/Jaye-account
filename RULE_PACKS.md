# Rule packs · design contract

No tax or payroll pack is installed. Approval bands and budgets are synthetic configuration, not approved tax rules. A future pack must include jurisdiction, entity applicability, source links, effective interval, immutable version, adviser approval and signed golden-test results. Changes must preserve historical calculations and never silently restate approved periods.

Tax-specific calculations stay off until source verification and professional approval. Missing configuration must block calculation instead of supplying remembered rates. This implementation asserts no legal rate, filing deadline, tax classification or statutory compliance status.
