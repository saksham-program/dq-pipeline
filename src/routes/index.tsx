import { DatasetStatusNotice } from "@/components/dq/DatasetStatus";
import { evaluationBadge } from "@/lib/dq/dataset-status";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, Clock, Database, Download, FlaskConical, Gauge, ListChecks, Play, Plus, Upload, XCircle, Layers, ScrollText, Globe } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, Kpi, Panel, RunLink, StageFlow, StatusBadge, fmt, fmtDate, fmtMs } from "@/components/dq/common";
import { RunPipelineDialog } from "@/components/dq/RunPipelineDialog";
import { getViolationCounts, loadSampleData } from "@/lib/dq/db";
import { useDatasets, useRunsInRange, useDatasetEvaluations } from "@/lib/dq/hooks";
import { RANGE_LABEL, useAppState } from "@/lib/app-state";
import { chartAxis, chartCursor, chartGrid, chartLegend, chartTooltip, halfDelta, metricFailed, isEvaluated, metricQuality, metricRecords, trendByDay, VIOLATION_LABELS } from "@/lib/dq/analytics";
import type { StageName, StageStatus } from "@/lib/dq/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — DQ Pipeline" },
      { name: "description", content: "Live data-quality KPIs, pipeline execution flow and validation failure analytics." },
      { property: "og:title", content: "DQ Pipeline Dashboard" },
      { property: "og:description", content: "Monitor data quality and pipeline health across all sources." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});


