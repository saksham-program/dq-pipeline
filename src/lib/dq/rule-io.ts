import { canonicalizeRuleShape } from "./rule-types";
import { validateDraft, type RuleDraft } from "./rule-templates";
import type { RuleParams, RuleType, Severity } from "./types";

/**
 * Import/export of rule configurations.
 *
 * SQL import is NOT SQL execution: pasted text is parsed by a strict recogniser that only accepts
 * the exact statement shape produced by exportRulesSql (a call to the bulk_insert_validation_rules
 * function with a JSON literal). Anything else is rejected, and nothing typed by the user is ever
 * sent to the database as SQL — the extracted rules go through the same validated, parameterised path
 * as every other bulk save.
 */
export const EXPORT_FORMAT = "dq-pipeline-rules";
export const MAX_IMPORT_RULES = 500;
const MAX_IMPORT_CHARS = 1_000_000;

export interface ExportableRule {
  rule_name: string;
  column_name: string | null;
  rule_type: string;
  parameters: unknown;
  severity: string;
  is_enabled: boolean;
}

const clean = (r: ExportableRule) => ({ rule_name: r.rule_name, column_name: r.column_name ?? null, rule_type: r.rule_type, parameters: r.parameters ?? {}, severity: r.severity, is_enabled: r.is_enabled });

export function exportRulesJson(rules: ExportableRule[], datasetName: string, now = new Date()): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, exported_at: now.toISOString(), dataset: datasetName, rules: rules.map(clean) }, null, 2);
}

export function exportRulesSql(rules: ExportableRule[], datasetName: string, now = new Date()): string {
  const json = JSON.stringify(rules.map(clean), null, 2);
  const tag = "dq_rules";
  if (json.includes(`$${tag}$`)) throw new Error("Rule text contains a reserved delimiter and cannot be exported as SQL.");
  const lit = datasetName.replace(/'/g, "''");
  return [
    `-- DQ Pipeline validation rules — exported ${now.toISOString()}`,
    `-- Dataset: ${datasetName.replace(/[\r\n]+/g, " ")} · ${rules.length} rule(s)`,
    `-- Idempotent: existing identical rules are skipped. Requires migration 0001_bulk_validation_rules.sql.`,
    `SELECT public.bulk_insert_validation_rules(`,
    `  (SELECT id FROM public.datasets WHERE name = '${lit}' ORDER BY created_at LIMIT 1),`,
    `  $${tag}$${json}$${tag}$::jsonb,`,
    `  true`,
    `);`,
    ``,
  ].join("\n");
}

export interface ParseResult {
  rules: RuleDraft[];
  /** Informational: aliases that were normalised (e.g. "unique" → "duplicate") and parameters that were ignored. */
  notes?: string[];
  /** Per-rule problems; invalid rules are skipped, never partially imported. */
  errors: string[];
  datasetName?: string;
}

function normalise(raw: unknown, i: number): { draft?: RuleDraft; error?: string; notes?: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `Rule ${i + 1}: not an object.` };
  const r = raw as Record<string, unknown>;
  const name = typeof r["rule_name"] === "string" ? r["rule_name"].trim() : "";
  const column = typeof r["column_name"] === "string" && r["column_name"].trim() ? r["column_name"].trim() : null;
  // Accept both the stored (canonical) rule types and the template names (unique, date, …); anything else is rejected with the reason.
  const c = canonicalizeRuleShape({ rule_type: String(r["rule_type"] ?? ""), column_name: column, parameters: r["parameters"] });
  const label = `Rule ${i + 1} (${name || "unnamed"})`;
  if (!c.rule) return { error: `${label}: ${c.error}` };
  const draft: RuleDraft = {
    rule_name: name,
    column_name: c.rule.column_name,
    rule_type: c.rule.rule_type,
    parameters: c.rule.parameters,
    severity: ((r["severity"] as Severity | undefined) ?? "error") as Severity,
    is_enabled: r["is_enabled"] === undefined ? true : r["is_enabled"] === true,
  };
  const errs = validateDraft(draft);
  if (errs.length) return { error: `${label}: ${errs.join(" ")}` };
  return { draft, notes: c.notes.map((n) => `${label}: ${n}`) };
}

