import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { getWorkspaceCounts, resetWorkspaceData } from "@/lib/dq/db";
import { describeSummary, RESET_CONFIRMATION, type ResetScope } from "@/lib/dq/workspace";

export function ResetWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<ResetScope>("all");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const counts = useQuery({ queryKey: ["workspace-counts"], queryFn: getWorkspaceCounts, staleTime: 0 });

  const reset = useMutation({
    mutationFn: () => resetWorkspaceData(scope),
    onSuccess: (r) => {
      toast.success("Workspace reset", { description: `${describeSummary(r.summary)}.${r.mode === "ordered" ? " (Migration 0002 is not applied, so this ran as ordered deletes rather than one transaction.)" : ""}`, duration: 9000 });
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.error(`Workspace was not reset: ${e.message}`);
    },
  });

  const c = counts.data;
  const n = c ? (scope === "all" ? c : { ...c, datasets: c.sampleDatasets }) : null;
  const ready = typed === RESET_CONFIRMATION && !reset.isPending && !!c;
  const submit = () => {
    if (!ready || reset.isPending) return; // prevents double submission
    setError("");
    reset.mutate();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !reset.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive"><RotateCcw className="size-5" />Reset workspace</DialogTitle>
          <DialogDescription>Removes data in dependency order: accepted/rejected records, logs, validation results, runs, rules, then datasets.</DialogDescription>
        </DialogHeader>

        <RadioGroup value={scope} onValueChange={(v) => setScope(v as ResetScope)} className="space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-destructive/30 p-3">
            <RadioGroupItem value="all" className="mt-1" />
            <span className="text-sm"><span className="block font-medium">Everything in this workspace</span><span className="block text-xs text-muted-foreground">All datasets (including your uploads), their rules, runs, logs, results and records.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <RadioGroupItem value="samples" className="mt-1" />
            <span className="text-sm"><span className="block font-medium">Built-in sample data only</span><span className="block text-xs text-muted-foreground">Datasets labelled [Demo] and their runs. Your own uploads are kept.</span></span>
          </label>
        </RadioGroup>

        <div className="rounded-md border p-3 text-xs" aria-live="polite">
          {counts.isLoading ? "Counting…" : counts.isError ? <span className="text-destructive">Could not count rows: {(counts.error as Error).message}</span> : n && (
            <ul className="space-y-0.5">
              <li><strong>{n.datasets}</strong> dataset(s) · <strong>{n.rules}</strong> rule(s) · <strong>{n.runs}</strong> run(s)</li>
              <li><strong>{n.results}</strong> validation result(s) · <strong>{n.logs}</strong> log line(s) · <strong>{n.acceptedRecords + n.rejectedRecords}</strong> accepted/rejected record(s)</li>
              {scope === "samples" && <li className="text-muted-foreground">Counts of rules/runs/records above are workspace totals; only those belonging to sample datasets are removed.</li>}
            </ul>
          )}
        </div>
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span><strong>Kept:</strong> your settings, the database schema and migrations. This cannot be undone.</span>
        </div>
        <div className="space-y-1">
          <Label htmlFor="reset-confirm">Type {RESET_CONFIRMATION} to confirm</Label>
          <Input id="reset-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={reset.isPending} />
        </div>
        {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={reset.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!ready}>{reset.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{reset.isPending ? "Resetting…" : "Reset workspace"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
