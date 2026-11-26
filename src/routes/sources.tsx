import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Eye, FileUp, Globe, Lock, Pencil, Play, RefreshCw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Empty, PageHeader, Panel, StatusBadge, WarnNote, fmtDate } from "@/components/dq/common";
import { RunPipelineDialog } from "@/components/dq/RunPipelineDialog";
import { parseCsv } from "@/lib/dq/csv";
import { createDataset, deleteDataset, getDataset, replaceDatasetRows, updateDataset, type DatasetLite } from "@/lib/dq/db";
import { inferSchema, jsonToRows } from "@/lib/dq/engine";
import { fetchApiSource } from "@/lib/dq/api-fetch.functions";
import { useDatasets, useSettings } from "@/lib/dq/hooks";
import type { ColumnInfo, Row } from "@/lib/dq/types";

export const Route = createFileRoute("/sources")({
  head: () => ({
    meta: [
      { title: "Data Sources — DQ Pipeline" },
      { name: "description", content: "Upload CSV files or register JSON API endpoints, inspect schemas and preview records." },
      { property: "og:title", content: "Data Sources — DQ Pipeline" },
      { property: "og:description", content: "CSV and API ingestion with schema inspection." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SourcesPage,
});

function parseHeaders(text: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return h;
}

function Preview({ rows, schema }: { rows: Row[]; schema: ColumnInfo[] }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {schema.map((c) => (
          <span key={c.name} className="rounded border bg-muted/50 px-2 py-0.5 font-mono text-[11px]">{c.name} <span className="text-primary">{c.type}</span>{c.nullCount > 0 && <span className="text-warning"> · {c.nullCount} empty</span>}</span>
        ))}
      </div>
      <div className="max-h-72 overflow-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead className="w-10">#</TableHead>{schema.map((c) => <TableHead key={c.name} className="font-mono text-[11px]">{c.name}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.slice(0, 10).map((r, i) => (
              <TableRow key={i}><TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>{schema.map((c) => <TableCell key={c.name} className="max-w-48 truncate font-mono text-[11px]">{String(r[c.name] ?? "")}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CsvIngest({ maxMb, replaceTarget, onDone }: { maxMb: number; replaceTarget?: DatasetLite | null; onDone: () => void }) {
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parsed, setParsed] = useState<{ rows: Row[]; file: string; errors: string[] } | null>(null);
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const handle = (f: File) => {
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") return toast.error("Please choose a .csv file.");
    if (f.size > maxMb * 1024 * 1024) return toast.error(`File is ${(f.size / 1048576).toFixed(1)} MB — limit is ${maxMb} MB (change it in Settings).`);
    const reader = new FileReader();
    reader.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    reader.onerror = () => toast.error("Could not read the file.");
    reader.onload = () => {
      setProgress(100);
      const res = parseCsv(String(reader.result));
      if (!res.fields.length || !res.rows.length) return toast.error("CSV has no header row or no data rows.");
      setParsed({ rows: res.rows, file: f.name, errors: res.errors });
      setName(replaceTarget?.name ?? f.name.replace(/\.csv$/i, ""));
    };
    reader.readAsText(f);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error("Choose a CSV file before saving.");
      const datasetName = replaceTarget?.name ?? (name.trim() || parsed.file);
      if (replaceTarget) await replaceDatasetRows(replaceTarget.id, parsed.rows, parsed.file);
      else await createDataset({ name: datasetName, source_type: "csv", rows: parsed.rows, uploaded_filename: parsed.file, source_reference: "Uploaded file" });
      return { datasetName, rowCount: parsed.rows.length, replaced: !!replaceTarget };
    },
    onSuccess: async ({ datasetName, rowCount, replaced }) => {
      await qc.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(replaced ? `Updated “${datasetName}” — ${rowCount} rows ready to run.` : `Uploaded “${datasetName}” — ${rowCount} rows ready to run.`);
      setParsed(null);
      setProgress(0);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handle(f); }}
        onClick={() => ref.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && ref.current?.click()}
        role="button" tabIndex={0}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${drag ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}
      >
        <FileUp className="size-6 text-primary" />
        <p className="text-sm font-medium">Drop a CSV here or click to browse</p>
        <p className="text-xs text-muted-foreground">Header row required · max {maxMb} MB</p>
        <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ""; }} />
      </div>
      {progress > 0 && progress < 100 && <Progress value={progress} />}
      {parsed && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 space-y-1"><Label htmlFor="dsname">Dataset name</Label><Input id="dsname" value={name} onChange={(e) => setName(e.target.value)} disabled={!!replaceTarget} /></div>
            <div className="text-xs text-muted-foreground">{parsed.file} · {parsed.rows.length} rows</div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}><Upload className="size-4" />{save.isPending ? "Saving dataset…" : replaceTarget ? "Replace data" : "Register dataset"}</Button>
          </div>
          {parsed.errors.length > 0 && <WarnNote>Parser notes: {parsed.errors.join("; ")}</WarnNote>}
          <Preview rows={parsed.rows} schema={inferSchema(parsed.rows)} />
        </div>
      )}
    </div>
  );
}

