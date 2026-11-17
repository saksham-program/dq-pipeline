import { describe, expect, it } from "vitest";
import { halfDelta, metricQuality, metricRecords } from "./analytics";
import type { PipelineRun } from "./db";

const run = (day: number, source: number, accepted: number) =>
  ({ started_at: `2026-01-${String(day).padStart(2, "0")}T10:00:00Z`, source_count: source, accepted_count: accepted, rejected_count: source - accepted, status: "success" }) as unknown as PipelineRun;

describe("halfDelta (KPI trend)", () => {
  it("compares newer runs against older runs regardless of input order", () => {
    // older half: 100 records, newer half: 150 records → +50%
    expect(halfDelta([run(4, 150, 150), run(1, 100, 100)], metricRecords)).toBe(50);
  });
  it("reports a quality drop as a negative change", () => {
    // older 100% quality, newer 80% → -20%
    expect(halfDelta([run(1, 10, 10), run(2, 10, 8)], metricQuality)).toBeCloseTo(-20);
  });
  it("returns null when there are fewer than two runs", () => {
    expect(halfDelta([run(1, 10, 10)], metricRecords)).toBeNull();
  });
});
