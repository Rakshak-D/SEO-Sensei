import { statusLabels, type CheckStatus } from "../features/analysis/schema";

export function StatusTag({ status }: { status: CheckStatus }) {
  return <span className={"status-tag " + status} aria-label={"Rule status: " + statusLabels[status]}>{statusLabels[status]}</span>;
}
