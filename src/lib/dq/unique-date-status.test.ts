import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { displayNames, evaluateDatasets, evaluationBadge, evaluationNotices, type RunLike } from "./dataset-status";
import { isIsoDateOnly, reconcile, ruleCoverage, split, validate } from "./engine";
import { exportRulesJson, exportRulesSql, parseRulesAuto, parseRulesJson, parseRulesSql, reviewImport } from "./rule-io";
import { persistRules, type RulesClient } from "./rule-persist";
import { buildDraft, describeParams, planBulkInsert, ruleKey } from "./rule-templates";
import { canonicalizeRuleShape, prepareRules } from "./rule-types";
import { DEFAULT_OPTIONS, type Row, type Rule } from "./types";

let n = 0;
const mk = (p: Partial<Rule> & Pick<Rule, "rule_type">): Rule => ({ id: `r${++n}`, rule_name: `rule ${n}`, column_name: null, parameters: {}, severity: "error", is_enabled: true, ...p });
const rowsOf = (col: string, values: unknown[]): Row[] => values.map((v) => ({ [col]: v as never }));
const flagged = (rows: Row[], rule: Rule) => validate(rows, [rule]).map((v) => v.row_number);

describe("rule-type conventions", () => {
  it("template names are normalised to the canonical rule the engine executes", () => {
    const c = (t: string, col: string | null, p: object = {}) => canonicalizeRuleShape({ rule_type: t, column_name: col, parameters: p }).rule;
    expect(c("unique", "order_id")).toEqual({ rule_type: "duplicate", column_name: null, parameters: { columns: ["order_id"], ignoreEmpty: true } });
    expect(c("date", "order_date")).toEqual({ rule_type: "data_type", column_name: "order_date", parameters: { type: "date" } });
    expect(c("date", "order_date", { format: "YYYY-MM-DD" })!.parameters).toEqual({ type: "date", format: "YYYY-MM-DD" });
    expect(c("required", "a")!.rule_type).toBe("not_null");
    expect(c("numeric_range", "a", { min: 1, max: 5 })).toEqual({ rule_type: "range", column_name: "a", parameters: { min: 1, max: 5 } });
    expect(c("positive", "a")!.parameters).toEqual({ operator: "gt", value: 0 });
    expect(c("email", "a")!.parameters).toEqual({ operator: "email", value: null });
    expect(c("duplicate_record", null, { columns: ["a", "b"] })!.parameters).toEqual({ columns: ["a", "b"] });
  });
  it("is case/space tolerant, requires a column where one is needed, and rejects unknown types with the supported list", () => {
    expect(canonicalizeRuleShape({ rule_type: "  Unique ", column_name: "id", parameters: {} }).rule!.rule_type).toBe("duplicate");
    expect(canonicalizeRuleShape({ rule_type: "unique", column_name: null, parameters: {} }).error).toMatch(/column is required/);
    expect(canonicalizeRuleShape({ rule_type: "date", column_name: "", parameters: {} }).error).toMatch(/column is required/);
    const bad = canonicalizeRuleShape({ rule_type: "frobnicate", column_name: "a", parameters: {} });
    expect(bad.rule).toBeNull();
    expect(bad.error).toMatch(/Supported types:.*data_type.*duplicate/);
    expect(bad.error).toMatch(/Also accepted:.*unique.*date/);
  });
  it("canonical rules pass through unchanged (existing rules behave exactly as before)", () => {
    const stored = mk({ rule_type: "duplicate", parameters: { columns: ["a"], caseInsensitive: true } });
    expect(prepareRules([stored])[0]!.rule).toEqual(stored);
  });
  it("parameters that are not understood are reported, not silently dropped", () => {
    const c = canonicalizeRuleShape({ rule_type: "unique", column_name: "id", parameters: { case_sensitive: true, bogus: 1 } });
    expect(c.notes.join(" ")).toMatch(/Ignored unsupported parameter\(s\): case_sensitive, bogus/);
  });
});

