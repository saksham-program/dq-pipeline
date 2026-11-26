import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileCode2, Trash2, ListPlus, Sparkles, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { deleteAllRules, insertRules, type DatasetLite, type RuleRow } from "@/lib/dq/db";
import { exportRulesSql, parseRuleSql, ruleFingerprint, validateParsed, SUPPORTED_RULE_TYPES, type ParsedRule } from "@/lib/dq/rule-sql";
import { suggestedRuleSql, defaultRuleParams } from "@/lib/dq/rule-suggestions";
import type { ColumnInfo, RuleType } from "@/lib/dq/types";

interface Props { datasets: DatasetLite[]; rules: RuleRow[]; filter: string }

const colsOf = (d?: DatasetLite) => ((d?.schema_metadata ?? []) as unknown as ColumnInfo[]).map((c) => c.name);

export function RuleBulkActions({ datasets, rules, filter }: Props) {
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [mode, setMode] = useState<"sql" | "bulk" | "suggested">("sql");
  const [delOpen, setDelOpen] = useState(false);
  const [scope, setScope] = useState<"dataset" | "all">("dataset");
  const [dsId, setDsId] = useState("");
  const [sql, setSql] = useState("");
  const [parsed, setParsed] = useState<{ rules: ParsedRule[]; errors: string[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [paramText, setParamText] = useState<Record<number, string>>({});

  const dsName = new Map(datasets.map((d) => [d.id, d.name]));
  const delTargetId = filter !== "all" ? filter : "";
  const delCount = scope === "all" ? rules.length : rules.filter((r) => r.dataset_id === delTargetId).length;
  const target = datasets.find((d) => d.id === dsId);
  const existing = useMemo(() => new Set(rules.filter((r) => r.dataset_id === dsId).map(ruleFingerprint)), [rules, dsId]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["rules"] }); qc.invalidateQueries({ queryKey: ["datasets"] }); };

  const delAll = useMutation({
    mutationFn: () => deleteAllRules(scope === "all" ? undefined : delTargetId),
    onSuccess: (n) => { toast.success(`Deleted ${n} rule(s). Datasets and run history were kept.`); setDelOpen(false); invalidate(); },
    onError: (e: Error) => toast.error(`Could not delete rules: ${e.message}`),
  });

  // Per-row status after user edits.
  const rowState = (r: ParsedRule, seen: Set<string>) => {
    const errs = [...r.errors];
    const fp = ruleFingerprint(r);
    const dup = existing.has(fp) ? "Already exists in this dataset" : seen.has(fp) ? "Duplicate of an earlier rule in this SQL" : null;
    return { errs, dup, fp };
  };
  const states = useMemo(() => {
    const seen = new Set<string>();
    return (parsed?.rules ?? []).map((r) => { const s = rowState(r, seen); if (!s.errs.length && !s.dup) seen.add(s.fp); return s; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, existing]);

  const review = (text = sql, id = dsId) => {
    const res = parseRuleSql(text, colsOf(datasets.find((d) => d.id === id)));
    setParsed(res);
    setParamText(Object.fromEntries(res.rules.map((r) => [r.key, r.parameterText ?? JSON.stringify(r.parameters)])));
    const seen = new Set<string>(); const ex = new Set(rules.filter((r) => r.dataset_id === id).map(ruleFingerprint));
    setPicked(new Set(res.rules.filter((r) => { const fp = ruleFingerprint(r); const ok = !r.errors.length && !ex.has(fp) && !seen.has(fp); if (ok) seen.add(fp); return ok; }).map((r) => r.key)));
  };

  const edit = (key: number, patch: Partial<ParsedRule>, pText?: string) => setParsed((p) => {
    if (!p) return p;
    return { ...p, rules: p.rules.map((r) => {
      if (r.key !== key) return r;
      const next = { ...r, ...patch };
      const extra: string[] = [];
      const text = pText ?? paramText[key] ?? JSON.stringify(next.parameters);
      try { const j = JSON.parse(text); if (j && typeof j === "object" && !Array.isArray(j)) next.parameters = j; else extra.push("parameters must be a JSON object."); } catch { extra.push("parameters is not valid JSON."); }
      next.errors = [...(next.sourceErrors ?? []), ...extra, ...validateParsed(next, colsOf(target))];
      return next;
    }) };
  });

  const doImport = useMutation({
    mutationFn: async () => {
      if (!dsId) throw new Error("Choose a target dataset.");
      if (parsed?.errors.length) throw new Error("Remove or correct unsupported SQL statements before importing.");
      const chosen = (parsed?.rules ?? []).filter((r, i) => picked.has(r.key) && !r.errors.length && !states[i]?.dup);
      if (!chosen.length) throw new Error("Select at least one valid, non-duplicate rule.");
      return insertRules(chosen.map((r) => ({ dataset_id: dsId, rule_name: r.rule_name.trim(), column_name: r.column_name, rule_type: r.rule_type, severity: r.severity, is_enabled: r.is_enabled, parameters: r.parameters })));
    },
    onSuccess: (n) => { toast.success(`Imported ${n} rule(s) into ${target?.name}.`); setImportOpen(false); setParsed(null); setSql(""); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportSql = () => {
    const list = rules.filter((r) => filter === "all" || r.dataset_id === filter);
    const text = exportRulesSql(list.map((r) => ({ dataset: dsName.get(r.dataset_id) ?? "", rule_name: r.rule_name, column_name: r.column_name, rule_type: r.rule_type, severity: r.severity, is_enabled: r.is_enabled, parameters: r.parameters })));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/sql" }));
    a.download = `validation-rules-${new Date().toISOString().slice(0, 10)}.sql`;
    a.click(); URL.revokeObjectURL(a.href);
    toast.success(`Exported ${list.length} rule(s).`);
  };

  const selectable = (i: number) => { const r = parsed?.rules[i]; return !!r && !r.errors.length && !states[i]?.dup; };
  const pickedValid = parsed ? parsed.rules.filter((r, i) => picked.has(r.key) && selectable(i)).length : 0;
  const openBatch = (kind: "bulk" | "suggested") => {
    const id = filter !== "all" ? filter : datasets[0]?.id ?? "";
    const d = datasets.find((item) => item.id === id);
    if (!d) return;
    setDsId(id); setMode(kind); setImportOpen(true);
    const text = kind === "suggested" ? suggestedRuleSql(d.name, d.schema_metadata as unknown as ColumnInfo[]) : exportRulesSql([{ dataset: d.name, rule_name: "", column_name: colsOf(d)[0] ?? null, rule_type: "not_null", severity: "error", is_enabled: true, parameters: {} }]);
    setSql(text); review(text, id);
  };
  const addRow = () => {
    const key = Math.max(-1, ...(parsed?.rules ?? []).map((r) => r.key)) + 1;
    const base = { dataset: target?.name ?? null, rule_name: "", column_name: colsOf(target)[0] ?? null, rule_type: "not_null", severity: "error", is_enabled: true, parameters: {} };
    setParsed((p) => ({ rules: [...(p?.rules ?? []), { ...base, key, statement: 1, errors: validateParsed(base, colsOf(target)) }], errors: p?.errors ?? [] }));
    setParamText((p) => ({ ...p, [key]: "{}" }));
  };

  return (
    <>
      <Button variant="outline" onClick={() => openBatch("bulk")} disabled={!datasets.length}><ListPlus className="size-4" />Bulk add rules</Button>
      <Button variant="outline" onClick={() => { setMode("sql"); setDsId(filter !== "all" ? filter : datasets[0]?.id ?? ""); setParsed(null); setImportOpen(true); }} disabled={!datasets.length}><FileCode2 className="size-4" />Import SQL</Button>
      <Button variant="outline" onClick={() => openBatch("suggested")} disabled={!datasets.length}><Sparkles className="size-4" />Generate suggested rules</Button>
      <Button variant="outline" onClick={exportSql} disabled={!rules.length}><Download className="size-4" />Export SQL</Button>
      <Button variant="outline" className="text-destructive" onClick={() => { setScope(filter !== "all" ? "dataset" : "all"); setDelOpen(true); }} disabled={!rules.length}><Trash2 className="size-4" />Delete all rules</Button>

      <Dialog open={delOpen} onOpenChange={(o) => !delAll.isPending && setDelOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Delete all rules</DialogTitle><DialogDescription>Datasets, uploaded files, pipeline runs and reports are kept.</DialogDescription></DialogHeader>
          <div className="space-y-2" role="radiogroup">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary">
              <input type="radio" name="scope" className="mt-1" checked={scope === "dataset"} onChange={() => setScope("dataset")} disabled={!delTargetId} />
              <span>Only <b>{dsName.get(delTargetId) ?? "selected dataset"}</b><br /><span className="text-muted-foreground">{rules.filter((r) => r.dataset_id === delTargetId).length} rule(s){filter === "all" && " — select a dataset in the page filter first"}</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary">
              <input type="radio" name="scope" className="mt-1" checked={scope === "all"} onChange={() => setScope("all")} />
              <span>All datasets<br /><span className="text-muted-foreground">{rules.length} rule(s)</span></span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(false)} disabled={delAll.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={() => delAll.mutate()} disabled={delAll.isPending || !delCount}>{delAll.isPending ? "Deleting…" : `Delete ${delCount} rule(s)`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(o) => !doImport.isPending && setImportOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>{mode === "sql" ? "Import rules from SQL" : mode === "bulk" ? "Bulk add rules" : "Suggested rules"}</DialogTitle><DialogDescription>{mode === "sql" ? <>Only <code className="font-mono">INSERT INTO validation_rules (...) VALUES (...)</code> rule exports are accepted. The SQL is read as data and never executed.</> : "Review and select rules before saving."}</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Target dataset</Label><Select value={dsId} onValueChange={(v) => { setDsId(v); setParsed(null); setPicked(new Set()); }}><SelectTrigger aria-label="Target dataset"><SelectValue placeholder="Dataset" /></SelectTrigger><SelectContent>{datasets.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
            {mode === "sql" && <div className="space-y-1"><Label htmlFor="sqlf">SQL file</Label><Input id="sqlf" type="file" accept=".sql,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (!f.name.toLowerCase().endsWith(".sql")) return toast.error("Choose a .sql file."); if (f.size > 1_000_000) return toast.error("SQL file is larger than 1 MB."); try { const t = await f.text(); setSql(t); review(t); } catch { toast.error("Could not read SQL file."); } }} /></div>}
          </div>
          {mode === "sql" && <div className="space-y-1"><Label htmlFor="sqlt">Or paste SQL</Label><Textarea id="sqlt" rows={6} className="font-mono text-xs" value={sql} onChange={(e) => { setSql(e.target.value); setParsed(null); }} placeholder={"INSERT INTO validation_rules (rule_name, column_name, rule_type, severity, is_enabled, parameters) VALUES\n  ('Price not negative', 'price', 'range', 'error', true, '{\"min\":0}');"} /></div>}
          {mode !== "bulk" && <Button variant="outline" onClick={() => review(mode === "suggested" && target ? suggestedRuleSql(target.name, target.schema_metadata as unknown as ColumnInfo[]) : sql)} disabled={!dsId || (mode === "sql" && !sql.trim())}>{mode === "suggested" ? "Generate rules" : "Review rules"}</Button>}
          {mode === "bulk" && <Button variant="outline" onClick={addRow} disabled={!dsId}><Plus className="size-4" />Add rule</Button>}

          {parsed && <div className="space-y-2">
            {parsed.errors.map((e, i) => <p key={i} className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{e}</p>)}
            <p className="text-sm text-muted-foreground">{parsed.rules.length} rule(s) detected · {pickedValid} selected</p>
            {parsed.rules.map((r, i) => { const st = states[i]; const ok = selectable(i); return (
              <div key={r.key} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Checkbox checked={picked.has(r.key) && ok} disabled={!ok} onCheckedChange={(v) => setPicked((s) => { const n = new Set(s); v ? n.add(r.key) : n.delete(r.key); return n; })} aria-label={`Select ${r.rule_name}`} />
                  <Input className="h-8 min-w-32 flex-1" value={r.rule_name} onChange={(e) => edit(r.key, { rule_name: e.target.value })} aria-label="Rule name" />
                  <span className="font-mono text-xs">{r.rule_type}</span>
                  <Select value={r.severity} onValueChange={(v) => edit(r.key, { severity: v })}><SelectTrigger className="h-8 w-28 text-xs" aria-label="Severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="error">Error</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent></Select>
                  <label className="flex items-center gap-1 text-xs"><Checkbox checked={r.is_enabled} onCheckedChange={(v) => edit(r.key, { is_enabled: v === true })} />Enabled</label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {mode === "bulk" && <Select value={r.rule_type} onValueChange={(v) => { const params = defaultRuleParams(v as RuleType, colsOf(target)); const text = JSON.stringify(params); setParamText((p) => ({ ...p, [r.key]: text })); edit(r.key, { rule_type: v, parameters: params }, text); }}><SelectTrigger className="h-8 w-44 text-xs" aria-label="Rule type"><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_RULE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>}
                  <Select value={r.column_name ?? "__none"} onValueChange={(v) => edit(r.key, { column_name: v === "__none" ? null : v })}><SelectTrigger className="h-8 w-44 text-xs" aria-label="Column"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">Dataset-level</SelectItem>{colsOf(target).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
                </div>
                <Input className="h-8 font-mono text-xs" value={paramText[r.key] ?? ""} onChange={(e) => { setParamText((p) => ({ ...p, [r.key]: e.target.value })); edit(r.key, {}, e.target.value); }} aria-label="Parameters (JSON)" />
                {r.dataset && target && r.dataset !== target.name && <p className="text-xs text-muted-foreground">Exported from "{r.dataset}" — will be added to "{target.name}".</p>}
                {r.errors.map((e, j) => <p key={j} className="text-xs text-destructive">{e}</p>)}
                {st?.dup && <p className="text-xs text-warning">{st.dup} — skipped to avoid a duplicate.</p>}
              </div>
            ); })}
          </div>}
          <DialogFooter><Button onClick={() => doImport.mutate()} disabled={doImport.isPending || !pickedValid || !!parsed?.errors.length}>{doImport.isPending ? "Importing…" : `Import ${pickedValid} rule(s)`}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
