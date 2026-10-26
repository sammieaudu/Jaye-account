import type { FinanceStore } from "./domain";

/** Identify the repository's explicit local fixtures. Never delete or rewrite accounting history. */
export function managementExclusions(s: FinanceStore, entity: string) {
  const spends = s
    .all(
      "SELECT id FROM spends WHERE entity_id=? AND purpose='Synthetic scenario for local workflow testing'",
      entity,
    )
    .map((r) => r.id as string);
  const journals = s
    .all(
      `WITH RECURSIVE samples(id) AS (
    SELECT id FROM journals WHERE entity_id=? AND (idempotency_key='seed-opening' OR source_id IN (SELECT id FROM spends WHERE entity_id=? AND purpose='Synthetic scenario for local workflow testing'))
    UNION SELECT j.id FROM journals j JOIN samples p ON j.reversal_of=p.id WHERE j.entity_id=?
  ) SELECT id FROM samples`,
      entity,
      entity,
      entity,
    )
    .map((r) => r.id as string);
  const seeded = s.get(
    "SELECT id FROM journals WHERE entity_id=? AND idempotency_key='seed-opening'",
    entity,
  );
  const budgets = seeded
    ? s
        .all(
          "SELECT id FROM budgets WHERE entity_id=? AND id IN (?,?,?,?,?)",
          entity,
          ...Array.from({ length: 5 }, (_, i) => `${entity}-b${i}`),
        )
        .map((r) => r.id as string)
    : [];
  return {
    spends,
    journals,
    budgets,
    note: "Explicit local sample journals, workflow records and legacy seed budgets are excluded from management reporting. Original accounting history is retained.",
  };
}
