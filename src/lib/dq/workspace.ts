/**
 * Workspace lifecycle: scoped rule deletion, workspace reset, and the "Fresh Demo Workspace" startup decision.
 *
 * Everything here talks to a small WorkspaceStore interface (implemented over Supabase in db.ts), so the
 * rules — what may be deleted, in which order, and when a launch counts as a genuine new start — are
 * testable without a database. Deletions go through the delete_validation_rules / reset_workspace database
 * functions (one transaction, confirmation token, no touching settings or schema); if the migration has not
 * been applied, an ordered client-side fallback is used instead.
 */

export type WorkspaceMode = "demo" | "persistent";
/** Fresh Demo Workspace is the default for the local demonstration environment. */
export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "demo";

export type ResetScope = "all" | "samples";
export const RESET_CONFIRMATION = "RESET";

export interface WorkspaceCounts {
  datasets: number;
  sampleDatasets: number;
  rules: number;
  runs: number;
  results: number;
  logs: number;
  acceptedRecords: number;
  rejectedRecords: number;
}
export const EMPTY_COUNTS: WorkspaceCounts = { datasets: 0, sampleDatasets: 0, rules: 0, runs: 0, results: 0, logs: 0, acceptedRecords: 0, rejectedRecords: 0 };

export const isWorkspaceEmpty = (c: WorkspaceCounts) => c.datasets + c.rules + c.runs + c.results + c.logs + c.acceptedRecords + c.rejectedRecords === 0;

export interface ResetSummary {
  scope: ResetScope;
  datasets: number;
  rules: number;
  runs: number;
  results: number;
  logs: number;
  accepted_records: number;
  rejected_records: number;
}

export type DataTable = "datasets" | "validation_rules" | "pipeline_runs" | "validation_results" | "pipeline_logs" | "accepted_records" | "rejected_records";
export interface RowFilter {
  column: string;
  eq?: string | boolean;
  /** match every row that has a value in `column` (columns that are NOT NULL, i.e. all rows) */
  notNull?: true;
}
export interface StoreError {
  message: string;
  code?: string;
}
export interface WorkspaceState {
  /** false when migration 0002 has not been applied (no workspace_state table). */
  available: boolean;
  confirmed: boolean;
  lastLaunchId: string | null;
  lastResetAt: string | null;
}

export interface WorkspaceStore {
  rpc(fn: "delete_validation_rules" | "reset_workspace" | "begin_workspace_launch", args: Record<string, unknown>): Promise<{ data: unknown; error: StoreError | null }>;
  count(table: DataTable, filter?: RowFilter): Promise<{ count: number; error: StoreError | null }>;
  remove(table: DataTable, filter: RowFilter): Promise<{ count: number; error: StoreError | null }>;
  readState(): Promise<WorkspaceState>;
  setAutoResetConfirmed(value: boolean): Promise<{ error: StoreError | null }>;
}

const fail = (what: string, e: StoreError | null): never => {
  throw new Error(`${what}: ${e?.message ?? "unknown error"}`);
};

export const isMissingFunction = (e: StoreError | null, fn: string) => !!e && (e.code === "PGRST202" || (new RegExp(fn, "i").test(e.message) && /could not find the function|does not exist/i.test(e.message)));

/* ───────────────────────────── counts ───────────────────────────── */

export async function fetchCounts(store: WorkspaceStore): Promise<WorkspaceCounts> {
  const c = async (t: DataTable, f?: RowFilter) => {
    const r = await store.count(t, f);
    return r.error ? fail(`Could not count ${t.replaceAll("_", " ")}`, r.error) : r.count;
  };
  const [datasets, sampleDatasets, rules, runs, results, logs, acceptedRecords, rejectedRecords] = await Promise.all([
    c("datasets"), c("datasets", { column: "is_sample", eq: true }), c("validation_rules"), c("pipeline_runs"), c("validation_results"), c("pipeline_logs"), c("accepted_records"), c("rejected_records"),
  ]);
  return { datasets, sampleDatasets, rules, runs, results, logs, acceptedRecords, rejectedRecords };
}