describe("unsupported rule types never pass silently", () => {
  const rows = rowsOf("a", ["x", "y"]);
  it("a stored alias still executes (it is canonicalised at run time)", () => {
    const stored = mk({ rule_type: "unique" as never, column_name: "a", rule_name: "stored alias" });
    expect(flagged([{ a: "k" }, { a: "k" }], stored)).toEqual([2]);
    expect(ruleCoverage(rows, [stored]).executable).toBe(1);
  });
  it("an unknown type is reported as a violation, counted as not executable, and never marks rows accepted by magic", () => {
    const bogus = mk({ rule_type: "frobnicate" as never, column_name: "a", rule_name: "bogus rule" });
    const v = validate(rows, [bogus]);
    expect(v).toHaveLength(1);
    expect(v[0]!.error_type).toBe("unsupported_rule");
    expect(v[0]!.row_number).toBeNull();
    expect(v[0]!.error_message).toMatch(/NOT executed.*Unsupported rule type "frobnicate"/s);
    const cov = ruleCoverage(rows, [bogus]);
    expect(cov.executable).toBe(0); // → "Not evaluated", not 100%
    expect(cov.unsupported).toHaveLength(1);
  });
  it("one supported + one unsupported rule: only the supported one counts as executing", () => {
    const cov = ruleCoverage(rows, [mk({ rule_type: "not_null", column_name: "a" }), mk({ rule_type: "nope" as never, column_name: "a" })]);
    expect(cov.executable).toBe(1);
    expect(cov.unsupported).toHaveLength(1);
  });
});

describe("unique / duplicate order_id", () => {
  const unique = (p: object = {}) => mk({ rule_type: "duplicate", rule_name: "Order ID must be unique", parameters: { columns: ["order_id"], ignoreEmpty: true, ...p } });

  it("all-unique ids pass — no value is wrongly flagged", () => {
    expect(validate(rowsOf("order_id", ["A1", "A2", "A3", "A4"]), [unique()])).toEqual([]);
  });
  it("a repeated id is flagged on the repeat, naming the first row, with an understandable reason", () => {
    const v = validate(rowsOf("order_id", ["A1", "A2", "A1", "A3"]), [unique()]);
    expect(v.map((x) => x.row_number)).toEqual([3]);
    expect(v[0]!.error_message).toBe("Duplicate key (order_id=A1) — first seen at row 1.");
    expect(v[0]!.rule_name).toBe("Order ID must be unique");
  });
  it("three copies flag both repeats; the original stays valid", () => {
    expect(flagged(rowsOf("order_id", ["A", "B", "A", "A"]), unique())).toEqual([3, 4]);
  });
  it("checks the whole dataset, not neighbouring rows", () => {
    expect(flagged(rowsOf("order_id", ["A", "B", "C", "D", "E", "F", "A"]), unique())).toEqual([7]);
  });
  it("empty values follow the configured behaviour", () => {
    const rows = rowsOf("order_id", ["A", "", "  ", null, "A"]);
    expect(flagged(rows, unique({ ignoreEmpty: true }))).toEqual([5]); // blanks ignored (leave them to a Required rule)
    expect(flagged(rows, unique({ ignoreEmpty: false }))).toEqual([3, 4, 5]); // blanks collide with each other
  });
  it("case sensitivity is configurable", () => {
    const rows = rowsOf("order_id", ["abc", "ABC"]);
    expect(flagged(rows, unique())).toEqual([]);
    expect(flagged(rows, unique({ caseInsensitive: true }))).toEqual([2]);
  });
  it("behaves the same for CSV text and API JSON values", () => {
    const csv = [{ order_id: "1001" }, { order_id: "1002" }, { order_id: "1001" }];
    const api = [{ order_id: 1001 }, { order_id: 1002 }, { order_id: 1001 }];
    const mixed = [{ order_id: 1001 }, { order_id: "1002" }, { order_id: " 1001 " }];
    for (const rows of [csv, api, mixed]) expect(flagged(rows as Row[], unique())).toEqual([3]);
  });
  it("the template, the import alias and the stored canonical form are the same rule", () => {
    const t = buildDraft("unique", "order_id", "error");
    const a = canonicalizeRuleShape({ rule_type: "unique", column_name: "order_id", parameters: {} }).rule!;
    expect(ruleKey({ rule_type: t.rule_type, column_name: t.column_name, parameters: t.parameters })).toBe(ruleKey(a));
  });
});

