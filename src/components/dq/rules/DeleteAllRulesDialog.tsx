import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteRulesByScope, type DatasetLite, type RuleRow } from "@/lib/dq/db";

/** Typed word required to delete rules across every dataset. */
export const DELETE_ALL_WORD = "DELETE";

export function DeleteAllRulesDialog({ onClose, datasets, rules, defaultDatasetId }: { onClose: () => void; datasets: DatasetLite[] | undefined; rules: RuleRow[]; defaultDatasetId: string }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"dataset" | "all">("dataset");
  const [datasetId, setDatasetId] = useState(defaultDatasetId);
  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");

  const perDataset = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rules) m.set(r.dataset_id, (m.get(r.dataset_id) ?? 0) + 1);
    return m;
  }, [rules]);
  const datasetCount = perDataset.get(datasetId) ?? 0;
  const allCount = rules.length;
  const count = scope === "dataset" ? datasetCount : allCount;
  const datasetName = datasets?.find((d) => d.id === datasetId)?.name ?? "the selected dataset";

  const del = useMutation({
    mutationFn: () => deleteRulesByScope(scope === "dataset" ? { scope: "dataset", datasetId } : { scope: "all" }),
    onSuccess: (r) => {
      toast.success(`${r.deleted} validation rule(s) deleted. Datasets and pipeline history were not touched.`);
      qc.invalidateQueries(); // rules list, "not evaluated" warning, dashboard and reports
      onClose();
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.error(`No rules were deleted: ${e.message}`);
    },
  });

  const ready = count > 0 && understood && (scope === "dataset" || typed === DELETE_ALL_WORD) && !del.isPending;
  const submit = () => {
    if (!ready || del.isPending) return; // guards against double submission
    setError("");
    del.mutate();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive"><Trash2 className="size-5" />Delete all rules</DialogTitle>
          <DialogDescription>Deletes validation rules only. Datasets, pipeline runs, logs and rejected/accepted records are kept.</DialogDescription>
        </DialogHeader>

        <RadioGroup value={scope} onValueChange={(v) => { setScope(v as "dataset" | "all"); setUnderstood(false); setTyped(""); setError(""); }} className="space-y-3">
          <div className="rounded-lg border p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <RadioGroupItem value="dataset" id="scope-dataset" className="mt-1" />
              <span className="flex-1 space-y-2">
                <span className="block text-sm font-medium">Rules for one dataset</span>
                <Select value={datasetId} onValueChange={(v) => { setDatasetId(v); setUnderstood(false); }}>
                  <SelectTrigger aria-label="Dataset" disabled={scope !== "dataset"}><SelectValue placeholder="Choose dataset" /></SelectTrigger>
                  <SelectContent>{datasets?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name} — {perDataset.get(d.id) ?? 0} rule(s)</SelectItem>)}</SelectContent>
                </Select>
                <span className="block text-xs text-muted-foreground">{datasetCount} rule(s) in {datasetName} will be deleted.</span>
              </span>
            </label>
          </div>
          <div className="rounded-lg border border-destructive/30 p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <RadioGroupItem value="all" id="scope-all" className="mt-1" />
              <span className="flex-1">
                <span className="block text-sm font-medium">Rules across all datasets</span>
                <span className="block text-xs text-muted-foreground">{allCount} rule(s) across {perDataset.size} dataset(s) will be deleted.</span>
              </span>
            </label>
          </div>
        </RadioGroup>

        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>After deletion those datasets will have no active rules, so their next runs are reported as “Not evaluated”. This cannot be undone.</span>
        </div>

        <label className="flex items-center gap-2 text-sm"><Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} disabled={count === 0 || del.isPending} />I understand that {count} rule(s) will be permanently deleted.</label>
        {scope === "all" && (
          <div className="space-y-1">
            <Label htmlFor="del-all">Type {DELETE_ALL_WORD} to confirm deleting every rule</Label>
            <Input id="del-all" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={del.isPending} />
          </div>
        )}
        {count === 0 && <p className="text-xs text-muted-foreground">There are no rules in this scope.</p>}
        {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={del.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!ready}>
            {del.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {del.isPending ? "Deleting…" : `Delete ${count} rule(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
