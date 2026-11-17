import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isEvaluated, metricQuality, trendByDay } from "./analytics";
import { clean, inferSchema, isValidDateString, reconcile, ruleCoverage, split, validate } from "./engine";
import type { PipelineRun } from "./db";
import { exportRulesJson, exportRulesSql, parseRulesAuto, parseRulesJson, parseRulesSql, reviewImport } from "./rule-io";
import { persistRules, ruleErrorMessage, toRulePayload, type RulesClient } from "./rule-persist";
import { ECOMMERCE_DATASET_NAME, ecommerceImportRules, ecommerceSeedRules } from "./rule-seeds";
import { suggestRules } from "./rule-suggest";
import { buildDraft, buildDrafts, columnNamesOf, planBulkInsert, ruleKey, SUPPORTED_RULE_TYPES, validateDraft, type RuleDraft } from "./rule-templates";
import { DEFAULT_OPTIONS, type Row, type Rule } from "./types";

const asRules = (drafts: RuleDraft[]): Rule[] => drafts.map((d, i) => ({ id: `rule-${i + 1}`, rule_name: d.rule_name, column_name: d.column_name, rule_type: d.rule_type, parameters: d.parameters, severity: d.severity, is_enabled: d.is_enabled }));
const rule = (r: Partial<Rule>): Rule => ({ id: "r", rule_name: "t", column_name: null, parameters: {}, severity: "error", is_enabled: true, rule_type: "not_null", ...r });

/** 50-row e-commerce dataset with 18 deliberately invalid rows (one defect each) and one tricky-but-valid row. */
function demoRows(): Row[] {
  const status = ["Paid", "Pending", "Delivered", "Cancelled"];
  const rows: Row[] = Array.from({ length: 50 }, (_, k) => {
    const i = k + 1;
    return { order_id: `ORD-${1000 + i}`, email: `user${i}@example.com`, age: String(20 + (i % 60)), order_amount: (10 + i).toFixed(2), order_date: `2026-03-${String(1 + (i % 28)).padStart(2, "0")}`, payment_status: status[i % 4]!, delivery_days: String(i % 30), rating: String(1 + (i % 5)), quantity: String(1 + (i % 100)) };
  });
  const set = (row: number, patch: Row) => Object.assign(rows[row - 1]!, patch);
  set(3, { order_id: "" }); //                    Required order_id
  set(10, { order_id: rows[8]!["order_id"] }); // Unique order_id (duplicate of row 9)
  set(5, { email: "" }); //                       Required email
  set(6, { email: "not-an-email" }); //           Email format
  set(7, { age: "17" }); set(8, { age: "150" }); // Age range
  set(11, { order_amount: "0" }); set(12, { order_amount: "-5" }); set(13, { order_amount: "abc" }); // Positive
  set(14, { order_date: "2026-02-31" }); set(15, { order_date: "not-a-date" }); // Valid date
  set(16, { payment_status: "Refunded" }); //     Allowed values
  set(17, { payment_status: "  paid " }); //      VALID: trim + case-insensitive
  set(18, { delivery_days: "45" }); set(19, { delivery_days: "-1" });
  set(20, { rating: "6" }); set(21, { rating: "0" });
  set(22, { quantity: "0" }); set(23, { quantity: "101" });
  return rows;
}
const REJECTED_ROWS = [3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23];

describe("bulk rule creation & templates", () => {
  it("builds the cross product of columns × templates and one rule for column-less templates", () => {
    const d = buildDrafts(["required", "email", "duplicate_record"], ["a", "b"], "error");
    expect(d.map((x) => x.rule_name)).toEqual(["a — Required", "b — Required", "a — Email format", "b — Email format", "No duplicate records (a + b)"]);
  });
  it("every template compiles to a rule type the engine supports", () => {
    const ids = ["required", "unique", "numeric_range", "positive", "data_type", "email", "date", "allowed_values", "duplicate_record", "custom"] as const;
    for (const id of ids) {
      const d = buildDraft(id, id === "duplicate_record" ? null : "c", "error", { min: 1, max: 2, type: "integer", values: ["x"], operator: "gt", value: 1 });
      expect(SUPPORTED_RULE_TYPES).toContain(d.rule_type);
      expect(validateDraft(d, ["c"])).toEqual([]);
    }
  });
  it("the e-commerce seed has the 11 requested rules, all error severity, and is valid for the dataset columns", () => {
    const seed = ecommerceSeedRules();
    expect(seed).toHaveLength(11);
    expect(seed.map((s) => s.severity).filter((s) => s !== "error")).toHaveLength(0);
    const cols = Object.keys(demoRows()[0]!);
    for (const s of seed) expect(validateDraft(s, cols)).toEqual([]);
  });
  it("validateDraft rejects unusable configurations", () => {
    expect(validateDraft(buildDraft("numeric_range", "a", "error"), ["a"]).join(" ")).toMatch(/minimum/i); // no limits set
    expect(validateDraft(buildDraft("numeric_range", "a", "error", { min: 5, max: 1 }), ["a"]).join(" ")).toMatch(/cannot exceed/);
    expect(validateDraft(buildDraft("allowed_values", "a", "error", { values: [] }), ["a"]).join(" ")).toMatch(/at least one/);
    expect(validateDraft(buildDraft("required", "ghost", "error"), ["a"]).join(" ")).toMatch(/does not exist/);
    expect(validateDraft(buildDraft("custom", "a", "error", { operator: "regex", value: "(" }), ["a"]).join(" ")).toMatch(/regular expression/);
  });
});

