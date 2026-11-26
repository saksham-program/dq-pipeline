/** Browser-only disposable relational store. No network calls or durable storage. */
type RecordData = Record<string, unknown>;
type Result = { data: RecordData[] | RecordData | null; error: { message: string } | null; count: number | null };
const TABLES = ["datasets", "validation_rules", "pipeline_runs", "pipeline_logs", "validation_results", "accepted_records", "rejected_records", "app_settings"] as const;
export type DemoTable = typeof TABLES[number];
export type DemoStore = Record<DemoTable, RecordData[]>;
export const createDemoStore = (): DemoStore => ({ datasets: [], validation_rules: [], pipeline_runs: [], pipeline_logs: [], validation_results: [], accepted_records: [], rejected_records: [], app_settings: [] });

function defaults(table: DemoTable): RecordData {
  const now = new Date().toISOString();
  const common = { id: crypto.randomUUID(), created_at: now };
  switch (table) {
    case "datasets": return { ...common, source_reference: null, uploaded_filename: null, api_method: null, api_headers: {}, requires_auth: false, schema_metadata: [], raw_records: [], record_count: 0, is_sample: false, status: "ready", updated_at: now };
    case "validation_rules": return { ...common, column_name: null, parameters: {}, severity: "error", is_enabled: true };
    case "pipeline_runs": return { ...common, dataset_id: null, status: "pending", stages: {}, started_at: now, completed_at: null, duration_ms: null, source_count: 0, accepted_count: 0, rejected_count: 0, loaded_count: 0, load_failure_count: 0, violation_count: 0, reconciliation_status: null, schema_snapshot: [], error_message: null, is_sample: false };
    case "pipeline_logs": return { ...common, timestamp: now, seq: 0, log_level: "info" };
    case "accepted_records": return { ...common, dataset_id: null };
    case "rejected_records": return { ...common, dataset_id: null, rejection_reasons: [], max_severity: "error" };
    case "app_settings": return { id: 1, settings: {}, updated_at: now };
    default: return common;
  }
}

/** Implements only the query operations used by DQ's existing persistence layer. */
export class DemoQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private values: RecordData[] = [];
  private filters: ((r: RecordData) => boolean)[] = [];
  private orders: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  private fields = "*";
  private returning = false;
  private cardinality: "many" | "single" | "maybe" = "many";
  private start = 0;
  private end = Infinity;
  private countRequested = false;
  private conflicts = ["id"];
  private ignoreDuplicates = false;
  private result: Promise<Result> | undefined;
  constructor(private store: DemoStore, private table: DemoTable) {}
  select(fields = "*", opts?: { count?: string }) { this.fields = fields; this.returning = true; this.countRequested ||= !!opts?.count; return this; }
  insert(v: RecordData | RecordData[]) { this.op = "insert"; this.values = structuredClone(Array.isArray(v) ? v : [v]); return this; }
  update(v: RecordData) { this.op = "update"; this.values = [structuredClone(v)]; return this; }
  delete(opts?: { count?: string }) { this.op = "delete"; this.countRequested = !!opts?.count; return this; }
  upsert(v: RecordData | RecordData[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.insert(v); this.op = "upsert"; this.conflicts = opts?.onConflict?.split(",") ?? ["id"]; this.ignoreDuplicates = opts?.ignoreDuplicates ?? false; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, v: unknown[]) { this.filters.push((r) => v.includes(r[c])); return this; }
  lt(c: string, v: string) { this.filters.push((r) => String(r[c]) < v); return this; }
  not(c: string, op: string, v: unknown) { if (op !== "is" || v !== null) throw new Error("Unsupported demo filter"); this.filters.push((r) => r[c] != null); return this; }
  like(c: string, v: string) { const re = new RegExp(`^${v.split("%").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`); this.filters.push((r) => re.test(String(r[c]))); return this; }
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) { this.orders.push({ column, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst ?? false }); return this; }
  limit(n: number) { this.end = n; return this; }
  range(start: number, end: number) { this.start = start; this.end = end + 1; return this; }
  single() { this.cardinality = "single"; return this; }
  maybeSingle() { this.cardinality = "maybe"; return this; }
  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    this.result ??= Promise.resolve().then(() => this.execute());
    return this.result.then(onfulfilled, onrejected);
  }
  private execute(): Result {
    try {
      const current = this.store[this.table];
      let affected = current.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "insert" || this.op === "upsert") {
        // Validate complete batches before changing anything.
        const next = structuredClone(current); affected = [];
        for (const v of this.values) {
          if (v["dataset_id"] != null && !this.store.datasets.some((d) => d["id"] === v["dataset_id"])) throw new Error("Dataset does not exist.");
          if (this.table !== "pipeline_runs" && v["run_id"] != null && !this.store.pipeline_runs.some((r) => r["run_id"] === v["run_id"])) throw new Error("Run does not exist.");
          const found = this.op === "upsert" ? next.find((r) => this.conflicts.every((k) => v[k] != null && r[k] === v[k])) : undefined;
          if (found) { if (!this.ignoreDuplicates) { Object.assign(found, v); affected.push(found); } continue; }
          if (this.table === "pipeline_runs" && next.some((r) => r["run_id"] === v["run_id"])) throw new Error("duplicate run_id");
          const row = { ...defaults(this.table), ...v }; next.push(row); affected.push(row);
        }
        this.store[this.table] = next;
      } else if (this.op === "update") {
        for (const row of affected) Object.assign(row, this.values[0]);
      } else if (this.op === "delete") {
        if (this.table === "datasets" && affected.some((d) => this.store.pipeline_runs.some((r) => r["dataset_id"] === d["id"]))) throw new Error("Clear this dataset's run history before deleting it.");
        this.store[this.table] = current.filter((r) => !affected.includes(r));
        // Only source/run relationships cascade. Historical rule IDs stay intact.
        if (this.table === "datasets") this.store.validation_rules = this.store.validation_rules.filter((r) => !affected.some((d) => d["id"] === r["dataset_id"]));
        if (this.table === "pipeline_runs") for (const t of ["accepted_records", "rejected_records", "pipeline_logs", "validation_results"] as const) this.store[t] = this.store[t].filter((r) => !affected.some((d) => d["run_id"] === r["run_id"]));
      }
      const count = this.countRequested ? affected.length : null;
      affected = [...affected].sort((a, b) => {
        for (const o of this.orders) {
          const x = a[o.column], y = b[o.column];
          if (x === y) continue;
          if (x == null || y == null) return (x == null ? -1 : 1) * (o.nullsFirst ? 1 : -1);
          const diff = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
          if (diff) return diff * (o.ascending ? 1 : -1);
        }
        return 0;
      }).slice(this.start, this.end);
      const data = this.returning ? affected.map((r) => this.fields === "*" ? r : Object.fromEntries(this.fields.split(",").map((k) => [k, r[k]]))) : [];
      if (this.cardinality === "single" && data.length !== 1) throw new Error("Expected exactly one record.");
      return { data: structuredClone(this.cardinality === "many" ? data : data[0] ?? null), error: null, count };
    } catch (e) { return { data: null, error: { message: e instanceof Error ? e.message : String(e) }, count: null }; }
  }
}