function ApiIngest({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("https://jsonplaceholder.typicode.com/users");
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [headers, setHeaders] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ rows: Row[]; status: number; ms: number; requiresAuth: boolean } | null>(null);
  const qc = useQueryClient();
  const test = useMutation({
    mutationFn: async () => {
      const r = await fetchApiSource({ data: { url, method, headers: parseHeaders(headers) } });
      if (!r.ok) {
        if (r.requiresAuth) setResult({ rows: [], status: r.status, ms: r.elapsedMs, requiresAuth: true });
        throw new Error(r.error ?? "Request failed");
      }
      const rows = jsonToRows(JSON.parse(r.jsonText ?? "null"));
      setResult({ rows, status: r.status, ms: r.elapsedMs, requiresAuth: false });
      if (!name) setName(new URL(url).hostname + new URL(url).pathname);
      return rows.length;
    },
    onSuccess: (n) => toast.success(`Connected — ${n} record(s) returned`),
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: () => createDataset({ name: name || url, source_type: "api", rows: result?.rows ?? [], source_reference: url, api_method: method, api_headers: parseHeaders(headers), requires_auth: Object.keys(parseHeaders(headers)).some((h) => /auth|key|token/i.test(h)) }),
    onSuccess: () => { toast.success("API source registered"); setResult(null); qc.invalidateQueries(); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
        <Select value={method} onValueChange={(v) => setMethod(v as "GET" | "POST")}><SelectTrigger aria-label="HTTP method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GET">GET</SelectItem><SelectItem value="POST">POST</SelectItem></SelectContent></Select>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/records" aria-label="API URL" />
      </div>
      <div className="space-y-1"><Label htmlFor="hdr">Optional headers (one per line, Name: value)</Label><Textarea id="hdr" rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Authorization: Bearer …" className="font-mono text-xs" /></div>
      <p className="text-xs text-muted-foreground">The demo URL is a free public test API that needs no key. Headers are stored with the source and sent on every pipeline run.</p>
      <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}><RefreshCw className={`size-4 ${test.isPending ? "animate-spin" : ""}`} />Test connection & fetch</Button>
      {result?.requiresAuth && <WarnNote><Lock className="mr-1 inline size-3" />HTTP {result.status}: this endpoint requires authentication. Add the required header and test again.</WarnNote>}
      {result && !result.requiresAuth && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">HTTP {result.status} · {result.ms} ms · {result.rows.length} records converted</div>
          <div className="flex items-end gap-3"><div className="flex-1 space-y-1"><Label htmlFor="apiname">Source name</Label><Input id="apiname" value={name} onChange={(e) => setName(e.target.value)} /></div><Button onClick={() => save.mutate()} disabled={!result.rows.length || save.isPending}>Register API source</Button></div>
          {result.rows.length > 0 && <Preview rows={result.rows} schema={inferSchema(result.rows)} />}
        </div>
      )}
    </div>
  );
}