describe("duplicate rule prevention", () => {
  it("skips rules that already exist and repeats inside one batch", () => {
    const existing = [buildDraft("required", "email", "error")];
    const batch = [buildDraft("required", "email", "warning"), buildDraft("required", "age", "error"), buildDraft("required", "age", "error")];
    const plan = planBulkInsert(existing, batch);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.duplicates).toHaveLength(2); // severity is cosmetic → same rule; second "age" repeats the first
  });
  it("different parameters are different rules", () => {
    expect(ruleKey(buildDraft("numeric_range", "a", "error", { min: 1, max: 5 }))).not.toBe(ruleKey(buildDraft("numeric_range", "a", "error", { min: 1, max: 6 })));
    expect(ruleKey({ rule_type: "range", column_name: "a", parameters: { min: 1, max: 5 } })).toBe(ruleKey({ rule_type: "range", column_name: "a", parameters: { max: 5, min: 1 } }));
  });
  it("importing the same export twice inserts nothing the second time", () => {
    const seed = ecommerceSeedRules();
    const first = planBulkInsert([], parseRulesJson(exportRulesJson(seed, "ds")).rules);
    expect(first.toInsert).toHaveLength(11);
    const second = planBulkInsert(first.toInsert, parseRulesJson(exportRulesJson(seed, "ds")).rules);
    expect(second.toInsert).toHaveLength(0);
    expect(second.duplicates).toHaveLength(11);
  });
});

describe("validation rule execution", () => {
  it("required: null, empty and whitespace-only are missing; zero is not", () => {
    const v = validate([{ a: null }, { a: "" }, { a: "   " }, { a: 0 }, { a: "x" }], asRules([buildDraft("required", "a", "error")]));
    expect(v.map((x) => x.row_number)).toEqual([1, 2, 3]);
  });
  it("unique: detects repeats across the whole dataset, ignores blanks, optional case-insensitivity", () => {
    const rows = [{ id: "A1" }, { id: "B2" }, { id: "A1" }, { id: "" }, { id: "" }, { id: "a1" }];
    const strict = validate(rows, asRules([buildDraft("unique", "id", "error")]));
    expect(strict.map((x) => x.row_number)).toEqual([3]); // blanks are not duplicates; "a1" differs by case
    expect(strict[0]!.error_message).toMatch(/first seen at row 1/);
    const ci = validate(rows, asRules([{ ...buildDraft("unique", "id", "error"), parameters: { columns: ["id"], ignoreEmpty: true, caseInsensitive: true } }]));
    expect(ci.map((x) => x.row_number)).toEqual([3, 6]);
  });
  it("legacy duplicate rules (no ignoreEmpty) keep their old behaviour", () => {
    const v = validate([{ id: "" }, { id: "" }], [rule({ rule_type: "duplicate", parameters: { columns: ["id"] } })]);
    expect(v).toHaveLength(1);
  });
  it("duplicate record: composite key and whole row", () => {
    const rows = [{ a: 1, b: 2, c: 1 }, { a: 1, b: 2, c: 9 }, { a: 1, b: 3, c: 1 }, { a: 1, b: 2, c: 1 }];
    expect(validate(rows, asRules([buildDraft("duplicate_record", null, "error", { columns: ["a", "b"] })])).map((x) => x.row_number)).toEqual([2, 4]);
    expect(validate(rows, asRules([buildDraft("duplicate_record", null, "error")])).map((x) => x.row_number)).toEqual([4]);
  });
  it("numeric range: inclusive bounds, numeric conversion, non-numeric text is a violation, blanks are left to Required", () => {
    const r = asRules([buildDraft("numeric_range", "n", "error", { min: 1, max: 5 })]);
    const v = validate([{ n: "1" }, { n: "5" }, { n: 0 }, { n: "5.01" }, { n: "abc" }, { n: "0x3" }, { n: "1,2" }, { n: "" }, { n: " 3 " }], r);
    expect(v.map((x) => x.row_number)).toEqual([3, 4, 5, 6, 7]);
    expect(v.find((x) => x.row_number === 5)!.error_type).toBe("type_mismatch");
    expect(v.find((x) => x.row_number === 3)!.error_type).toBe("invalid_range");
  });
  it("numeric comparison is numeric, not lexical", () => {
    const v = validate([{ n: "9" }, { n: "10" }, { n: "100" }], asRules([buildDraft("numeric_range", "n", "error", { min: 10, max: 100 })]));
    expect(v.map((x) => x.row_number)).toEqual([1]); // lexically "9" > "100"
  });
  it("positive: strictly greater than zero", () => {
    const v = validate([{ p: "0.01" }, { p: "0" }, { p: "-1" }, { p: "x" }], asRules([buildDraft("positive", "p", "error")]));
    expect(v.map((x) => x.row_number)).toEqual([2, 3, 4]);
  });
  it("email format", () => {
    const v = validate([{ e: "a@b.com" }, { e: "bad" }, { e: "a@b" }, { e: "a b@c.com" }, { e: "" }], asRules([buildDraft("email", "e", "error")]));
    expect(v.map((x) => x.row_number)).toEqual([2, 3, 4]);
  });
  it("date validation catches impossible and malformed dates", () => {
    const good = ["2026-01-31", "2024-02-29", "2026-03-05T10:30:00Z", "2026-03-05 10:30", "12/31/2026", "31/12/2026", "1/2/2026"];
    const bad = ["2026-02-31", "2025-02-29", "2026-13-01", "2026-00-10", "2026-01-32", "13/13/2026", "2026-01-01T25:00", "banana", "20260101", "2026-1-1"];
    for (const g of good) expect(isValidDateString(g)).toBe(true);
    for (const b of bad) expect(isValidDateString(b)).toBe(false);
    const v = validate([...good, ...bad].map((d) => ({ d })), asRules([buildDraft("date", "d", "error")]));
    expect(v).toHaveLength(bad.length);
  });
  it("allowed values: trimmed and case-insensitive by default, strict on request, blanks left to Required", () => {
    const rows = [{ s: "Paid" }, { s: " paid " }, { s: "PENDING" }, { s: "Refunded" }, { s: "" }];
    const loose = validate(rows, asRules([buildDraft("allowed_values", "s", "error", { values: ["Paid", "Pending"] })]));
    expect(loose.map((x) => x.row_number)).toEqual([4]);
    expect(loose[0]!.error_type).toBe("invalid_value");
    expect(loose[0]!.error_message).toMatch(/Paid, Pending/);
    const strict = validate(rows, asRules([buildDraft("allowed_values", "s", "error", { values: ["Paid", "Pending"], caseSensitive: true })]));
    expect(strict.map((x) => x.row_number)).toEqual([2, 3, 4]); // " paid " trims to "paid" ≠ "Paid"
  });
});

