/**
 * Safe SQL rule-export format. SQL text is PARSED AS DATA, never executed.
 *
 * Supported statement (one or many, each ending with ";"; "--" comments allowed):
 *   INSERT INTO validation_rules (dataset, rule_name, column_name, rule_type, severity, is_enabled, parameters)
 *   VALUES ('Orders', 'Price not negative', 'price', 'range', 'error', true, '{"min":0}'), (...);
 * Column list order may vary; rule_name and rule_type are required.
 */
import { z } from "zod";
import type { RuleParams, RuleType } from "./types";

export const SUPPORTED_RULE_TYPES: RuleType[] = ["required_columns", "data_type", "not_null", "duplicate", "range", "custom", "record_count"];
const SEVERITIES = ["critical", "error", "warning"];
const KNOWN_COLS = ["dataset", "rule_name", "column_name", "rule_type", "severity", "is_enabled", "parameters"];
const NEEDS_COLUMN: RuleType[] = ["data_type", "not_null", "range", "custom"];
const OPERATORS = ["gt", "gte", "lt", "lte", "eq", "neq", "email", "regex"];
const DATA_TYPES = ["string", "integer", "float", "date", "boolean"];

export interface ParsedRule {
  key: number;
  statement: number;
  dataset: string | null;
  rule_name: string;
  column_name: string | null;
  rule_type: string;
  severity: string;
  is_enabled: boolean;
  parameters: RuleParams;
  errors: string[];
  sourceErrors?: string[];
  parameterText?: string;
}
export interface ParseResult { rules: ParsedRule[]; errors: string[] }

type Val = string | number | boolean | null;

function splitStatements(sql: string): string[] {
  const out: string[] = []; let cur = ""; let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? "";
    if (!inStr && c === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; cur += " "; continue; }
    if (c === "'") { if (inStr && sql[i + 1] === "'") { cur += "''"; i++; continue; } inStr = !inStr; }
    if (c === ";" && !inStr) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (inStr) throw new Error("Unterminated string literal ( ' ) in SQL.");
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Parse "( v, v, ... ), ( ... )" into tuples of literal values. */
function parseTuples(s: string): Val[][] {
  const tuples: Val[][] = []; let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i] ?? "")) i++; };
  const literal = (): Val => {
    ws();
    if (s[i] === "'") {
      let v = ""; i++;
      for (;;) {
        if (i >= s.length) throw new Error("Unterminated string");
        if (s[i] === "'") { if (s[i + 1] === "'") { v += "'"; i += 2; continue; } i++; break; }
        v += s[i++];
      }
      return v;
    }
    const m = /^(NULL|TRUE|FALSE|-?\d+(\.\d+)?)/i.exec(s.slice(i));
    if (!m) throw new Error(`Unsupported value near "${s.slice(i, i + 20)}" — only quoted strings, numbers, true/false and NULL are allowed.`);
    i += m[0].length;
    const t = m[0].toUpperCase();
    return t === "NULL" ? null : t === "TRUE" ? true : t === "FALSE" ? false : Number(m[0]);
  };
  for (;;) {
    ws();
    if (s[i] !== "(") throw new Error(`Expected "(" to start a VALUES row near "${s.slice(i, i + 20)}".`);
    i++; const row: Val[] = [];
    for (;;) { row.push(literal()); ws(); if (s[i] === ",") { i++; continue; } if (s[i] === ")") { i++; break; } throw new Error(`Expected "," or ")" near "${s.slice(i, i + 20)}".`); }
    tuples.push(row); ws();
    if (i >= s.length) break;
    if (s[i] === ",") { i++; continue; }
    throw new Error(`Unexpected text after VALUES row: "${s.slice(i, i + 20)}".`);
  }
  return tuples;
}

