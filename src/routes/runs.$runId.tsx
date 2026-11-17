import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, RotateCcw, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, Kpi, Panel, StageFlow, StatusBadge, fmt, fmtDate, fmtMs, runQuality } from "@/components/dq/common";
import { RunPipelineDialog } from "@/components/dq/RunPipelineDialog";
import { downloadCsv } from "@/lib/dq/csv";
import { fetchAllRecords, getLogs, getRun, getValidationResults } from "@/lib/dq/db";
import { reconcile } from "@/lib/dq/engine";
import { VIOLATION_LABELS } from "@/lib/dq/analytics";
import { cn } from "@/lib/utils";
import type { StageName, StageStatus, Violation } from "@/lib/dq/types";
import { CheckCircle2, Clock, Gauge, Layers, XCircle } from "lucide-react";

export const Route = createFileRoute("/runs/$runId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.runId} — DQ Pipeline` },
      { name: "description", content: `Execution summary, validation results, reconciliation and logs for pipeline run ${params.runId}.` },
      { property: "og:title", content: `${params.runId} — DQ Pipeline` },
      { property: "og:description", content: "Pipeline execution details." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RunDetail,
});

function RunDetail() {
  const { runId } = Route.useParams();
  const [rerun, setRerun] = useState(false);
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => getRun(runId), refetchInterval: (q) => (q.state.data?.status === "running" ? 1500 : false) });
  const logs = useQuery({ queryKey: ["logs", runId], queryFn: () => getLogs(runId), enabled: run.data?.status !== "running" });
  const results = useQuery({ queryKey: ["results", runId], queryFn: () => getValidationResults(runId) });
  const rejected = useQuery({ queryKey: ["rejected", runId], queryFn: () => fetchAllRecords("rejected", { runId }) });

  const byRule = useMemo(() => {
    const m = new Map<string, { rule: string; type: string; severity: string; count: number }>();
    for (const v of results.data ?? []) {
      const k = `${v.rule_name}|${v.error_type}`;
      const e = m.get(k) ?? { rule: v.rule_name ?? "—", type: v.error_type, severity: v.severity, count: 0 };
      e.count++;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [results.data]);

  if (run.isLoading) return <Skeleton className="h-96" />;
  const r = run.data;
  if (!r) return <Empty icon={ScrollText} title={`Run ${runId} not found`}><Link to="/runs" className="text-primary">Back to runs</Link></Empty>;
  const rec = reconcile(r.source_count, r.accepted_count, r.rejected_count, r.loaded_count, r.load_failure_count);
  const finished = r.status !== "running" && r.status !== "pending";
  const datasetLevel = (results.data ?? []).filter((v) => v.row_number === null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild><Link to="/runs" aria-label="Back"><ArrowLeft className="size-4" /></Link></Button>
          <div>
            <div className="flex items-center gap-2"><h1 className="font-mono text-lg font-semibold">{r.run_id}</h1><StatusBadge status={r.status} />{r.is_sample && <StatusBadge status="demo" />}</div>
            <p className="text-xs text-muted-foreground">{r.dataset_name} · {fmtDate(r.started_at)} → {fmtDate(r.completed_at)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.dataset_id && <Button variant="outline" size="sm" onClick={() => setRerun(true)}><RotateCcw className="size-3.5" />Run again</Button>}
          <Button variant="outline" size="sm" onClick={() => downloadCsv(`${r.run_id}_validation_results.csv`, (results.data ?? []).map((v) => ({ run_id: v.run_id, row_number: v.row_number, column: v.column_name, rule: v.rule_name, error_type: v.error_type, severity: v.severity, message: v.error_message })))}><Download className="size-3.5" />Validation CSV</Button>
          <Button variant="outline" size="sm" onClick={async () => downloadCsv(`${r.run_id}_accepted.csv`, (await fetchAllRecords("accepted", { runId: r.run_id })).map((x) => ({ row_number: x.row_number, ...(x.record_data as object) })))}><Download className="size-3.5" />Accepted CSV</Button>
        </div>
      </div>

      {r.status === "not_evaluated" && <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning"><strong>Not evaluated — no active validation rules.</strong> Records were passed through without validation, so data quality is unknown. Add or enable rules on the Validation Rules page and run again.</div>}
      {r.error_message && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><strong>Error:</strong> {r.error_message}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Source records" value={fmt(r.source_count)} icon={Layers} />
        <Kpi label="Accepted" value={fmt(r.accepted_count)} icon={CheckCircle2} tone="success" />
        <Kpi label="Rejected" value={fmt(r.rejected_count)} icon={XCircle} tone="destructive" hint={`${fmt(r.violation_count)} violation(s)`} />
        <Kpi label="Quality" value={runQuality(r)} icon={Gauge} tone="insight" />
        <Kpi label="Duration" value={fmtMs(r.duration_ms)} icon={Clock} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Stage-by-stage status"><StageFlow stages={r.stages as Record<StageName, StageStatus>} /></Panel>
        <Panel title="Source-to-target reconciliation" actions={finished && <StatusBadge status={rec.status} />}>
          <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            {[["Source", rec.source], ["Accepted", rec.accepted], ["Rejected", rec.rejected], ["Loaded", rec.loaded], ["Load fail", rec.loadFailures], ["Difference", rec.sourceDiff + rec.loadDiff]].map(([l, v]) => (
              <div key={l} className={cn("rounded-md bg-muted/60 p-2", l === "Difference" && v !== 0 && "bg-destructive/15 text-destructive")}><div className="text-[10px] text-muted-foreground uppercase">{l}</div><div className="font-mono text-sm font-semibold">{fmt(v as number)}</div></div>
            ))}
          </div>
          <div className="mt-3 space-y-1 font-mono text-[11px] text-muted-foreground">
            <div className={rec.sourceDiff ? "text-destructive" : ""}>source {rec.source} = accepted {rec.accepted} + rejected {rec.rejected} → diff {rec.sourceDiff}</div>
            <div className={rec.loadDiff ? "text-destructive" : ""}>accepted {rec.accepted} = loaded {rec.loaded} + failures {rec.loadFailures} → diff {rec.loadDiff}</div>
          </div>
        </Panel>
      </div>

      <Tabs defaultValue="validation">
        <TabsList className="flex-wrap">
          <TabsTrigger value="validation">Validation summary</TabsTrigger>
          <TabsTrigger value="rejected">Rejected records ({fmt(r.rejected_count)})</TabsTrigger>
          <TabsTrigger value="logs">Execution logs</TabsTrigger>
        </TabsList>
        <TabsContent value="validation" className="mt-4 space-y-4">
          {datasetLevel.length > 0 && (
            <Panel title="Dataset-level findings" description="Schema and record-count checks">
              <ul className="space-y-1.5">{datasetLevel.map((v) => <li key={v.id} className="flex items-start gap-2 text-xs"><StatusBadge status={v.severity} /><span>{v.error_message}</span></li>)}</ul>
            </Panel>
          )}
          <Panel title="Failed validation rules">
            {!byRule.length ? <Empty icon={CheckCircle2} title="All rules passed" /> : (
              <div className="-m-5 overflow-x-auto"><Table>
                <TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Category</TableHead><TableHead>Severity</TableHead><TableHead className="text-right">Violations</TableHead></TableRow></TableHeader>
                <TableBody>{byRule.map((b) => <TableRow key={b.rule + b.type}><TableCell className="font-medium">{b.rule}</TableCell><TableCell className="text-xs">{VIOLATION_LABELS[b.type] ?? b.type}</TableCell><TableCell><StatusBadge status={b.severity} /></TableCell><TableCell className="text-right font-mono">{b.count}</TableCell></TableRow>)}</TableBody>
              </Table></div>
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="rejected" className="mt-4">
          <Panel>
            {!rejected.data?.length ? <Empty icon={CheckCircle2} title="No rejected records" /> : (
              <div className="-m-5 max-h-[520px] overflow-auto"><Table>
                <TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Reasons</TableHead><TableHead>Record</TableHead></TableRow></TableHeader>
                <TableBody>{rejected.data.map((x) => (
                  <TableRow key={x.id} className="align-top">
                    <TableCell className="font-mono text-xs">{x.row_number}</TableCell>
                    <TableCell><ul className="space-y-1">{((x.rejection_reasons ?? []) as unknown as Violation[]).map((v, i) => <li key={i} className="flex items-start gap-1.5 text-xs"><StatusBadge status={v.severity} /><span>{v.error_message}</span></li>)}</ul></TableCell>
                    <TableCell className="max-w-md truncate font-mono text-[11px] text-muted-foreground">{JSON.stringify(x.record_data)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table></div>
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="logs" className="mt-4">
          <Panel>
            {!logs.data?.length ? <Empty icon={ScrollText} title={finished ? "No logs stored" : "Logs are written when the run finishes"} /> : (
              <ol className="max-h-[520px] space-y-0.5 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-[11px]">
                {logs.data.map((l) => (
                  <li key={l.id} className="grid grid-cols-[88px_72px_56px_1fr] gap-2">
                    <span className="text-muted-foreground">{new Date(l.timestamp).toLocaleTimeString(undefined, { hour12: false })}.{String(new Date(l.timestamp).getMilliseconds()).padStart(3, "0")}</span>
                    <span className="text-cyan uppercase">{l.stage}</span>
                    <span className={cn("uppercase", l.log_level === "error" && "text-destructive", l.log_level === "warn" && "text-warning", l.log_level === "success" && "text-success")}>{l.log_level}</span>
                    <span className="break-words">{l.message}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
      <RunPipelineDialog open={rerun} onOpenChange={setRerun} datasetId={r.dataset_id ?? undefined} />
    </div>
  );
}
