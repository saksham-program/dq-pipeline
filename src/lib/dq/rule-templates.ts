import { CANONICAL_RULE_TYPES, canonicalizeRuleShape } from "./rule-types";
import type { ColumnInfo, DataType, Rule, RuleParams, RuleType, Severity } from "./types";

/**
 * Reusable validation-rule templates. Every template compiles to a rule type the
 * existing engine (engine.ts) already executes — there is no second engine:
 *
 *   required → not_null          unique → duplicate (single key, blanks ignored)
 *   range → range                positive → custom { gt 0 }
 *   data_type → data_type        email → custom { email }
 *   date → data_type { date }    allowed_values → allowed_values
 *   duplicate_record → duplicate (composite key or whole row)
 *   custom → custom
 */
export type TemplateId =
  | "required"
  | "unique"
  | "numeric_range"
  | "positive"
  | "data_type"
  | "email"
  | "date"
  | "allowed_values"
  | "duplicate_record"
  | "custom";

/** A rule that has not been saved yet (no id). */
export interface RuleDraft {
  rule_name: string;
  column_name: string | null;
  rule_type: RuleType;
  parameters: RuleParams;
  severity: Severity;
  is_enabled: boolean;
  /** Which template produced it (informational). */
  template?: TemplateId;
  /** Why it was suggested (smart suggestions only). */
  reason?: string;
}

/** User-configurable options a template reads. */
export interface TemplateOptions {
  min?: number | null;
  max?: number | null;
  type?: DataType;
  values?: string[];
  caseSensitive?: boolean;
  columns?: string[]; // duplicate_record composite key
  operator?: NonNullable<RuleParams["operator"]>;
  value?: string | number | null;
}

export interface TemplateDef {
  id: TemplateId;
  label: string;
  description: string;
  /** true = one rule per selected column; false = one rule for the whole selection */
  perColumn: boolean;
  needsColumn: boolean;
  /** Options the configuration step should show. */
  options: ("range" | "type" | "values" | "custom")[];
}

export const TEMPLATES: TemplateDef[] = [
  { id: "required", label: "Required field", description: "Rejects null, empty or whitespace-only values.", perColumn: true, needsColumn: true, options: [] },
  { id: "unique", label: "Unique field", description: "Flags repeated values across the whole dataset (blanks are left to Required).", perColumn: true, needsColumn: true, options: [] },
  { id: "numeric_range", label: "Numeric range", description: "Value must be numeric and within the configured minimum/maximum (inclusive).", perColumn: true, needsColumn: true, options: ["range"] },
  { id: "positive", label: "Positive value", description: "Numeric value must be greater than zero.", perColumn: true, needsColumn: true, options: [] },
  { id: "data_type", label: "Data type", description: "Value must match the expected type.", perColumn: true, needsColumn: true, options: ["type"] },
  { id: "email", label: "Email format", description: "Value must look like a valid email address.", perColumn: true, needsColumn: true, options: [] },
  { id: "date", label: "Date validation", description: "Value must be a real calendar date (YYYY-MM-DD, timestamps, or M/D/YYYY).", perColumn: true, needsColumn: true, options: [] },
  { id: "allowed_values", label: "Allowed values", description: "Value must be in an approved list (trimmed, case-insensitive by default).", perColumn: true, needsColumn: true, options: ["values"] },
  { id: "duplicate_record", label: "Duplicate record", description: "Flags rows that repeat a composite key — or the whole row if no columns are chosen.", perColumn: false, needsColumn: false, options: [] },
  { id: "custom", label: "Custom condition", description: "Comparison, email or regular-expression check using the engine's custom rule.", perColumn: true, needsColumn: true, options: ["custom"] },
];

export const templateDef = (id: TemplateId) => TEMPLATES.find((t) => t.id === id)!;

const SHORT: Record<TemplateId, string> = {
  required: "Required",
  unique: "Unique",
  numeric_range: "Range",
  positive: "Positive",
  data_type: "Type",
  email: "Email format",
  date: "Valid date",
  allowed_values: "Allowed values",
  duplicate_record: "No duplicate records",
  custom: "Custom",
};

const OP_SYMBOL: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", neq: "≠" };

export function defaultRuleName(id: TemplateId, column: string | null, o: TemplateOptions = {}): string {
  const col = column ?? "";
  switch (id) {
    case "numeric_range":
      return `${col} — Range ${o.min ?? "−∞"} to ${o.max ?? "∞"}`;
    case "data_type":
      return `${col} — Type ${o.type ?? "string"}`;
    case "allowed_values":
      return `${col} — Allowed values`;
    case "duplicate_record":
      return o.columns?.length ? `No duplicate records (${o.columns.join(" + ")})` : "No duplicate records (whole row)";
    case "custom":
      return `${col} — Custom ${o.operator === "email" ? "email" : o.operator === "regex" ? "pattern" : `${OP_SYMBOL[o.operator ?? "gt"] ?? ""} ${o.value ?? ""}`.trim()}`;
    default:
      return `${col} — ${SHORT[id]}`;
  }
}

