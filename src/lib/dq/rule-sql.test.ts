import { describe, expect, it } from "vitest";
import { exportRulesSql, parseRuleSql, ruleFingerprint } from "./rule-sql";
import { validate } from "./engine";
import type { Rule, RuleParams } from "./types";

const cols = ["id", "price", "email"];
describe("SQL rule import", () => {
  it("parses multiple rules from one statement", () => {
    const r = parseRuleSql(`INSERT INTO validation_rules (rule_name, column_name, rule_type, severity, is_enabled, parameters) VALUES ('P', 'price', 'range', 'warning', false, '{"min":0}'), ('E', 'email', 'custom', 'error', true, '{"operator":"email"}');`, cols);
    expect(r.errors).toEqual([]);
    expect(r.rules).toHaveLength(2);
    expect(r.rules[0]?.severity).toBe("warning");
    expect(r.rules[0]?.is_enabled).toBe(false);
    expect(r.rules[0]?.parameters.min).toBe(0);
  });
  it("rejects other SQL statements without executing them", () => {
    const r = parseRuleSql("DROP TABLE datasets;", cols);
    expect(r.rules).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });
  it("reports unsupported rule types and unknown columns", () => {
    const r = parseRuleSql(`INSERT INTO validation_rules (rule_name, column_name, rule_type) VALUES ('a', 'price', 'allowed_values'), ('b', 'nope', 'not_null');`, cols);
    expect(r.rules[0]?.errors[0]).toContain("Unsupported rule type");
    expect(r.rules[1]?.errors[0]).toContain("does not exist");
  });
  it("export can be re-imported with identical rules", () => {
    const src = [{ dataset: "O'Brien", rule_name: "it's", column_name: "price", rule_type: "range", severity: "critical", is_enabled: true, parameters: { min: 1, max: 9 } }];
    const r = parseRuleSql(exportRulesSql(src), cols);
    expect(r.errors).toEqual([]);
    const imported = r.rules[0], original = src[0];
    if (!imported || !original) throw new Error("Expected exported and imported rules");
    expect(imported.dataset).toBe("O'Brien");
    expect(imported.rule_name).toBe("it's");
    expect(ruleFingerprint(imported)).toBe(ruleFingerprint(original));
  });
  it("duplicate fingerprint ignores key order and null params", () => {
    expect(ruleFingerprint({ rule_type: "range", column_name: "p", parameters: { max: 2, min: 1, x: null } })).toBe(ruleFingerprint({ rule_type: "range", column_name: "p", parameters: { min: 1, max: 2 } }));
  });
  it.each([
    ["required_columns", { columns: ["id"] }, null],
    ["not_null", { treatEmptyAsNull: true }, "id"],
    ["range", { min: 0, max: 10 }, "price"],
    ["duplicate", { columns: ["id"] }, null],
    ["data_type", { type: "date" }, "date"],
    ["custom", { operator: "email" }, "email"],
    ["record_count", { min: 3 }, null],
  ] as [Rule["rule_type"], RuleParams, string | null][])("round-trips and executes %s", (rule_type, parameters, column_name) => {
    const r = parseRuleSql(exportRulesSql([{ dataset: "Orders", rule_name: rule_type, rule_type, parameters, column_name, severity: "error", is_enabled: true }]), ["id", "price", "date", "email"]);
    expect(r.errors).toEqual([]);
    const parsed = r.rules[0];
    if (!parsed) throw new Error("Missing parsed rule");
    expect(parsed.errors).toEqual([]);
    const violations = validate([{ id: null, price: -1, date: "not-date", email: "bad" }, { id: null, price: 2, date: "2026-01-01", email: "a@b.com" }], [{ ...parsed, id: "imported", rule_type, severity: "error" }]);
    if (rule_type === "required_columns") expect(violations).toHaveLength(0);
    else expect(violations.length).toBeGreaterThan(0);
  });
  it("malformed parameter lists are reported without crashing", () => {
    const r = parseRuleSql(`INSERT INTO validation_rules (rule_name, rule_type, parameters) VALUES ('bad', 'duplicate', '{"columns":"id"}');`, cols);
    expect(r.rules[0]?.errors.length).toBeGreaterThan(0);
  });
  it("reports unknown parameters and backwards bounds", () => {
    const r = parseRuleSql(`INSERT INTO validation_rules (rule_name, column_name, rule_type, parameters) VALUES ('a','price','range','{"min":5,"max":2}'), ('b','id','not_null','{"allowed":[1]}');`, cols);
    expect(r.rules[0]?.errors).toContain("Minimum must not exceed maximum.");
    expect(r.rules[1]?.errors.length).toBeGreaterThan(0);
  });
  it("does not accept expressions or duplicate SQL column definitions", () => {
    expect(parseRuleSql("INSERT INTO validation_rules (rule_name,rule_type) VALUES (current_user,'duplicate');").errors).toHaveLength(1);
    expect(parseRuleSql("INSERT INTO validation_rules (rule_name,rule_name,rule_type) VALUES ('x','y','duplicate');").errors).toHaveLength(1);
  });
});