/* ───────────────────── delete validation rules ───────────────────── */

export type RuleDeleteTarget = { scope: "dataset"; datasetId: string } | { scope: "all" };

/**
 * Delete validation rules only — never datasets, runs, logs or records.
 * "dataset" removes that dataset's rules; "all" removes every rule in the workspace.
 */
export async function deleteRulesScoped(store: WorkspaceStore, target: RuleDeleteTarget): Promise<{ deleted: number; mode: "rpc" | "direct" }> {
  if (target.scope === "dataset" && !target.datasetId) throw new Error("Choose a dataset first.");
  const args = target.scope === "dataset" ? { p_scope: "dataset", p_dataset_id: target.datasetId } : { p_scope: "all" };
  const rpc = await store.rpc("delete_validation_rules", args);
  if (!rpc.error) return { deleted: Number(rpc.data ?? 0), mode: "rpc" };
  if (!isMissingFunction(rpc.error, "delete_validation_rules")) throw new Error(rpc.error.message);

  const filter: RowFilter = target.scope === "dataset" ? { column: "dataset_id", eq: target.datasetId } : { column: "id", notNull: true };
  const del = await store.remove("validation_rules", filter);
  if (del.error) return fail("Could not delete rules", del.error);
  return { deleted: del.count, mode: "direct" };
}

/* ───────────────────────── reset workspace ───────────────────────── */

/**
 * Remove datasets, rules, runs, logs, results and accepted/rejected records, in foreign-key order.
 * scope "samples" removes only built-in sample data (is_sample); "all" removes everything in the workspace.
 * Settings, the schema and migrations are never touched. Refuses while a run is in progress.
 */
export async function resetWorkspace(store: WorkspaceStore, scope: ResetScope): Promise<{ summary: ResetSummary; mode: "rpc" | "ordered" }> {
  const rpc = await store.rpc("reset_workspace", { p_scope: scope, p_confirm: RESET_CONFIRMATION });
  if (!rpc.error) return { summary: normaliseSummary(rpc.data, scope), mode: "rpc" };
  if (!isMissingFunction(rpc.error, "reset_workspace")) throw new Error(rpc.error.message);

  // Fallback (migration 0002 not applied): ordered deletes, one statement each — NOT a single transaction.
  const running = await store.count("pipeline_runs", { column: "status", eq: "running" });
  if (running.error) fail("Could not check for active runs", running.error);
  if (running.count > 0) throw new Error("Reset refused: a pipeline run is still in progress.");
  const before = await fetchCounts(store);
  const del = async (t: DataTable, f: RowFilter) => {
    const r = await store.remove(t, f);
    if (r.error) fail(`Could not clear ${t.replaceAll("_", " ")}`, r.error);
  };
  if (scope === "all") {
    // children first; deleting runs/datasets would also cascade, but explicit order keeps the intent obvious
    for (const [t, col] of [["accepted_records", "run_id"], ["rejected_records", "run_id"], ["pipeline_logs", "run_id"], ["validation_results", "run_id"], ["pipeline_runs", "run_id"], ["validation_rules", "id"], ["datasets", "id"]] as const) await del(t, { column: col, notNull: true });
    return { mode: "ordered", summary: { scope, datasets: before.datasets, rules: before.rules, runs: before.runs, results: before.results, logs: before.logs, accepted_records: before.acceptedRecords, rejected_records: before.rejectedRecords } };
  }
  await del("pipeline_runs", { column: "is_sample", eq: true }); // results, logs and records cascade from the run
  await del("datasets", { column: "is_sample", eq: true }); // rules cascade from the dataset
  const after = await fetchCounts(store);
  return { mode: "ordered", summary: { scope, datasets: before.datasets - after.datasets, rules: before.rules - after.rules, runs: before.runs - after.runs, results: before.results - after.results, logs: before.logs - after.logs, accepted_records: before.acceptedRecords - after.acceptedRecords, rejected_records: before.rejectedRecords - after.rejectedRecords } };
}

