import { workspaceClient as supabase } from "./workspace";
import type { Tables } from "@/integrations/supabase/types";
import { inferSchema } from "./engine";
import { buildSamples } from "./samples";
import { RUN_DATA_CLEANUP_ORDER } from "./run-data";
import type { ProcessingOptions, Row, Rule } from "./types";
import { DEFAULT_OPTIONS } from "./types";
import { ruleFingerprint, validateParsed } from "./rule-sql";

export type Dataset = Tables<"datasets">;
export type RuleRow = Tables<"validation_rules">;
export type PipelineRun = Tables<"pipeline_runs">;
export type LogRow = Tables<"pipeline_logs">;

function check<T>(r: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as NonNullable<T>;
}

const LIGHT_DATASET_COLS = "id,name,source_type,source_reference,uploaded_filename,api_method,api_headers,requires_auth,schema_metadata,record_count,is_sample,status,created_at,updated_at";
export type DatasetLite = Omit<Dataset, "raw_records">;

export async function listDatasets(): Promise<DatasetLite[]> {
  return check(await supabase.from("datasets").select(LIGHT_DATASET_COLS).order("created_at", { ascending: false })) as DatasetLite[];
}
export async function getDataset(id: string): Promise<Dataset> {
  return check(await supabase.from("datasets").select("*").eq("id", id).single());
}
export async function createDataset(input: { name: string; source_type: "csv" | "api"; rows: Row[]; uploaded_filename?: string | null; source_reference?: string | null; api_method?: string | null; api_headers?: Record<string, string>; requires_auth?: boolean; is_sample?: boolean }) {
  return check(
    await supabase
      .from("datasets")
      .insert({
        name: input.name,
        source_type: input.source_type,
        uploaded_filename: input.uploaded_filename ?? null,
        source_reference: input.source_reference ?? null,
        api_method: input.api_method ?? null,
        api_headers: input.api_headers ?? {},
        requires_auth: input.requires_auth ?? false,
        raw_records: input.rows as never,
        record_count: input.rows.length,
        schema_metadata: inferSchema(input.rows) as never,
        is_sample: input.is_sample ?? false,
      })
      .select(LIGHT_DATASET_COLS)
      .single(),
  ) as DatasetLite;
}
export async function replaceDatasetRows(id: string, rows: Row[], filename?: string) {
  check(await supabase.from("datasets").update({ raw_records: rows as never, record_count: rows.length, schema_metadata: inferSchema(rows) as never, updated_at: new Date().toISOString(), ...(filename ? { uploaded_filename: filename } : {}) }).eq("id", id));
}
export async function updateDataset(id: string, patch: Partial<Pick<Dataset, "name" | "source_reference" | "api_method" | "requires_auth">> & { api_headers?: Record<string, string> }) {
  check(await supabase.from("datasets").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id));
}
export async function deleteDataset(id: string) {
  check(await supabase.from("datasets").delete().eq("id", id));
}

export async function listRules(): Promise<RuleRow[]> {
  return check(await supabase.from("validation_rules").select("*").order("created_at", { ascending: false }));
}
export async function upsertRule(r: Partial<RuleRow> & { dataset_id: string; rule_name: string; rule_type: string }) {
  if (r.id) return check(await supabase.from("validation_rules").update(r).eq("id", r.id));
  return check(await supabase.from("validation_rules").insert(r));
}
export async function deleteRule(id: string) {
  check(await supabase.from("validation_rules").delete().eq("id", id));
}
export const toRule = (r: RuleRow): Rule => ({ id: r.id, rule_name: r.rule_name, column_name: r.column_name, rule_type: r.rule_type as Rule["rule_type"], parameters: (r.parameters ?? {}) as Rule["parameters"], severity: r.severity as Rule["severity"], is_enabled: r.is_enabled });

