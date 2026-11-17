import { canonicalizeRuleShape } from "./rule-types";

/**
 * One source of truth for "has this dataset been evaluated?", used by BOTH the Dashboard and the
 * Validation Rules page. It is derived only from live registered datasets, their rules and their runs, so a
 * deleted dataset (or a reset workspace) can never appear, and the answer is identical on every page.
 *
 *  - no rules that can run      → "no-rules"      Not evaluated
 *  - runnable rules, never run  → "awaiting-run"  Awaiting first validation run  (never a quality figure)
 *  - run in progress            → "running"
 *  - last run succeeded         → "evaluated"     real quality = accepted ÷ source
 *  - last run partial / failed  → "partial" / "failed"  the actual status
 */
export type EvaluationState = "no-rules" | "awaiting-run" | "running" | "evaluated" | "partial" | "failed";

export interface DatasetLike {
  id: string;
  name: string;
}
export interface RuleLike {
  dataset_id: string;
  is_enabled: boolean;
  rule_type: string;
  column_name?: string | null;
  parameters?: unknown;
}
export interface RunLike {
  run_id?: string;
  dataset_id: string | null;
  status: string;
  started_at: string;
  source_count: number;
  accepted_count: number;
  rejected_count?: number;
}

export interface DatasetEvaluation {
  id: string;
  name: string;
  state: EvaluationState;
  /** enabled rules the engine can actually execute */
  activeRules: number;
  /** enabled rules with an unsupported type (they would not run) */
  unsupportedRules: number;
  lastRun: RunLike | null;
  /** accepted ÷ source of the last evaluated run; null whenever quality is unknown (never 100% by default) */
  qualityPct: number | null;
  /** short, user-facing status line */
  headline: string;
  /** true when the user should do something (add rules, run, look at a failure) */
  needsAttention: boolean;
}

const isRunnable = (r: RuleLike) => canonicalizeRuleShape({ rule_type: r.rule_type, column_name: r.column_name ?? "x", parameters: r.parameters ?? {} }).rule !== null;

const STATUS_LABEL: Record<string, string> = { success: "Success", partial_success: "Partial success", failed: "Failed", running: "Running", pending: "Pending", not_evaluated: "Not evaluated" };
export const runStatusLabel = (s: string) => STATUS_LABEL[s] ?? s;

/** Evaluate every registered dataset. Duplicated dataset records are collapsed by id. */
export function evaluateDatasets(datasets: DatasetLike[], rules: RuleLike[], runs: RunLike[]): DatasetEvaluation[] {
  const latest = new Map<string, RunLike>();
  for (const r of runs) {
    if (!r.dataset_id) continue;
    const cur = latest.get(r.dataset_id);
    if (!cur || new Date(r.started_at).getTime() > new Date(cur.started_at).getTime()) latest.set(r.dataset_id, r);
  }
  const seen = new Set<string>();
  const out: DatasetEvaluation[] = [];
  for (const d of datasets) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const enabled = rules.filter((r) => r.dataset_id === d.id && r.is_enabled);
    const activeRules = enabled.filter(isRunnable).length;
    const unsupportedRules = enabled.length - activeRules;
    const lastRun = latest.get(d.id) ?? null;
    const base = { id: d.id, name: d.name, activeRules, unsupportedRules, lastRun, qualityPct: null as number | null };
    const pctOf = (r: RunLike) => (r.source_count > 0 ? (r.accepted_count / r.source_count) * 100 : null);

    if (activeRules === 0)
      out.push({ ...base, state: "no-rules", needsAttention: true, headline: unsupportedRules ? `Not evaluated — ${unsupportedRules} enabled rule(s) use an unsupported type and cannot run.` : "Not evaluated — no enabled validation rules." });
    else if (!lastRun || lastRun.status === "not_evaluated")
      out.push({ ...base, state: "awaiting-run", needsAttention: true, headline: lastRun ? "Awaiting validation run — rules were added after the last run." : "Awaiting first validation run." });
    else if (lastRun.status === "running" || lastRun.status === "pending")
      out.push({ ...base, state: "running", needsAttention: false, headline: "Validation run in progress." });
    else if (lastRun.status === "failed")
      out.push({ ...base, state: "failed", needsAttention: true, headline: "Last run failed." });
    else if (lastRun.status === "partial_success")
      out.push({ ...base, state: "partial", qualityPct: pctOf(lastRun), needsAttention: true, headline: "Last run completed with violations (partial success)." });
    else out.push({ ...base, state: "evaluated", qualityPct: pctOf(lastRun), needsAttention: false, headline: "Evaluated." });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Names for display with duplicates collapsed ("iris ×2"), so a repeated name is listed once. */
export function displayNames(list: { name: string }[], max = 3): string {
  const counts = new Map<string, number>();
  for (const d of list) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  const names = [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
  return names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", ");
}

export interface EvaluationNotice {
  state: EvaluationState;
  tone: "warning" | "info" | "danger";
  title: string;
  /** datasets covered by this notice */
  datasets: DatasetEvaluation[];
  detail: string;
}

/** The warnings to show — identical on every page. Empty when there are no datasets or nothing needs attention. */
export function evaluationNotices(evals: DatasetEvaluation[]): EvaluationNotice[] {
  const by = (s: EvaluationState) => evals.filter((e) => e.state === s);
  const notices: EvaluationNotice[] = [];
  const noRules = by("no-rules");
  if (noRules.length) notices.push({ state: "no-rules", tone: "warning", title: "Not evaluated", datasets: noRules, detail: `${noRules.length} dataset(s) have no enabled validation rules — ${displayNames(noRules)}. Runs on ${noRules.length === 1 ? "it" : "them"} pass records through unvalidated and report quality as “Not evaluated”, never 100%.` });
  const awaiting = by("awaiting-run");
  if (awaiting.length) notices.push({ state: "awaiting-run", tone: "info", title: "Awaiting validation run", datasets: awaiting, detail: `${awaiting.length} dataset(s) have enabled rules but no validation result yet — ${displayNames(awaiting)}. Run the pipeline to evaluate ${awaiting.length === 1 ? "it" : "them"}; no quality score is shown until then.` });
  const failed = by("failed");
  if (failed.length) notices.push({ state: "failed", tone: "danger", title: "Last run failed", datasets: failed, detail: `The last run failed for ${displayNames(failed)}.` });
  const partial = by("partial");
  if (partial.length) notices.push({ state: "partial", tone: "warning", title: "Last run partially completed", datasets: partial, detail: `Violations were found in the last run for ${displayNames(partial)}.` });
  return notices;
}

/** StatusBadge key for a dataset's evaluation state, so list badges agree with the notices. */
export const evaluationBadge = (state: EvaluationState): string => ({ "no-rules": "not_evaluated", "awaiting-run": "awaiting_run", running: "running", evaluated: "success", partial: "partial_success", failed: "failed" })[state];
