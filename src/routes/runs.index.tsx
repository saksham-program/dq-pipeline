import { createFileRoute } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, StageFlow, StatusBadge, RunLink } from "@/components/dq/common";
import { RunPipelineDialog } from "@/components/dq/RunPipelineDialog";
import { RunsTable } from "@/components/dq/RunsTable";
import { ClearRunDataButton } from "@/components/dq/ClearRunDataButton";
import { useRunsInRange } from "@/lib/dq/hooks";
import type { StageName, StageStatus } from "@/lib/dq/types";

export const Route = createFileRoute("/runs/")({
  head: () => ({
    meta: [
      { title: "Pipeline Runs — DQ Pipeline" },
      { name: "description", content: "Monitor pipeline executions, stage status, record counts and reconciliation." },
      { property: "og:title", content: "Pipeline Runs — DQ Pipeline" },
      { property: "og:description", content: "Every execution with a unique Run ID and full logs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RunsPage,
});

function RunsPage() {
  const { data: runs, isLoading } = useRunsInRange();
  const [open, setOpen] = useState(false);
  const active = (runs ?? []).filter((r) => r.status === "running").slice(0, 3);
  return (
    <div className="space-y-6">
      <PageHeader title="Pipeline Runs" description="Each execution receives a unique Run ID and stores stages, counts, violations and logs." actions={<><ClearRunDataButton /><Button onClick={() => setOpen(true)}><Play className="size-4" />Run pipeline</Button></>} />
      {active.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {active.map((r) => (
            <div key={r.id} className="surface space-y-3 p-4"><div className="flex justify-between"><RunLink runId={r.run_id} /><StatusBadge status={r.status} /></div><StageFlow stages={r.stages as Record<StageName, StageStatus>} /></div>
          ))}
        </div>
      )}
      <Panel title="Executions" description={`${runs?.length ?? 0} run(s) in selected date range`}>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <RunsTable runs={runs ?? []} />}
      </Panel>
      <RunPipelineDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
