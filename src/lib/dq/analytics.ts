import type { PipelineRun } from "./db";

export const VIOLATION_LABELS: Record<string, string> = {
  missing_value: "Missing values",
  duplicate: "Duplicates",
  invalid_range: "Invalid ranges",
  type_mismatch: "Type mismatches",
  schema_change: "Schema changes",
  null_violation: "Null violations",
  invalid_value: "Disallowed values",
  unsupported_rule: "Unsupported rules",
  custom: "Custom rules",
  record_count: "Record count",
};

/** A run whose quality is meaningful: it actually executed at least one validation rule. */
export const isEvaluated = (r: Pick<PipelineRun, "status">) => r.status !== "not_evaluated";

export function trendByDay(allRuns: PipelineRun[]) {
  const runs = allRuns.filter(isEvaluated);
  const m = new Map<string, { day: string; accepted: number; rejected: number; runs: number; duration: number; quality: number; src: number }>();
  for (const r of [...runs].reverse()) {
    const day = new Date(r.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const e = m.get(day) ?? { day, accepted: 0, rejected: 0, runs: 0, duration: 0, quality: 0, src: 0 };
    e.accepted += r.accepted_count;
    e.rejected += r.rejected_count;
    e.src += r.source_count;
    e.runs += 1;
    e.duration += r.duration_ms ?? 0;
    m.set(day, e);
  }
  return [...m.values()].map((e) => ({ ...e, quality: e.src ? +((e.accepted / e.src) * 100).toFixed(1) : 0, avgDuration: e.runs ? Math.round(e.duration / e.runs) : 0 }));
}

export const chartTooltip = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--popover-foreground)", boxShadow: "var(--shadow-elevated)", padding: "8px 12px" },
  labelStyle: { fontWeight: 700, marginBottom: 4, color: "var(--popover-foreground)" },
  itemStyle: { padding: "1px 0" },
};

export const chartAxis = { tick: { fontSize: 11, fill: "var(--muted-foreground)" }, axisLine: false, tickLine: false } as const;
export const chartGrid = { stroke: "var(--border)", strokeDasharray: "4 4" } as const;
export const chartCursor = { fill: "var(--accent)", opacity: 0.45 } as const;
export const chartLegend = { iconType: "circle" as const, iconSize: 8, wrapperStyle: { fontSize: 12, color: "var(--muted-foreground)", paddingTop: 8 } };

type RunMetric = (runs: PipelineRun[]) => number | null;
export const metricRecords: RunMetric = (r) => r.reduce((s, x) => s + x.source_count, 0);
export const metricQuality: RunMetric = (all) => {
  const r = all.filter(isEvaluated);
  const src = r.reduce((s, x) => s + x.source_count, 0);
  return src ? (r.reduce((s, x) => s + x.accepted_count, 0) / src) * 100 : null;
};
export const metricFailed: RunMetric = (r) => r.filter((x) => x.status === "failed").length;

/**
 * Trend indicator for KPI cards: compares the newer half of the given runs
 * with the older half (by start time). Returns the % change, or null when
 * there are fewer than 2 runs or the older half's value is 0/unknown.
 */
export function halfDelta(runs: PipelineRun[], metric: RunMetric): number | null {
  if (runs.length < 2) return null;
  const sorted = [...runs].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  const mid = Math.floor(sorted.length / 2);
  const older = metric(sorted.slice(0, mid));
  const newer = metric(sorted.slice(mid));
  if (older == null || newer == null || older === 0) return null;
  return ((newer - older) / older) * 100;
}
