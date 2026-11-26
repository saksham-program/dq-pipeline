import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, PageHeader, Panel, RunLink, StatusBadge, fmt } from "@/components/dq/common";
import { downloadCsv } from "@/lib/dq/csv";
import { fetchAllRecords, fetchRecords } from "@/lib/dq/db";
import { useDatasets, useRuns } from "@/lib/dq/hooks";
import type { Violation } from "@/lib/dq/types";

export const Route = createFileRoute("/explorer")({
  head: () => ({
    meta: [
      { title: "Data Explorer — DQ Pipeline" },
      { name: "description", content: "Browse accepted and rejected records with search, sorting, filters and CSV export." },
      { property: "og:title", content: "Data Explorer — DQ Pipeline" },
      { property: "og:description", content: "Accepted and rejected records, traceable to their source rows." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Explorer,
});

const PAGE = 25;
const ALL = "__all";

function Explorer() {
  const [tab, setTab] = useState<"accepted" | "rejected">("accepted");
  const [datasetId, setDatasetId] = useState(ALL);
  const [runId, setRunId] = useState(ALL);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sev, setSev] = useState(ALL);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const { data: datasets } = useDatasets();
  const { data: runs } = useRuns();
  const runOptions = (runs ?? []).filter((r) => datasetId === ALL || r.dataset_id === datasetId);
  const filters = { runId: runId === ALL ? undefined : runId, datasetId: datasetId === ALL ? undefined : datasetId };
  const q = useQuery({ queryKey: ["records", tab, filters, page], queryFn: () => fetchRecords(tab, { ...filters, page, pageSize: PAGE }), placeholderData: keepPreviousData });

  const cols = useMemo(() => {
    const s = new Set<string>();
    q.data?.rows.forEach((r) => Object.keys((r.record_data ?? {}) as object).forEach((k) => s.add(k)));
    return [...s].slice(0, 12);
  }, [q.data]);

  const rows = useMemo(() => {
    let list = q.data?.rows ?? [];
    if (search) list = list.filter((r) => JSON.stringify(r.record_data).toLowerCase().includes(search.toLowerCase()) || JSON.stringify(r.rejection_reasons ?? "").toLowerCase().includes(search.toLowerCase()));
    if (tab === "rejected" && sev !== ALL) list = list.filter((r) => r.max_severity === sev);
    if (sort) list = [...list].sort((a, b) => {
      const av = (a.record_data as Record<string, unknown>)[sort.col], bv = (b.record_data as Record<string, unknown>)[sort.col];
      const an = Number(av), bn = Number(bv);
      return (!isNaN(an) && !isNaN(bn) ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""))) * sort.dir;
    });
    return list;
  }, [q.data, search, sort, sev, tab]);
  const total = q.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const exportCsv = async () => {
    const all = await fetchAllRecords(tab, filters);
    if (!all.length) return toast.error("Nothing to export.");
    downloadCsv(`${tab}_records.csv`, all.map((r) => tab === "accepted"
      ? { run_id: r.run_id, row_number: r.row_number, ...(r.record_data as object) }
      : { run_id: r.run_id, row_number: r.row_number, dataset: datasets?.find((d) => d.id === r.dataset_id)?.name, failed_columns: ((r.rejection_reasons ?? []) as unknown as Violation[]).map((v) => v.column_name).join("; "), rules: ((r.rejection_reasons ?? []) as unknown as Violation[]).map((v) => v.rule_name).join("; "), reasons: ((r.rejection_reasons ?? []) as unknown as Violation[]).map((v) => v.error_message).join(" | "), severity: r.max_severity, ...(r.record_data as object) }));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Data Explorer" description="Accepted records are the cleaned output loaded to analytical storage. Rejected records keep every reason they failed." actions={<Button variant="outline" onClick={exportCsv}><Download className="size-4" />Download CSV</Button>} />
      <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setPage(0); setSort(null); }}>
        <TabsList><TabsTrigger value="accepted">Accepted</TabsTrigger><TabsTrigger value="rejected">Rejected</TabsTrigger></TabsList>
      </Tabs>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={datasetId} onValueChange={(v) => { setDatasetId(v); setRunId(ALL); setPage(0); }}><SelectTrigger aria-label="Dataset"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All datasets</SelectItem>{datasets?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select>
        <Select value={runId} onValueChange={(v) => { setRunId(v); setPage(0); }}><SelectTrigger aria-label="Run"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All runs</SelectItem>{runOptions.map((r) => <SelectItem key={r.id} value={r.run_id}>{r.run_id}</SelectItem>)}</SelectContent></Select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search this page…" aria-label="Search records" />
        {tab === "rejected" && <Select value={sev} onValueChange={setSev}><SelectTrigger aria-label="Severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All severities</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="error">Error</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent></Select>}
      </div>
      <Panel title={`${fmt(total)} ${tab} record(s)`}>
        {!rows.length ? <Empty icon={Table2} title={q.isLoading ? "Loading…" : "No records"} /> : (
          <div className="-m-5 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Run</TableHead><TableHead>Row</TableHead>
                {tab === "rejected" && <><TableHead>Severity</TableHead><TableHead className="min-w-72">Failed column · rule · reason</TableHead></>}
                {cols.map((c) => (
                  <TableHead key={c}><button className="inline-flex items-center gap-1 font-mono text-[11px]" onClick={() => setSort((s) => (s?.col === c ? (s.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}>{c}{sort?.col === c && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button></TableHead>
                ))}
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="align-top">
                    <TableCell><RunLink runId={r.run_id} /></TableCell>
                    <TableCell className="font-mono text-xs">{r.row_number}</TableCell>
                    {tab === "rejected" && <>
                      <TableCell><StatusBadge status={r.max_severity ?? "error"} /></TableCell>
                      <TableCell><ul className="space-y-1">{((r.rejection_reasons ?? []) as unknown as Violation[]).map((v, i) => <li key={i} className="text-xs"><span className="font-mono text-primary">{v.column_name ?? "row"}</span> · <span className="font-medium">{v.rule_name}</span> — <span className="text-muted-foreground">{v.error_message}</span></li>)}</ul></TableCell>
                    </>}
                    {cols.map((c) => <TableCell key={c} className="max-w-40 truncate font-mono text-[11px]">{String((r.record_data as Record<string, unknown>)[c] ?? "")}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2 text-xs">
          <span className="text-muted-foreground">Page {page + 1} of {pages}</span>
          <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
          <Button variant="outline" size="icon" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
        </div>
      </Panel>
    </div>
  );
}
