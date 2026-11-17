import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { inferSchema } from "./engine";
import { buildSamples } from "./samples";
import { RUN_DATA_CLEANUP_ORDER } from "./run-data";
import { persistRules, ruleErrorMessage, type BulkInsertResult, type RulesClient } from "./rule-persist";
import type { RuleDraft } from "./rule-templates";
import { confirmFreshStart, deleteRulesScoped, DEFAULT_WORKSPACE_MODE, fetchCounts, resetWorkspace, runStartup, type ResetScope, type RuleDeleteTarget, type StoreError, type WorkspaceMode, type WorkspaceState, type WorkspaceStore } from "./workspace";
import type { ProcessingOptions, Row, Rule } from "./types";
import { DEFAULT_OPTIONS } from "./types";

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
  const res = r.id ? await supabase.from("validation_rules").update(r).eq("id", r.id) : await supabase.from("validation_rules").insert(r);
  if (res.error) throw new Error(ruleErrorMessage(res.error.message));
  return (res.data ?? []) as unknown[];
}
export async function deleteRule(id: string) {
  check(await supabase.from("validation_rules").delete().eq("id", id));
}
export { ruleErrorMessage, type BulkInsertResult } from "./rule-persist";

/** Save many rules for one dataset atomically (see persistRules). */
export async function bulkInsertRules(datasetId: string, drafts: RuleDraft[]): Promise<BulkInsertResult> {
  return persistRules(supabase as unknown as RulesClient, datasetId, drafts);
}

export async function setRulesEnabled(ids: string[], enabled: boolean) {
  if (!ids.length) return;
  check(await supabase.from("validation_rules").update({ is_enabled: enabled }).in("id", ids));
}
export async function deleteRules(ids: string[]) {
  if (!ids.length) return;
  check(await supabase.from("validation_rules").delete().in("id", ids));
}

export const toRule = (r: RuleRow): Rule => ({ id: r.id, rule_name: r.rule_name, column_name: r.column_name, rule_type: r.rule_type as Rule["rule_type"], parameters: (r.parameters ?? {}) as Rule["parameters"], severity: r.severity as Rule["severity"], is_enabled: r.is_enabled });

export async function listRuns(): Promise<PipelineRun[]> {
  return check(await supabase.from("pipeline_runs").select("*").order("started_at", { ascending: false }).limit(1000));
}
export async function getRun(runId: string): Promise<PipelineRun | null> {
  return check(await supabase.from("pipeline_runs").select("*").eq("run_id", runId).maybeSingle());
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
  /** "demo" = Fresh Demo Workspace (default); "persistent" = keep everything across restarts. */
  workspaceMode: WorkspaceMode;
}
export const DEFAULT_SETTINGS: AppSettings = { processing: DEFAULT_OPTIONS, defaultRange: "30d", defaultSeverity: "error", maxUploadMb: 5, apiTimeoutSec: 15, retentionDays: null, workspaceMode: DEFAULT_WORKSPACE_MODE };

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

/* ───────────────────────── workspace lifecycle ───────────────────────── */

type Err = { message: string; code?: string } | null;
const toErr = (e: Err): StoreError | null => (e ? { message: e.message, ...(e.code ? { code: e.code } : {}) } : null);
// The workspace helpers address tables by name at runtime, so they use an untyped view of the client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: Err }> };

/** WorkspaceStore over Supabase. All writes go through RLS-governed table access or the SQL functions in migration 0002. */
export const workspaceStore: WorkspaceStore = {
  async rpc(fn, args) {
    const r = await sb.rpc(fn, args);
    return { data: r.data, error: toErr(r.error) };
  },
  async count(table, filter) {
    let q = sb.from(table).select("*", { count: "exact", head: true });
    if (filter?.eq !== undefined) q = q.eq(filter.column, filter.eq);
    if (filter?.notNull) q = q.not(filter.column, "is", null);
    const r = await q;
    return { count: r.count ?? 0, error: toErr(r.error) };
  },
  async remove(table, filter) {
    let q = sb.from(table).delete({ count: "exact" });
    q = filter.eq !== undefined ? q.eq(filter.column, filter.eq) : q.not(filter.column, "is", null);
    const r = await q;
    return { count: r.count ?? 0, error: toErr(r.error) };
  },
  async readState(): Promise<WorkspaceState> {
    const r = await sb.from("workspace_state").select("auto_reset_confirmed,last_launch_id,last_reset_at").eq("id", 1).maybeSingle();
    if (r.error) return { available: false, confirmed: false, lastLaunchId: null, lastResetAt: null }; // table missing → migration 0002 not applied → never auto-reset
    return { available: true, confirmed: r.data?.auto_reset_confirmed === true, lastLaunchId: r.data?.last_launch_id ?? null, lastResetAt: r.data?.last_reset_at ?? null };
  },
  async setAutoResetConfirmed(value) {
    const r = await sb.from("workspace_state").upsert({ id: 1, auto_reset_confirmed: value });
    return { error: toErr(r.error) };
  },
};

export const getWorkspaceCounts = () => fetchCounts(workspaceStore);
export const getWorkspaceState = () => workspaceStore.readState();
/** Delete validation rules only (one dataset, or all). Never touches datasets, runs or history. */
export const deleteRulesByScope = (target: RuleDeleteTarget) => deleteRulesScoped(workspaceStore, target);
export const resetWorkspaceData = (scope: ResetScope) => resetWorkspace(workspaceStore, scope);
export const startWorkspace = (i: { mode: WorkspaceMode; allowed: boolean; launchId: string | null }) => runStartup({ ...i, store: workspaceStore });
export const confirmFreshWorkspace = (launchId: string | null) => confirmFreshStart(workspaceStore, launchId);
