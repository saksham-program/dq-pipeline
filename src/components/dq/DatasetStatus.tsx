import { WarnNote } from "./common";
import { evaluationNotices } from "@/lib/dq/dataset-status";
import { useDatasetEvaluations } from "@/lib/dq/hooks";

/**
 * Dataset evaluation warnings. Rendered by BOTH the Dashboard and the Validation Rules page, so the two can
 * never disagree. Renders nothing when there are no datasets, while data is loading, or when nothing needs attention.
 */
export function DatasetStatusNotice() {
  const { evaluations, ready } = useDatasetEvaluations();
  if (!ready) return null;
  const notices = evaluationNotices(evaluations);
  if (!notices.length) return null;
  return (
    <div className="space-y-2" role="region" aria-label="Dataset evaluation status">
      {notices.map((n) => (
        <WarnNote key={n.state}>
          <strong>{n.title}:</strong> {n.detail}
        </WarnNote>
      ))}
    </div>
  );
}
