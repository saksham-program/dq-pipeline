import { Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { describeParams, planBulkInsert, RULE_TYPE_LABEL, validateDraft, type RuleDraft } from "@/lib/dq/rule-templates";
import type { Rule, RuleParams, Severity } from "@/lib/dq/types";

export interface DraftRow extends RuleDraft {
  uid: string;
  selected: boolean;
  confidence?: "high" | "medium" | "low";
  needsReview?: boolean;
}

let counter = 0;
export const toRows = <T extends RuleDraft>(drafts: T[], selected = false): (T & { uid: string; selected: boolean })[] =>
  drafts.map((d) => ({ ...d, uid: `draft-${Date.now().toString(36)}-${counter++}`, selected }));

type Existing = Pick<Rule, "rule_type" | "column_name" | "parameters">[];

export interface Analysis {
  errors: Map<string, string[]>;
  duplicates: Set<string>;
  /** Selected, valid and not already saved — exactly what "Apply" will send. */
  applicable: DraftRow[];
  selectedInvalid: number;
}

/** Validate rows against the dataset's columns and detect rules that already exist. */
export function analyseRows(rows: DraftRow[], columnNames: string[], existing: Existing): Analysis {
  const errors = new Map<string, string[]>();
  for (const r of rows) {
    const e = validateDraft(r, columnNames);
    if (e.length) errors.set(r.uid, e);
  }
  // Only valid rows take part in duplicate detection so an invalid twin doesn't hide a good rule.
  const plan = planBulkInsert(existing, rows.filter((r) => !errors.has(r.uid)));
  const duplicates = new Set(plan.duplicates.map((d) => d.uid));
  const applicable = rows.filter((r) => r.selected && !errors.has(r.uid) && !duplicates.has(r.uid));
  return { errors, duplicates, applicable, selectedInvalid: rows.filter((r) => r.selected && errors.has(r.uid)).length };
}

const colLabel = (r: RuleDraft) => r.column_name ?? (r.parameters.columns?.length ? r.parameters.columns.join(" + ") : "—");

export function RuleDraftTable({ rows, onChange, columnNames, datasetName, existing, showConfidence = false }: { rows: DraftRow[]; onChange: (rows: DraftRow[]) => void; columnNames: string[]; datasetName: string; existing: Existing; showConfidence?: boolean }) {
  const [editing, setEditing] = useState<DraftRow | null>(null);
  const a = useMemo(() => analyseRows(rows, columnNames, existing), [rows, columnNames, existing]);
  const patch = (uid: string, p: Partial<DraftRow>) => onChange(rows.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
  const allSelected = rows.length > 0 && rows.every((r) => r.selected);

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={(v) => onChange(rows.map((r) => ({ ...r, selected: v === true })))} aria-label="Select all rules" /></TableHead>
              <TableHead>Rule name</TableHead>
              <TableHead>Dataset</TableHead>
              <TableHead>Column</TableHead>
              <TableHead>Rule type</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const errs = a.errors.get(r.uid);
              const dup = a.duplicates.has(r.uid);
              return (
                <TableRow key={r.uid} className={dup ? "opacity-60" : ""}>
                  <TableCell><Checkbox checked={r.selected} onCheckedChange={(v) => patch(r.uid, { selected: v === true })} aria-label={`Select ${r.rule_name}`} /></TableCell>
                  <TableCell className="min-w-56 align-top">
                    <Input value={r.rule_name} onChange={(e) => patch(r.uid, { rule_name: e.target.value })} className="h-8 text-xs" aria-label="Rule name" />
                    {r.reason && <p className="mt-1 max-w-md text-[11px] leading-snug text-muted-foreground">{r.reason}</p>}
                    {showConfidence && (r.confidence || r.needsReview) && (
                      <p className="mt-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{r.confidence ? `${r.confidence} confidence` : ""}{r.needsReview ? " · review before applying" : ""}</p>
                    )}
                    {errs && <p className="mt-1 text-[11px] text-destructive">{errs.join(" ")}</p>}
                    {dup && !errs && <p className="mt-1 text-[11px] text-warning">Duplicate of an existing or earlier rule — will be skipped.</p>}
                  </TableCell>
                  <TableCell className="max-w-36 truncate align-top text-xs">{datasetName}</TableCell>
                  <TableCell className="align-top font-mono text-xs">{colLabel(r)}</TableCell>
                  <TableCell className="align-top text-xs">
                    {RULE_TYPE_LABEL[r.rule_type] ?? r.rule_type}
                    <div className="max-w-56 truncate font-mono text-[11px] text-muted-foreground" title={describeParams(r.rule_type, r.parameters)}>{describeParams(r.rule_type, r.parameters)}</div>
                  </TableCell>
                  <TableCell className="align-top">
                    <Select value={r.severity} onValueChange={(v) => patch(r.uid, { severity: v as Severity })}>
                      <SelectTrigger className="h-8 w-28 text-xs" aria-label="Severity"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="error">Error</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="align-top"><Switch checked={r.is_enabled} onCheckedChange={(v) => patch(r.uid, { is_enabled: v })} aria-label={`Enable ${r.rule_name}`} /></TableCell>
                  <TableCell className="text-right align-top whitespace-nowrap">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(r)} aria-label="Edit rule settings"><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => onChange(rows.filter((x) => x.uid !== r.uid))} aria-label="Remove rule from preview"><Trash2 className="size-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <ParamsDialog
          row={editing}
          columnNames={columnNames}
          onClose={() => setEditing(null)}
          onSave={(params) => {
            patch(editing.uid, { parameters: params });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

const splitList = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

function ParamsDialog({ row, columnNames, onClose, onSave }: { row: DraftRow; columnNames: string[]; onClose: () => void; onSave: (p: RuleParams) => void }) {
  const p0 = row.parameters;
  const [min, setMin] = useState(p0.min?.toString() ?? "");
  const [max, setMax] = useState(p0.max?.toString() ?? "");
  const [values, setValues] = useState((p0.values ?? []).join("\n"));
  const [caseSensitive, setCaseSensitive] = useState(p0.caseSensitive === true);
  const [type, setType] = useState<string>(p0.type ?? "string");
  const [operator, setOperator] = useState<string>(p0.operator ?? "gt");
  const [value, setValue] = useState(p0.value?.toString() ?? "");
  const [columns, setColumns] = useState((p0.columns ?? []).join(", "));
  const [ignoreEmpty, setIgnoreEmpty] = useState(p0.ignoreEmpty === true);
  const [caseInsensitive, setCaseInsensitive] = useState(p0.caseInsensitive === true);
  const [fill, setFill] = useState(p0.fillValue?.toString() ?? "");
  const [json, setJson] = useState(JSON.stringify(p0, null, 2));
  const [err, setErr] = useState("");
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  const submit = () => {
    setErr("");
    switch (row.rule_type) {
      case "range":
        return onSave({ min: num(min), max: num(max) });
      case "allowed_values":
        return onSave({ values: splitList(values), caseSensitive });
      case "data_type":
        return onSave({ type: type as RuleParams["type"] });
      case "custom":
        return onSave({ operator: operator as RuleParams["operator"], value: operator === "email" ? null : operator === "regex" ? value : num(value) });
      case "duplicate":
        return onSave({ columns: splitList(columns), ignoreEmpty, caseInsensitive });
      case "not_null":
        return onSave({ ...p0, treatEmptyAsNull: true, fillValue: fill || null });
      default:
        try {
          const parsed = JSON.parse(json);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          return onSave(parsed as RuleParams);
        } catch {
          setErr("Parameters must be a valid JSON object.");
        }
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit settings — {RULE_TYPE_LABEL[row.rule_type] ?? row.rule_type}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {row.rule_type === "range" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="pmin">Minimum</Label><Input id="pmin" type="number" step="any" value={min} onChange={(e) => setMin(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="pmax">Maximum</Label><Input id="pmax" type="number" step="any" value={max} onChange={(e) => setMax(e.target.value)} /></div>
            </div>
          )}
          {row.rule_type === "allowed_values" && (
            <>
              <div className="space-y-1"><Label htmlFor="pvals">Allowed values (one per line or comma separated)</Label><Textarea id="pvals" rows={6} value={values} onChange={(e) => setValues(e.target.value)} /></div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={caseSensitive} onCheckedChange={setCaseSensitive} />Case-sensitive comparison</label>
            </>
          )}
          {row.rule_type === "data_type" && (
            <div className="space-y-1"><Label>Expected type</Label><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["string", "integer", "float", "date", "boolean"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
          )}
          {row.rule_type === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Condition</Label><Select value={operator} onValueChange={setOperator}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[["gt", "> greater than"], ["gte", "≥ at least"], ["lt", "< less than"], ["lte", "≤ at most"], ["eq", "= equals"], ["neq", "≠ not equal"], ["email", "Valid email"], ["regex", "Matches regex"]].map(([v, l]) => <SelectItem key={v} value={v!}>{l}</SelectItem>)}</SelectContent></Select></div>
              {operator !== "email" && <div className="space-y-1"><Label htmlFor="pval">Value</Label><Input id="pval" value={value} onChange={(e) => setValue(e.target.value)} /></div>}
            </div>
          )}
          {row.rule_type === "duplicate" && (
            <>
              <div className="space-y-1"><Label htmlFor="pcols">Key columns (comma separated)</Label><Input id="pcols" value={columns} onChange={(e) => setColumns(e.target.value)} placeholder="Empty = complete-row duplicates" /><p className="text-[11px] text-muted-foreground">Available: {columnNames.join(", ")}</p></div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={ignoreEmpty} onCheckedChange={setIgnoreEmpty} />Ignore blank keys (leave blanks to a Required rule)</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={caseInsensitive} onCheckedChange={setCaseInsensitive} />Case-insensitive</label>
            </>
          )}
          {row.rule_type === "not_null" && (
            <div className="space-y-1"><Label htmlFor="pfill">Fill value (optional cleaning)</Label><Input id="pfill" value={fill} onChange={(e) => setFill(e.target.value)} placeholder="Leave empty to reject empty values" /></div>
          )}
          {!["range", "allowed_values", "data_type", "custom", "duplicate", "not_null"].includes(row.rule_type) && (
            <div className="space-y-1"><Label htmlFor="pjson">Parameters (JSON)</Label><Textarea id="pjson" rows={6} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} /></div>
          )}
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