describe("date validation of order_date", () => {
  const date = (p: object = {}) => mk({ rule_type: "data_type", column_name: "order_date", rule_name: "Order date must be valid", parameters: { type: "date", ...p } });

  it("valid YYYY-MM-DD dates pass (including leap day)", () => {
    expect(flagged(rowsOf("order_date", ["2026-03-05", "2024-02-29", "2026-12-31", "2026-01-01"]), date())).toEqual([]);
  });
  it("impossible and malformed dates fail", () => {
    const bad = ["2026-13-26", "2026-02-30", "2025-02-29", "2026-00-10", "2026-04-31", "not-a-date", "2026/03/05x", "20260305", "2026-3-5"];
    expect(flagged(rowsOf("order_date", bad), date())).toEqual(bad.map((_, i) => i + 1));
  });
  it("the violation carries the real row, column and reason", () => {
    const v = validate(rowsOf("order_date", ["2026-03-05", "2026-13-26"]), [date()]);
    expect(v).toHaveLength(1);
    expect(v[0]!.row_number).toBe(2);
    expect(v[0]!.column_name).toBe("order_date");
    expect(v[0]!.error_type).toBe("type_mismatch");
    expect(v[0]!.error_message).toBe('"order_date" value "2026-13-26" is not a valid date.');
  });
  it("format YYYY-MM-DD restricts to exactly that layout", () => {
    const strict = date({ format: "YYYY-MM-DD" });
    expect(flagged(rowsOf("order_date", ["2026-03-05", "03/05/2026", "2026-03-05T10:00:00Z", "2026-13-26"]), strict)).toEqual([2, 3, 4]);
    expect(flagged(rowsOf("order_date", ["03/05/2026"]), date())).toEqual([]); // without a format, other real layouts are accepted
    expect(isIsoDateOnly("2026-03-05")).toBe(true);
    expect(isIsoDateOnly("2026-02-30")).toBe(false);
    expect(validate(rowsOf("order_date", ["03/05/2026"]), [strict])[0]!.error_message).toMatch(/YYYY-MM-DD format/);
  });
  it("blank dates are left to a Required rule", () => {
    expect(flagged(rowsOf("order_date", ["", null, "  "]), date())).toEqual([]);
  });
  it("only validates its own column — text columns are never treated as dates", () => {
    const rows: Row[] = [{ order_date: "2026-03-05", customer_name: "Alice Smith", notes: "call back later" }];
    expect(validate(rows, [date()])).toEqual([]);
  });
  it("API values: numbers and non-strings are not silently valid dates", () => {
    expect(flagged(rowsOf("order_date", [20260305, "2026-03-05"]), date())).toEqual([1]);
  });
  it("the template, the import alias and the stored canonical form are the same rule", () => {
    const t = buildDraft("date", "order_date", "error");
    const a = canonicalizeRuleShape({ rule_type: "date", column_name: "order_date", parameters: {} }).rule!;
    expect(ruleKey({ rule_type: t.rule_type, column_name: t.column_name, parameters: t.parameters })).toBe(ruleKey(a));
    expect(describeParams("data_type", { type: "date", format: "YYYY-MM-DD" })).toBe("must be date (YYYY-MM-DD)");
    expect(describeParams("unique", {})).toBe("key: x · blanks ignored"); // stored alias described by its meaning
  });
});

