import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isEvaluated, metricQuality, trendByDay } from "./analytics";
import type { PipelineRun } from "./db";
import {
  autoResetAllowed, confirmFreshStart, deleteRulesScoped, describeSummary, EMPTY_COUNTS, fetchCounts, isWorkspaceEmpty, resetWorkspace, runStartup,
  type DataTable, type RowFilter, type StoreError, type WorkspaceState, type WorkspaceStore,
} from "./workspace";

/* ───────────────────────── in-memory database (NOT Postgres) ─────────────────────────
 * Mirrors the schema's foreign keys: validation_rules → datasets ON DELETE CASCADE;
 * results/logs/accepted/rejected → pipeline_runs ON DELETE CASCADE; accepted/rejected → datasets CASCADE;
 * pipeline_runs.dataset_id → datasets ON DELETE SET NULL. app_settings is kept to prove it is never touched.
 * The three SQL functions of migration 0002 are emulated from their documented behaviour. */
type Row = Record<string, unknown>;
const TABLES: DataTable[] = ["datasets", "validation_rules", "pipeline_runs", "validation_results", "pipeline_logs", "accepted_records", "rejected_records"];

class FakeDb {
  t: Record<DataTable, Row[]> = { datasets: [], validation_rules: [], pipeline_runs: [], validation_results: [], pipeline_logs: [], accepted_records: [], rejected_records: [] };
  appSettings: Row = { id: 1, settings: { defaultSeverity: "error", workspaceMode: "demo" } };
  state = { available: true, confirmed: false, last_launch_id: null as string | null, last_reset_at: null as string | null };
  functionsMissing = false;
  deleteOrder: DataTable[] = [];
  rpcCalls: string[] = [];

  seed() {
    this.t.datasets = [{ id: "ds-iris", is_sample: false }, { id: "ds-bank", is_sample: false }, { id: "ds-demo", is_sample: true }];
    this.t.validation_rules = [...["a", "b", "c", "d", "e"].map((x) => ({ id: `r-iris-${x}`, dataset_id: "ds-iris" })), ...["a", "b", "c"].map((x) => ({ id: `r-bank-${x}`, dataset_id: "ds-bank" })), ...["a", "b"].map((x) => ({ id: `r-demo-${x}`, dataset_id: "ds-demo" }))];
    this.t.pipeline_runs = [{ run_id: "run-1", dataset_id: "ds-iris", is_sample: false, status: "success" }, { run_id: "run-2", dataset_id: "ds-bank", is_sample: false, status: "partial_success" }, { run_id: "run-3", dataset_id: "ds-demo", is_sample: true, status: "success" }];
    for (const r of ["run-1", "run-2", "run-3"]) {
      const ds = (this.t.pipeline_runs.find((x) => x["run_id"] === r)!["dataset_id"]) as string;
      this.t.validation_results.push({ run_id: r }, { run_id: r });
      this.t.pipeline_logs.push({ run_id: r }, { run_id: r }, { run_id: r });
      this.t.accepted_records.push({ run_id: r, dataset_id: ds }, { run_id: r, dataset_id: ds });
      this.t.rejected_records.push({ run_id: r, dataset_id: ds });
    }
    return this;
  }
  n = (t: DataTable) => this.t[t].length;
  snapshot = () => Object.fromEntries(TABLES.map((t) => [t, this.n(t)])) as Record<DataTable, number>;

