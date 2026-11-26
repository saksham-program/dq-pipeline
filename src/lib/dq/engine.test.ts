import { describe, expect, it } from "vitest";
import { clean, jsonToRows, reconcile, split, validate } from "./engine";
import { DEFAULT_OPTIONS, type Rule } from "./types";

const rule = (r: Partial<Rule>): Rule => ({ id: "r", rule_name: "t", column_name: null, parameters: {}, severity: "error", is_enabled: true, rule_type: "not_null", ...r });

describe("validation engine", () => {
  it("detects missing required columns", () => {
    const v = validate([{ a: 1 }], [rule({ rule_type: "required_columns", parameters: { columns: ["a", "b"] } })]);
    expect(v).toHaveLength(1);
    expect(v[0]?.column_name).toBe("b");
  });
  it("flags nulls and empty strings", () => {
    const v = validate([{ a: "" }, { a: null }, { a: "x" }], [rule({ column_name: "a" })]);
    expect(v.map((x) => x.row_number)).toEqual([1, 2]);
  });
  it("detects duplicates by key column", () => {
    const v = validate([{ id: 1 }, { id: 2 }, { id: 1 }], [rule({ rule_type: "duplicate", parameters: { columns: ["id"] } })]);
    expect(v).toHaveLength(1);
    expect(v[0]!.row_number).toBe(3);
  });
  it("checks numeric range", () => {
    const v = validate([{ p: "-5" }, { p: "10" }], [rule({ rule_type: "range", column_name: "p", parameters: { min: 0 } })]);
    expect(v.map((x) => x.row_number)).toEqual([1]);
  });
  it("checks data types", () => {
    const v = validate([{ q: "12" }, { q: "abc" }], [rule({ rule_type: "data_type", column_name: "q", parameters: { type: "integer" } })]);
    expect(v.map((x) => x.row_number)).toEqual([2]);
  });
  it("custom email rule", () => {
    const v = validate([{ email: "a@b.com" }, { email: "bad" }], [rule({ rule_type: "custom", column_name: "email", parameters: { operator: "email" } })]);
    expect(v.map((x) => x.row_number)).toEqual([2]);
  });
  it("keeps all violations for a row and warnings don't reject", () => {
    const rows = [{ a: "", b: "-1" }, { a: "x", b: "-1" }];
    const v = validate(rows, [rule({ column_name: "a" }), rule({ rule_type: "range", column_name: "b", parameters: { min: 0 }, severity: "warning" })]);
    const s = split(rows, v, DEFAULT_OPTIONS);
    expect(s.rejected).toHaveLength(1);
    expect(s.rejected[0]!.reasons).toHaveLength(2);
    expect(s.accepted.map((a) => a.row_number)).toEqual([2]);
  });
  it("fillable nulls are accepted and filled without mutating originals", () => {
    const rows = [{ c: "" }];
    const rules = [rule({ column_name: "c", parameters: { fillValue: "N/A" } })];
    const s = split(rows, validate(rows, rules), DEFAULT_OPTIONS);
    const c = clean(s.accepted, rules, DEFAULT_OPTIONS);
    expect(c.rows[0]!.record["c"]).toBe("N/A");
    expect(rows[0]!["c"]).toBe("");
  });
  it("reconciliation mismatches are never matched", () => {
    expect(reconcile(10, 7, 3, 7, 0).status).toBe("matched");
    expect(reconcile(10, 7, 2, 7, 0).status).toBe("mismatch");
    expect(reconcile(10, 7, 3, 6, 0).status).toBe("mismatch");
  });
  it("flattens JSON arrays nested in objects", () => {
    expect(jsonToRows({ data: [{ a: { b: 1 } }] })).toEqual([{ "a.b": 1 }]);
  });
});