function fromArray(arr: unknown[]): ParseResult {
  const res: ParseResult = { rules: [], errors: [], notes: [] };
  if (arr.length > MAX_IMPORT_RULES) return { rules: [], errors: [`At most ${MAX_IMPORT_RULES} rules can be imported at once (found ${arr.length}).`] };
  arr.forEach((raw, i) => {
    const { draft, error, notes } = normalise(raw, i);
    if (draft) res.rules.push(draft);
    if (error) res.errors.push(error);
    if (notes) res.notes!.push(...notes);
  });
  return res;
}

export function parseRulesJson(text: string): ParseResult {
  if (text.length > MAX_IMPORT_CHARS) return { rules: [], errors: ["Input is too large."] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { rules: [], errors: ["Not valid JSON."] };
  }
  if (Array.isArray(data)) return fromArray(data);
  if (data && typeof data === "object" && Array.isArray((data as { rules?: unknown }).rules)) {
    const o = data as { rules: unknown[]; dataset?: unknown };
    return { ...fromArray(o.rules), ...(typeof o.dataset === "string" ? { datasetName: o.dataset } : {}) };
  }
  return { rules: [], errors: ['Expected an exported rules file (an object with a "rules" array) or an array of rules.'] };
}

/*
 * SQL recogniser. It reads exactly ONE statement shape — a call to bulk_insert_validation_rules with a
 * dataset lookup and a JSON rule list — and nothing else. Equivalent spellings of that same call are
 * accepted (schema prefix optional, $$ or $tag$ or '…' quoting, ::jsonb/::json cast, ASC/DESC, AS alias).
 * Text between statements may only be whitespace, comments, `;`, BEGIN or COMMIT. Any other statement
 * rejects the whole file. Nothing is ever executed: the JSON is extracted as data and then validated.
 */
const SCHEMA = String.raw`(?:public\s*\.\s*)?`;
const SQ = String.raw`'((?:[^']|'')*)'`;
const CALL_START = String.raw`SELECT\s+(?:\*\s+FROM\s+)?${SCHEMA}bulk_insert_validation_rules\s*\(\s*`;
const LOOKUP = String.raw`\(\s*SELECT\s+id\s+FROM\s+${SCHEMA}datasets\s+WHERE\s+(?:name\s*=\s*${SQ}|lower\s*\(\s*name\s*\)\s*=\s*lower\s*\(\s*${SQ}\s*\))(?:\s+ORDER\s+BY\s+created_at(?:\s+(?:ASC|DESC))?)?(?:\s+LIMIT\s+1)?\s*\)`;
const PAYLOAD = String.raw`(?:\$([A-Za-z_][A-Za-z0-9_]*)?\$([\s\S]*?)\$\3\$|${SQ})(?:\s*::\s*jsonb?)?`;
const CALL_END = String.raw`\s*(?:,\s*(?:true|false)\s*)?\)(?:\s+AS\s+[A-Za-z_][A-Za-z0-9_]*)?`;
// groups: 1,2 = dataset name (= form / lower() form); 3 = $tag; 4 = dollar-quoted JSON; 5 = single-quoted JSON
const STATEMENT_SRC = `${CALL_START}${LOOKUP}\\s*,\\s*${PAYLOAD}${CALL_END}`;
const SKIP = /(?:\s+|--[^\r\n]*|\/\*[\s\S]*?\*\/|;|\bBEGIN(?:\s+TRANSACTION)?\b|\bCOMMIT\b)+/iy;

const lineOf = (text: string, pos: number) => text.slice(0, pos).split("\n").length;
const snippet = (text: string, pos: number) => text.slice(pos, pos + 90).split(/\r?\n/)[0]!.trim();

const FORMAT_HELP = [
  "Accepted format — one statement per dataset:",
  "SELECT public.bulk_insert_validation_rules(",
  "  (SELECT id FROM public.datasets WHERE name = '<dataset name>' ORDER BY created_at LIMIT 1),",
  '  $dq_rules$[ { "rule_name", "column_name", "rule_type", "parameters", "severity", "is_enabled" }, … ]$dq_rules$::jsonb,',
  "  true",
  ");",
  "Create an importable file with Export SQL / Export JSON on the Validation Rules page. Pasted SQL is only read as data and is never executed.",
].join("\n");