  private match(t: DataTable, f?: RowFilter) {
    return this.t[t].filter((r) => !f || (f.notNull ? r[f.column] !== null && r[f.column] !== undefined : r[f.column] === f.eq));
  }
  /** delete rows (with FK cascades) and return the number of DIRECTLY matched rows */
  private del(t: DataTable, rows: Row[]) {
    const set = new Set(rows);
    this.deleteOrder.push(t);
    this.t[t] = this.t[t].filter((r) => !set.has(r));
    if (t === "datasets") {
      const ids = new Set(rows.map((r) => r["id"]));
      this.t.validation_rules = this.t.validation_rules.filter((r) => !ids.has(r["dataset_id"]));
      this.t.accepted_records = this.t.accepted_records.filter((r) => !ids.has(r["dataset_id"]));
      this.t.rejected_records = this.t.rejected_records.filter((r) => !ids.has(r["dataset_id"]));
      this.t.pipeline_runs.forEach((r) => { if (ids.has(r["dataset_id"])) r["dataset_id"] = null; }); // SET NULL
    }
    if (t === "pipeline_runs") {
      const ids = new Set(rows.map((r) => r["run_id"]));
      for (const c of ["validation_results", "pipeline_logs", "accepted_records", "rejected_records"] as const) this.t[c] = this.t[c].filter((r) => !ids.has(r["run_id"]));
    }
    return rows.length;
  }

  store(): WorkspaceStore {
    const db = this;
    const missing: StoreError = { code: "PGRST202", message: "Could not find the function public.x in the schema cache" };
    return {
      async count(t, f) { return { count: db.match(t, f).length, error: null }; },
      async remove(t, f) { return { count: db.del(t, db.match(t, f)), error: null }; },
      async readState(): Promise<WorkspaceState> { return { available: db.state.available, confirmed: db.state.confirmed, lastLaunchId: db.state.last_launch_id, lastResetAt: db.state.last_reset_at }; },
      async setAutoResetConfirmed(v) { db.state.confirmed = v; return { error: null }; },
      async rpc(fn, args) {
        db.rpcCalls.push(fn);
        if (db.functionsMissing) return { data: null, error: missing };
        const err = (message: string) => ({ data: null, error: { message } });
        if (fn === "delete_validation_rules") {
          if (args["p_scope"] === "dataset") {
            if (!args["p_dataset_id"]) return err('A dataset id is required when scope is "dataset".');
            return { data: db.del("validation_rules", db.match("validation_rules", { column: "dataset_id", eq: args["p_dataset_id"] as string })), error: null };
          }
          if (args["p_scope"] === "all") return args["p_dataset_id"] ? err('Do not pass a dataset id when scope is "all".') : { data: db.del("validation_rules", db.t.validation_rules.slice()), error: null };
          return err("Unknown scope");
        }
        if (fn === "reset_workspace") {
          if (args["p_confirm"] !== "RESET") return err("Reset refused: confirmation text must be RESET.");
          if (!["all", "samples"].includes(args["p_scope"] as string)) return err("Unknown scope");
          if (db.t.pipeline_runs.some((r) => r["status"] === "running")) return err("Reset refused: a pipeline run is still in progress.");
          const all = args["p_scope"] === "all";
          const sampleRuns = new Set(db.t.pipeline_runs.filter((r) => r["is_sample"]).map((r) => r["run_id"]));
          const sel = (t: DataTable) => (all ? db.t[t].slice() : db.t[t].filter((r) => sampleRuns.has(r["run_id"])));
          const out = { scope: args["p_scope"], accepted_records: 0, rejected_records: 0, logs: 0, results: 0, runs: 0, rules: 0, datasets: 0 };
          out.accepted_records = db.del("accepted_records", sel("accepted_records"));
          out.rejected_records = db.del("rejected_records", sel("rejected_records"));
          out.logs = db.del("pipeline_logs", sel("pipeline_logs"));
          out.results = db.del("validation_results", sel("validation_results"));
          out.runs = db.del("pipeline_runs", all ? db.t.pipeline_runs.slice() : db.t.pipeline_runs.filter((r) => r["is_sample"]));
          if (all) out.rules = db.del("validation_rules", db.t.validation_rules.slice());
          else { const ids = new Set(db.t.datasets.filter((d) => d["is_sample"]).map((d) => d["id"])); out.rules = db.t.validation_rules.filter((r) => ids.has(r["dataset_id"])).length; }
          out.datasets = db.del("datasets", all ? db.t.datasets.slice() : db.t.datasets.filter((d) => d["is_sample"]));
          db.state.last_reset_at = "now";
          return { data: out, error: null };
        }
        if (fn === "begin_workspace_launch") {
          if (!args["p_launch_id"]) return err("A launch id is required.");
          if (db.state.last_launch_id === args["p_launch_id"]) return { data: false, error: null };
          db.state.last_launch_id = args["p_launch_id"] as string; // single atomic UPDATE in SQL
          return { data: true, error: null };
        }
        return err("unknown function");
      },
    };
  }
}

