import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getSettings, listDatasets, listRules, listRuns } from "./db";
import { runPipeline, type Progress } from "./runner";
import { rangeStart, useAppState } from "@/lib/app-state";

export const useDatasets = () => useQuery({ queryKey: ["datasets"], queryFn: listDatasets });
export const useRules = () => useQuery({ queryKey: ["rules"], queryFn: listRules });
export const useRuns = () => useQuery({ queryKey: ["runs"], queryFn: listRuns });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: getSettings });

export function useRunsInRange() {
  const q = useRuns();
  const { range } = useAppState();
  const start = rangeStart(range);
  return { ...q, data: q.data?.filter((r) => new Date(r.started_at).getTime() >= start) };
}

export function useRunPipeline() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<Progress | null>(null);
  const m = useMutation({
    mutationFn: (datasetId: string) => runPipeline(datasetId, setProgress),
    onSuccess: (runId) => toast.success(`Pipeline ${runId} finished`),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries(),
  });
  return { ...m, progress, reset: () => { setProgress(null); m.reset(); } };
}
