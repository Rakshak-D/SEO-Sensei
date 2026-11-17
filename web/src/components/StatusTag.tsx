import { statusLabels, type CheckStatus, type FindingImpact } from "../features/analysis/schema";

export function StatusTag({ status }: { status: CheckStatus }) {
  return <span className={"status-tag " + status} aria-label={"Rule status: " + statusLabels[status]}>{statusLabels[status]}</span>;
}

const impactLabels: Record<FindingImpact, string> = {
  blocking: "Blocking",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function ImpactTag({ impact }: { impact: FindingImpact }) {
  return (
    <span className={`impact-tag impact-${impact}`}>
      <span className="impact-mark" aria-hidden="true" />
      {impactLabels[impact]}
    </span>
  );
}