const MODES = [{ label: "database function (RPC)", missing: false }, { label: "fallback (migration not applied)", missing: true }];

describe("fresh workspace", () => {
  it("an empty database reports zero everywhere and counts as empty", async () => {
    const db = new FakeDb();
    const c = await fetchCounts(db.store());
    expect(c).toEqual(EMPTY_COUNTS);
    expect(isWorkspaceEmpty(c)).toBe(true);
    expect(isWorkspaceEmpty({ ...EMPTY_COUNTS, rules: 1 })).toBe(false);
  });
  it("dashboard metrics for a workspace with no runs are not fabricated", () => {
    expect(metricQuality([])).toBeNull();
    expect(trendByDay([])).toEqual([]);
    const run = { started_at: "2026-01-01T00:00:00Z", status: "not_evaluated", source_count: 50, accepted_count: 50, rejected_count: 0 } as unknown as PipelineRun;
    expect(isEvaluated(run)).toBe(false);
    expect(metricQuality([run])).toBeNull(); // never 100% for an unevaluated run
  });
  it("seeded fixture counts are exact", async () => {
    const c = await fetchCounts(new FakeDb().seed().store());
    expect(c).toEqual({ datasets: 3, sampleDatasets: 1, rules: 10, runs: 3, results: 6, logs: 9, acceptedRecords: 6, rejectedRecords: 3 });
  });
});