/** Build one draft from a template. Throws nothing; use validateDraft for problems. */
export function buildDraft(id: TemplateId, column: string | null, severity: Severity, o: TemplateOptions = {}, enabled = true): RuleDraft {
  const base = { severity, is_enabled: enabled, template: id } as const;
  const name = defaultRuleName(id, column, o);
  switch (id) {
    case "required":
      return { ...base, rule_name: name, column_name: column, rule_type: "not_null", parameters: { treatEmptyAsNull: true } };
    case "unique":
      return { ...base, rule_name: name, column_name: null, rule_type: "duplicate", parameters: { columns: column ? [column] : [], ignoreEmpty: true } };
    case "numeric_range":
      return { ...base, rule_name: name, column_name: column, rule_type: "range", parameters: { min: o.min ?? null, max: o.max ?? null } };
    case "positive":
      return { ...base, rule_name: name, column_name: column, rule_type: "custom", parameters: { operator: "gt", value: 0 } };
    case "data_type":
      return { ...base, rule_name: name, column_name: column, rule_type: "data_type", parameters: { type: o.type ?? "string" } };
    case "email":
      return { ...base, rule_name: name, column_name: column, rule_type: "custom", parameters: { operator: "email", value: null } };
    case "date":
      return { ...base, rule_name: name, column_name: column, rule_type: "data_type", parameters: { type: "date" } };
    case "allowed_values":
      return { ...base, rule_name: name, column_name: column, rule_type: "allowed_values", parameters: { values: [...(o.values ?? [])], caseSensitive: o.caseSensitive === true } };
    case "duplicate_record":
      return { ...base, rule_name: name, column_name: null, rule_type: "duplicate", parameters: { columns: [...(o.columns ?? [])] } };
    case "custom": {
      const operator = o.operator ?? "gt";
      return { ...base, rule_name: name, column_name: column, rule_type: "custom", parameters: { operator, value: operator === "email" ? null : (o.value ?? null) } };
    }
  }
}

/**
 * Build drafts for the cross product of columns × templates.
 * Column-less templates (duplicate_record) produce a single draft.
 */
export function buildDrafts(templates: TemplateId[], columns: string[], severity: Severity, o: TemplateOptions = {}, enabled = true): RuleDraft[] {
  const out: RuleDraft[] = [];
  for (const id of templates) {
    const def = templateDef(id);
    if (!def.perColumn) out.push(buildDraft(id, null, severity, { ...o, columns: o.columns?.length ? o.columns : columns.length > 1 ? columns : [] }, enabled));
    else for (const c of columns) out.push(buildDraft(id, c, severity, o, enabled));
  }
  return out;
}

const RULE_TYPES: RuleType[] = ["required_columns", "data_type", "not_null", "duplicate", "range", "custom", "record_count", "allowed_values"];
export const SUPPORTED_RULE_TYPES = RULE_TYPES;
const SEVERITIES: Severity[] = ["critical", "error", "warning"];
const DATA_TYPES: DataType[] = ["string", "integer", "float", "date", "boolean"];
const OPERATORS = ["gt", "gte", "lt", "lte", "eq", "neq", "email", "regex"];
const COLUMNLESS: RuleType[] = ["required_columns", "duplicate", "record_count"];

const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);

/** Structural problems that would make a rule save wrongly or never execute. Empty array = valid. */
export function validateDraft(d: RuleDraft, columnNames?: string[]): string[] {
  const errs: string[] = [];
  const p = d.parameters ?? {};
  if (!d.rule_name?.trim()) errs.push("Rule name is required.");
  if (!RULE_TYPES.includes(d.rule_type)) errs.push(`Unsupported rule type "${d.rule_type}".`);
  if (!SEVERITIES.includes(d.severity)) errs.push(`Invalid severity "${d.severity}".`);
  const needsCol = !COLUMNLESS.includes(d.rule_type);
  if (needsCol && !d.column_name) errs.push("A column is required.");
  const colsToCheck = [...(d.column_name ? [d.column_name] : []), ...(["duplicate", "required_columns"].includes(d.rule_type) ? (p.columns ?? []) : [])];
  if (columnNames) for (const c of colsToCheck) if (!columnNames.includes(c)) errs.push(`Column "${c}" does not exist in this dataset.`);
  switch (d.rule_type) {
    case "range":
      if (p.min == null && p.max == null) errs.push("Set a minimum and/or maximum.");
      if (p.min != null && !isNum(p.min)) errs.push("Minimum must be a number.");
      if (p.max != null && !isNum(p.max)) errs.push("Maximum must be a number.");
      if (isNum(p.min) && isNum(p.max) && (p.min as number) > (p.max as number)) errs.push("Minimum cannot exceed maximum.");
      break;
    case "data_type":
      if (!p.type || !DATA_TYPES.includes(p.type)) errs.push("Choose an expected data type.");
      break;
    case "allowed_values":
      if (!Array.isArray(p.values) || p.values.map((v) => String(v).trim()).filter(Boolean).length === 0) errs.push("List at least one allowed value.");
      break;
    case "required_columns":
      if (!p.columns?.length) errs.push("List at least one required column.");
      break;
    case "custom": {
      const op = p.operator ?? "gt";
      if (!OPERATORS.includes(op)) errs.push(`Unknown operator "${op}".`);
      else if (op === "regex") {
        try {
          new RegExp(String(p.value ?? ""));
        } catch {
          errs.push("Pattern is not a valid regular expression.");
        }
        if (!String(p.value ?? "")) errs.push("Enter a pattern.");
      } else if (op !== "email") {
        const n = Number(p.value);
        if (p.value === null || p.value === undefined || p.value === "" || !Number.isFinite(n)) errs.push("Enter a numeric comparison value.");
      }
      break;
    }
    case "duplicate":
      break;
    case "record_count":
      if (p.min == null && p.max == null && p.maxChangePct == null) errs.push("Set at least one record-count limit.");
      break;
  }
  return errs;
}

