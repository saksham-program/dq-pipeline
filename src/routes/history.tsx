import { createFileRoute } from "@tanstack/react-router";
import { GitCompare, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, RunLink, StatusBadge, fmt, fmtMs, runQuality } from "@/components/dq/common";
import { RunsTable } from "@/components/dq/RunsTable";
import { ClearRunDataButton } from "@/components/dq/ClearRunDataButton";
import { getViolationCounts } from "@/lib/dq/db";
import { useDatasets, useRuns } from "@/lib/dq/hooks";
import { VIOLATION_LABELS } from "@/lib/dq/analytics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/history")({
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s.q === "string" ? s.q : undefined }),
  head: () => ({
    meta: [
      { title: "Run History — DQ Pipeline" },
      { name: "description", content: "Search and filter historical pipeline runs and compare two executions side by side." },
      { property: "og:title", content: "Run History — DQ Pipeline" },
      { property: "og:description", content: "Historical runs with side-by-side comparison." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: History,
});

const ALL = "__all";

function History() {
  const { q } = Route.useSearch();
  const { data: runs } = useRuns();
  const { data: datasets } = useDatasets();
  const [search, setSearch] = useState(q ?? "");
  const [ds, setDs] = useState(ALL);
  const [src, setSrc] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => setSearch(q ?? ""), [q]);

  const list = useMemo(() => (runs ?? []).filter((r) => {
    const t = new Date(r.started_at).getTime();
    return (!search || `${r.run_id} ${r.dataset_name}`.toLowerCase().includes(search.toLowerCase())) && (ds === ALL || r.dataset_id === ds) && (src === ALL || r.source_type === src) && (status === ALL || r.status === status) && (!from || t >= new Date(from).getTime()) && (!to || t <= new Date(to).getTime() + 86400000);
  }), [runs, search, ds, src, status, from, to]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));
  const pair = sel.map((id) => runs?.find((r) => r.run_id === id)).filter(Boolean) as NonNullable<typeof runs>;
  const vc = useQuery({ queryKey: ["vc", sel], queryFn: () => getViolationCounts(sel), enabled: sel.length === 2 });

  return (
    <div className="space-y-6">
      <PageHeader title="Run History" description="All executions are retained. Tick two runs to compare them." actions={<ClearRunDataButton />} />
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Run ID or dataset" aria-label="Search" className="lg:col-span-2" />
        <Select value={ds} onValueChange={setDs}><SelectTrigger aria-label="Dataset"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All datasets</SelectItem>{datasets?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select>
        <Select value={src} onValueChange={setSrc}><SelectTrigger aria-label="Source"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All sources</SelectItem><SelectItem value="csv">CSV</SelectItem><SelectItem value="api">API</SelectItem></SelectContent></Select>
        <Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All statuses</SelectItem>{["success", "partial_success", "not_evaluated", "failed", "running"].map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent></Select>
        <div className="flex gap-1"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></div>
      </div>

      {pair.length === 2 && (
        <Panel title="Run comparison" actions={<Button variant="ghost" size="sm" onClick={() => setSel([])}><X className="size-3.5" />Clear</Button>}>
          <div className="-m-5 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Metric</TableHead>{pair.map((r) => <TableHead key={r.id}><RunLink runId={r.run_id} /></TableHead>)}<TableHead>Change</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell className="text-xs">Dataset</TableCell>{pair.map((r) => <TableCell key={r.id} className="text-xs">{r.dataset_name}</TableCell>)}<TableCell /></TableRow>
                <TableRow><TableCell className="text-xs">Status</TableCell>{pair.map((r) => <TableCell key={r.id}><StatusBadge status={r.status} /></TableCell>)}<TableCell /></TableRow>
                {([["Source records", "source_count"], ["Accepted", "accepted_count"], ["Rejected", "rejected_count"], ["Loaded", "loaded_count"], ["Violations", "violation_count"], ["Duration (ms)", "duration_ms"]] as const).map(([l, k]) => {
                  const a = pair[0][k] ?? 0, b = pair[1][k] ?? 0;
                  return <TableRow key={k}><TableCell className="text-xs">{l}</TableCell><TableCell className="font-mono text-xs">{fmt(a)}</TableCell><TableCell className="font-mono text-xs">{fmt(b)}</TableCell><TableCell className={cn("font-mono text-xs", b - a > 0 ? "text-warning" : b - a < 0 ? "text-cyan" : "text-muted-foreground")}>{b - a > 0 ? "+" : ""}{fmt(b - a)}</TableCell></TableRow>;
                })}
                <TableRow><TableCell className="text-xs">Quality</TableCell>{pair.map((r) => <TableCell key={r.id} className="font-mono text-xs">{runQuality(r)}</TableCell>)}<TableCell className="font-mono text-xs">{pair[0].source_count && pair[1].source_count ? `${((pair[1].accepted_count / pair[1].source_count - pair[0].accepted_count / pair[0].source_count) * 100).toFixed(1)} pts` : "—"}</TableCell></TableRow>
                {Object.entries(VIOLATION_LABELS).map(([k, l]) => {
                  const c = (id: string) => (vc.data ?? []).filter((v) => v.run_id === id && v.error_type === k).length;
                  const a = c(pair[0].run_id), b = c(pair[1].run_id);
                  if (!a && !b) return null;
                  return <TableRow key={k}><TableCell className="text-xs text-muted-foreground">{l}</TableCell><TableCell className="font-mono text-xs">{a}</TableCell><TableCell className="font-mono text-xs">{b}</TableCell><TableCell className="font-mono text-xs">{b - a > 0 ? "+" : ""}{b - a}</TableCell></TableRow>;
                })}
                <TableRow><TableCell className="text-xs">Errors</TableCell>{pair.map((r) => <TableCell key={r.id} className="max-w-60 text-xs text-destructive">{r.error_message ?? "—"}</TableCell>)}<TableCell /></TableRow>
                <TableRow><TableCell className="text-xs">Duration</TableCell>{pair.map((r) => <TableCell key={r.id} className="font-mono text-xs">{fmtMs(r.duration_ms)}</TableCell>)}<TableCell /></TableRow>
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
      <Panel title={`${list.length} run(s)`} actions={sel.length === 1 && <span className="flex items-center gap-1 text-xs text-muted-foreground"><GitCompare className="size-3.5" />Select one more to compare</span>}>
        <RunsTable runs={list} selected={sel} onToggle={toggle} />
      </Panel>
    </div>
  );
}