describe("pipeline validation on the intentionally-invalid e-commerce dataset", () => {
  const rows = demoRows();
  const rules = asRules(ecommerceSeedRules());
  const violations = validate(rows, rules);
  const parts = split(rows, violations, DEFAULT_OPTIONS);

  it("rejects exactly the invalid rows instead of accepting all 50", () => {
    expect(rows).toHaveLength(50);
    expect(parts.rejected.map((r) => r.row_number)).toEqual(REJECTED_ROWS);
    expect(parts.accepted).toHaveLength(32);
    expect(parts.accepted.map((r) => r.row_number)).toContain(17); // "  paid " is acceptable
    expect(reconcile(50, parts.accepted.length, parts.rejected.length, parts.accepted.length, 0).status).toBe("matched");
  });
  it("reports accurate violation counts per rule", () => {
    const by = new Map<string, number>();
    for (const v of violations) by.set(v.rule_name, (by.get(v.rule_name) ?? 0) + 1);
    expect(Object.fromEntries(by)).toEqual({
      "order_id — Required": 1, "order_id — Unique": 1, "email — Required": 1, "email — Email format": 1,
      "age — Range 18 to 100": 2, "order_amount — Positive": 3, "order_date — Valid date": 2,
      "payment_status — Allowed values": 1, "delivery_days — Range 0 to 30": 2, "rating — Range 1 to 5": 2, "quantity — Range 1 to 100": 2,
    });
    expect(violations).toHaveLength(18);
  });
  it("every rejected record carries its real reason and the id of the rule that caught it", () => {
    for (const r of parts.rejected) {
      expect(r.reasons.length).toBeGreaterThan(0);
      for (const reason of r.reasons) {
        expect(reason.rule_id).toMatch(/^rule-\d+$/);
        expect(reason.error_message.length).toBeGreaterThan(10);
      }
    }
    const row10 = parts.rejected.find((r) => r.row_number === 10)!.reasons[0]!;
    expect(row10.rule_id).toBe("rule-2");
    expect(row10.error_message).toMatch(/ORD-1009/);
    expect(parts.rejected.find((r) => r.row_number === 14)!.reasons[0]!.error_message).toMatch(/2026-02-31/);
  });
  it("warning violations are recorded without rejecting; error and critical reject", () => {
    const soft = rules.map((r) => (r.rule_name.startsWith("quantity") ? { ...r, severity: "warning" as const } : r));
    const v = validate(rows, soft);
    expect(v).toHaveLength(18); // still recorded
    expect(split(rows, v, DEFAULT_OPTIONS).rejected.map((r) => r.row_number)).toEqual(REJECTED_ROWS.filter((n) => n !== 22 && n !== 23));
    const crit = rules.map((r) => ({ ...r, severity: "critical" as const }));
    expect(split(rows, validate(rows, crit), DEFAULT_OPTIONS).rejected).toHaveLength(18);
    expect(split(rows, v, { ...DEFAULT_OPTIONS, rejectOnWarning: true }).rejected).toHaveLength(18);
  });
  it("re-running after changing rules changes the outcome", () => {
    const run = (rs: Rule[]) => split(rows, validate(rows, rs), DEFAULT_OPTIONS);
    expect(run(rules).rejected).toHaveLength(18);
    expect(run(rules.map((r) => (r.rule_name === "order_id — Unique" ? { ...r, is_enabled: false } : r))).rejected).toHaveLength(17); // disable one
    expect(run(rules.filter((r) => !r.rule_name.startsWith("rating"))).rejected).toHaveLength(16); // delete one
    const extra = asRules([buildDraft("numeric_range", "age", "error", { min: 30, max: 100 })]).map((r) => ({ ...r, id: "extra" }));
    expect(run([...rules, ...extra]).rejected.length).toBeGreaterThan(18); // add a stricter rule
  });
  it("cleaning keeps originals untouched for accepted rows", () => {
    const c = clean(parts.accepted, rules, DEFAULT_OPTIONS);
    expect(c.rows).toHaveLength(32);
    expect(rows[16]!["payment_status"]).toBe("  paid "); // source row preserved
  });
});