const numberParam = z.number().finite().nullable().optional();
const countParam = z.number().int().nonnegative().nullable().optional();
const columnList = z.array(z.string().trim().min(1)).optional();
const PARAMS: Record<RuleType, z.ZodTypeAny> = {
  required_columns: z.object({ columns: columnList, allowExtraColumns: z.boolean().optional() }).strict(),
  duplicate: z.object({ columns: columnList }).strict(),
  data_type: z.object({ type: z.enum(["string", "integer", "float", "date", "boolean"]) }).strict(),
  not_null: z.object({ treatEmptyAsNull: z.boolean().optional(), fillValue: z.string().nullable().optional() }).strict(),
  range: z.object({ min: numberParam, max: numberParam }).strict(),
  record_count: z.object({ min: countParam, max: countParam, maxChangePct: z.number().finite().nonnegative().nullable().optional() }).strict(),
  custom: z.object({ operator: z.enum(["gt", "gte", "lt", "lte", "eq", "neq", "email", "regex"]), value: z.union([z.string(), z.number().finite()]).nullable().optional() }).strict(),
};

export function validateParsed(r: Omit<ParsedRule, "errors" | "key" | "statement">, columns?: string[]): string[] {
  const e: string[] = [];
  if (!r.rule_name.trim()) e.push("Rule name is empty.");
  if (r.rule_name.length > 200) e.push("Rule name must be at most 200 characters.");
  if (r.dataset !== null && (!r.dataset.trim() || r.dataset.length > 200)) e.push("Dataset name must contain 1–200 characters.");
  if (!SEVERITIES.includes(r.severity)) e.push(`Invalid severity "${r.severity}".`);
  if (!SUPPORTED_RULE_TYPES.includes(r.rule_type as RuleType)) { e.push(`Unsupported rule type "${r.rule_type}". Supported: ${SUPPORTED_RULE_TYPES.join(", ")}.`); return e; }
  const t = r.rule_type as RuleType; const p = r.parameters;
  const checked = PARAMS[t].safeParse(p);
  if (!checked.success) { e.push(...checked.error.issues.map((issue) => `parameters${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`)); return e; }
  if (NEEDS_COLUMN.includes(t) && !r.column_name) e.push(`Rule type "${t}" needs a column_name.`);
  if (columns && r.column_name && !columns.includes(r.column_name)) e.push(`Column "${r.column_name}" does not exist in the dataset.`);
  const listCols = (cs?: string[]) => cs?.filter((c) => columns && !columns.includes(c)) ?? [];
  if (t === "required_columns" && !p.columns?.length) e.push("required_columns needs parameters.columns.");
  if ((t === "duplicate" || t === "required_columns") && listCols(p.columns).length) e.push(`Unknown column(s): ${listCols(p.columns).join(", ")}.`);
  if (t === "data_type" && !DATA_TYPES.includes(String(p.type))) e.push(`data_type needs parameters.type (${DATA_TYPES.join(", ")}).`);
  if (t === "range" || t === "record_count") {
    for (const k of ["min", "max", "maxChangePct"] as const) if (p[k] != null && typeof p[k] !== "number") e.push(`parameters.${k} must be a number.`);
    if (t === "range" && p.min == null && p.max == null) e.push("range needs parameters.min or parameters.max.");
    if (p.min != null && p.max != null && p.min > p.max) e.push("Minimum must not exceed maximum.");
    if (t === "record_count" && p.min == null && p.max == null && p.maxChangePct == null) e.push("record_count needs a minimum, maximum or change percentage.");
  }
  if (t === "custom") {
    if (!OPERATORS.includes(String(p.operator))) e.push(`custom needs parameters.operator (${OPERATORS.join(", ")}).`);
    else if (p.operator === "regex") { if (typeof p.value !== "string" || !p.value) e.push("parameters.value must contain a regular expression."); else { try { new RegExp(p.value); } catch { e.push("parameters.value is not a valid regular expression."); } } }
    else if (p.operator !== "email" && typeof p.value !== "number") e.push("parameters.value must be a number for this operator.");
  }
  return e;
}

