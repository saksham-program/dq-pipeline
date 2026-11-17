import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { bulkInsertRules, getDataset, type DatasetLite, type RuleRow } from "@/lib/dq/db";
import { useRules } from "@/lib/dq/hooks";
import { reviewImport } from "@/lib/dq/rule-io";
import { suggestRules } from "@/lib/dq/rule-suggest";
import { buildDrafts, columnNamesOf, TEMPLATES, type RuleDraft, type TemplateId, type TemplateOptions } from "@/lib/dq/rule-templates";
import type { ColumnInfo, Row, Rule, RuleParams, Severity } from "@/lib/dq/types";
import { analyseRows, RuleDraftTable, toRows, type DraftRow } from "./RuleDraftTable";

type Datasets = DatasetLite[] | undefined;

/** Existing rules of one dataset, in the shape the duplicate detector needs. */
function useExisting(datasetId: string) {
  const { data } = useRules();
  return useMemo(() => (data ?? []).filter((r) => r.dataset_id === datasetId).map((r) => ({ rule_type: r.rule_type as Rule["rule_type"], column_name: r.column_name, parameters: (r.parameters ?? {}) as RuleParams })), [data, datasetId]);
}

function useApply(datasetId: string, onDone: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (drafts: RuleDraft[]) => bulkInsertRules(datasetId, drafts),
    onSuccess: (r) => {
      toast.success(`${r.inserted} rule(s) saved${r.skipped ? ` · ${r.skipped} skipped (already exist)` : ""}`);
      if (r.mode === "insert") toast.message("Database migration 0001 is not applied yet — rules were saved, but database-level duplicate protection is inactive.");
      qc.invalidateQueries({ queryKey: ["rules"] });
      onDone();
    },
    onError: (e: Error) => toast.error(`Nothing was saved: ${e.message}`),
  });
}