/** Order-independent identity of a rule: same dataset-level check = same key. Severity/name/enabled are cosmetic. */
export function ruleKey(r: { rule_type: string; column_name: string | null; parameters: unknown }): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]));
    return v;
  };
  return JSON.stringify([r.rule_type, r.column_name ?? "", canon(r.parameters ?? {})]);
}

export interface BulkPlan<T extends RuleDraft> {
  toInsert: T[];
  /** Already saved for the dataset (or repeated earlier in the same batch). */
  duplicates: T[];
}

/** Split drafts into new vs already-existing. The database unique index is the final authority. */
export function planBulkInsert<T extends RuleDraft>(existing: Pick<Rule, "rule_type" | "column_name" | "parameters">[], drafts: T[]): BulkPlan<T> {
  const seen = new Set(existing.map(ruleKey));
  const plan: BulkPlan<T> = { toInsert: [], duplicates: [] };
  for (const d of drafts) {
    const k = ruleKey(d);
    if (seen.has(k)) plan.duplicates.push(d);
    else {
      seen.add(k);
      plan.toInsert.push(d);
    }
  }
  return plan;
}

/** Column names from stored schema metadata. */
export const columnNamesOf = (schema: unknown): string[] => (Array.isArray(schema) ? (schema as ColumnInfo[]).map((c) => c.name) : []);

export const RULE_TYPE_LABEL: Record<string, string> = {
  required_columns: "Required columns / schema",
  data_type: "Data type",
  not_null: "Not null / required value",
  duplicate: "Duplicate / unique",
  range: "Numerical range",
  allowed_values: "Allowed values",
  custom: "Custom condition",
  record_count: "Record count",
};

/** One-line human description of a rule's parameters. */
export function describeParams(type: string, p: RuleParams = {}): string {
  if (!(CANONICAL_RULE_TYPES as string[]).includes(type)) {
    // a stored template-name alias still executes: describe it by what it means
    const c = canonicalizeRuleShape({ rule_type: type, column_name: "x", parameters: p });
    if (c.rule) return describeParams(c.rule.rule_type, c.rule.parameters);
  }
  switch (type) {
    case "required_columns":
      return `${(p.columns ?? []).join(", ")}${p.allowExtraColumns === false ? " (no extra columns)" : ""}`;
    case "data_type":
      return `must be ${p.type}${p.format ? ` (${p.format})` : ""}`;
    case "not_null":
      return p.fillValue ? `fill with "${p.fillValue}"` : "reject if empty";
    case "duplicate":
      return `${p.columns?.length ? `key: ${p.columns.join(", ")}` : "complete row"}${p.ignoreEmpty ? " · blanks ignored" : ""}${p.caseInsensitive ? " · case-insensitive" : ""}`;
    case "range":
      return `${p.min ?? "−∞"} … ${p.max ?? "∞"}`;
    case "allowed_values":
      return `one of: ${(p.values ?? []).join(", ")}${p.caseSensitive ? " (case-sensitive)" : ""}`;
    case "custom":
      return p.operator === "email" ? "valid email" : p.operator === "regex" ? `matches ${p.value}` : `${OP_SYMBOL[p.operator ?? "gt"] ?? p.operator} ${p.value}`;
    case "record_count":
      return [p.min != null && `min ${p.min}`, p.max != null && `max ${p.max}`, p.maxChangePct != null && `≤${p.maxChangePct}% change`].filter(Boolean).join(", ");
  }
  return `unsupported rule type "${type}" — will not execute`;
}
