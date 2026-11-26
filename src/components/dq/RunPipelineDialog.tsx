import { useNavigate } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDatasets, useRunPipeline } from "@/lib/dq/hooks";
import { StageFlow } from "./common";

export function RunPipelineDialog({ open, onOpenChange, datasetId }: { open: boolean; onOpenChange: (o: boolean) => void; datasetId?: string }) {
  const { data: datasets } = useDatasets();
  const [sel, setSel] = useState(datasetId ?? "");
  const run = useRunPipeline();
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      setSel(datasetId ?? "");
      run.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, datasetId]);
  const finished = run.isSuccess || run.isError;

  return (
    <Dialog open={open} onOpenChange={(o) => !run.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run pipeline</DialogTitle>
          <DialogDescription>Extract → validate → clean → load → publish, using this dataset's enabled rules.</DialogDescription>
        </DialogHeader>
        <Select value={sel} onValueChange={setSel} disabled={run.isPending || finished}>
          <SelectTrigger aria-label="Dataset"><SelectValue placeholder="Choose a dataset" /></SelectTrigger>
          <SelectContent>
            {datasets?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name} · {d.record_count} rows</SelectItem>)}
          </SelectContent>
        </Select>
        {!datasets?.length && <p className="text-xs text-muted-foreground">No datasets yet — upload one or load sample data first.</p>}
        {run.progress && (
          <div className="space-y-3 rounded-md border bg-muted/40 p-4">
            <div className="flex justify-between text-xs"><span className="font-mono">{run.progress.runId}</span></div>
            <StageFlow stages={run.progress.stages} />
            <p className="line-clamp-2 font-mono text-[11px] text-muted-foreground">{run.progress.message}</p>
          </div>
        )}
        <DialogFooter>
          {finished && run.progress?.runId ? (
            <Button onClick={() => { onOpenChange(false); navigate({ to: "/runs/$runId", params: { runId: run.progress!.runId } }); }}>View run details</Button>
          ) : (
            <Button disabled={!sel || run.isPending} onClick={() => run.mutate(sel)}><Play className="size-4" />{run.isPending ? "Running…" : "Run pipeline"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