export function parseRuleSql(sql: string, columns?: string[]): ParseResult {
  const errors: string[] = []; const rules: ParsedRule[] = []; let key = 0;
  if (sql.length > 1_000_000) return { rules, errors: ["SQL input must be at most 1 MB."] };
  let stmts: string[];
  try { stmts = splitStatements(sql); } catch (x) { return { rules, errors: [(x as Error).message] }; }
  if (!stmts.length) errors.push("No SQL statements found.");
  stmts.forEach((st, si) => {
    const n = si + 1;
    const m = /^INSERT\s+INTO\s+(?:public\.)?"?validation_rules"?\s*\(([^)]*)\)\s*VALUES\s*([\s\S]+)$/i.exec(st);
    if (!m) { errors.push(`Statement ${n} is not supported (only INSERT INTO validation_rules (...) VALUES (...) is accepted; nothing is executed): "${st.slice(0, 60)}…"`); return; }
    const cols = (m[1] ?? "").split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());
    if (new Set(cols).size !== cols.length) { errors.push(`Statement ${n}: duplicate column names.`); return; }
    const unknown = cols.filter((c) => !KNOWN_COLS.includes(c));
    if (unknown.length) { errors.push(`Statement ${n}: unknown column(s) ${unknown.join(", ")}.`); return; }
    if (!cols.includes("rule_name") || !cols.includes("rule_type")) { errors.push(`Statement ${n}: rule_name and rule_type columns are required.`); return; }
    let tuples: Val[][];
    try { tuples = parseTuples(m[2] ?? ""); } catch (x) { errors.push(`Statement ${n}: ${(x as Error).message}`); return; }
    tuples.forEach((tu, ti) => {
      if (tu.length !== cols.length) { errors.push(`Statement ${n}, row ${ti + 1}: expected ${cols.length} values, got ${tu.length}.`); return; }
      const g = (c: string) => tu[cols.indexOf(c)];
      const rowErr: string[] = [];
      const sourceErrors: string[] = [];
      for (const c of ["rule_name", "rule_type", "column_name", "dataset"]) {
        const v = g(c);
        if (v != null && typeof v !== "string") sourceErrors.push(`${c} must be a quoted string or NULL.`);
      }
      let params: RuleParams = {};
      const pv = cols.includes("parameters") ? g("parameters") : null;
      if (pv != null) { try { const j = JSON.parse(String(pv)); if (j && typeof j === "object" && !Array.isArray(j)) params = j; else rowErr.push("parameters must be a JSON object."); } catch { rowErr.push("parameters is not valid JSON."); } }
      const sev = cols.includes("severity") && g("severity") != null ? String(g("severity")).toLowerCase() : "error";
      const en = cols.includes("is_enabled") ? g("is_enabled") : true;
      if (typeof en !== "boolean") sourceErrors.push("is_enabled must be true or false.");
      const base = { dataset: g("dataset") == null ? null : String(g("dataset")), rule_name: String(g("rule_name") ?? ""), column_name: cols.includes("column_name") && g("column_name") != null ? String(g("column_name")) : null, rule_type: String(g("rule_type") ?? ""), severity: sev, is_enabled: en !== false, parameters: params };
      rules.push({ ...base, key: key++, statement: n, sourceErrors, parameterText: pv == null ? "{}" : String(pv), errors: [...sourceErrors, ...rowErr, ...validateParsed(base, columns)] });
    });
  });
  return { rules, errors };
}

const sortObj = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] != null).map((k) => [k, sortObj((v as Record<string, unknown>)[k])])) : v);
/** Identity used for duplicate detection (name-independent). */
export const ruleFingerprint = (r: { rule_type: string; column_name: string | null; parameters: unknown }) => `${r.rule_type}|${r.column_name ?? ""}|${JSON.stringify(sortObj(r.parameters ?? {}))}`;

const q = (v: string | null) => (v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
export function exportRulesSql(rules: { dataset: string; rule_name: string; column_name: string | null; rule_type: string; severity: string; is_enabled: boolean; parameters: unknown }[]): string {
  const head = `-- DQ Pipeline validation rule export (${new Date().toISOString()})\n-- Import via Validation Rules > Import SQL. This file is parsed as data, never executed.\n`;
  if (!rules.length) return head;
  const rows = rules.map((r) => `  (${q(r.dataset)}, ${q(r.rule_name)}, ${q(r.column_name)}, ${q(r.rule_type)}, ${q(r.severity)}, ${r.is_enabled}, ${q(JSON.stringify(r.parameters ?? {}))})`);
  return `${head}INSERT INTO validation_rules (dataset, rule_name, column_name, rule_type, severity, is_enabled, parameters) VALUES\n${rows.join(",\n")};\n`;
}