function normaliseSummary(data: unknown, scope: ResetScope): ResetSummary {
  const d = (data ?? {}) as Partial<ResetSummary>;
  return { scope, datasets: d.datasets ?? 0, rules: d.rules ?? 0, runs: d.runs ?? 0, results: d.results ?? 0, logs: d.logs ?? 0, accepted_records: d.accepted_records ?? 0, rejected_records: d.rejected_records ?? 0 };
}

/* ───────────────── Fresh Demo Workspace: startup decision ───────────────── */

/**
 * Automatic resets run only in a development/demo environment: the Vite dev server, or when
 * VITE_DEMO_AUTO_RESET=true is set explicitly. A production build never deletes data on its own.
 */
export const autoResetAllowed = (env: { DEV?: boolean; VITE_DEMO_AUTO_RESET?: string }) => env.DEV === true || env.VITE_DEMO_AUTO_RESET === "true";

export type StartupResult =
  | { action: "skipped"; reason: "persistent-mode" | "not-allowed" | "no-launch-id" | "unavailable" | "empty" | "same-launch" }
  | { action: "needs-confirmation"; counts: WorkspaceCounts }
  | { action: "initialized"; counts: WorkspaceCounts; summary: ResetSummary | null };

/**
 * Decide what a page load should do. A reset happens only when ALL hold:
 *  - Fresh Demo mode, in an environment that allows automatic resets;
 *  - the user has confirmed (once) that fresh starts may delete the data in this database;
 *  - this is the first load of a genuinely new application launch. `launchId` is created once per dev-server
 *    start, so a browser refresh or hot reload presents the same id and is ignored; the database claims
 *    each launch id for exactly one caller, so a second tab cannot reset again.
 * Until the user has confirmed, existing data is never deleted — the caller shows a confirmation instead.
 */
export async function runStartup(i: { mode: WorkspaceMode; allowed: boolean; launchId: string | null; store: WorkspaceStore }): Promise<StartupResult> {
  if (i.mode !== "demo") return { action: "skipped", reason: "persistent-mode" };
  if (!i.allowed) return { action: "skipped", reason: "not-allowed" };
  if (!i.launchId) return { action: "skipped", reason: "no-launch-id" };
  const state = await i.store.readState();
  if (!state.available) return { action: "skipped", reason: "unavailable" };
  const counts = await fetchCounts(i.store);

  if (!state.confirmed) return isWorkspaceEmpty(counts) ? { action: "skipped", reason: "empty" } : { action: "needs-confirmation", counts };

  const claim = await i.store.rpc("begin_workspace_launch", { p_launch_id: i.launchId });
  if (claim.error) return { action: "skipped", reason: "unavailable" };
  if (claim.data !== true) return { action: "skipped", reason: "same-launch" };
  if (isWorkspaceEmpty(counts)) return { action: "initialized", counts, summary: null };
  const { summary } = await resetWorkspace(i.store, "all");
  return { action: "initialized", counts, summary };
}

/** User accepted the one-time confirmation: wipe the workspace, remember the consent, and claim this launch. */
export async function confirmFreshStart(store: WorkspaceStore, launchId: string | null): Promise<ResetSummary> {
  const { summary } = await resetWorkspace(store, "all");
  const c = await store.setAutoResetConfirmed(true);
  if (c.error) fail("Could not save your choice", c.error);
  if (launchId) await store.rpc("begin_workspace_launch", { p_launch_id: launchId });
  return summary;
}

/* ───────────────────────────── summaries ───────────────────────────── */

export const describeSummary = (s: ResetSummary) =>
  `${s.datasets} dataset(s), ${s.rules} rule(s), ${s.runs} run(s), ${s.accepted_records + s.rejected_records} accepted/rejected record(s) removed`;
