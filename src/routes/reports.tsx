import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, FileBarChart } from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, Kpi, PageHeader, Panel, fmt } from "@/components/dq/common";
import { downloadCsv } from "@/lib/dq/csv";
import { fetchAllRecords, getValidationResults, getViolationCounts } from "@/lib/dq/db";
import { useRunsInRange } from "@/lib/dq/hooks";
import { chartCursor, chartGrid, chartLegend, chartTooltip, trendByDay, VIOLATION_LABELS } from "@/lib/dq/analytics";
import { Gauge, Percent, CheckCircle2, AlertTriangle } from "lucide-react";
import type { Violation } from "@/lib/dq/types";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Analytics — DQ Pipeline" },
      { name: "description", content: "Quality scores by dataset and source, failure analytics and downloadable CSV reports." },
      { property: "og:title", content: "Reports — DQ Pipeline" },
      { property: "og:description", content: "Data-quality analytics and CSV exports from stored runs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reports,
});

const axis = { tick: { fontSize: 11, fill: "var(--muted-foreground)" }, axisLine: false, tickLine: false } as const;

function Reports() {
  const { data: runs } = useRunsInRange();
  const done = (runs ?? []).filter((r) => r.status !== "running");
  const evaluated = done.filter((r) => r.status !== "not_evaluated"); // quality only counts runs that executed rules
  const ids = done.map((r) => r.run_id);
  const { data: vio } = useQuery({ queryKey: ["vio-all", ids], queryFn: () => getViolationCounts(ids), enabled: !!runs });

  const a = useMemo(() => {
    const src = evaluated.reduce((s, r) => s + r.source_count, 0), acc = evaluated.reduce((s, r) => s + r.accepted_count, 0), rej = evaluated.reduce((s, r) => s + r.rejected_count, 0);
    const group = (key: (r: (typeof done)[number]) => string) => {
      const m = new Map<string, { name: string; src: number; acc: number }>();
      for (const r of evaluated) { const k = key(r); const e = m.get(k) ?? { name: k, src: 0, acc: 0 }; e.src += r.source_count; e.acc += r.accepted_count; m.set(k, e); }
      return [...m.values()].map((e) => ({ name: e.name.replace("[Demo] ", ""), quality: e.src ? +((e.acc / e.src) * 100).toFixed(1) : 0 }));
    };
    const rules = new Map<string, number>();
    for (const v of vio ?? []) rules.set(v.rule_name ?? v.error_type, (rules.get(v.rule_name ?? v.error_type) ?? 0) + 1);
    return {
      score: src ? (acc / src) * 100 : null, rejRate: src ? (rej / src) * 100 : null,
      success: done.length ? (done.filter((r) => r.status !== "failed").length / done.length) * 100 : null,
      byDataset: group((r) => r.dataset_name), bySource: group((r) => r.source_type.toUpperCase()),
      topRules: [...rules.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
      totalViolations: vio?.length ?? 0,
    };
  }, [done, evaluated, vio]);
  const trend = useMemo(() => trendByDay(done), [done]);

  const guard = (fn: () => Promise<void>) => async () => { try { await fn(); } catch (e) { toast.error((e as Error).message); } };
  const reports = [
    { title: "Accepted records", desc: "All loaded rows with run & row number", fn: guard(async () => { const r = await fetchAllRecords("accepted", {}); if (!r.length) throw new Error("No accepted records stored."); downloadCsv("accepted_records.csv", r.map((x) => ({ run_id: x.run_id, row_number: x.row_number, ...(x.record_data as object) }))); }) },
    { title: "Rejected records", desc: "Every rejected row with all reasons", fn: guard(async () => { const r = await fetchAllRecords("rejected", {}); if (!r.length) throw new Error("No rejected records stored."); downloadCsv("rejected_records.csv", r.map((x) => ({ run_id: x.run_id, row_number: x.row_number, severity: x.max_severity, reasons: ((x.rejection_reasons ?? []) as unknown as Violation[]).map((v) => `[${v.rule_name}] ${v.error_message}`).join(" | "), ...(x.record_data as object) }))); }) },
    { title: "Validation results", desc: "Each rule violation, row and message", fn: guard(async () => { const r = await getValidationResults(); if (!r.length) throw new Error("No validation results stored."); downloadCsv("validation_results.csv", r.map((v) => ({ run_id: v.run_id, row_number: v.row_number, column: v.column_name, rule: v.rule_name, error_type: v.error_type, severity: v.severity, message: v.error_message }))); }) },
    { title: "Pipeline execution report", desc: "Counts, status & duration per run", fn: guard(async () => { if (!done.length) throw new Error("No runs in this date range."); downloadCsv("pipeline_execution_report.csv", done.map((r) => ({ run_id: r.run_id, dataset_name: r.dataset_name, source_type: r.source_type, started_at: r.started_at, completed_at: r.completed_at, source_count: r.source_count, accepted_count: r.accepted_count, rejected_count: r.rejected_count, loaded_count: r.loaded_count, load_failures: r.load_failure_count, validation_failures: r.violation_count, reconciliation: r.reconciliation_status, status: r.status, duration_ms: r.duration_ms, error: r.error_message }))); }) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports & Analytics" description="Generated from stored runs in the selected date range." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Overall quality score" value={a.score == null ? (done.length ? "Not evaluated" : "—") : `${a.score.toFixed(1)}%`} icon={Gauge} tone="insight" />
        <Kpi label="Rejection rate" value={a.rejRate == null ? (done.length ? "Not evaluated" : "—") : `${a.rejRate.toFixed(1)}%`} icon={Percent} tone="destructive" />
        <Kpi label="Pipeline success rate" value={a.success == null ? "—" : `${a.success.toFixed(0)}%`} icon={CheckCircle2} tone="success" hint="non-failed runs" />
        <Kpi label="Validation failures" value={fmt(a.totalViolations)} icon={AlertTriangle} tone="warning" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {reports.map((r) => (
          <button key={r.title} onClick={r.fn} className="surface group flex items-start gap-3 p-4 text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-soft hover:shadow-elevated focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
            <span className="rounded-lg bg-primary/10 p-2 text-primary ring-1 ring-primary/15 transition-colors group-hover:bg-brand group-hover:text-primary-foreground"><Download className="size-4" /></span>
            <span><span className="block text-sm font-medium">{r.title} CSV</span><span className="text-xs text-muted-foreground">{r.desc}</span></span>
          </button>
        ))}
      </div>
      {!done.length ? <Panel><Empty icon={FileBarChart} title="No runs in this range">Run a pipeline to populate analytics.</Empty></Panel> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Quality by dataset"><div className="h-60"><ResponsiveContainer><BarChart data={a.byDataset}><defs><linearGradient id="rb1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" /><stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.75} /></linearGradient><linearGradient id="rb2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-3)" /><stop offset="100%" stopColor="var(--chart-fade)" stopOpacity={0.8} /></linearGradient><linearGradient id="rb3" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="var(--chart-4)" /><stop offset="100%" stopColor="var(--chart-5)" /></linearGradient><linearGradient id="rbAcc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-accepted)" /><stop offset="100%" stopColor="var(--chart-accepted)" stopOpacity={0.6} /></linearGradient><linearGradient id="ra1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0.02} /></linearGradient><linearGradient id="ra2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid {...chartGrid} vertical={false} /><XAxis dataKey="name" {...axis} interval={0} angle={-15} textAnchor="end" height={50} /><YAxis {...axis} domain={[0, 100]} width={32} /><Tooltip {...chartTooltip} cursor={chartCursor} /><Bar dataKey="quality" name="Quality %" fill="url(#rb1)" radius={[6, 6, 0, 0]} maxBarSize={44} /></BarChart></ResponsiveContainer></div></Panel>
          <Panel title="Quality by source"><div className="h-60"><ResponsiveContainer><BarChart data={a.bySource}><CartesianGrid {...chartGrid} vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} domain={[0, 100]} width={32} /><Tooltip {...chartTooltip} cursor={chartCursor} /><Bar dataKey="quality" name="Quality %" fill="url(#rb2)" radius={[6, 6, 0, 0]} maxBarSize={56} /></BarChart></ResponsiveContainer></div></Panel>
          <Panel title="Most common validation failures">{a.topRules.length ? <div className="h-60"><ResponsiveContainer><BarChart data={a.topRules} layout="vertical" margin={{ right: 12 }}><XAxis type="number" {...axis} allowDecimals={false} /><YAxis type="category" dataKey="name" {...axis} width={150} /><Tooltip {...chartTooltip} cursor={chartCursor} /><Bar dataKey="count" name="Violations" fill="url(#rb3)" radius={[0, 6, 6, 0]} barSize={14} /></BarChart></ResponsiveContainer></div> : <Empty icon={CheckCircle2} title="No failures" />}</Panel>
          <Panel title="Accepted vs rejected trend"><div className="h-60"><ResponsiveContainer><BarChart data={trend}><CartesianGrid {...chartGrid} vertical={false} /><XAxis dataKey="day" {...axis} /><YAxis {...axis} width={36} /><Tooltip {...chartTooltip} cursor={chartCursor} /><Legend {...chartLegend} /><Bar dataKey="accepted" name="Accepted" stackId="a" fill="url(#rbAcc)" maxBarSize={44} /><Bar dataKey="rejected" name="Rejected" stackId="a" fill="var(--chart-2)" radius={[6, 6, 0, 0]} maxBarSize={44} /></BarChart></ResponsiveContainer></div></Panel>
          <Panel title="Quality % trend"><div className="h-56"><ResponsiveContainer><AreaChart data={trend}><CartesianGrid {...chartGrid} vertical={false} /><XAxis dataKey="day" {...axis} /><YAxis {...axis} domain={[0, 100]} width={32} /><Tooltip {...chartTooltip} cursor={{ stroke: "var(--soft)" }} /><Area type="monotone" dataKey="quality" name="Quality %" stroke="var(--chart-5)" fill="url(#ra1)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--card)", strokeWidth: 2 }} activeDot={{ r: 5 }} /></AreaChart></ResponsiveContainer></div></Panel>
          <Panel title="Avg processing duration (ms)"><div className="h-56"><ResponsiveContainer><AreaChart data={trend}><CartesianGrid {...chartGrid} vertical={false} /><XAxis dataKey="day" {...axis} /><YAxis {...axis} width={44} /><Tooltip {...chartTooltip} cursor={{ stroke: "var(--soft)" }} /><Area type="monotone" dataKey="avgDuration" name="Avg duration (ms)" stroke="var(--chart-4)" fill="url(#ra2)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--card)", strokeWidth: 2 }} activeDot={{ r: 5 }} /></AreaChart></ResponsiveContainer></div></Panel>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Category reference: {Object.values(VIOLATION_LABELS).join(" · ")}</p>
    </div>
  );
}