describe("empty / unusable rule configuration is never reported as clean", () => {
  const rows = demoRows();
  it("no rules → nothing executable", () => {
    expect(validate(rows, [])).toEqual([]);
    expect(ruleCoverage(rows, [])).toEqual({ enabled: 0, executable: 0, skipped: [], unsupported: [] });
  });
  it("only disabled rules → nothing executable", () => {
    const off = asRules(ecommerceSeedRules()).map((r) => ({ ...r, is_enabled: false }));
    expect(ruleCoverage(rows, off).executable).toBe(0);
    expect(ruleCoverage(rows, off).enabled).toBe(0);
  });
  it("rules whose column is absent cannot execute and are reported as skipped", () => {
    const ghost = asRules([buildDraft("required", "ghost", "error")]);
    const cov = ruleCoverage(rows, ghost);
    expect(cov.executable).toBe(0);
    expect(cov.skipped).toHaveLength(1);
    const mixed = ruleCoverage(rows, [...ghost, ...asRules([buildDraft("required", "email", "error")])]);
    expect(mixed.executable).toBe(1);
  });
  const run = (status: string, src: number, acc: number) => ({ started_at: "2026-01-01T00:00:00Z", status, source_count: src, accepted_count: acc, rejected_count: src - acc }) as unknown as PipelineRun;
  it("analytics exclude not-evaluated runs from quality", () => {
    expect(isEvaluated(run("not_evaluated", 50, 50))).toBe(false);
    expect(metricQuality([run("not_evaluated", 50, 50)])).toBeNull(); // not 100%
    expect(metricQuality([run("not_evaluated", 50, 50), run("partial_success", 50, 32)])).toBeCloseTo(64);
    expect(trendByDay([run("not_evaluated", 50, 50)])).toEqual([]);
  });
});