for (const mode of MODES) {
  describe(`delete rules — ${mode.label}`, () => {
    const setup = () => { const db = new FakeDb().seed(); db.functionsMissing = mode.missing; return db; };

    it("one dataset: removes only that dataset's rules", async () => {
      const db = setup();
      const before = db.snapshot();
      const r = await deleteRulesScoped(db.store(), { scope: "dataset", datasetId: "ds-iris" });
      expect(r.deleted).toBe(5);
      expect(r.mode).toBe(mode.missing ? "direct" : "rpc");
      expect(db.t.validation_rules.map((x) => x["dataset_id"]).sort()).toEqual(["ds-bank", "ds-bank", "ds-bank", "ds-demo", "ds-demo"]);
      expect({ ...db.snapshot(), validation_rules: 0 }).toEqual({ ...before, validation_rules: 0 }); // nothing else changed
    });
    it("all datasets: removes every rule but no dataset, run, log, result or record", async () => {
      const db = setup();
      const before = db.snapshot();
      const r = await deleteRulesScoped(db.store(), { scope: "all" });
      expect(r.deleted).toBe(10);
      expect(db.n("validation_rules")).toBe(0);
      expect({ ...db.snapshot(), validation_rules: 0 }).toEqual({ ...before, validation_rules: 0 });
      expect(db.appSettings["settings"]).toEqual({ defaultSeverity: "error", workspaceMode: "demo" });
    });
    it("deleting rules of a dataset with none deletes nothing", async () => {
      const db = setup();
      expect((await deleteRulesScoped(db.store(), { scope: "dataset", datasetId: "ds-unknown" })).deleted).toBe(0);
      expect(db.n("validation_rules")).toBe(10);
    });
    it("refuses a dataset scope without a dataset", async () => {
      const db = setup();
      await expect(deleteRulesScoped(db.store(), { scope: "dataset", datasetId: "" })).rejects.toThrow(/dataset/i);
      expect(db.n("validation_rules")).toBe(10);
    });
  });

  describe(`reset workspace — ${mode.label}`, () => {
    const setup = () => { const db = new FakeDb().seed(); db.functionsMissing = mode.missing; return db; };

    it("everything: clears datasets, rules, runs, logs, results and records, keeps settings, reports exact counts", async () => {
      const db = setup();
      const { summary } = await resetWorkspace(db.store(), "all");
      expect(db.snapshot()).toEqual({ datasets: 0, validation_rules: 0, pipeline_runs: 0, validation_results: 0, pipeline_logs: 0, accepted_records: 0, rejected_records: 0 });
      expect(summary).toEqual({ scope: "all", datasets: 3, rules: 10, runs: 3, results: 6, logs: 9, accepted_records: 6, rejected_records: 3 });
      expect(db.appSettings["settings"]).toEqual({ defaultSeverity: "error", workspaceMode: "demo" });
      expect(describeSummary(summary)).toMatch(/3 dataset\(s\), 10 rule\(s\), 3 run\(s\), 9 accepted\/rejected/);
    });
    it("deletes children before parents (foreign-key order)", async () => {
      const db = setup();
      await resetWorkspace(db.store(), "all");
      const o = db.deleteOrder;
      const idx = (t: DataTable) => o.indexOf(t);
      for (const child of ["accepted_records", "rejected_records", "pipeline_logs", "validation_results"] as const) expect(idx(child)).toBeLessThan(idx("pipeline_runs"));
      expect(idx("pipeline_runs")).toBeLessThan(idx("datasets"));
      expect(idx("validation_rules")).toBeLessThan(idx("datasets"));
    });
    it("samples only: removes sample datasets and their runs, keeps the user's data", async () => {
      const db = setup();
      const { summary } = await resetWorkspace(db.store(), "samples");
      expect(db.t.datasets.map((d) => d["id"])).toEqual(["ds-iris", "ds-bank"]);
      expect(db.t.pipeline_runs.map((r) => r["run_id"])).toEqual(["run-1", "run-2"]);
      expect(db.n("validation_rules")).toBe(8); // demo's 2 rules cascaded away
      expect(summary.datasets).toBe(1);
      expect(summary.rules).toBe(2);
      expect(summary.runs).toBe(1);
    });
    it("refuses while a run is in progress and deletes nothing", async () => {
      const db = setup();
      db.t.pipeline_runs.push({ run_id: "run-live", dataset_id: "ds-iris", is_sample: false, status: "running" });
      const before = db.snapshot();
      await expect(resetWorkspace(db.store(), "all")).rejects.toThrow(/in progress/);
      expect(db.snapshot()).toEqual(before);
    });
    it("resetting an already-empty workspace is a harmless no-op", async () => {
      const db = new FakeDb();
      db.functionsMissing = mode.missing;
      expect((await resetWorkspace(db.store(), "all")).summary.datasets).toBe(0);
    });
  });
}

describe("reset safety", () => {
  it("the database function refuses a wrong confirmation token and deletes nothing", async () => {
    const db = new FakeDb().seed();
    const before = db.snapshot();
    const r = await db.store().rpc("reset_workspace", { p_scope: "all", p_confirm: "yes" });
    expect(r.error?.message).toMatch(/RESET/);
    expect(db.snapshot()).toEqual(before);
  });
  it("the app always sends the confirmation token", async () => {
    const db = new FakeDb().seed();
    await resetWorkspace(db.store(), "all");
    expect(db.n("datasets")).toBe(0); // would have been refused without p_confirm = RESET
  });
});