describe("multiple violations on one row; accepted/rejected accounting", () => {
  const rules = [
    mk({ rule_type: "duplicate", rule_name: "unique id", parameters: { columns: ["order_id"], ignoreEmpty: true } }),
    mk({ rule_type: "data_type", column_name: "order_date", rule_name: "valid date", parameters: { type: "date" } }),
    mk({ rule_type: "not_null", column_name: "email", rule_name: "email required", parameters: { treatEmptyAsNull: true } }),
    mk({ rule_type: "range", column_name: "age", rule_name: "age 18-100", parameters: { min: 18, max: 100 }, severity: "warning" }),
  ];
  const rows: Row[] = [
    { order_id: "A", order_date: "2026-03-01", email: "a@x.com", age: "30" }, // clean
    { order_id: "B", order_date: "2026-03-02", email: "b@x.com", age: "15" }, // warning only → accepted
    { order_id: "A", order_date: "2026-13-26", email: "", age: "30" }, // 3 error violations on one row
    { order_id: "C", order_date: "bad", email: "c@x.com", age: "40" }, // 1 violation
  ];
  const violations = validate(rows, rules);
  const parts = split(rows, violations, DEFAULT_OPTIONS);

  it("a row with several violations is ONE rejected record carrying every reason and its rule id", () => {
    const r3 = parts.rejected.find((r) => r.row_number === 3)!;
    expect(r3.reasons.map((x) => x.rule_name).sort()).toEqual(["email required", "unique id", "valid date"]);
    for (const reason of r3.reasons) expect(rules.map((r) => r.id)).toContain(reason.rule_id);
    expect(parts.rejected.filter((r) => r.row_number === 3)).toHaveLength(1);
  });
  it("counts: every source row is exactly accepted or rejected; warnings do not reject", () => {
    expect(parts.rejected.map((r) => r.row_number)).toEqual([3, 4]);
    expect(parts.accepted.map((r) => r.row_number)).toEqual([1, 2]);
    expect(violations.filter((v) => v.row_number === 2)).toHaveLength(1); // the warning is still recorded
    const rec = reconcile(rows.length, parts.accepted.length, parts.rejected.length, parts.accepted.length, 0);
    expect(rec.status).toBe("matched");
    expect(rec.sourceDiff).toBe(0);
  });
  it("violation total = sum of per-rule violations (no double counting or loss)", () => {
    const per = rules.map((r) => violations.filter((v) => v.rule_id === r.id).length);
    expect(per.reduce((a, b) => a + b, 0)).toBe(violations.length);
    expect(per).toEqual([1, 2, 1, 1]);
  });
});

describe("import / export / persistence of unique and date rules", () => {
  const fileJson = JSON.stringify({ format: "dq-pipeline-rules", version: 1, dataset: "retail", rules: [
    { rule_name: "Order ID must be unique", column_name: "order_id", rule_type: "unique", parameters: {}, severity: "error", is_enabled: true },
    { rule_name: "Order date must be valid", column_name: "order_date", rule_type: "date", parameters: { format: "YYYY-MM-DD" }, severity: "error", is_enabled: true },
  ] });

  it("JSON with unique/date imports (it used to be rejected as unsupported) and is stored canonically", () => {
    const r = parseRulesJson(fileJson);
    expect(r.errors).toEqual([]);
    expect(r.rules.map((x) => x.rule_type)).toEqual(["duplicate", "data_type"]);
    expect(r.rules[0]!.parameters).toEqual({ columns: ["order_id"], ignoreEmpty: true });
    expect(r.notes!.join(" ")).toMatch(/"unique" is stored as "duplicate"/);
  });
  it("SQL with unique/date imports, and the export of what was imported re-imports identically", () => {
    const sql = exportRulesSql(parseRulesJson(fileJson).rules, "retail").replace(/"rule_type": "duplicate"/, '"rule_type": "unique"');
    const first = parseRulesSql(sql);
    expect(first.errors).toEqual([]);
    expect(first.rules).toHaveLength(2);
    const again = parseRulesAuto(exportRulesSql(first.rules, "retail"));
    expect(again.rules.map(ruleKey)).toEqual(first.rules.map(ruleKey));
    expect(parseRulesAuto(exportRulesJson(first.rules, "retail")).rules.map(ruleKey)).toEqual(first.rules.map(ruleKey));
  });
  it("exports always contain canonical types, so they import on any version", () => {
    const out = exportRulesJson(parseRulesJson(fileJson).rules, "retail");
    expect(out).not.toMatch(/"rule_type": "(unique|date)"/);
    expect(out).toMatch(/"rule_type": "duplicate"/);
    expect(out).toMatch(/"rule_type": "data_type"/);
  });
  it("re-importing a file whose other rules already exist skips them and adds only the new ones", () => {
    const existing = [buildDraft("required", "order_id", "error")];
    const file = parseRulesJson(JSON.stringify([{ rule_name: "req", column_name: "order_id", rule_type: "required", parameters: {} }, ...JSON.parse(fileJson).rules]));
    const plan = planBulkInsert(existing, file.rules);
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.toInsert.map((x) => x.rule_type)).toEqual(["duplicate", "data_type"]);
  });
  it("review lists unsupported and column-less rules as errors with the reason, and still imports the valid ones", () => {
    const r = reviewImport(JSON.stringify([
      { rule_name: "ok", column_name: "a", rule_type: "unique", parameters: {} },
      { rule_name: "bad type", column_name: "a", rule_type: "frobnicate", parameters: {} },
      { rule_name: "no col", column_name: null, rule_type: "date", parameters: {} },
    ]));
    expect(r.drafts).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.join(" ")).toMatch(/Unsupported rule type "frobnicate"/);
    expect(r.errors.join(" ")).toMatch(/column is required for "date"/);
  });
  it("persistence stores the canonical rule through the bulk-insert contract", async () => {
    const table: Record<string, unknown>[] = [];
    const calls: Record<string, unknown>[] = [];
    const client: RulesClient = {
      from: () => ({ select: () => ({ eq: async () => ({ data: table, error: null }) }), insert: async () => ({ error: null }) }),
      rpc: async (_fn, args) => { calls.push(args as unknown as Record<string, unknown>); for (const r of args.p_rules as Record<string, unknown>[]) table.push({ ...r, dataset_id: args.p_dataset_id }); return { data: { inserted: (args.p_rules as unknown[]).length, skipped: 0 }, error: null }; },
    };
    const res = await persistRules(client, "ds", parseRulesJson(fileJson).rules);
    expect(res.inserted).toBe(2);
    expect(table.map((r) => r["rule_type"])).toEqual(["duplicate", "data_type"]);
    expect(Object.keys((calls[0]!["p_rules"] as object[])[0]!).sort()).toEqual(["column_name", "is_enabled", "parameters", "rule_name", "rule_type", "severity"]);
    expect((await persistRules(client, "ds", parseRulesJson(fileJson).rules)).inserted).toBe(0); // second import: nothing new
  });
});

