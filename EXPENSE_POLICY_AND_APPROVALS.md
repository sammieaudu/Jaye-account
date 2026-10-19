# Expense policy and approvals · draft

Local sequence: draft → manager_review → finance_review → cfo_review if configured threshold, missing/over budget or related party requires it → approved → scheduled → paid → reconciled → posted. Requests stop at approved and reserve budget; a matched bill continues the workflow. Return/rejection retains history; returning requires a written reason. Draft editing UI is still pending, but additional evidence can be attached before resubmission.

Policies are stored per entity, not embedded in workflow thresholds. Synthetic seed bands are USD 1,000 and NGN 500,000. Broader department/category rules, absence delegation, split-spend and merchant-classifier checks remain pending. Receipt hashes, same vendor/amount/day and vendor invoice uniqueness implement exact duplicate controls, not perceptual image matching.

Evidence is mandatory for expenses and bills at submission and scheduling. No loss affidavit exception is available. Government fees are blocked rather than paid without the required legal/official evidence controls. Requester, reviewers, payment releaser and reconciler must be different user IDs, even if a test actor's role changes. Finance reviewer may schedule and later post; neither action releases funds.

Commitment = approved/scheduled/paid/reconciled amounts. Actual = posted amounts. A linked approved bill replaces the request's commitment; no double count. Missing budget and overrun escalate to CFO. Configured alert percentage is retained for a future alert service; automated threshold notifications are not delivered.