describe("Fresh Demo Workspace startup", () => {
  const base = { mode: "demo" as const, allowed: true, launchId: "launch-A" };

  it("Persistent Workspace never deletes anything, across restarts", async () => {
    const db = new FakeDb().seed();
    for (const id of ["launch-A", "launch-B", "launch-C"]) expect((await runStartup({ ...base, mode: "persistent", launchId: id, store: db.store() })).action).toBe("skipped");
    expect(db.n("datasets")).toBe(3);
  });
  it("production (automatic resets not allowed) never deletes, even in demo mode and when confirmed", async () => {
    const db = new FakeDb().seed();
    db.state.confirmed = true;
    const r = await runStartup({ ...base, allowed: false, store: db.store() });
    expect(r).toEqual({ action: "skipped", reason: "not-allowed" });
    expect(db.n("datasets")).toBe(3);
    expect(autoResetAllowed({ DEV: false })).toBe(false);
    expect(autoResetAllowed({})).toBe(false);
    expect(autoResetAllowed({ DEV: true })).toBe(true);
    expect(autoResetAllowed({ DEV: false, VITE_DEMO_AUTO_RESET: "true" })).toBe(true);
    expect(autoResetAllowed({ DEV: false, VITE_DEMO_AUTO_RESET: "yes" })).toBe(false);
  });
  it("without a launch id (outside Vite) nothing happens", async () => {
    const db = new FakeDb().seed();
    db.state.confirmed = true;
    expect((await runStartup({ ...base, launchId: null, store: db.store() })).action).toBe("skipped");
    expect(db.n("datasets")).toBe(3);
  });
  it("migration 0002 not applied → never resets", async () => {
    const db = new FakeDb().seed();
    db.state.available = false;
    expect(await runStartup({ ...base, store: db.store() })).toEqual({ action: "skipped", reason: "unavailable" });
    expect(db.n("datasets")).toBe(3);
  });
  it("existing data + no consent yet → asks first, with exact counts, and deletes nothing (also on refresh)", async () => {
    const db = new FakeDb().seed();
    for (let i = 0; i < 3; i++) {
      const r = await runStartup({ ...base, store: db.store() });
      expect(r.action).toBe("needs-confirmation");
      if (r.action === "needs-confirmation") expect(r.counts.datasets).toBe(3);
    }
    expect(db.n("datasets")).toBe(3);
    expect(db.rpcCalls).not.toContain("reset_workspace");
  });
  it("empty workspace + no consent → nothing to ask", async () => {
    expect(await runStartup({ ...base, store: new FakeDb().store() })).toEqual({ action: "skipped", reason: "empty" });
  });
  it("confirmed + genuinely new launch → resets once and reports what was cleared", async () => {
    const db = new FakeDb().seed();
    db.state.confirmed = true;
    const r = await runStartup({ ...base, store: db.store() });
    expect(r.action).toBe("initialized");
    if (r.action === "initialized") expect(r.summary?.datasets).toBe(3);
    expect(db.snapshot()).toEqual({ datasets: 0, validation_rules: 0, pipeline_runs: 0, validation_results: 0, pipeline_logs: 0, accepted_records: 0, rejected_records: 0 });
    expect(db.appSettings["settings"]).toEqual({ defaultSeverity: "error", workspaceMode: "demo" });
  });
  it("a browser refresh (same launch id) does not erase data created after the reset", async () => {
    const db = new FakeDb().seed();
    db.state.confirmed = true;
    await runStartup({ ...base, store: db.store() }); // launch A initialises
    db.t.datasets.push({ id: "ds-new", is_sample: false }); // user uploads a CSV
    db.t.validation_rules.push({ id: "r-new", dataset_id: "ds-new" });
    for (let i = 0; i < 3; i++) expect(await runStartup({ ...base, store: db.store() })).toEqual({ action: "skipped", reason: "same-launch" }); // refresh ×3
    expect(db.n("datasets")).toBe(1);
    expect(db.n("validation_rules")).toBe(1);
  });
  it("restarting the app (a new launch id) starts empty again", async () => {
    const db = new FakeDb().seed();
    db.state.confirmed = true;
    await runStartup({ ...base, store: db.store() });
    db.t.datasets.push({ id: "ds-new", is_sample: false });
    const r = await runStartup({ ...base, launchId: "launch-B", store: db.store() });
    expect(r.action).toBe("initialized");
    expect(db.n("datasets")).toBe(0);
  });
  it("two tabs opening the same launch reset exactly once", async () => {
    const db = new FakeDb().seed();
    db.state.confirmed = true;
    const [a, b] = await Promise.all([runStartup({ ...base, store: db.store() }), runStartup({ ...base, store: db.store() })]);
    expect([a.action, b.action].sort()).toEqual(["initialized", "skipped"]);
    expect(db.rpcCalls.filter((f) => f === "reset_workspace")).toHaveLength(1);
  });
  it("a new launch with an already-empty workspace initialises without deleting anything", async () => {
    const db = new FakeDb();
    db.state.confirmed = true;
    const r = await runStartup({ ...base, store: db.store() });
    expect(r.action).toBe("initialized");
    if (r.action === "initialized") expect(r.summary).toBeNull();
    expect(db.rpcCalls).not.toContain("reset_workspace");
  });
  it("confirming the one-time prompt wipes, remembers consent and claims this launch (no repeat on refresh)", async () => {
    const db = new FakeDb().seed();
    const s = await confirmFreshStart(db.store(), "launch-A");
    expect(s.datasets).toBe(3);
    expect(db.state.confirmed).toBe(true);
    db.t.datasets.push({ id: "ds-after", is_sample: false });
    expect(await runStartup({ ...base, store: db.store() })).toEqual({ action: "skipped", reason: "same-launch" });
    expect(db.n("datasets")).toBe(1);
    expect((await runStartup({ ...base, launchId: "launch-B", store: db.store() })).action).toBe("initialized"); // next restart
    expect(db.n("datasets")).toBe(0);
  });
});