describe("controlled-defect retail sample (examples/ — a sample, not your own file)", () => {
  const root = process.cwd();
  const { rows } = parseCsv(readFileSync(path.join(root, "examples/retail_orders_sample.csv"), "utf8"));
  const parsed = parseRulesJson(readFileSync(path.join(root, "examples/retail_orders_sample.rules.json"), "utf8"));
  const rules: Rule[] = parsed.rules.map((d, i) => ({ id: `rule-${i + 1}`, rule_name: d.rule_name, column_name: d.column_name, rule_type: d.rule_type, parameters: d.parameters, severity: d.severity, is_enabled: d.is_enabled }));
  const violations = validate(rows, rules);
  const parts = split(rows, violations, DEFAULT_OPTIONS);
  // the intended defects, defined by the sample itself (independent of the engine): row → rule name
  const INTENDED: Record<number, string> = { 3: "Order ID is required", 5: "Email is required", 6: "Email must be valid", 7: "Age must be 18 to 100", 10: "Order ID must be unique", 11: "Order amount must be positive", 13: "Order date must be valid", 16: "Payment status must be allowed", 18: "Delivery days 0 to 30", 20: "Rating 1 to 5" };

  it("the rules file (with unique/date) loads completely: 10 rules, no errors, all executable", () => {
    expect(parsed.errors).toEqual([]);
    expect(rules).toHaveLength(10);
    const cov = ruleCoverage(rows, rules);
    expect(cov.enabled).toBe(10);
    expect(cov.executable).toBe(10);
    expect(cov.unsupported).toHaveLength(0);
  });
  it("every intended defect is detected by exactly the intended rule — and nothing else is", () => {
    expect(rows).toHaveLength(50);
    const got = Object.fromEntries(violations.map((v) => [v.row_number, v.rule_name]));
    expect(got).toEqual(INTENDED);
    expect(violations).toHaveLength(Object.keys(INTENDED).length);
  });
  it("the duplicate order id and the invalid date are reported with their reasons", () => {
    expect(violations.find((v) => v.row_number === 10)!.error_message).toBe("Duplicate key (order_id=ORD-1009) — first seen at row 9.");
    expect(violations.find((v) => v.row_number === 13)!.error_message).toMatch(/"2026-13-26" is not a valid date in YYYY-MM-DD format/);
  });
  it("clean rows — including a trimmed mixed-case status and a leap-day date — are not rejected by unrelated rules", () => {
    const rejected = new Set(parts.rejected.map((r) => r.row_number));
    expect(rejected.has(17)).toBe(false); // payment_status "  paid "
    expect(rejected.has(21)).toBe(false); // order_date 2024-02-29
    expect([...rejected].sort((a, b) => a - b)).toEqual(Object.keys(INTENDED).map(Number));
  });
  it("accepted + rejected reconcile with the source count (computed, not hardcoded)", () => {
    const rec = reconcile(rows.length, parts.accepted.length, parts.rejected.length, parts.accepted.length, 0);
    expect(rec.status).toBe("matched");
    expect(parts.accepted.length + parts.rejected.length).toBe(rows.length);
  });
});