function SourcesPage() {
  const { data: datasets, isLoading } = useDatasets();
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const [inspect, setInspect] = useState<DatasetLite | null>(null);
  const [edit, setEdit] = useState<DatasetLite | null>(null);
  const [replace, setReplace] = useState<DatasetLite | null>(null);
  const [del, setDel] = useState<DatasetLite | null>(null);
  const [runFor, setRunFor] = useState<string | undefined>();
  const detail = useQuery({ queryKey: ["dataset", inspect?.id], queryFn: () => getDataset(inspect!.id), enabled: !!inspect });
  const remove = useMutation({ mutationFn: (id: string) => deleteDataset(id), onSuccess: () => { toast.success("Dataset deleted"); qc.invalidateQueries(); }, onError: (e: Error) => toast.error(e.message) });
  const testApi = useMutation({
    mutationFn: async (d: DatasetLite) => { const r = await fetchApiSource({ data: { url: d.source_reference!, method: (d.api_method as "GET") ?? "GET", headers: (d.api_headers ?? {}) as Record<string, string> } }); if (!r.ok) throw new Error(r.error ?? "failed"); return jsonToRows(JSON.parse(r.jsonText ?? "null")).length; },
    onSuccess: (n) => toast.success(`Connection OK — ${n} records available`),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Data Sources" description="Register CSV files and JSON APIs. Original data is stored untouched for traceability." />
      <Panel title="Add a source">
        <Tabs defaultValue="csv">
          <TabsList><TabsTrigger value="csv"><FileUp className="size-3.5" />CSV upload</TabsTrigger><TabsTrigger value="api"><Globe className="size-3.5" />API endpoint</TabsTrigger></TabsList>
          <TabsContent value="csv" className="pt-4"><CsvIngest maxMb={settings?.maxUploadMb ?? 5} onDone={() => {}} /></TabsContent>
          <TabsContent value="api" className="pt-4"><ApiIngest onDone={() => {}} /></TabsContent>
        </Tabs>
      </Panel>

      <Panel title="Registered sources" description={`${datasets?.length ?? 0} dataset(s)`}>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : !datasets?.length ? <Empty icon={Database} title="No sources yet">Use the CSV upload or API endpoint tab above to register your first dataset.</Empty> : (
          <div className="-m-5 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>File / URL</TableHead><TableHead className="text-right">Records</TableHead><TableHead className="text-right">Columns</TableHead><TableHead>Updated</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {datasets.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium"><div className="flex items-center gap-2">{d.name}{d.is_sample && <StatusBadge status="demo" />}{d.requires_auth && <Lock className="size-3 text-warning" aria-label="Requires authentication" />}</div></TableCell>
                    <TableCell><StatusBadge status={d.source_type} /></TableCell>
                    <TableCell className="max-w-56 truncate font-mono text-[11px] text-muted-foreground">{d.source_type === "api" ? `${d.api_method} ${d.source_reference}` : d.uploaded_filename}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{d.record_count}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{(d.schema_metadata as unknown[]).length}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDate(d.updated_at)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" onClick={() => setInspect(d)} aria-label="Inspect"><Eye className="size-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setEdit(d)} aria-label="Edit"><Pencil className="size-4" /></Button>
                      {d.source_type === "api" ? <Button variant="ghost" size="icon" onClick={() => testApi.mutate(d)} aria-label="Test connection"><RefreshCw className="size-4" /></Button> : <Button variant="ghost" size="icon" onClick={() => setReplace(d)} aria-label="Replace data"><Upload className="size-4" /></Button>}
                      <Button variant="ghost" size="icon" onClick={() => setRunFor(d.id)} aria-label="Run pipeline"><Play className="size-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDel(d)} aria-label="Delete"><Trash2 className="size-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Dialog open={!!inspect} onOpenChange={(o) => !o && setInspect(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader><DialogTitle>{inspect?.name}</DialogTitle></DialogHeader>
          {inspect && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Source type</dt><dd className="uppercase">{inspect.source_type}</dd></div>
                <div><dt className="text-muted-foreground">File / URL</dt><dd className="truncate">{inspect.uploaded_filename ?? inspect.source_reference}</dd></div>
                <div><dt className="text-muted-foreground">Records · Columns</dt><dd>{inspect.record_count} · {(inspect.schema_metadata as unknown[]).length}</dd></div>
                <div><dt className="text-muted-foreground">Uploaded</dt><dd>{fmtDate(inspect.created_at)}</dd></div>
              </dl>
              {detail.data ? <Preview rows={detail.data.raw_records as Row[]} schema={detail.data.schema_metadata as unknown as ColumnInfo[]} /> : <p className="text-sm text-muted-foreground">Loading records…</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <EditDialog ds={edit} onClose={() => setEdit(null)} />
      <Dialog open={!!replace} onOpenChange={(o) => !o && setReplace(null)}>
        <DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>Replace data — {replace?.name}</DialogTitle></DialogHeader><CsvIngest maxMb={settings?.maxUploadMb ?? 5} replaceTarget={replace} onDone={() => setReplace(null)} /><p className="text-xs text-muted-foreground">Rules and past runs are kept. Previous runs still reference their own stored records.</p></DialogContent>
      </Dialog>
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete "{del?.name}"?</AlertDialogTitle><AlertDialogDescription>This permanently removes the dataset, its rules, and its accepted/rejected records. Run history entries stay, without records.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => del && remove.mutate(del.id)}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RunPipelineDialog open={!!runFor} onOpenChange={(o) => !o && setRunFor(undefined)} datasetId={runFor} />
    </div>
  );
}

function EditDialog({ ds, onClose }: { ds: DatasetLite | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [prevId, setPrevId] = useState<string | null>(null);
  if (ds && ds.id !== prevId) {
    setPrevId(ds.id);
    setName(ds.name);
    setUrl(ds.source_reference ?? "");
    setHeaders(Object.entries((ds.api_headers ?? {}) as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join("\n"));
  }
  const save = useMutation({
    mutationFn: () => updateDataset(ds!.id, ds!.source_type === "api" ? { name, source_reference: url, api_headers: parseHeaders(headers) } : { name }),
    onSuccess: () => { toast.success("Source updated"); qc.invalidateQueries(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!ds} onOpenChange={(o) => { if (!o) { onClose(); setPrevId(null); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit source</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="en">Name</Label><Input id="en" value={name} onChange={(e) => setName(e.target.value)} /></div>
          {ds?.source_type === "api" && <>
            <div className="space-y-1"><Label htmlFor="eu">URL</Label><Input id="eu" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="eh">Headers</Label><Textarea id="eh" value={headers} onChange={(e) => setHeaders(e.target.value)} className="font-mono text-xs" /></div>
          </>}
        </div>
        <DialogFooter><Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
