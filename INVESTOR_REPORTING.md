# Investor reporting · Phase 2 gate

The investor endpoint returns an empty approved-snapshot list. Financial endpoints reject Investor actors. No live ledger, receipt, vendor, salary or bank data is returned to investors. The empty state explains the freeze/approval requirement; it is not a simulated investor performance dashboard.

Future snapshot formulas must identify period, entity source journals, USD rates, constant-currency reference and eliminations. Gross burn = operating cash outflows by approved definition; net burn = operating cash outflows less operating inflows; runway requires an approved burn basis and usable cash definition. Do not infer driver metrics from accounting records. No burn/runway figure is currently calculated.

CFO-approved snapshots must be immutable and versioned on restatement with reason and approver. Download watermarking, investor access expiry, logged exports, board packs and restricted data room remain unimplemented.