export async function listRuns(): Promise<PipelineRun[]> {
  return check(await supabase.from("pipeline_runs").select("*").order("started_at", { ascending: false }).limit(1000));
}
export async function getRun(runId: string): Promise<PipelineRun | null> {
  const result = await supabase.from("pipeline_runs").select("*").eq("run_id", runId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export async function getLogs(runId: string): Promise<LogRow[]> {
  return check(await supabase.from("pipeline_logs").select("*").eq("run_id", runId).order("seq"));
}
export async function getValidationResults(runId?: string) {
  let q = supabase.from("validation_results").select("*").order("row_number", { nullsFirst: true }).limit(5000);
  if (runId) q = q.eq("run_id", runId);
  return check(await q);
}
/** Violation counts by error_type for the given runs (or all). */
export async function getViolationCounts(runIds?: string[]) {
  let q = supabase.from("validation_results").select("error_type,run_id,rule_name").limit(10000);
  if (runIds) q = q.in("run_id", runIds.length ? runIds : ["-"]);
  return check(await q);
}

export async function fetchRecords(kind: "accepted" | "rejected", opts: { runId?: string | undefined; datasetId?: string | undefined; page: number; pageSize: number }) {
  const table = kind === "accepted" ? "accepted_records" : "rejected_records";
  let q = supabase.from(table).select("*", { count: "exact" }).order("run_id", { ascending: false }).order("row_number");
  if (opts.runId) q = q.eq("run_id", opts.runId);
  if (opts.datasetId) q = q.eq("dataset_id", opts.datasetId);
  const r = await q.range(opts.page * opts.pageSize, opts.page * opts.pageSize + opts.pageSize - 1);
  if (r.error) throw new Error(r.error.message);
  return { rows: r.data as (Tables<"accepted_records"> & Partial<Tables<"rejected_records">>)[], count: r.count ?? 0 };
}
export async function fetchAllRecords(kind: "accepted" | "rejected", opts: { runId?: string | undefined; datasetId?: string | undefined }) {
  const all: (Tables<"accepted_records"> & Partial<Tables<"rejected_records">>)[] = [];
  for (let page = 0; ; page++) {
    const { rows } = await fetchRecords(kind, { ...opts, page, pageSize: 1000 });
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

export interface AppSettings {
  processing: ProcessingOptions;
  defaultRange: "7d" | "30d" | "90d" | "all";
  defaultSeverity: "critical" | "error" | "warning";
  maxUploadMb: number;
  apiTimeoutSec: number;
  retentionDays: number | null;
}
export const DEFAULT_SETTINGS: AppSettings = { processing: DEFAULT_OPTIONS, defaultRange: "30d", defaultSeverity: "error", maxUploadMb: 5, apiTimeoutSec: 15, retentionDays: null };

export async function getSettings(): Promise<AppSettings> {
  const r = check(await supabase.from("app_settings").select("settings").eq("id", 1).maybeSingle());
  const s = (r?.settings ?? {}) as Partial<AppSettings>;
  return { ...DEFAULT_SETTINGS, ...s, processing: { ...DEFAULT_OPTIONS, ...(s.processing ?? {}) } };
}
export async function saveSettings(s: AppSettings) {
  check(await supabase.from("app_settings").upsert({ id: 1, settings: s as never, updated_at: new Date().toISOString() }));
}

export async function loadSampleData() {
  const existing = check(await supabase.from("datasets").select("id").eq("is_sample", true).limit(1));
  if (existing.length) throw new Error("Demonstration data is already loaded. Reset it in Settings first.");
  for (const s of buildSamples()) {
    const ds = await createDataset({ name: `[Demo] ${s.name}`, source_type: "csv", rows: s.rows, uploaded_filename: s.filename, source_reference: "Built-in demonstration data", is_sample: true });
    check(await supabase.from("validation_rules").insert(s.rules.map((r) => ({ ...r, parameters: r.parameters as never, dataset_id: ds.id }))));
  }
}
export async function resetSampleData() {
  check(await supabase.from("pipeline_runs").delete().eq("is_sample", true));
  check(await supabase.from("datasets").delete().eq("is_sample", true));
}
export async function purgeOldRuns(days: number) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const r = await supabase.from("pipeline_runs").delete({ count: "exact" }).lt("started_at", cutoff);
  if (r.error) throw new Error(r.error.message);
  return r.count ?? 0;
}

export async function clearRunData() {
  const active = check(await supabase.from("pipeline_runs").select("run_id").eq("status", "running").limit(1));
  if (active.length) throw new Error("Wait for the active pipeline to finish before clearing run data.");

  let deletedRuns = 0;
  for (const table of RUN_DATA_CLEANUP_ORDER) {
    const result = await supabase.from(table).delete({ count: "exact" }).neq("run_id", "");
    if (result.error) throw new Error(`Could not clear ${table.replaceAll("_", " ")}: ${result.error.message}`);
    if (table === "pipeline_runs") deletedRuns = result.count ?? 0;
  }
  return deletedRuns;
}

/** Deletes rules for one dataset, or all rules. Datasets and runs are untouched. */
export async function deleteAllRules(datasetId?: string) {
  const rules = (await listRules()).filter((r) => !datasetId || r.dataset_id === datasetId);
  if (!rules.length) return 0;
  const q = supabase.from("validation_rules").delete({ count: "exact" }).in("id", rules.map((r) => r.id));
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.count ?? 0;
}
type ImportRow = { dataset_id: string; rule_name: string; column_name: string | null; rule_type: string; severity: string; is_enabled: boolean; parameters: unknown };
declare global { var __dqRuleImportQueue: Promise<unknown> | undefined; }
/** Serialize imports and re-read persisted rules immediately before insertion. */
export async function insertRules(rows: ImportRow[]) {
  const task = (globalThis.__dqRuleImportQueue ?? Promise.resolve()).catch(() => undefined).then(async () => {
    if (!rows.length) return 0;
    const existing = new Set((await listRules()).map((r) => `${r.dataset_id}|${ruleFingerprint(r)}`));
    const selected: ImportRow[] = [];
    for (const r of rows) {
      const ds = await getDataset(r.dataset_id);
      const columns = (ds.schema_metadata as unknown as import("./types").ColumnInfo[]).map((c) => c.name);
      const errors = validateParsed({ ...r, dataset: ds.name, parameters: r.parameters as Rule["parameters"] }, columns);
      if (errors.length) throw new Error(`${r.rule_name}: ${errors.join(" ")}`);
      const fingerprint = `${r.dataset_id}|${ruleFingerprint(r)}`;
      if (existing.has(fingerprint)) continue;
      existing.add(fingerprint); selected.push(r);
    }
    if (!selected.length) return 0;
    check(await supabase.from("validation_rules").insert(selected.map((r) => ({ ...r, parameters: r.parameters as never }))));
    return selected.length;
  });
  globalThis.__dqRuleImportQueue = task;
  return task;
}