describe("migration 0002 (structure)", () => {
  const root = process.cwd();
  const sql = readFileSync(path.join(root, "drizzle/migrations/0002_workspace_lifecycle.sql"), "utf8");
  const code = sql.replace(/^\s*--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");

  it("never drops or truncates anything", () => {
    expect(code).not.toMatch(/\b(DROP|TRUNCATE)\b/i);
  });
  it("every DELETE has a WHERE clause (no unscoped delete)", () => {
    const deletes = code.match(/DELETE\s+FROM[^;]*;/gi) ?? [];
    expect(deletes.length).toBeGreaterThan(5);
    for (const d of deletes) expect(d).toMatch(/\bWHERE\b/i);
  });
  it("never touches app_settings", () => {
    expect(code).not.toMatch(/app_settings/i);
  });
  it("delete_validation_rules deletes from validation_rules only", () => {
    const body = /FUNCTION public\.delete_validation_rules[\s\S]*?\$\$;/.exec(sql)![0];
    const targets = [...body.matchAll(/DELETE\s+FROM\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(new Set(targets)).toEqual(new Set(["validation_rules"]));
  });
  it("reset_workspace requires the RESET token and deletes in foreign-key order", () => {
    const body = /FUNCTION public\.reset_workspace[\s\S]*?\$\$;/.exec(sql)![0];
    expect(body).toMatch(/p_confirm IS DISTINCT FROM 'RESET'/);
    expect(body).toMatch(/status = 'running'/);
    const all = body.slice(body.indexOf("IF p_scope = 'all' THEN"), body.indexOf("ELSE\n    DELETE FROM public.accepted_records"));
    const order = [...all.matchAll(/DELETE FROM public\.(\w+)/g)].map((m) => m[1]);
    expect(order).toEqual(["accepted_records", "rejected_records", "pipeline_logs", "validation_results", "pipeline_runs", "validation_rules", "datasets"]);
  });
  it("launch claiming is a single atomic UPDATE and functions are not executable by PUBLIC", () => {
    expect(sql).toMatch(/UPDATE public\.workspace_state SET last_launch_id = p_launch_id\s+WHERE id = 1 AND last_launch_id IS DISTINCT FROM p_launch_id/);
    for (const f of ["delete_validation_rules(text, uuid)", "reset_workspace(text, text)", "begin_workspace_launch(text)"]) expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC`);
  });
  it("is registered in the drizzle journal and creates no workspace column on existing tables", () => {
    const j = JSON.parse(readFileSync(path.join(root, "drizzle/migrations/meta/_journal.json"), "utf8"));
    expect(j.entries.map((e: { tag: string }) => e.tag)).toContain("0002_workspace_lifecycle");
    expect(code).not.toMatch(/ALTER\s+TABLE\s+public\.(datasets|validation_rules|pipeline_runs)/i);
  });
});
