import { describe, expect, it } from "vitest";
import { RUN_DATA_CLEANUP_ORDER } from "./run-data";

describe("run data cleanup scope", () => {
  it("removes run results before run history without removing datasets or rules", () => {
    expect(RUN_DATA_CLEANUP_ORDER).toEqual([
      "accepted_records",
      "rejected_records",
      "pipeline_logs",
      "validation_results",
      "pipeline_runs",
    ]);
    expect(RUN_DATA_CLEANUP_ORDER).not.toContain("datasets");
    expect(RUN_DATA_CLEANUP_ORDER).not.toContain("validation_rules");
  });
});