function DatasetSelect({ datasets, value, onChange, label = "Dataset" }: { datasets: Datasets; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}><SelectValue placeholder="Choose dataset" /></SelectTrigger>
        <SelectContent>{datasets?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function ApplyFooter({ rows, columnNames, existing, pending, onApply, onClose }: { rows: DraftRow[]; columnNames: string[]; existing: ReturnType<typeof useExisting>; pending: boolean; onApply: (r: DraftRow[]) => void; onClose: () => void }) {
  const a = useMemo(() => analyseRows(rows, columnNames, existing), [rows, columnNames, existing]);
  const selected = rows.filter((r) => r.selected).length;
  const dupSelected = rows.filter((r) => r.selected && a.duplicates.has(r.uid)).length;
  return (
    <DialogFooter className="items-center gap-2 sm:justify-between">
      <p className="text-xs text-muted-foreground" role="status">
        {selected} selected · {a.applicable.length} will be saved{dupSelected ? ` · ${dupSelected} already exist` : ""}
        {a.selectedInvalid ? <span className="text-destructive"> · fix or deselect {a.selectedInvalid} rule(s) with problems</span> : null}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onApply(a.applicable)} disabled={pending || a.applicable.length === 0 || a.selectedInvalid > 0}>
          {pending && <Loader2 className="size-4 animate-spin" />}Apply selected rules
        </Button>
      </div>
    </DialogFooter>
  );
}

/* ───────────────────────── Bulk Add Rules ───────────────────────── */

export function BulkRulesDialog({ open, onClose, datasets, defaultDatasetId, defaultSeverity }: { open: boolean; onClose: () => void; datasets: Datasets; defaultDatasetId: string; defaultSeverity: Severity }) {
  const [datasetId, setDatasetId] = useState(defaultDatasetId);
  const [cols, setCols] = useState<string[]>([]);
  const [tpls, setTpls] = useState<TemplateId[]>([]);
  const [severity, setSeverity] = useState<Severity>(defaultSeverity);
  const [enabled, setEnabled] = useState(true);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [dtype, setDtype] = useState<NonNullable<TemplateOptions["type"]>>("string");
  const [values, setValues] = useState("");
  const [operator, setOperator] = useState<NonNullable<TemplateOptions["operator"]>>("gt");
  const [cvalue, setCvalue] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const columnNames = useMemo(() => columnNamesOf(datasets?.find((d) => d.id === datasetId)?.schema_metadata), [datasets, datasetId]);
  const existing = useExisting(datasetId);
  const dsName = datasets?.find((d) => d.id === datasetId)?.name ?? "";
  const apply = useApply(datasetId, () => { setRows([]); onClose(); });
  const opts = new Set(tpls.flatMap((t) => TEMPLATES.find((x) => x.id === t)!.options));
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  const addToPreview = () => {
    const o: TemplateOptions = { min: num(min), max: num(max), type: dtype, values: values.split(/[\n,]/).map((x) => x.trim()).filter(Boolean), operator, value: operator === "regex" ? cvalue : num(cvalue) };
    const drafts = buildDrafts(tpls, cols, severity, o, enabled);
    if (!drafts.length) return toast.error("Choose at least one template (and a column for column-based templates).");
    setRows((r) => [...r, ...toRows(drafts, true)]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>Bulk add rules</DialogTitle><DialogDescription>Pick columns and templates, review the generated rules, then save them all in one transaction.</DialogDescription></DialogHeader>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3">
            <DatasetSelect datasets={datasets} value={datasetId} onChange={(v) => { setDatasetId(v); setCols([]); setRows([]); }} />
            <div className="space-y-1">
              <Label>Columns</Label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {columnNames.length === 0 && <p className="text-xs text-muted-foreground">No column metadata for this dataset.</p>}
                {columnNames.map((c) => <label key={c} className="flex items-center gap-2 text-xs"><Checkbox checked={cols.includes(c)} onCheckedChange={(v) => setCols(toggle(cols, c, v === true))} />{c}</label>)}
              </div>
              <div className="flex gap-3 text-[11px]"><button type="button" className="text-primary" onClick={() => setCols(columnNames)}>All</button><button type="button" className="text-primary" onClick={() => setCols([])}>None</button></div>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Rule types</Label>
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-2">
              {TEMPLATES.map((t) => <label key={t.id} className="flex items-start gap-2 text-xs" title={t.description}><Checkbox className="mt-0.5" checked={tpls.includes(t.id)} onCheckedChange={(v) => setTpls(toggle(tpls, t.id, v === true))} /><span><span className="font-medium">{t.label}</span><span className="block text-[11px] text-muted-foreground">{t.description}</span></span></label>)}
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1"><Label>Severity</Label><Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}><SelectTrigger aria-label="Severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="error">Error</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent></Select></div>
              <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={enabled} onCheckedChange={setEnabled} />Enabled</label>
            </div>
            {opts.has("range") && <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label htmlFor="bmin">Min</Label><Input id="bmin" type="number" step="any" value={min} onChange={(e) => setMin(e.target.value)} /></div><div className="space-y-1"><Label htmlFor="bmax">Max</Label><Input id="bmax" type="number" step="any" value={max} onChange={(e) => setMax(e.target.value)} /></div></div>}
            {opts.has("type") && <div className="space-y-1"><Label>Expected type</Label><Select value={dtype} onValueChange={(v) => setDtype(v as typeof dtype)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["string", "integer", "float", "date", "boolean"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>}
            {opts.has("values") && <div className="space-y-1"><Label htmlFor="bvals">Allowed values</Label><Textarea id="bvals" rows={3} value={values} onChange={(e) => setValues(e.target.value)} placeholder="One per line or comma separated" /></div>}
            {opts.has("custom") && <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label>Condition</Label><Select value={operator} onValueChange={(v) => setOperator(v as typeof operator)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[["gt", "> greater than"], ["gte", "≥ at least"], ["lt", "< less than"], ["lte", "≤ at most"], ["eq", "= equals"], ["neq", "≠ not equal"], ["email", "Valid email"], ["regex", "Matches regex"]].map(([v, l]) => <SelectItem key={v} value={v!}>{l}</SelectItem>)}</SelectContent></Select></div>{operator !== "email" && <div className="space-y-1"><Label htmlFor="bcv">Value</Label><Input id="bcv" value={cvalue} onChange={(e) => setCvalue(e.target.value)} /></div>}</div>}
            <Button onClick={addToPreview} disabled={!datasetId || !tpls.length}>Add to preview</Button>
          </div>
        </div>
        {rows.length > 0 ? (
          <RuleDraftTable rows={rows} onChange={setRows} columnNames={columnNames} datasetName={dsName} existing={existing} />
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Generated rules appear here for review before anything is saved.</p>
        )}
        <ApplyFooter rows={rows} columnNames={columnNames} existing={existing} pending={apply.isPending} onApply={(r) => apply.mutate(r)} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────── Generate Suggested Rules ───────────────────── */

export function SuggestRulesDialog({ open, onClose, datasets, defaultDatasetId, defaultSeverity }: { open: boolean; onClose: () => void; datasets: Datasets; defaultDatasetId: string; defaultSeverity: Severity }) {
  const [datasetId, setDatasetId] = useState(defaultDatasetId);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const columnNames = useMemo(() => columnNamesOf(datasets?.find((d) => d.id === datasetId)?.schema_metadata), [datasets, datasetId]);
  const existing = useExisting(datasetId);
  const dsName = datasets?.find((d) => d.id === datasetId)?.name ?? "";
  const apply = useApply(datasetId, () => { setRows([]); onClose(); });

  const generate = async () => {
    setLoading(true);
    setNote("");
    try {
      const ds = await getDataset(datasetId);
      const data = (ds.raw_records ?? []) as Row[];
      const schema = (ds.schema_metadata ?? []) as unknown as ColumnInfo[];
      if (!schema.length) throw new Error("This dataset has no column metadata yet. Upload data or run the pipeline once.");
      const s = suggestRules(schema, Array.isArray(data) ? data : [], defaultSeverity);
      // Suggestions start UNSELECTED: nothing becomes a rule until the user chooses it and applies it.
      setRows(toRows(s, false));
      setNote(data.length ? `${s.length} suggestion(s) from ${data.length} sample row(s).` : "No stored rows yet (API source not run?) — suggestions use column types and names only; observed-value suggestions (allowed values, duplicates) need data.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>Generate suggested rules</DialogTitle><DialogDescription>Suggestions come from detected column types, column names and observed values. Nothing is saved until you select rules and click Apply.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64"><DatasetSelect datasets={datasets} value={datasetId} onChange={(v) => { setDatasetId(v); setRows([]); setNote(""); }} /></div>
          <Button onClick={generate} disabled={!datasetId || loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}Generate suggestions</Button>
        </div>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Button size="sm" variant="outline" onClick={() => setRows(rows.map((r) => ({ ...r, selected: true })))}>Select all suggested</Button>
              <Button size="sm" variant="outline" onClick={() => setRows(rows.map((r) => ({ ...r, selected: r.confidence === "high" && !r.needsReview })))}>Select high-confidence only</Button>
              <Button size="sm" variant="ghost" onClick={() => setRows(rows.map((r) => ({ ...r, selected: false })))}>Clear selection</Button>
            </div>
            <RuleDraftTable rows={rows} onChange={setRows} columnNames={columnNames} datasetName={dsName} existing={existing} showConfidence />
          </>
        )}
        {!rows.length && !loading && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Choose a dataset and click Generate suggestions.</p>}
        <ApplyFooter rows={rows} columnNames={columnNames} existing={existing} pending={apply.isPending} onApply={(r) => apply.mutate(r)} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Import SQL / JSON ───────────────────────── */

export function ImportRulesDialog({ open, onClose, datasets, defaultDatasetId }: { open: boolean; onClose: () => void; datasets: Datasets; defaultDatasetId: string }) {
  const [datasetId, setDatasetId] = useState(defaultDatasetId);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const columnNames = useMemo(() => columnNamesOf(datasets?.find((d) => d.id === datasetId)?.schema_metadata), [datasets, datasetId]);
  const existing = useExisting(datasetId);
  const dsName = datasets?.find((d) => d.id === datasetId)?.name ?? "";
  const apply = useApply(datasetId, () => { setRows([]); setText(""); onClose(); });

  const parse = () => {
    const r = reviewImport(text, datasets ?? []);
    setErrors(r.errors);
    setNotes(r.notes);
    setRows(toRows(r.drafts, true));
    // The dataset named in the file is a hint: select the matching registered dataset if there is one.
    if (r.matchedDatasetId) setDatasetId(r.matchedDatasetId);
    else if (r.drafts.length && r.fileDatasetName && r.fileDatasetName !== dsName) toast.message(`The file was exported from "${r.fileDatasetName}", which is not registered here; rules will be imported into "${dsName}" if its columns match.`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader><DialogTitle>Import rules</DialogTitle><DialogDescription>Paste or upload a rule export (SQL or JSON) created by this app. Pasted SQL is only read as data — it is never executed — and importing the same file twice adds no duplicates.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[16rem_1fr]">
          <DatasetSelect datasets={datasets} value={datasetId} onChange={(v) => { setDatasetId(v); }} label="Import into dataset" />
          <div className="space-y-1"><Label htmlFor="imp-file">Upload file (.sql, .json)</Label><Input id="imp-file" type="file" accept=".sql,.json,.txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></div>
        </div>
        <Textarea rows={8} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={"-- paste an exported .sql file or JSON here"} aria-label="Rules to import" />
        <div><Button onClick={parse} disabled={!text.trim() || !datasetId}>Review rules</Button></div>
        {errors.length > 0 && <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{errors.map((e, i) => <li key={i} className="font-mono whitespace-pre-wrap">{e}</li>)}</ul>}
        {notes.length > 0 && <ul className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground" aria-label="Import notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        {rows.length > 0 && <RuleDraftTable rows={rows} onChange={setRows} columnNames={columnNames} datasetName={dsName} existing={existing} />}
        <ApplyFooter rows={rows} columnNames={columnNames} existing={existing} pending={apply.isPending} onApply={(r) => apply.mutate(r)} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────── Apply selected rules to another dataset ─────────────── */

export function CopyRulesDialog({ open, onClose, datasets, source }: { open: boolean; onClose: () => void; datasets: Datasets; source: RuleRow[] }) {
  const [datasetId, setDatasetId] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const columnNames = useMemo(() => columnNamesOf(datasets?.find((d) => d.id === datasetId)?.schema_metadata), [datasets, datasetId]);
  const existing = useExisting(datasetId);
  const dsName = datasets?.find((d) => d.id === datasetId)?.name ?? "";
  const apply = useApply(datasetId, () => { setRows([]); onClose(); });
  const choose = (id: string) => {
    setDatasetId(id);
    setRows(toRows(source.map((r) => ({ rule_name: r.rule_name, column_name: r.column_name, rule_type: r.rule_type as Rule["rule_type"], parameters: (r.parameters ?? {}) as RuleParams, severity: r.severity as Severity, is_enabled: r.is_enabled })), true));
  };
  const targets = datasets?.filter((d) => !source.every((r) => r.dataset_id === d.id));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>Apply {source.length} rule(s) to another dataset</DialogTitle><DialogDescription>Rules whose columns do not exist in the target are flagged — remove or fix them before applying.</DialogDescription></DialogHeader>
        <div className="w-72"><DatasetSelect datasets={targets} value={datasetId} onChange={choose} label="Target dataset" /></div>
        {rows.length > 0 && <RuleDraftTable rows={rows} onChange={setRows} columnNames={columnNames} datasetName={dsName} existing={existing} />}
        <ApplyFooter rows={rows} columnNames={columnNames} existing={existing} pending={apply.isPending} onApply={(r) => apply.mutate(r)} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
