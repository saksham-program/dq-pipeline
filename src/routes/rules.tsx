import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RuleBulkActions } from "@/components/dq/RuleBulkActions";
import { Empty, PageHeader, Panel, StatusBadge, fmtDate } from "@/components/dq/common";
import { deleteRule, upsertRule, type RuleRow } from "@/lib/dq/db";
import { useDatasets, useRules, useSettings } from "@/lib/dq/hooks";
import type { ColumnInfo, RuleParams, RuleType, Severity } from "@/lib/dq/types";

export const Route = createFileRoute("/rules")({
  head: () => ({
    meta: [
      { title: "Validation Rules — DQ Pipeline" },
      { name: "description", content: "Configure schema, type, null, duplicate, range and custom validation rules per dataset." },
      { property: "og:title", content: "Validation Rules — DQ Pipeline" },
      { property: "og:description", content: "Configurable data-quality rules executed on every run." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RulesPage,
});

const TYPES: { v: RuleType; label: string; needsColumn: boolean }[] = [
  { v: "required_columns", label: "Required columns / schema", needsColumn: false },
  { v: "data_type", label: "Data type", needsColumn: true },
  { v: "not_null", label: "Not null / required value", needsColumn: true },
  { v: "duplicate", label: "Duplicate detection", needsColumn: false },
  { v: "range", label: "Numerical range", needsColumn: true },
  { v: "custom", label: "Custom condition", needsColumn: true },
  { v: "record_count", label: "Record count", needsColumn: false },
];
const typeLabel = (t: string) => TYPES.find((x) => x.v === t)?.label ?? t;

function describe(r: RuleRow) {
  const p = (r.parameters ?? {}) as RuleParams;
  switch (r.rule_type) {
    case "required_columns": return `${(p.columns ?? []).join(", ")}${p.allowExtraColumns === false ? " (no extra columns)" : ""}`;
    case "data_type": return `must be ${p.type}`;
    case "not_null": return p.fillValue ? `fill with "${p.fillValue}"` : "reject if empty";
    case "duplicate": return p.columns?.length ? `key: ${p.columns.join(", ")}` : "complete row";
    case "range": return `${p.min ?? "−∞"} … ${p.max ?? "∞"}`;
    case "custom": return p.operator === "email" ? "valid email" : p.operator === "regex" ? `matches ${p.value}` : `${p.operator} ${p.value}`;
    case "record_count": return [p.min != null && `min ${p.min}`, p.max != null && `max ${p.max}`, p.maxChangePct != null && `≤${p.maxChangePct}% change`].filter(Boolean).join(", ");
  }
  return "";
}

interface Form { id?: string; dataset_id: string; rule_name: string; column_name: string; rule_type: RuleType; severity: Severity; is_enabled: boolean; p: Record<string, string | boolean> }

function RulesPage() {
  const { data: rules } = useRules();
  const { data: datasets } = useDatasets();
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState<Form | null>(null);
  const [del, setDel] = useState<RuleRow | null>(null);
  const dsName = useMemo(() => new Map(datasets?.map((d) => [d.id, d.name])), [datasets]);
  const shown = (rules ?? []).filter((r) => filter === "all" || r.dataset_id === filter);
  const cols = useMemo(() => ((datasets?.find((d) => d.id === form?.dataset_id)?.schema_metadata ?? []) as unknown as ColumnInfo[]).map((c) => c.name), [datasets, form?.dataset_id]);

  const toggle = useMutation({ mutationFn: (r: RuleRow) => upsertRule({ id: r.id, dataset_id: r.dataset_id, rule_name: r.rule_name, rule_type: r.rule_type, is_enabled: !r.is_enabled }), onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }), onError: (e: Error) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: (id: string) => deleteRule(id), onSuccess: () => { toast.success("Rule deleted"); qc.invalidateQueries({ queryKey: ["rules"] }); } });
  const save = useMutation({
    mutationFn: async (f: Form) => {
      const p: RuleParams = {};
      const n = (s: unknown) => (s === "" || s == null ? null : Number(s));
      const list = (s: unknown) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (f.rule_type === "required_columns") { p.columns = list(f.p.columns); p.allowExtraColumns = !f.p.strict; if (!p.columns.length) throw new Error("List at least one required column."); }
      if (f.rule_type === "data_type") p.type = (f.p.type as RuleParams["type"]) || "string";
      if (f.rule_type === "not_null") { p.treatEmptyAsNull = true; p.fillValue = (f.p.fillValue as string) || null; }
      if (f.rule_type === "duplicate") p.columns = list(f.p.columns);
      if (f.rule_type === "range") { p.min = n(f.p.min); p.max = n(f.p.max); if (p.min == null && p.max == null) throw new Error("Set a minimum or maximum."); if ((p.min != null && isNaN(p.min)) || (p.max != null && isNaN(p.max))) throw new Error("Min and max must be numbers."); }
      if (f.rule_type === "custom") { p.operator = (f.p.operator as RuleParams["operator"]) || "gt"; p.value = p.operator === "regex" ? String(f.p.value ?? "") : p.operator === "email" ? null : n(f.p.value); if (p.operator === "regex") new RegExp(String(p.value)); }
      if (f.rule_type === "record_count") { p.min = n(f.p.min); p.max = n(f.p.max); p.maxChangePct = n(f.p.maxChangePct); }
      const needsCol = TYPES.find((t) => t.v === f.rule_type)?.needsColumn ?? false;
      if (needsCol && !f.column_name) throw new Error("Choose a column.");
      await upsertRule({ id: f.id, dataset_id: f.dataset_id, rule_name: f.rule_name.trim(), column_name: needsCol ? f.column_name : null, rule_type: f.rule_type, severity: f.severity, is_enabled: f.is_enabled, parameters: p as never });
    },
    onSuccess: () => { toast.success("Rule saved"); setForm(null); qc.invalidateQueries({ queryKey: ["rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNew = () => setForm({ dataset_id: filter !== "all" ? filter : datasets?.[0]?.id ?? "", rule_name: "", column_name: "", rule_type: "not_null", severity: settings?.defaultSeverity ?? "error", is_enabled: true, p: {} });
  const openEdit = (r: RuleRow) => {
    const p = (r.parameters ?? {}) as RuleParams;
    setForm({ id: r.id, dataset_id: r.dataset_id, rule_name: r.rule_name, column_name: r.column_name ?? "", rule_type: r.rule_type as RuleType, severity: r.severity as Severity, is_enabled: r.is_enabled, p: { columns: (p.columns ?? []).join(", "), strict: p.allowExtraColumns === false, type: p.type ?? "", fillValue: p.fillValue ?? "", min: p.min?.toString() ?? "", max: p.max?.toString() ?? "", operator: p.operator ?? "gt", value: p.value?.toString() ?? "", maxChangePct: p.maxChangePct?.toString() ?? "" } });
  };
  const setP = (k: string, v: string | boolean) => setForm((f) => f && { ...f, p: { ...f.p, [k]: v } });
  const need = form && (TYPES.find((t) => t.v === form.rule_type)?.needsColumn ?? false);

  return (
    <div className="space-y-6">
      <PageHeader title="Validation Rules" description="Every enabled rule is executed on each pipeline run. Critical and error violations reject the row; warnings are recorded only." actions={<div className="flex flex-wrap gap-2"><Button onClick={openNew} disabled={!datasets?.length}><Plus className="size-4" />New rule</Button><RuleBulkActions datasets={datasets ?? []} rules={rules ?? []} filter={filter} /></div>} />
      <Panel title={`${shown.length} rule(s)`} actions={
        <Select value={filter} onValueChange={setFilter}><SelectTrigger className="h-8 w-56 text-xs" aria-label="Filter by dataset"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All datasets</SelectItem>{datasets?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select>
      }>
        {!shown.length ? <Empty icon={ListChecks} title="No rules yet">{datasets?.length ? "Create a rule or use Import SQL to start validating data." : "Upload a dataset on Data Sources first, then add rules here."}</Empty> : (
          <div className="-m-5 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>On</TableHead><TableHead>Rule</TableHead><TableHead>Dataset</TableHead><TableHead>Column</TableHead><TableHead>Type</TableHead><TableHead>Parameters</TableHead><TableHead>Severity</TableHead><TableHead>Created</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.id} className={r.is_enabled ? "" : "opacity-55"}>
                    <TableCell><Switch checked={r.is_enabled} onCheckedChange={() => toggle.mutate(r)} aria-label={`Toggle ${r.rule_name}`} /></TableCell>
                    <TableCell className="font-medium">{r.rule_name}</TableCell>
                    <TableCell className="max-w-40 truncate text-xs">{dsName.get(r.dataset_id)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.column_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{typeLabel(r.rule_type)}</TableCell>
                    <TableCell className="max-w-56 truncate font-mono text-[11px] text-muted-foreground">{describe(r)}</TableCell>
                    <TableCell><StatusBadge status={r.severity} /></TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="whitespace-nowrap"><Button variant="ghost" size="icon" onClick={() => openEdit(r)} aria-label="Edit rule"><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" onClick={() => setDel(r)} aria-label="Delete rule"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{form?.id ? "Edit rule" : "New validation rule"}</DialogTitle></DialogHeader>
          {form && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
              <div className="space-y-1"><Label htmlFor="rn">Rule name</Label><Input id="rn" required value={form.rule_name} onChange={(e) => setForm({ ...form, rule_name: e.target.value })} placeholder="Price must not be negative" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Dataset</Label><Select value={form.dataset_id} onValueChange={(v) => setForm({ ...form, dataset_id: v, column_name: "" })}><SelectTrigger><SelectValue placeholder="Dataset" /></SelectTrigger><SelectContent>{datasets?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label>Rule type</Label><Select value={form.rule_type} onValueChange={(v) => setForm({ ...form, rule_type: v as RuleType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}</SelectContent></Select></div>
              </div>
              {need && <div className="space-y-1"><Label>Column</Label><Select value={form.column_name} onValueChange={(v) => setForm({ ...form, column_name: v })}><SelectTrigger><SelectValue placeholder="Choose column" /></SelectTrigger><SelectContent>{cols.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>}
              {form.rule_type === "required_columns" && <>
                <div className="space-y-1"><Label htmlFor="rc">Required columns (comma separated)</Label><Input id="rc" value={String(form.p.columns ?? "")} onChange={(e) => setP("columns", e.target.value)} /><button type="button" className="text-xs text-primary" onClick={() => setP("columns", cols.join(", "))}>Use current schema</button></div>
                <label className="flex items-center gap-2 text-sm"><Switch checked={!!form.p.strict} onCheckedChange={(v) => setP("strict", v)} />Flag unexpected extra columns</label>
              </>}
              {form.rule_type === "data_type" && <div className="space-y-1"><Label>Expected type</Label><Select value={String(form.p.type || "")} onValueChange={(v) => setP("type", v)}><SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger><SelectContent>{["string", "integer", "float", "date", "boolean"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>}
              {form.rule_type === "not_null" && <div className="space-y-1"><Label htmlFor="fv">Fill value (optional cleaning)</Label><Input id="fv" value={String(form.p.fillValue ?? "")} onChange={(e) => setP("fillValue", e.target.value)} placeholder="Leave empty to reject empty values" /></div>}
              {form.rule_type === "duplicate" && <div className="space-y-1"><Label htmlFor="dk">Unique key columns (comma separated)</Label><Input id="dk" value={String(form.p.columns ?? "")} onChange={(e) => setP("columns", e.target.value)} placeholder="Empty = complete-row duplicates" /><p className="text-[11px] text-muted-foreground">Available: {cols.join(", ")}</p></div>}
              {(form.rule_type === "range" || form.rule_type === "record_count") && <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label htmlFor="mn">Minimum</Label><Input id="mn" type="number" step="any" value={String(form.p.min ?? "")} onChange={(e) => setP("min", e.target.value)} /></div><div className="space-y-1"><Label htmlFor="mx">Maximum</Label><Input id="mx" type="number" step="any" value={String(form.p.max ?? "")} onChange={(e) => setP("max", e.target.value)} /></div></div>}
              {form.rule_type === "record_count" && <div className="space-y-1"><Label htmlFor="mc">Max change vs previous run (%)</Label><Input id="mc" type="number" value={String(form.p.maxChangePct ?? "")} onChange={(e) => setP("maxChangePct", e.target.value)} /></div>}
              {form.rule_type === "custom" && <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Condition</Label><Select value={String(form.p.operator || "gt")} onValueChange={(v) => setP("operator", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[["gt", "> greater than"], ["gte", "≥ at least"], ["lt", "< less than"], ["lte", "≤ at most"], ["eq", "= equals"], ["neq", "≠ not equal"], ["email", "Valid email"], ["regex", "Matches regex"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
                {form.p.operator !== "email" && <div className="space-y-1"><Label htmlFor="cv">Value</Label><Input id="cv" value={String(form.p.value ?? "")} onChange={(e) => setP("value", e.target.value)} /></div>}
              </div>}
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1"><Label>Severity</Label><Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v as Severity })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="error">Error</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent></Select></div>
                <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={form.is_enabled} onCheckedChange={(v) => setForm({ ...form, is_enabled: v })} />Enabled</label>
              </div>
              <DialogFooter><Button type="submit" disabled={save.isPending || !form.dataset_id}>Save rule</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete rule "{del?.rule_name}"?</AlertDialogTitle><AlertDialogDescription>Past run results are kept.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => del && remove.mutate(del.id)}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