describe("dataset evaluation status — shared by Dashboard and Validation Rules", () => {
  const ds = (id: string, name = id) => ({ id, name });
  const rule = (dataset_id: string, over: Partial<{ is_enabled: boolean; rule_type: string }> = {}) => ({ dataset_id, is_enabled: true, rule_type: "not_null", column_name: "a", parameters: {}, ...over });
  const run = (dataset_id: string, status: string, started_at = "2026-01-02T00:00:00Z", source = 50, accepted = 40): RunLike => ({ dataset_id, status, started_at, source_count: source, accepted_count: accepted });
  const state = (d: ReturnType<typeof ds>[], r: ReturnType<typeof rule>[], runs: RunLike[]) => evaluateDatasets(d, r, runs).map((e) => e.state);

  it("1. a fresh workspace with zero datasets shows no warning at all", () => {
    expect(evaluationNotices(evaluateDatasets([], [], []))).toEqual([]);
    expect(evaluationNotices(evaluateDatasets([], [rule("ghost")], [run("ghost", "success")]))).toEqual([]); // orphan rows/runs never resurrect a dataset
  });
  it("2. one dataset without rules → exactly one 'Not evaluated' warning naming it", () => {
    const notices = evaluationNotices(evaluateDatasets([ds("a", "retail")], [], []));
    expect(notices).toHaveLength(1);
    expect(notices[0]!.state).toBe("no-rules");
    expect(notices[0]!.detail).toMatch(/1 dataset\(s\) have no enabled validation rules — retail/);
    expect(notices[0]!.detail).toMatch(/never 100%/);
  });
  it("3. adding enabled rules changes it to 'awaiting first run' with no quality figure", () => {
    const e = evaluateDatasets([ds("a")], [rule("a")], [])[0]!;
    expect(e.state).toBe("awaiting-run");
    expect(e.headline).toBe("Awaiting first validation run.");
    expect(e.qualityPct).toBeNull();
    expect(evaluationNotices([e])[0]!.state).toBe("awaiting-run");
  });
  it("4. after a successful run the actual status and a computed quality appear; no warning remains", () => {
    const e = evaluateDatasets([ds("a")], [rule("a")], [run("a", "success", undefined, 50, 50)])[0]!;
    expect(e.state).toBe("evaluated");
    expect(e.qualityPct).toBe(100); // computed from the run, because rules really ran
    expect(evaluationNotices([e])).toEqual([]);
  });
  it("5. partial and failed runs show their actual status", () => {
    const p = evaluateDatasets([ds("a")], [rule("a")], [run("a", "partial_success", undefined, 50, 42)])[0]!;
    expect(p.state).toBe("partial");
    expect(p.qualityPct).toBeCloseTo(84);
    expect(evaluationNotices([p])[0]!.state).toBe("partial");
    const f = evaluateDatasets([ds("a")], [rule("a")], [run("a", "failed")])[0]!;
    expect(f.state).toBe("failed");
    expect(f.qualityPct).toBeNull();
    expect(evaluationNotices([f])[0]!.tone).toBe("danger");
  });
  it("6. a deleted dataset disappears from the calculation immediately", () => {
    const all = [ds("a"), ds("b")];
    expect(evaluationNotices(evaluateDatasets(all, [], []))[0]!.datasets).toHaveLength(2);
    expect(evaluationNotices(evaluateDatasets(all.filter((d) => d.id !== "b"), [], []))[0]!.datasets.map((d) => d.id)).toEqual(["a"]);
    expect(evaluationNotices(evaluateDatasets([], [], []))).toEqual([]);
  });
  it("counts update at once after rule creation and rule deletion", () => {
    const d = [ds("a"), ds("b")];
    expect(state(d, [], [])).toEqual(["no-rules", "no-rules"]);
    expect(state(d, [rule("a")], [])).toEqual(["awaiting-run", "no-rules"]); // rule created
    expect(state(d, [], [])).toEqual(["no-rules", "no-rules"]); // rule deleted again
  });
  it("disabled rules and unsupported rule types do not count as evaluation coverage", () => {
    expect(state([ds("a")], [rule("a", { is_enabled: false })], [])).toEqual(["no-rules"]);
    const e = evaluateDatasets([ds("a")], [rule("a", { rule_type: "frobnicate" })], [])[0]!;
    expect(e.state).toBe("no-rules");
    expect(e.unsupportedRules).toBe(1);
    expect(e.headline).toMatch(/unsupported type/);
    expect(state([ds("a")], [rule("a", { rule_type: "unique" })], [])).toEqual(["awaiting-run"]); // a template-name alias is runnable
  });
  it("a run recorded before any rules existed does not count as an evaluation", () => {
    const e = evaluateDatasets([ds("a")], [rule("a")], [run("a", "not_evaluated", undefined, 50, 50)])[0]!;
    expect(e.state).toBe("awaiting-run");
    expect(e.qualityPct).toBeNull();
    expect(e.headline).toMatch(/after the last run/);
  });
  it("deleting every rule after a good run makes the dataset 'not evaluated' again (current configuration wins)", () => {
    expect(state([ds("a")], [], [run("a", "success", undefined, 50, 50)])).toEqual(["no-rules"]);
  });
  it("uses the LATEST run per dataset", () => {
    const runs = [run("a", "failed", "2026-01-01T00:00:00Z"), run("a", "success", "2026-02-01T00:00:00Z", 10, 10), run("b", "success", "2026-03-01T00:00:00Z")];
    const e = evaluateDatasets([ds("a")], [rule("a")], runs)[0]!;
    expect(e.state).toBe("evaluated");
    expect(e.lastRun!.started_at).toBe("2026-02-01T00:00:00Z");
  });
  it("duplicate names are listed once, duplicate records are collapsed, and long lists are summarised", () => {
    expect(displayNames([{ name: "iris" }, { name: "iris" }, { name: "bank" }])).toBe("iris ×2, bank");
    expect(displayNames(["a", "b", "c", "d", "e"].map((name) => ({ name })))).toBe("a, b, c and 2 more");
    expect(evaluateDatasets([ds("a", "x"), ds("a", "x")], [], [])).toHaveLength(1);
  });
  it("is deterministic — a browser refresh recomputes the same answer from the same data", () => {
    const d = [ds("a"), ds("b")];
    const r = [rule("a")];
    const runs = [run("a", "success")];
    expect(evaluateDatasets(d, r, runs)).toEqual(evaluateDatasets(d, r, runs));
  });
  it("list badges use the same states as the notices", () => {
    expect(evaluationBadge("no-rules")).toBe("not_evaluated");
    expect(evaluationBadge("awaiting-run")).toBe("awaiting_run");
    expect(evaluationBadge("evaluated")).toBe("success");
    expect(evaluationBadge("partial")).toBe("partial_success");
  });
  it("both pages render the SAME shared component and neither keeps its own warning logic", () => {
    const rules = readFileSync(path.join(process.cwd(), "src/routes/rules.tsx"), "utf8");
    const dash = readFileSync(path.join(process.cwd(), "src/routes/index.tsx"), "utf8");
    for (const src of [rules, dash]) {
      expect(src).toMatch(/<DatasetStatusNotice \/>/);
      expect(src).not.toMatch(/have no enabled validation rules/);
      expect(src).not.toMatch(/unevaluatedDatasets/);
    }
  });
});
