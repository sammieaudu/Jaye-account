/** Shared status treatment for finance lists, details, and payment histories. */
export default function FinanceStatus({ status }: { status: string }) {
  const tone = ["approved", "posted", "cleared", "verified", "active"].includes(
    status,
  )
    ? "success"
    : ["paid", "reconciled"].includes(status)
      ? "info"
      : [
            "pending",
            "review_required",
            "scheduled",
            "manager_review",
            "finance_review",
            "cfo_review",
          ].includes(status)
        ? "warning"
        : status === "rejected"
          ? "danger"
          : "neutral";
  return (
    <span className={`finance-status ${tone}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