function Dashboard() {
  const { data: runs, isLoading } = useRunsInRange();
  const { data: datasets } = useDatasets();
  const { evaluations } = useDatasetEvaluations();
  const { range } = useAppState();
  const [runOpen, setRunOpen] = useState(false);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const runIds = runs?.map((r) => r.run_id);
  const { data: violations } = useQuery({ queryKey: ["violations", runIds], queryFn: () => getViolationCounts(runIds), enabled: !!runIds });
  const sample = useMutation({ mutationFn: loadSampleData, onSuccess: () => { toast.success("Demonstration datasets and rules loaded"); qc.invalidateQueries(); }, onError: (e: Error) => toast.error(e.message) });

  const k = useMemo(() => {
    const r = runs ?? [];
    const done = r.filter((x) => x.status !== "running" && x.status !== "pending");
    const src = done.reduce((s, x) => s + x.source_count, 0);
    const acc = done.reduce((s, x) => s + x.accepted_count, 0);
    const rej = done.reduce((s, x) => s + x.rejected_count, 0);
    const dur = done.filter((x) => x.duration_ms != null);
    const ev = done.filter(isEvaluated); // quality only counts runs that executed at least one rule
    const evSrc = ev.reduce((s, x) => s + x.source_count, 0);
    const evAcc = ev.reduce((s, x) => s + x.accepted_count, 0);
    return { src, acc, rej, unevaluated: done.length - ev.length, q: evSrc ? (evAcc / evSrc) * 100 : null, total: r.length, ok: r.filter((x) => x.status === "success" || x.status === "partial_success").length, failed: r.filter((x) => x.status === "failed").length, avg: dur.length ? Math.round(dur.reduce((s, x) => s + (x.duration_ms ?? 0), 0) / dur.length) : null };
  }, [runs]);

  const vCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of violations ?? []) m[v.error_type] = (m[v.error_type] ?? 0) + 1;
    return Object.entries(VIOLATION_LABELS).map(([key, label]) => ({ key, label, count: m[key] ?? 0 }));
  }, [violations]);
  const trend = useMemo(() => trendByDay(runs ?? []), [runs]);
  const deltas = useMemo(() => {
    const done = (runs ?? []).filter((x) => x.status !== "running" && x.status !== "pending");
    return { records: halfDelta(done, metricRecords), quality: halfDelta(done, metricQuality), failed: halfDelta(done, metricFailed) };
  }, [runs]);
  const latest = runs?.[0];
  const filtered = (runs ?? []).filter((r) => !search || `${r.run_id} ${r.dataset_name}`.toLowerCase().includes(search.toLowerCase())).slice(0, 8);
  const lastByDataset = new Map<string, NonNullable<typeof runs>[number]>();
  for (const r of runs ?? []) if (r.dataset_id && !lastByDataset.has(r.dataset_id)) lastByDataset.set(r.dataset_id, r);

  if (isLoading) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;

  const noData = !datasets?.length;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">{RANGE_LABEL[range]} · computed from {fmt(runs?.length)} stored run(s)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild><Link to="/sources"><Upload className="size-3.5" />Upload dataset</Link></Button>
          <Button variant="outline" size="sm" asChild><Link to="/rules"><Plus className="size-3.5" />Add rule</Link></Button>
          <Button variant="outline" size="sm" asChild><Link to="/runs"><ScrollText className="size-3.5" />Run logs</Link></Button>
          <Button variant="outline" size="sm" asChild><Link to="/reports"><Download className="size-3.5" />Reports</Link></Button>
          <Button size="sm" onClick={() => setRunOpen(true)}><Play className="size-3.5" />Run pipeline</Button>
        </div>
      </div>

      <DatasetStatusNotice />

      {noData && (
        <div className="surface relative overflow-hidden border-dashed border-soft p-6"><div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:linear-gradient(90deg,transparent,black)]" />
          <div className="relative flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-insight/10 p-3 text-insight ring-1 ring-insight/20"><FlaskConical className="size-5" /></div>
              <div>
                <p className="font-display text-lg font-bold">Welcome — your workspace is empty</p>
                <p className="text-sm text-muted-foreground">No datasets, rules or pipeline runs exist yet, so every figure below is zero or “Not evaluated”. Nothing is preloaded or estimated.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link to="/sources"><Upload className="size-4" />Upload dataset</Link></Button>
              <Button variant="outline" asChild><Link to="/sources"><Globe className="size-4" />Connect API</Link></Button>
              <Button variant="outline" asChild><Link to="/rules"><Plus className="size-4" />Create validation rule</Link></Button>
              <Button variant="outline" disabled title="Add a dataset first"><Play className="size-4" />Run pipeline</Button>
            </div>
            <p className="text-xs text-muted-foreground">Just exploring? <button type="button" className="font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50" onClick={() => sample.mutate()} disabled={sample.isPending}>{sample.isPending ? "Loading sample datasets…" : "Load sample datasets"}</button> adds 8 labelled [Demo] datasets with ready-made rules. Nothing runs until you click Run pipeline.</p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Records processed" value={fmt(k.src)} icon={Layers} trend={{ delta: deltas.records }} />
        <Kpi label="Accepted records" value={fmt(k.acc)} icon={CheckCircle2} tone="success" />
        <Kpi label="Rejected records" value={fmt(k.rej)} icon={XCircle} tone="destructive" />
        <Kpi label="Data quality" value={k.q == null ? "Not evaluated" : `${k.q.toFixed(1)}%`} icon={Gauge} tone="insight" trend={{ delta: deltas.quality }} hint={k.q == null ? (k.total ? "no run had an active rule" : "no runs yet") : k.unevaluated ? `${k.unevaluated} run(s) had no active rules — excluded` : "accepted ÷ source"} />
        <Kpi label="Pipeline runs" value={fmt(k.total)} icon={Activity} tone="cyan" />
        <Kpi label="Successful runs" value={fmt(k.ok)} icon={CheckCircle2} tone="success" hint="incl. partial success" />
        <Kpi label="Failed runs" value={fmt(k.failed)} icon={XCircle} tone="destructive" trend={{ delta: deltas.failed, goodWhenUp: false }} />
        <Kpi label="Avg processing time" value={k.avg == null ? "Not available" : fmtMs(k.avg)} icon={Clock} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Latest pipeline run" className="lg:col-span-2" actions={latest && <StatusBadge status={latest.status} />}>
          {latest ? (
            <div className="space-y-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <div><dt className="text-muted-foreground">Run ID</dt><dd><RunLink runId={latest.run_id} /></dd></div>
                <div><dt className="text-muted-foreground">Dataset</dt><dd className="truncate font-medium">{latest.dataset_name}</dd></div>
                <div><dt className="text-muted-foreground">Started</dt><dd>{fmtDate(latest.started_at)}</dd></div>
                <div><dt className="text-muted-foreground">Ended</dt><dd>{fmtDate(latest.completed_at)}</dd></div>
                <div><dt className="text-muted-foreground">Duration</dt><dd className="font-mono">{fmtMs(latest.duration_ms)}</dd></div>
                <div><dt className="text-muted-foreground">Records</dt><dd className="font-mono">{fmt(latest.source_count)}</dd></div>
              </dl>
              <StageFlow stages={latest.stages as Record<StageName, StageStatus>} />
            </div>
          ) : <Empty icon={Play} title="No runs yet">Run a pipeline to see its execution flow here.</Empty>}
        </Panel>
        <Panel title="Accepted vs rejected" description="Records per day" className="lg:col-span-3">
          {trend.length ? (
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-accepted)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--chart-accepted)" stopOpacity={0.02} /></linearGradient>
                    <linearGradient id="gaStroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="var(--chart-accepted)" /><stop offset="100%" stopColor="var(--chart-1)" /></linearGradient>
                    <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid {...chartGrid} vertical={false} />
                  <XAxis dataKey="day" {...chartAxis} />
                  <YAxis {...chartAxis} width={36} />
                  <Tooltip {...chartTooltip} cursor={{ stroke: "var(--soft)", strokeWidth: 1 }} />
                  <Legend {...chartLegend} />
                  <Area type="monotone" name="Accepted" dataKey="accepted" stroke="url(#gaStroke)" fill="url(#ga)" strokeWidth={2.5} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
                  <Area type="monotone" name="Rejected" dataKey="rejected" stroke="var(--chart-2)" fill="url(#gr)" strokeWidth={2} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty icon={Activity} title="No trend data in this range" />}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Validation failures" description="Violations by category" className="lg:col-span-3">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={vCounts} layout="vertical" margin={{ left: 10, right: 12 }}>
                <defs><linearGradient id="gv" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="var(--chart-4)" /><stop offset="100%" stopColor="var(--chart-5)" /></linearGradient></defs>
                <CartesianGrid {...chartGrid} horizontal={false} />
                <XAxis type="number" {...chartAxis} allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={120} {...chartAxis} />
                <Tooltip {...chartTooltip} cursor={chartCursor} />
                <Bar dataKey="count" name="Violations" fill="url(#gv)" radius={[0, 6, 6, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Data quality" className="lg:col-span-2">
          <div className="space-y-4">
            <div className="flex items-baseline gap-2"><span className="font-display text-5xl font-bold tracking-tight text-brand">{k.q == null ? "—" : k.q.toFixed(1)}</span>{k.q != null && <span className="text-muted-foreground">%</span>}</div>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
              <div className="rounded-full bg-success transition-all duration-500" style={{ width: k.src ? `${(k.acc / k.src) * 100}%` : 0 }} />
              <div className="rounded-full bg-destructive transition-all duration-500" style={{ width: k.src ? `${(k.rej / k.src) * 100}%` : 0 }} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-success/20 bg-success/8 p-3"><div className="text-muted-foreground">Valid</div><div className="font-display text-lg font-bold text-success">{fmt(k.acc)}</div></div>
              <div className="rounded-lg border border-destructive/20 bg-destructive/8 p-3"><div className="text-muted-foreground">Rejected</div><div className="font-display text-lg font-bold text-destructive">{fmt(k.rej)}</div></div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Recent pipeline runs" className="lg:col-span-2" actions={<Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-7 w-40 text-xs" aria-label="Search recent runs" />}>
          {filtered.length ? (
            <div className="-m-5 overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Run ID</TableHead><TableHead>Source</TableHead><TableHead>Dataset</TableHead><TableHead>Started</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Records</TableHead><TableHead className="text-right">Duration</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><RunLink runId={r.run_id} /></TableCell>
                      <TableCell><StatusBadge status={r.source_type} /></TableCell>
                      <TableCell className="max-w-40 truncate text-xs">{r.dataset_name}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.started_at)}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(r.source_count)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtMs(r.duration_ms)}</TableCell>
                      <TableCell><Button variant="ghost" size="sm" asChild><Link to="/runs/$runId" params={{ runId: r.run_id }}>View</Link></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : <Empty icon={Activity} title="No runs found" />}
        </Panel>
        <Panel title="Source health">
          {datasets?.length ? (
            <ul className="space-y-2">
              {datasets.slice(0, 8).map((d) => {
                const lr = lastByDataset.get(d.id);
                return (
                  <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-soft hover:bg-accent/40">
                    <div className="min-w-0"><div className="truncate text-xs font-medium">{d.name}</div><div className="text-[11px] text-muted-foreground">{d.record_count} rows · {d.source_type.toUpperCase()}</div></div>
                    <StatusBadge status={(() => { const e = evaluations.find((x) => x.id === d.id); return e ? evaluationBadge(e.state) : (lr?.status ?? "pending"); })()} />
                  </li>
                );
              })}
            </ul>
          ) : <Empty icon={Database} title="No sources registered" />}
          <Button variant="link" size="sm" className="mt-2 px-0" asChild><Link to="/rules"><ListChecks className="size-3.5" />Manage rules</Link></Button>
        </Panel>
      </div>
      <RunPipelineDialog open={runOpen} onOpenChange={setRunOpen} />
    </div>
  );
}
