import { beforeEach, describe, expect, it, vi } from "vitest";
const cloudFrom = vi.hoisted(() => vi.fn(() => { throw new Error("Demo must never access Cloud tables"); }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: cloudFrom } }));
vi.mock("./api-fetch.functions", () => ({ fetchApiSource: vi.fn() }));
import { createDemoStore } from "./demo-store";
import { initWorkspace, workspaceClient } from "./workspace";
import { createDataset, deleteAllRules, fetchRecords, getDataset, getLogs, getRun, insertRules, listDatasets, listRules, listRuns } from "./db";
import { runPipeline } from "./runner";

beforeEach(() => {
  cloudFrom.mockClear();
  globalThis.__dqWorkspaceMode = "demo";
  globalThis.__dqDemoStore = createDemoStore();
  globalThis.__dqWorkspaceInit = undefined;
  globalThis.__dqRuleImportQueue = undefined;
});
const makeDataset = (name: string) => createDataset({ name, source_type: "csv", rows: [{ id: "1", price: "10" }, { id: "2", price: "-2" }] });
const priceRule = (dataset_id: string) => ({ dataset_id, rule_name: "Price >= 0", rule_type: "range", column_name: "price", severity: "error", is_enabled: true, parameters: { min: 0 } });

describe("isolated demo workspace flow", () => {
  it("runs imported rules, saves rejected/accepted records, logs and reconciles", async () => {
    const ds = await makeDataset("Orders");
    expect(await insertRules([priceRule(ds.id)])).toBe(1);
    const runId = await runPipeline(ds.id);
    const run = await getRun(runId);
    expect(run?.source_count).toBe(2);
    expect(run?.accepted_count).toBe(1);
    expect(run?.rejected_count).toBe(1);
    expect(run?.loaded_count).toBe(1);
    expect(run?.reconciliation_status).toBe("matched");
    expect((await fetchRecords("accepted", { page: 0, pageSize: 20 })).count).toBe(1);
    expect((await fetchRecords("rejected", { page: 0, pageSize: 20 })).count).toBe(1);
    expect((await getLogs(runId)).length).toBeGreaterThan(0);
    expect((await getDataset(ds.id)).raw_records).toEqual([{ id: "1", price: "10" }, { id: "2", price: "-2" }]);
    expect(cloudFrom).not.toHaveBeenCalled();
  });
  it("deletes one dataset's rules without touching another, datasets or history", async () => {
    const a = await makeDataset("A"), b = await makeDataset("B");
    await insertRules([priceRule(a.id), priceRule(b.id)]);
    await runPipeline(a.id);
    expect(await deleteAllRules(a.id)).toBe(1);
    expect((await listRules()).map((r) => r.dataset_id)).toEqual([b.id]);
    expect(await listDatasets()).toHaveLength(2);
    expect(await listRuns()).toHaveLength(1);
  });
  it("deletes all rules without deleting run results or datasets", async () => {
    const a = await makeDataset("A"), b = await makeDataset("B");
    await insertRules([priceRule(a.id), priceRule(b.id)]);
    await runPipeline(a.id);
    expect(await deleteAllRules()).toBe(2);
    expect(await listRules()).toHaveLength(0);
    expect(await listDatasets()).toHaveLength(2);
    expect(await listRuns()).toHaveLength(1);
    expect((await fetchRecords("rejected", { page: 0, pageSize: 20 })).count).toBe(1);
  });
  it("avoids duplicates on repeated and simultaneous imports", async () => {
    const a = await makeDataset("A");
    expect(await insertRules([priceRule(a.id), priceRule(a.id)])).toBe(1);
    expect(await insertRules([priceRule(a.id)])).toBe(0);
    await deleteAllRules();
    expect(await Promise.all([insertRules([priceRule(a.id)]), insertRules([priceRule(a.id)])])).toEqual([1, 0]);
    expect(await listRules()).toHaveLength(1);
  });
  it("initializes once and retains data across remount/HMR-style reinitialization", async () => {
    const first = initWorkspace();
    await first;
    await makeDataset("A");
    expect(initWorkspace()).toBe(first);
    expect(await listDatasets()).toHaveLength(1);
    expect(cloudFrom).not.toHaveBeenCalled();
  });
  it("a fresh browser realm starts with empty demo tables, never deleting Cloud data", async () => {
    await makeDataset("old-demo");
    const old = globalThis.__dqDemoStore;
    globalThis.__dqDemoStore = undefined;
    globalThis.__dqWorkspaceInit = undefined;
    globalThis.__dqWorkspaceMode = undefined;
    await initWorkspace();
    expect(await listDatasets()).toHaveLength(0);
    expect(await listRules()).toHaveLength(0);
    expect(await listRuns()).toHaveLength(0);
    expect(await getRun("RUN-old")).toBeNull();
    expect(old?.datasets).toHaveLength(1);
    expect(cloudFrom).not.toHaveBeenCalled();
  });
  it("persistent mode delegates to the unchanged Cloud client", () => {
    globalThis.__dqWorkspaceMode = "persistent";
    expect(() => workspaceClient.from("datasets")).toThrow("Demo must never access Cloud tables");
    expect(cloudFrom).toHaveBeenCalledWith("datasets");
  });
});