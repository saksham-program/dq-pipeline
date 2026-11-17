import { supabase } from "@/integrations/supabase/client";
import { clean, inferSchema, jsonToRows, qualityPct, reconcile, ruleCoverage, split, validate } from "./engine";
import { getDataset, getSettings, toRule } from "./db";
import { fetchApiSource } from "./api-fetch.functions";
import type { Row, RunStatus, StageName, StageStatus } from "./types";
import { STAGES } from "./types";

export type StageMap = Record<StageName, StageStatus>;
export interface Progress {
  runId: string;
  stages: StageMap;
  message: string;
}

async function nextRunId(): Promise<string> {
  const d = new Date();
  const prefix = `RUN-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}-`;
  const { data } = await supabase.from("pipeline_runs").select("run_id").like("run_id", `${prefix}%`).order("run_id", { ascending: false }).limit(1);
  const last = data?.[0]?.run_id ? Number(data[0].run_id.slice(prefix.length)) : 0;
  return prefix + String(last + 1).padStart(3, "0");
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * Executes Extract → Validate → Clean → Load → Publish for a dataset and
 * persists every artefact (run, logs, violations, accepted/rejected rows).
 */
export async function runPipeline(datasetId: string, onProgress?: (p: Progress) => void): Promise<string> {
  const settings = await getSettings();
  const opts = settings.processing;
  const t0 = Date.now();
  const stages: StageMap = { ingest: "pending", validate: "pending", clean: "pending", load: "pending", publish: "pending" };
  const dsMeta = await getDataset(datasetId);

  // Allocate a unique run id (retry on concurrent collision).
  let runId = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    runId = await nextRunId();
    const ins = await supabase.from("pipeline_runs").insert({ run_id: runId, dataset_id: datasetId, dataset_name: dsMeta.name, source_type: dsMeta.source_type, status: "running", stages: stages as never, is_sample: dsMeta.is_sample });
    if (!ins.error) break;
    if (!ins.error.message.includes("duplicate") || attempt === 4) throw new Error(ins.error.message);
  }

  let seq = 0;
  const logBuf: { run_id: string; stage: string; log_level: string; message: string; timestamp: string; seq: number }[] = [];
  const log = (stage: StageName, message: string, level: "info" | "warn" | "error" | "success" = "info") => {
    logBuf.push({ run_id: runId, stage, log_level: level, message, timestamp: new Date().toISOString(), seq: seq++ });
    onProgress?.({ runId, stages: { ...stages }, message });
  };
  const flushLogs = async () => {
    if (!logBuf.length) return;
    const batch = logBuf.splice(0);
    await supabase.from("pipeline_logs").insert(batch);
  };
  const setStage = async (s: StageName, st: StageStatus) => {
    stages[s] = st;
    onProgress?.({ runId, stages: { ...stages }, message: `${s} ${st}` });
    await supabase.from("pipeline_runs").update({ stages: stages as never }).eq("run_id", runId);
  };
  let current: StageName = "ingest";
  let notEvaluated = false;

  try {
    // 1. EXTRACT
    current = "ingest";
    await setStage("ingest", "running");
    log("ingest", `Dataset ingestion started for "${dsMeta.name}" (${dsMeta.source_type.toUpperCase()}).`);
    let rows: Row[];
    if (dsMeta.source_type === "api") {
      if (!dsMeta.source_reference) throw new Error("API source has no URL configured.");
      log("ingest", `Requesting ${dsMeta.api_method ?? "GET"} ${dsMeta.source_reference}`);
      const res = await fetchApiSource({ data: { url: dsMeta.source_reference, method: (dsMeta.api_method as "GET" | "POST") ?? "GET", headers: (dsMeta.api_headers ?? {}) as Record<string, string> } });
      if (!res.ok) throw new Error(`API extraction failed: ${res.error}`);
      rows = jsonToRows(JSON.parse(res.jsonText ?? "null"));
      log("ingest", `API responded HTTP ${res.status} in ${res.elapsedMs} ms.`);
      // keep a traceable snapshot of what was extracted
      await supabase.from("datasets").update({ raw_records: rows as never, record_count: rows.length, schema_metadata: inferSchema(rows) as never, updated_at: new Date().toISOString() }).eq("id", datasetId);
    } else {
      rows = (dsMeta.raw_records ?? []) as Row[];
    }
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("Source contains no records to process.");
    const schema = inferSchema(rows);
    log("ingest", `Records extracted: ${rows.length}. Columns detected: ${schema.length} (${schema.map((c) => `${c.name}:${c.type}`).join(", ")}).`, "success");
    await supabase.from("pipeline_runs").update({ source_count: rows.length, schema_snapshot: schema as never }).eq("run_id", runId);
    await setStage("ingest", "completed");

    // 2. VALIDATE
    current = "validate";
    await setStage("validate", "running");
    const { data: ruleRows, error: rErr } = await supabase.from("validation_rules").select("*").eq("dataset_id", datasetId);
    if (rErr) throw new Error(rErr.message);
    const rules = (ruleRows ?? []).map(toRule);
    const enabled = rules.filter((r) => r.is_enabled);
    log("validate", `Loaded ${rules.length} rule(s); ${enabled.length} enabled.`);
    const coverage = ruleCoverage(rows, rules);
    notEvaluated = coverage.executable === 0;
    if (notEvaluated)
      log("validate", enabled.length ? `Not evaluated — none of the ${enabled.length} enabled rule(s) can run because their columns are missing from the dataset or their rule types are unsupported. Records are passed through UNVALIDATED; data quality is unknown.` : "Not evaluated — no active validation rules. Records are passed through UNVALIDATED; data quality is unknown (not 100%). Add rules on the Validation Rules page.", "warn");
    else for (const r of coverage.skipped) log("validate", `Rule "${r.rule_name}" skipped: column "${r.column_name}" is not in the dataset.`, "warn");
    for (const r of coverage.unsupported) log("validate", `Rule "${r.rule_name}" NOT executed: unsupported rule type "${r.rule_type}".`, "error");
    const { data: prev } = await supabase.from("pipeline_runs").select("source_count").eq("dataset_id", datasetId).in("status", ["success", "partial_success"]).neq("run_id", runId).order("started_at", { ascending: false }).limit(1);
    const violations = validate(rows, rules, { previousCount: prev?.[0]?.source_count ?? null });
    const byType = violations.reduce<Record<string, number>>((m, v) => ((m[v.error_type] = (m[v.error_type] ?? 0) + 1), m), {});
    const datasetLevel = violations.filter((v) => v.row_number === null);
    for (const v of datasetLevel) log("validate", v.error_message, v.severity === "warning" ? "warn" : "error");
    const labels: Record<string, string> = { duplicate: "Duplicate records detected", invalid_range: "Invalid numerical values detected", invalid_value: "Values outside the allowed list detected", unsupported_rule: "Rules that could not be executed", type_mismatch: "Type mismatches detected", missing_value: "Missing values detected", null_violation: "Null violations detected", custom: "Custom rule violations detected", schema_change: "Schema changes detected", record_count: "Record-count anomalies detected" };
    for (const [t, n] of Object.entries(byType)) log("validate", `${labels[t] ?? t}: ${n}.`, "warn");
    log("validate", `Schema and rule validation completed — ${violations.length} violation(s).`, violations.length ? "warn" : "success");
    for (const c of chunk(violations, 500)) {
      const { error } = await supabase.from("validation_results").insert(c.map((v) => ({ run_id: runId, row_number: v.row_number, column_name: v.column_name, rule_id: v.rule_id, rule_name: v.rule_name, error_type: v.error_type, severity: v.severity, error_message: v.error_message, record_data: (v.row_number ? rows[v.row_number - 1] : null) as never })));
      if (error) throw new Error(`Saving validation results failed: ${error.message}`);
    }
    await setStage("validate", "completed");

    // 3. CLEAN & TRANSFORM
    current = "clean";
    await setStage("clean", "running");
    const parts = split(rows, violations, opts);
    log("clean", `Separated ${parts.accepted.length} accepted and ${parts.rejected.length} rejected record(s).`);
    const cleaned = clean(parts.accepted, rules, opts);
    log("clean", `Cleaning applied (trim=${opts.trimWhitespace}, lowercase emails=${opts.lowercaseEmails}, fills from rules): ${cleaned.changes} value(s) changed. Original source kept unchanged.`);
    for (const c of chunk(parts.rejected, 500)) {
      const { error } = await supabase.from("rejected_records").insert(c.map((r) => ({ run_id: runId, dataset_id: datasetId, row_number: r.row_number, record_data: r.record as never, rejection_reasons: r.reasons as never, max_severity: r.max_severity })));
      if (error) throw new Error(`Saving rejected records failed: ${error.message}`);
    }
    await setStage("clean", "completed");

    // 4. LOAD
    current = "load";
    await setStage("load", "running");
    let loaded = 0, failures = 0;
    for (const c of chunk(cleaned.rows, 500)) {
      const { data, error } = await supabase.from("accepted_records").upsert(c.map((r) => ({ run_id: runId, dataset_id: datasetId, row_number: r.row_number, record_data: r.record as never })), { onConflict: "run_id,row_number", ignoreDuplicates: true }).select("id");
      if (error) {
        failures += c.length;
        log("load", `Batch load failed: ${error.message}`, "error");
      } else loaded += data?.length ?? 0;
    }
    log("load", `Accepted records loaded: ${loaded}${failures ? `, load failures: ${failures}` : ""}.`, failures ? "error" : "success");
    await setStage("load", failures && !loaded ? "failed" : "completed");

    // 5. PUBLISH
    current = "publish";
    await setStage("publish", "running");
    const rec = reconcile(rows.length, parts.accepted.length, parts.rejected.length, loaded, failures);
    log("publish", `Reconciliation ${rec.status === "matched" ? "completed — counts match" : "MISMATCH"}: source ${rec.source} = accepted ${rec.accepted} + rejected ${rec.rejected} (diff ${rec.sourceDiff}); accepted ${rec.accepted} = loaded ${rec.loaded} + failures ${rec.loadFailures} (diff ${rec.loadDiff}).`, rec.status === "matched" ? "success" : "error");
    const hasDatasetErrors = datasetLevel.some((v) => v.severity !== "warning");
    const status: RunStatus = rec.status === "mismatch" ? "failed" : notEvaluated ? "not_evaluated" : parts.rejected.length || failures || hasDatasetErrors ? "partial_success" : "success";
    await setStage("publish", "completed");
    const duration = Date.now() - t0;
    log("publish", `Pipeline execution finished with status ${status.toUpperCase()} in ${duration} ms. ${notEvaluated ? "Quality: not evaluated (no executable rules)." : `Quality ${qualityPct(parts.accepted.length, rows.length).toFixed(1)}%.`}`, status === "failed" ? "error" : notEvaluated ? "warn" : "success");
    await flushLogs();
    await supabase.from("pipeline_runs").update({ status, completed_at: new Date().toISOString(), duration_ms: duration, accepted_count: parts.accepted.length, rejected_count: parts.rejected.length, loaded_count: loaded, load_failure_count: failures, violation_count: violations.length, reconciliation_status: rec.status, error_message: rec.status === "mismatch" ? "Source-to-target reconciliation mismatch." : null }).eq("run_id", runId);
    onProgress?.({ runId, stages: { ...stages }, message: `Finished: ${status}` });
    return runId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    stages[current] = "failed";
    log(current, `Pipeline failed during ${current}: ${msg}`, "error");
    await flushLogs();
    await supabase.from("pipeline_runs").update({ status: "failed", stages: stages as never, completed_at: new Date().toISOString(), duration_ms: Date.now() - t0, error_message: msg }).eq("run_id", runId);
    onProgress?.({ runId, stages: { ...stages }, message: msg });
    throw Object.assign(new Error(msg), { runId });
  }
}

export { STAGES };