describe("smart rule suggestions", () => {
  const rows = demoRows();
  const sug = suggestRules(inferSchema(rows), rows);
  const get = (k: string) => sug.find((s) => s.key === k);
  it("suggests by name and type, each with a reason", () => {
    for (const k of ["required:order_id", "unique:order_id", "required:email", "email:email", "data_type:age", "numeric_range:age", "positive:order_amount", "date:order_date", "allowed_values:payment_status", "numeric_range:rating"]) expect(get(k)).toBeDefined();
    for (const s of sug) expect(s.reason.length).toBeGreaterThan(10);
  });
  it("does not assume ID columns are unique, and does not invent business limits", () => {
    expect(get("unique:order_id")!.needsReview).toBe(true);
    expect(get("unique:order_id")!.reason).toMatch(/not always unique/);
    expect(get("unique:order_id")!.reason).toMatch(/repeated/); // real duplicates observed in the data
    const range = get("numeric_range:age")!;
    expect(range.needsReview).toBe(true);
    expect(range.parameters.min).toBeNull();
    expect(range.parameters.max).toBeNull();
    expect(validateDraft(range, ["age"]).length).toBeGreaterThan(0); // cannot be applied until the user sets limits
  });
  it("allowed values come from observed data with counts for review", () => {
    const av = get("allowed_values:payment_status")!;
    expect(av.parameters.values).toContain("Refunded"); // observed — the reason lists counts so the user can remove it
    expect(av.reason).toMatch(/Paid \(/);
    expect(av.needsReview).toBe(true);
  });
  it("suggestions are inert drafts — they carry no id and are not enabled-by-selection", () => {
    for (const s of sug) expect("id" in s).toBe(false);
  });
  it("works without sample rows (API dataset not yet run) and flags exact duplicate rows when present", () => {
    expect(suggestRules(inferSchema(rows)).some((s) => s.template === "allowed_values")).toBe(false);
    const dup = [{ a: "1" }, { a: "1" }];
    expect(suggestRules(inferSchema(dup), dup).some((s) => s.template === "duplicate_record")).toBe(true);
  });
  it("customer_id style columns get a low-confidence unique suggestion that needs confirmation", () => {
    const s = suggestRules([{ name: "order_id", type: "string", nullCount: 0 }, { name: "customer_id", type: "string", nullCount: 0 }]);
    expect(s.find((x) => x.key === "unique:customer_id")!.confidence).toBe("low");
    expect(s.find((x) => x.key === "unique:customer_id")!.needsReview).toBe(true);
  });
});

describe("import / export", () => {
  const seed = ecommerceSeedRules();
  it("JSON round-trips", () => {
    const back = parseRulesJson(exportRulesJson(seed, "ds"));
    expect(back.errors).toEqual([]);
    expect(back.rules.map(ruleKey)).toEqual(seed.map(ruleKey));
  });
  it("SQL export parses back, including dataset names containing quotes", () => {
    const sql = exportRulesSql(seed, "Bob's data");
    const back = parseRulesSql(sql);
    expect(back.errors).toEqual([]);
    expect(back.datasetName).toBe("Bob's data");
    expect(back.rules.map(ruleKey)).toEqual(seed.map(ruleKey));
    expect(parseRulesAuto(sql).rules).toHaveLength(11);
  });
  it("arbitrary SQL is rejected, never interpreted", () => {
    for (const bad of ["DROP TABLE public.validation_rules;", "DELETE FROM public.validation_rules;", "TRUNCATE public.datasets;", exportRulesSql(seed, "x") + "\nDROP TABLE public.datasets;", "SELECT pg_sleep(10);"]) {
      const r = parseRulesSql(bad);
      expect(r.rules).toHaveLength(0);
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });
  it("invalid rules in a file are reported and skipped; unknown parameter keys are dropped", () => {
    const r = parseRulesJson(JSON.stringify([{ rule_name: "ok", column_name: "a", rule_type: "not_null", parameters: { evil: "x" } }, { rule_name: "bad", column_name: "a", rule_type: "drop_everything" }, { rule_name: "range no limits", column_name: "a", rule_type: "range" }]));
    expect(r.rules).toHaveLength(1);
    expect(r.rules[0]!.parameters).toEqual({});
    expect(r.errors).toHaveLength(2);
  });
  it("garbage input fails cleanly", () => {
    expect(parseRulesJson("{nope").errors[0]).toMatch(/JSON/);
    expect(parseRulesJson('{"hello":1}').rules).toHaveLength(0);
  });
  it("columnNamesOf reads stored schema metadata", () => {
    expect(columnNamesOf([{ name: "a" }, { name: "b" }])).toEqual(["a", "b"]);
    expect(columnNamesOf(null)).toEqual([]);
  });
});

describe("SQL artifacts", () => {
  const root = process.cwd();
  const seedSql = readFileSync(path.join(root, "supabase/seeds/seed_ecommerce_validation_rules.sql"), "utf8");
  const migration = readFileSync(path.join(root, "drizzle/migrations/0001_bulk_validation_rules.sql"), "utf8");
  // statements only: drop comments and single-quoted text (error messages may contain words like "delete")
  const code = (s: string) => s.replace(/^\s*--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");

  it("seed SQL carries exactly the same rules as the TypeScript seed config", () => {
    const m = /\$json\$([\s\S]*?)\$json\$::jsonb/.exec(seedSql);
    expect(m).toBeTruthy();
    const fromSql = parseRulesJson(m![1]!);
    expect(fromSql.errors).toEqual([]);
    expect(fromSql.rules.map(ruleKey)).toEqual(ecommerceSeedRules().map(ruleKey));
    expect(fromSql.rules.map((r) => r.severity)).toEqual(ecommerceSeedRules().map((r) => r.severity));
  });
  it("neither script contains destructive statements", () => {
    for (const sql of [seedSql, migration]) expect(code(sql)).not.toMatch(/\b(DROP|TRUNCATE|DELETE|ALTER\s+TABLE\s+\S+\s+DROP)\b/i);
  });
  it("the database function whitelists exactly the rule types the app supports", () => {
    const m = /v_type NOT IN \(([^)]*)\)/.exec(migration)!;
    const listed = [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(listed).toEqual([...SUPPORTED_RULE_TYPES].sort());
  });
  it("user data reaches SQL only as a bound jsonb parameter", () => {
    expect(migration).toMatch(/p_rules jsonb/);
    expect(code(migration)).not.toMatch(/\bEXECUTE\b(?!\s+(FUNCTION|PROCEDURE|ON)\b)/i); // no dynamic SQL ("EXECUTE FUNCTION" in a trigger and "GRANT EXECUTE ON" are fine)
  });
  it("migration is registered in the drizzle journal", () => {
    const j = JSON.parse(readFileSync(path.join(root, "drizzle/migrations/meta/_journal.json"), "utf8"));
    expect(j.entries.map((e: { tag: string }) => e.tag)).toContain("0001_bulk_validation_rules");
  });
});

describe("importable export file for dq_pipeline_demo_dataset", () => {
  const root = process.cwd();
  const sqlPath = path.join(root, "supabase/seeds/dq_pipeline_demo_dataset.rules-export.sql");
  const jsonPath = path.join(root, "supabase/seeds/dq_pipeline_demo_dataset.rules-export.json");
  const sql = readFileSync(sqlPath, "utf8");
  const EXPECTED: [string, string | null, string][] = [
    ["order_id — Required", "order_id", "not_null"],
    ["order_id — Unique", null, "duplicate"],
    ["email — Required", "email", "not_null"],
    ["email — Valid email format", "email", "custom"],
    ["age — Between 18 and 100", "age", "range"],
    ["order_amount — Greater than 0", "order_amount", "custom"],
    ["order_date — Valid date", "order_date", "data_type"],
    ["payment_status — Allowed values: Paid, Pending, Delivered, Cancelled", "payment_status", "allowed_values"],
    ["delivery_days — Between 0 and 30", "delivery_days", "range"],
    ["rating — Between 1 and 5", "rating", "range"],
    ["quantity — Greater than 0", "quantity", "custom"],
  ];

  it("the importer accepts the checked-in .sql file and yields exactly the 11 requested rules", () => {
    const r = parseRulesAuto(sql);
    expect(r.errors).toEqual([]);
    expect(r.datasetName).toBe(ECOMMERCE_DATASET_NAME);
    expect(r.rules.map((x) => [x.rule_name, x.column_name, x.rule_type])).toEqual(EXPECTED);
    for (const x of r.rules) {
      expect(x.severity).toBe("error");
      expect(x.is_enabled).toBe(true);
    }
  });
  it("the file is byte-for-byte what the app's own exporter produces (apart from the timestamp comment)", () => {
    const regenerated = exportRulesSql(ecommerceImportRules(), ECOMMERCE_DATASET_NAME);
    const body = (t: string) => t.split("\n").slice(1).join("\n");
    expect(body(sql)).toBe(body(regenerated));
  });
  it("the .json twin parses to the same rules", () => {
    const j = parseRulesJson(readFileSync(jsonPath, "utf8"));
    expect(j.errors).toEqual([]);
    expect(j.rules.map(ruleKey)).toEqual(parseRulesSql(sql).rules.map(ruleKey));
  });
  it("column mappings are valid for the demo dataset and parameters are correct", () => {
    const cols = Object.keys(demoRows()[0]!);
    const rules = parseRulesSql(sql).rules;
    for (const r of rules) expect(validateDraft(r, cols)).toEqual([]);
    const byName = (n: string) => rules.find((r) => r.rule_name.startsWith(n))!;
    expect(byName("order_id — Unique").parameters).toEqual({ columns: ["order_id"], ignoreEmpty: true });
    expect(byName("age").parameters).toEqual({ min: 18, max: 100 });
    expect(byName("order_amount").parameters).toEqual({ operator: "gt", value: 0 });
    expect(byName("payment_status").parameters.values).toEqual(["Paid", "Pending", "Delivered", "Cancelled"]);
    expect(byName("email — Valid").parameters.operator).toBe("email");
  });
  it("the seed script (DO block) is NOT importable, and the error explains the accepted format", () => {
    const seed = readFileSync(path.join(root, "supabase/seeds/seed_ecommerce_validation_rules.sql"), "utf8");
    const r = parseRulesAuto(seed);
    expect(r.rules).toHaveLength(0);
    expect(r.errors[0]).toMatch(/bulk_insert_validation_rules/);
    expect(r.errors[0]).toMatch(/seed script/);
    expect(r.errors[0]).toMatch(/never executed/);
  });

  /** In-memory stand-in for the table + unique index (NOT the real database): applies planBulkInsert like bulkInsertRules does. */
  const makeStore = () => {
    const saved: RuleDraft[] = [];
    return {
      saved,
      apply(drafts: RuleDraft[]) {
        const plan = planBulkInsert(saved, drafts);
        saved.push(...plan.toInsert);
        return { inserted: plan.toInsert.length, skipped: plan.duplicates.length };
      },
    };
  };
  it("importing the same export repeatedly never creates duplicates", () => {
    const db = makeStore();
    expect(db.apply(parseRulesAuto(sql).rules)).toEqual({ inserted: 11, skipped: 0 });
    expect(db.apply(parseRulesAuto(sql).rules)).toEqual({ inserted: 0, skipped: 11 });
    expect(db.apply(parseRulesJson(readFileSync(jsonPath, "utf8")).rules)).toEqual({ inserted: 0, skipped: 11 }); // SQL and JSON are the same rules
    expect(db.saved).toHaveLength(11);
  });
  it("a partial overlap inserts only the missing rules", () => {
    const db = makeStore();
    db.apply(parseRulesAuto(sql).rules.slice(0, 3));
    expect(db.apply(parseRulesAuto(sql).rules)).toEqual({ inserted: 8, skipped: 3 });
  });
  it("end to end (simulated store): export → import → apply → validate → rejected records with reasons", () => {
    const db = makeStore();
    db.apply(parseRulesAuto(exportRulesSql(ecommerceImportRules(), ECOMMERCE_DATASET_NAME)).rules); // fresh export, not the checked-in file
    const stored = asRules(db.saved);
    expect(stored).toHaveLength(11);
    const rows = demoRows();
    const parts = split(rows, validate(rows, stored), DEFAULT_OPTIONS);
    // same bad rows as before, except row 23 (quantity 101) is valid under "quantity > 0"
    expect(parts.rejected.map((r) => r.row_number)).toEqual(REJECTED_ROWS.filter((n) => n !== 23));
    expect(parts.accepted).toHaveLength(33);
    for (const rej of parts.rejected) for (const reason of rej.reasons) expect(stored.map((r) => r.id)).toContain(reason.rule_id);
  });
});

describe("SQL import: accepted spellings and diagnostics", () => {
  const root = process.cwd();
  const file = readFileSync(path.join(root, "supabase/seeds/dq_pipeline_demo_dataset.rules-export.sql"), "utf8");
  const payload = file.slice(file.indexOf("$dq_rules$") + 10, file.indexOf("$dq_rules$::jsonb"));
  // the layout quoted in the Import dialog's own error message
  const dialogLayout = `SELECT public.bulk_insert_validation_rules(\n(\nSELECT id\nFROM public.datasets\nWHERE name = 'dq_pipeline_demo_dataset'\nORDER BY created_at\nLIMIT 1\n),\n$dq_rules$${payload}$dq_rules$::jsonb,\ntrue\n);`;
  const n = (t: string) => parseRulesAuto(t).rules.length;

  it("file-level conditions: CRLF, BOM, blank lines, BEGIN/COMMIT, the dialog's multi-line layout", () => {
    expect(n(file)).toBe(11);
    expect(n(file.replace(/\n/g, "\r\n"))).toBe(11);
    expect(n("\uFEFF" + file)).toBe(11);
    expect(n("\n\n" + file + "\n\n")).toBe(11);
    expect(n("BEGIN;\n" + file + "COMMIT;")).toBe(11);
    expect(n(dialogLayout)).toBe(11);
  });
  it("equivalent spellings of the same call are accepted", () => {
    const variants: [string, (t: string) => string][] = [
      ["$$ quoting", (t) => t.replace(/\$dq_rules\$/g, () => "$$")],
      ["other tag", (t) => t.replace(/\$dq_rules\$/g, () => "$rules$")],
      ["ORDER BY created_at DESC", (t) => t.replace("ORDER BY created_at", "ORDER BY created_at DESC")],
      ["no ORDER BY / LIMIT", (t) => t.replace("\nORDER BY created_at\nLIMIT 1", "")],
      ["no schema prefix", (t) => t.replace(/public\./g, "")],
      ["AS alias", (t) => t.replace(/\);$/, ") AS result;")],
      ["SELECT * FROM", (t) => t.replace("SELECT public.", "SELECT * FROM public.")],
      ["single-quoted JSON", (t) => t.replace(/\$dq_rules\$([\s\S]*?)\$dq_rules\$::jsonb/, (_m, j: string) => `'${j.replace(/'/g, "''")}'::jsonb`)],
      ["::json cast", (t) => t.replace("::jsonb", "::json")],
      ["no cast", (t) => t.replace("::jsonb", "")],
      ["block comment header", (t) => "/* exported */\n" + t],
      ["lower(name) = lower()", (t) => t.replace("WHERE name = 'dq_pipeline_demo_dataset'", "WHERE lower(name) = lower('dq_pipeline_demo_dataset')")],
      ["no third argument", (t) => t.replace(/,\s*true\s*\)/, ")")],
    ];
    for (const [label, f] of variants) expect(`${label}: ${n(f(dialogLayout))}`).toBe(`${label}: 11`);
  });
  it("a JSON payload containing quotes, $ and comment-like text survives intact", () => {
    const tricky = [{ rule_name: "it's /* not a comment */ -- or $dq$", column_name: "c", rule_type: "custom", parameters: { operator: "regex", value: "^a'b$" }, severity: "error", is_enabled: true }];
    const back = parseRulesSql(exportRulesSql(tricky, "O'Brien"));
    expect(back.errors).toEqual([]);
    expect(back.rules[0]!.rule_name).toBe("it's /* not a comment */ -- or $dq$");
    expect(back.rules[0]!.parameters.value).toBe("^a'b$");
  });
  it("any other statement still rejects the WHOLE file, with the line and reason", () => {
    const bads: [string, string, RegExp][] = [
      ["trailing SELECT", dialogLayout + "\nSELECT * FROM public.validation_rules;", /line \d+.*validation_rules/s],
      ["INSERT INTO", "INSERT INTO public.validation_rules (rule_name) VALUES ('x');", /Unrecognised statement at line 1/],
      ["DROP after a valid call", dialogLayout + "\nDROP TABLE public.datasets;", /DROP TABLE/],
      ["uuid literal instead of lookup", dialogLayout.replace(/\(\s*SELECT id[\s\S]*?LIMIT 1\s*\)/, "'11111111-1111-1111-1111-111111111111'"), /dataset lookup/],
      ["mismatched delimiter", dialogLayout.replace("]$dq_rules$::jsonb", "]$other$::jsonb"), /closing delimiter/],
      ["seed script", readFileSync(path.join(root, "supabase/seeds/seed_ecommerce_validation_rules.sql"), "utf8"), /seed script/],
    ];
    for (const [label, text, why] of bads) {
      const r = parseRulesAuto(text);
      expect(`${label}: ${r.rules.length}`).toBe(`${label}: 0`);
      expect(r.errors[0]).toMatch(why);
      expect(r.errors[0]).toMatch(/Accepted format/);
    }
  });
  it("reviewImport: 11 drafts, correct dataset match, column mapping and per-rule validation", () => {
    const review = reviewImport(file, [{ id: "ds-other", name: "sales_demo" }, { id: "ds-demo", name: "DQ_Pipeline_Demo_Dataset" }]);
    expect(review.errors).toEqual([]);
    expect(review.drafts).toHaveLength(11);
    expect(review.matchedDatasetId).toBe("ds-demo"); // case-insensitive match
    expect(review.fileDatasetName).toBe("dq_pipeline_demo_dataset");
    const cols = Object.keys(demoRows()[0]!);
    expect(review.drafts.map((d) => d.column_name ?? d.parameters.columns!.join("+"))).toEqual(["order_id", "order_id", "email", "email", "age", "order_amount", "order_date", "payment_status", "delivery_days", "rating", "quantity"]);
    for (const d of review.drafts) expect(validateDraft(d, cols)).toEqual([]);
    expect(reviewImport(file, [{ id: "x", name: "other" }]).matchedDatasetId).toBeUndefined();
  });
});

describe("Apply: persistence through the bulk-insert contract (in-memory client, not a real database)", () => {
  const root = process.cwd();
  const migration = readFileSync(path.join(root, "drizzle/migrations/0001_bulk_validation_rules.sql"), "utf8");
  const WHITELIST = [...(/v_type NOT IN \(([^)]*)\)/.exec(migration)![1]!).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
  const DATASET = "ds-demo";
  const COLUMNS = Object.keys(demoRows()[0]!);

  /** Emulates the SQL function's checks (whitelist read from the migration file) and its all-or-nothing behaviour. */
  function fakeClient(opts: { functionMissing?: boolean } = {}) {
    const table: Record<string, unknown>[] = [];
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const key = (r: { rule_type: string; column_name: string | null; parameters: unknown }) => ruleKey(r);
    const client: RulesClient = {
      from: () => ({
        select: () => ({ eq: async (_c, v) => ({ data: table.filter((r) => r["dataset_id"] === v), error: null }) }),
        insert: async (rows) => { table.push(...(rows as Record<string, unknown>[]).map((r, i) => ({ id: `row-${table.length + i + 1}`, ...r }))); return { error: null }; },
      }),
      rpc: async (fn, args) => {
        calls.push({ fn, args: args as unknown as Record<string, unknown> });
        if (opts.functionMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.bulk_insert_validation_rules(p_dataset_id, p_rules, p_strict_columns) in the schema cache" } };
        const staged: Record<string, unknown>[] = []; // committed only if every rule is valid (transaction)
        let inserted = 0, skipped = 0;
        const seen = new Set(table.filter((r) => r["dataset_id"] === args.p_dataset_id).map((r) => key(r as never)));
        const rules = args.p_rules as Record<string, unknown>[];
        for (const [i, r] of rules.entries()) {
          const fail = (m: string) => ({ data: null, error: { message: `Rule #${i + 1}: ${m}` } });
          if (!String(r["rule_name"] ?? "").trim()) return fail("rule_name is required.");
          if (!WHITELIST.includes(String(r["rule_type"]))) return fail(`unsupported rule_type "${r["rule_type"]}".`);
          if (!["critical", "error", "warning"].includes(String(r["severity"] ?? "error"))) return fail("bad severity.");
          const col = r["column_name"] as string | null;
          if (args.p_strict_columns && col && !COLUMNS.includes(col)) return fail(`column "${col}" does not exist in the dataset schema.`);
          const k = key({ rule_type: String(r["rule_type"]), column_name: col, parameters: r["parameters"] });
          if (seen.has(k)) { skipped++; continue; }
          seen.add(k);
          staged.push({ id: `row-${table.length + staged.length + 1}`, dataset_id: args.p_dataset_id, ...r });
          inserted++;
        }
        table.push(...staged);
        return { data: { inserted, skipped }, error: null };
      },
    };
    return { client, table, calls };
  }

  const imported = () => reviewImport(readFileSync(path.join(root, "supabase/seeds/dq_pipeline_demo_dataset.rules-export.sql"), "utf8")).drafts;

  it("the whitelist the fake enforces is the real one from the migration, and covers every app rule type", () => {
    expect([...WHITELIST].sort()).toEqual([...SUPPORTED_RULE_TYPES].sort());
  });
  it("sends exactly the six property names the SQL function reads, strict columns on", async () => {
    const { client, calls } = fakeClient();
    await persistRules(client, DATASET, imported());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("bulk_insert_validation_rules");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(["p_dataset_id", "p_rules", "p_strict_columns"]);
    expect(calls[0]!.args["p_strict_columns"]).toBe(true);
    const rules = calls[0]!.args["p_rules"] as Record<string, unknown>[];
    expect(rules).toHaveLength(11);
    for (const r of rules) expect(Object.keys(r).sort()).toEqual(["column_name", "is_enabled", "parameters", "rule_name", "rule_type", "severity"]);
    expect(toRulePayload(imported()[0]!)).toEqual(rules[0]);
  });
  it("Apply stores all 11 rules with the right datasets, columns, types, parameters, severity and enabled flag", async () => {
    const { client, table } = fakeClient();
    const res = await persistRules(client, DATASET, imported());
    expect(res).toEqual({ inserted: 11, skipped: 0, mode: "rpc" });
    expect(table).toHaveLength(11);
    expect(table.every((r) => r["dataset_id"] === DATASET && r["severity"] === "error" && r["is_enabled"] === true)).toBe(true);
    expect(table.map((r) => [r["rule_name"], r["column_name"], r["rule_type"]])).toEqual([
      ["order_id — Required", "order_id", "not_null"], ["order_id — Unique", null, "duplicate"], ["email — Required", "email", "not_null"], ["email — Valid email format", "email", "custom"],
      ["age — Between 18 and 100", "age", "range"], ["order_amount — Greater than 0", "order_amount", "custom"], ["order_date — Valid date", "order_date", "data_type"],
      ["payment_status — Allowed values: Paid, Pending, Delivered, Cancelled", "payment_status", "allowed_values"], ["delivery_days — Between 0 and 30", "delivery_days", "range"],
      ["rating — Between 1 and 5", "rating", "range"], ["quantity — Greater than 0", "quantity", "custom"],
    ]);
    expect(table[1]!["parameters"]).toEqual({ columns: ["order_id"], ignoreEmpty: true });
  });
  it("importing the same file again persists nothing new", async () => {
    const { client, table } = fakeClient();
    await persistRules(client, DATASET, imported());
    const again = await persistRules(client, DATASET, imported());
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(11);
    expect(table).toHaveLength(11);
  });
  it("a failing batch stores nothing (all-or-nothing)", async () => {
    const { client, table } = fakeClient();
    const bad = [...imported().slice(0, 3), { ...imported()[3]!, column_name: "no_such_column", rule_name: "ghost" }];
    await expect(persistRules(client, DATASET, bad)).rejects.toThrow(/does not exist in the dataset schema/);
    expect(table).toHaveLength(0);
  });
  it("falls back to one atomic INSERT when the migration is not applied yet", async () => {
    const { client, table } = fakeClient({ functionMissing: true });
    const res = await persistRules(client, DATASET, imported());
    expect(res).toEqual({ inserted: 11, skipped: 0, mode: "insert" });
    expect(table).toHaveLength(11);
    expect(table[0]!["dataset_id"]).toBe(DATASET);
    expect((await persistRules(client, DATASET, imported())).inserted).toBe(0); // still de-duplicated
  });
  it("friendly message for the unique-index violation", () => {
    expect(ruleErrorMessage('duplicate key value violates unique constraint "validation_rules_dataset_fingerprint_key"')).toMatch(/identical rule already exists/);
  });
  it("full flow: export → review → apply → stored rules reject the bad records with reasons", async () => {
    const { client, table } = fakeClient();
    const exported = exportRulesSql(ecommerceImportRules(), ECOMMERCE_DATASET_NAME);
    const review = reviewImport(exported, [{ id: DATASET, name: ECOMMERCE_DATASET_NAME }]);
    expect(review.matchedDatasetId).toBe(DATASET);
    await persistRules(client, review.matchedDatasetId!, review.drafts);
    const stored: Rule[] = table.map((r) => ({ id: String(r["id"]), rule_name: String(r["rule_name"]), column_name: r["column_name"] as string | null, rule_type: r["rule_type"] as Rule["rule_type"], parameters: r["parameters"] as Rule["parameters"], severity: r["severity"] as Rule["severity"], is_enabled: r["is_enabled"] === true }));
    const rows = demoRows();
    const parts = split(rows, validate(rows, stored), DEFAULT_OPTIONS);
    expect(parts.rejected.map((r) => r.row_number)).toEqual(REJECTED_ROWS.filter((x) => x !== 23)); // row 23 (quantity 101) is valid under "> 0"
    expect(parts.accepted).toHaveLength(33);
    for (const rej of parts.rejected) for (const reason of rej.reasons) expect(stored.map((r) => r.id)).toContain(reason.rule_id);
  });
});