/** Say which part of the statement at `pos` did not match, so the user can fix the file. */
function diagnose(text: string, pos: number): string {
  const rest = text.slice(pos);
  const at = (re: RegExp, from: number) => {
    const r = new RegExp(re.source, "iy");
    r.lastIndex = from;
    return r.exec(rest) ? r.lastIndex : -1;
  };
  const where = `line ${lineOf(text, pos)}: \`${snippet(text, pos)}\``;
  const afterStart = at(new RegExp(CALL_START), 0);
  if (afterStart < 0) {
    const seed = /\bDO\s+\$\w*\$/i.test(text) ? " This looks like a seed script (a DO $…$ block); seed scripts are run in the Supabase SQL editor, not imported." : "";
    return `Unrecognised statement at ${where}. Only a SELECT public.bulk_insert_validation_rules(…) call is read; any other statement (INSERT, DROP, a verification SELECT, …) causes the whole file to be rejected.${seed}`;
  }
  const afterLookup = at(new RegExp(LOOKUP), afterStart);
  if (afterLookup < 0) return `The call at ${where} does not start with the dataset lookup. The first argument must be (SELECT id FROM public.datasets WHERE name = '<dataset name>' [ORDER BY created_at] [LIMIT 1]).`;
  const afterComma = at(/\s*,\s*/, afterLookup);
  if (afterComma < 0) return `The call at ${where} is missing the comma after the dataset lookup.`;
  const afterPayload = at(new RegExp(PAYLOAD), afterComma);
  if (afterPayload < 0) return `The call at ${where}: the second argument must be the JSON rule list in $dq_rules$…$dq_rules$ (or $$…$$, or '…') quotes, optionally followed by ::jsonb. Check that the closing delimiter matches the opening one.`;
  return `The call at ${where} is not closed correctly after the JSON: expected  [, true|false] );`;
}

export function unsupportedSqlMessage(text: string, pos = 0): string {
  const clean = text.replace(/^\uFEFF/, "");
  return `${diagnose(clean, Math.min(pos, clean.length))}\n\n${FORMAT_HELP}`;
}

export function parseRulesSql(input: string): ParseResult {
  if (input.length > MAX_IMPORT_CHARS) return { rules: [], errors: ["Input is too large."] };
  const text = input.replace(/^\uFEFF/, "");
  const found: { name: string; json: string }[] = [];
  const stmt = new RegExp(STATEMENT_SRC, "iy");
  const skip = new RegExp(SKIP.source, SKIP.flags);
  let pos = 0;
  while (pos < text.length) {
    skip.lastIndex = pos;
    if (skip.exec(text)) pos = skip.lastIndex;
    if (pos >= text.length) break;
    stmt.lastIndex = pos;
    const m = stmt.exec(text);
    if (!m) return { rules: [], errors: [unsupportedSqlMessage(text, pos)] };
    const name = (m[1] ?? m[2] ?? "").replace(/''/g, "'");
    const json = m[3] !== undefined || m[4] !== undefined ? (m[4] ?? "") : (m[5] ?? "").replace(/''/g, "'");
    found.push({ name, json });
    pos = stmt.lastIndex;
  }
  if (found.length === 0) return { rules: [], errors: [unsupportedSqlMessage(text, 0)] };
  const out: ParseResult = { rules: [], errors: [], notes: [], datasetName: found[0]!.name };
  for (const f of found) {
    const r = parseRulesJson(f.json);
    out.rules.push(...r.rules);
    out.errors.push(...r.errors);
    out.notes!.push(...(r.notes ?? []));
  }
  if (out.rules.length > MAX_IMPORT_RULES) return { rules: [], errors: [`At most ${MAX_IMPORT_RULES} rules can be imported at once.`] };
  return out;
}

/** Detect which format a pasted/uploaded text is in and parse it. */
export function parseRulesAuto(text: string): ParseResult {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return parseRulesJson(t);
  return parseRulesSql(t);
}

export interface ImportReview {
  drafts: RuleDraft[];
  errors: string[];
  /** Normalisations applied while reading the file (shown to the user, not errors). */
  notes: string[];
  /** Registered dataset whose name matches the dataset named in the file (case-insensitive), if any. */
  matchedDatasetId?: string;
  /** Dataset name written in the file (a hint only — the user's chosen target decides where rules go). */
  fileDatasetName?: string;
}

/** What the Import dialog shows after "Review rules": parsed drafts, problems, and which dataset the file names. */
export function reviewImport(text: string, datasets: { id: string; name: string }[] = []): ImportReview {
  const r = parseRulesAuto(text);
  const match = r.datasetName ? datasets.find((d) => d.name.toLowerCase() === r.datasetName!.toLowerCase()) : undefined;
  return { drafts: r.rules, errors: r.errors, notes: r.notes ?? [], ...(match ? { matchedDatasetId: match.id } : {}), ...(r.datasetName ? { fileDatasetName: r.datasetName } : {}) };
}
