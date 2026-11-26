import type { ColumnInfo, RuleParams, RuleType } from "./types";
import { exportRulesSql } from "./rule-sql";

export function defaultRuleParams(type: RuleType, columns: string[]): RuleParams {
  switch (type) {
    case "required_columns": return { columns, allowExtraColumns: true };
    case "duplicate": return { columns: [] };
    case "data_type": return { type: "string" };
    case "range": return { min: 0 };
    case "custom": return { operator: "email" };
    case "record_count": return { min: 1 };
    default: return {};
  }
}

/** Suggestions remain in review; no rule is written until explicitly selected. */
export function suggestedRuleSql(dataset: string, columns: ColumnInfo[]): string {
  const rules = columns.flatMap((c) => [
    { dataset, rule_name: `${c.name} required`, column_name: c.name, rule_type: "not_null", severity: "error", is_enabled: true, parameters: {} },
    ...(c.type === "string" ? [] : [{ dataset, rule_name: `${c.name} is ${c.type}`, column_name: c.name, rule_type: "data_type", severity: "error", is_enabled: true, parameters: { type: c.type } }]),
  ]);
  return exportRulesSql(rules);
}