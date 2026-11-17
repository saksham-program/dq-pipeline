import { prepareRules } from "./rule-types";
import type {
  ColumnInfo,
  DataType,
  ProcessingOptions,
  Row,
  Rule,
  Severity,
  Violation,
} from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INT_RE = /^[-+]?\d+$/;
const FLOAT_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const BOOL_VALUES = new Set(["true", "false", "yes", "no", "1", "0", "y", "n"]);
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const validYmd = (y: number, m: number, d: number) => y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);

/**
 * Strict calendar check. Accepts YYYY-MM-DD[ T]hh:mm[:ss[.fff]][Z|±hh:mm] and
 * M/D/YYYY or D/M/YYYY (valid if either reading is a real date). Rejects
 * impossible dates such as 2026-02-31 or 2026-13-01 that Date.parse may let through.
 */
/** Exactly YYYY-MM-DD (no time part, no other layout) and a real calendar date. */
export function isIsoDateOnly(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return !!m && validYmd(+m[1]!, +m[2]!, +m[3]!);
}

export function isValidDateString(s: string): boolean {
  const iso = ISO_DATE_RE.exec(s);
  if (iso) {
    const [, y, mo, d, h, mi, sec] = iso;
    if (!validYmd(+y!, +mo!, +d!)) return false;
    if (h !== undefined && (+h > 23 || +mi! > 59 || (sec !== undefined && +sec > 59))) return false;
    return true;
  }
  const sl = SLASH_DATE_RE.exec(s);
  if (sl) {
    const a = +sl[1]!, b = +sl[2]!, y = +sl[3]!;
    return validYmd(y, a, b) || validYmd(y, b, a);
  }
  return false;
}

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

export function matchesType(v: unknown, t: DataType): boolean {
  if (isEmpty(v)) return true; // nulls are handled by not_null
  const s = String(v).trim();
  switch (t) {
    case "string":
      return true;
    case "integer":
      return typeof v === "number" ? Number.isInteger(v) : INT_RE.test(s);
    case "float":
      return typeof v === "number" ? Number.isFinite(v) : FLOAT_RE.test(s);
    case "boolean":
      return typeof v === "boolean" || BOOL_VALUES.has(s.toLowerCase());
    case "date":
      return isValidDateString(s);
  }
}

export function inferType(values: unknown[]): DataType {
  const present = values.filter((v) => !isEmpty(v));
  if (present.length === 0) return "string";
  const order: DataType[] = ["boolean", "integer", "float", "date"];
  for (const t of order) {
    const ok = present.filter((v) => matchesType(v, t)).length;
    if (t === "boolean" && present.every((v) => /^(0|1)$/.test(String(v).trim()))) continue;
    if (ok / present.length >= 0.9) return t;
  }
  return "string";
}

export function inferSchema(rows: Row[]): ColumnInfo[] {
  const cols = columnsOf(rows);
  return cols.map((name) => {
    const vals = rows.map((r) => r[name]);
    return { name, type: inferType(vals), nullCount: vals.filter(isEmpty).length };
  });
}

export function columnsOf(rows: Row[]): string[] {
  const set = new Set<string>();
  for (const r of rows.slice(0, 500)) Object.keys(r).forEach((k) => set.add(k));
  return [...set];
}

function num(v: unknown): number | null {
  if (isEmpty(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).trim();
  if (!FLOAT_RE.test(t)) return null; // rejects "0x10", "1,200", "$5", "Infinity"
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const OP_LABEL: Record<string, string> = {
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  eq: "equal to",
  neq: "not equal to",
};

/** Execute every enabled rule. Row numbers are 1-based data rows (header excluded). */
export function validate(
  rows: Row[],
  rules: Rule[],
  ctx: { previousCount?: number | null } = {},
): Violation[] {
  const out: Violation[] = [];
  const cols = new Set(columnsOf(rows));
  for (const prepared of prepareRules(rules).filter((x) => x.original.is_enabled)) {
    if (!prepared.rule) {
      // never let an unrecognised rule pass silently: surface it as a dataset-level violation
      out.push({
        rule_id: prepared.original.id,
        rule_name: prepared.original.rule_name,
        severity: prepared.original.severity,
        row_number: null,
        column_name: prepared.original.column_name ?? "",
        error_type: "unsupported_rule",
        error_message: `Rule "${prepared.original.rule_name}" was NOT executed: ${prepared.error ?? "unsupported rule type"}`,
      });
      continue;
    }
    const rule = prepared.rule;
    const p = rule.parameters ?? {};
    const col = rule.column_name ?? "";
    const base = { rule_id: rule.id, rule_name: rule.rule_name, severity: rule.severity };
    const columnMissing = rule.rule_type !== "required_columns" && rule.rule_type !== "duplicate" && rule.rule_type !== "record_count" && col && !cols.has(col) && rows.length > 0;
    if (columnMissing) {
      out.push({
        ...base,
        row_number: null,
        column_name: col,
        error_type: "schema_change",
        error_message: `Column "${col}" referenced by rule "${rule.rule_name}" is missing from the dataset.`,
      });
      continue;
    }
    switch (rule.rule_type) {
      case "required_columns": {
        const req = p.columns ?? [];
        for (const c of req)
          if (!cols.has(c))
            out.push({ ...base, row_number: null, column_name: c, error_type: "schema_change", error_message: `Required column "${c}" is missing.` });
        if (p.allowExtraColumns === false)
          for (const c of cols)
            if (!req.includes(c))
              out.push({ ...base, row_number: null, column_name: c, error_type: "schema_change", error_message: `Unexpected column "${c}" found (not in expected schema).` });
        break;
      }
      case "record_count": {
        const n = rows.length;
        if (p.min != null && n < p.min)
          out.push({ ...base, row_number: null, column_name: null, error_type: "record_count", error_message: `Record count ${n} is below the minimum of ${p.min}.` });
        if (p.max != null && n > p.max)
          out.push({ ...base, row_number: null, column_name: null, error_type: "record_count", error_message: `Record count ${n} exceeds the maximum of ${p.max}.` });
        if (p.maxChangePct != null && ctx.previousCount) {
          const pct = (Math.abs(n - ctx.previousCount) / ctx.previousCount) * 100;
          if (pct > p.maxChangePct)
            out.push({ ...base, row_number: null, column_name: null, error_type: "record_count", error_message: `Record count changed ${pct.toFixed(1)}% vs previous run (${ctx.previousCount} → ${n}); limit is ${p.maxChangePct}%.` });
        }
        break;
      }
      case "duplicate": {
        const keyCols = p.columns && p.columns.length ? p.columns : null;
        const seen = new Map<string, number>();
        const norm = (x: unknown) => (p.caseInsensitive ? String(x ?? "").trim().toLowerCase() : String(x ?? "").trim());
        rows.forEach((r, i) => {
          // ignoreEmpty: a row whose key columns are all blank can't be a "duplicate" (not_null reports blanks)
          if (keyCols && p.ignoreEmpty && keyCols.every((c) => isEmpty(r[c]))) return;
          const key = keyCols ? JSON.stringify(keyCols.map((c) => norm(r[c]))) : JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));
          const first = seen.get(key);
          if (first !== undefined)
            out.push({
              ...base,
              row_number: i + 1,
              column_name: keyCols ? keyCols.join(", ") : null,
              error_type: "duplicate",
              error_message: keyCols
                ? `Duplicate key (${keyCols.map((c) => `${c}=${r[c]}`).join(", ")}) — first seen at row ${first}.`
                : `Exact duplicate of row ${first}.`,
            });
          else seen.set(key, i + 1);
        });
        break;
      }
      default:
        rows.forEach((r, i) => {
          const v = r[col];
          const msg = rowCheck(rule, v);
          if (msg) out.push({ ...base, row_number: i + 1, column_name: col, error_type: msg.type, error_message: msg.text, fixable: msg.fixable });
        });
    }
  }
  return out;
}

function rowCheck(rule: Rule, v: unknown): { type: string; text: string; fixable?: boolean } | null {
  const p = rule.parameters ?? {};
  const col = rule.column_name;
  switch (rule.rule_type) {
    case "not_null": {
      const empty = v === null || v === undefined || (p.treatEmptyAsNull !== false && typeof v === "string" && v.trim() === "");
      if (!empty) return null;
      const hasFill = p.fillValue !== undefined && p.fillValue !== null && p.fillValue !== "";
      return {
        type: v === null || v === undefined ? "null_violation" : "missing_value",
        text: hasFill ? `"${col}" is empty — filled with "${p.fillValue}" during cleaning.` : `"${col}" is required but is empty.`,
        fixable: hasFill,
      };
    }
    case "data_type":
      if (p.type === "date" && p.format === "YYYY-MM-DD" && !isEmpty(v) && !isIsoDateOnly(String(v).trim()))
        return { type: "type_mismatch", text: `"${col}" value "${String(v)}" is not a valid date in YYYY-MM-DD format.` };
      if (p.type && !matchesType(v, p.type)) return { type: "type_mismatch", text: `"${col}" value "${String(v)}" is not a valid ${p.type}.` };
      return null;
    case "range": {
      if (isEmpty(v)) return null;
      const n = num(v);
      if (n === null) return { type: "type_mismatch", text: `"${col}" value "${String(v)}" is not numeric, so its range cannot be checked.` };
      if (p.min != null && n < p.min) return { type: "invalid_range", text: `"${col}" = ${n} is below the minimum of ${p.min}.` };
      if (p.max != null && n > p.max) return { type: "invalid_range", text: `"${col}" = ${n} is above the maximum of ${p.max}.` };
      return null;
    }
    case "allowed_values": {
      if (isEmpty(v)) return null; // blanks are reported by a not_null rule, not here
      const allowed = (p.values ?? []).map((x) => String(x).trim());
      const cs = p.caseSensitive === true;
      const fold = (x: string) => (cs ? x : x.toLowerCase());
      const got = String(v).trim();
      if (allowed.some((a) => fold(a) === fold(got))) return null;
      const shown = allowed.length > 8 ? `${allowed.slice(0, 8).join(", ")}, … (${allowed.length} values)` : allowed.join(", ");
      return { type: "invalid_value", text: `"${col}" value "${got}" is not one of the allowed values: ${shown || "(none configured)"}.` };
    }
    case "custom": {
      if (isEmpty(v)) return null;
      const op = p.operator ?? "gt";
      if (op === "email") return EMAIL_RE.test(String(v).trim()) ? null : { type: "custom", text: `"${col}" value "${String(v)}" is not a valid email address.` };
      if (op === "regex") {
        let re: RegExp;
        try {
          re = new RegExp(String(p.value ?? ""));
        } catch {
          return { type: "custom", text: `Rule pattern "${p.value}" is not a valid regular expression.` };
        }
        return re.test(String(v)) ? null : { type: "custom", text: `"${col}" value "${String(v)}" does not match pattern ${p.value}.` };
      }
      const n = num(v);
      const target = Number(p.value);
      if (n === null) return { type: "type_mismatch", text: `"${col}" value "${String(v)}" is not numeric.` };
      const ok = op === "gt" ? n > target : op === "gte" ? n >= target : op === "lt" ? n < target : op === "lte" ? n <= target : op === "eq" ? n === target : n !== target;
      return ok ? null : { type: "custom", text: `"${col}" = ${n} must be ${OP_LABEL[op]} ${target}.` };
    }
  }
  return null;
}

/**
 * Which enabled rules can actually run against these rows? A column-bound rule whose
 * column is absent cannot execute (validate() reports it as a schema_change instead).
 * When `executable` is 0 the data was NOT evaluated — callers must not report 100% quality.
 */
export function ruleCoverage(rows: Row[], rules: Rule[]): { enabled: number; executable: number; skipped: Rule[]; unsupported: Rule[] } {
  const cols = new Set(columnsOf(rows));
  const enabled = prepareRules(rules).filter((x) => x.original.is_enabled);
  const datasetLevel = new Set(["required_columns", "duplicate", "record_count"]);
  const unsupported = enabled.filter((x) => !x.rule).map((x) => x.original);
  const skipped = enabled.filter((x) => x.rule && !datasetLevel.has(x.rule.rule_type) && !!x.rule.column_name && !cols.has(x.rule.column_name) && rows.length > 0).map((x) => x.original);
  return { enabled: enabled.length, executable: enabled.length - skipped.length - unsupported.length, skipped, unsupported };
}

const SEV_RANK: Record<Severity, number> = { warning: 1, error: 2, critical: 3 };
export function maxSeverity(list: { severity: Severity }[]): Severity {
  return list.reduce<Severity>((m, v) => (SEV_RANK[v.severity] > SEV_RANK[m] ? v.severity : m), "warning");
}

export interface SplitResult {
  accepted: { row_number: number; record: Row }[];
  rejected: { row_number: number; record: Row; reasons: Violation[]; max_severity: Severity }[];
}

/** Separate rows: any blocking violation (critical/error, or warning if configured) rejects the row. All violations are preserved. */
export function split(rows: Row[], violations: Violation[], opts: ProcessingOptions): SplitResult {
  const byRow = new Map<number, Violation[]>();
  for (const v of violations) if (v.row_number != null) byRow.set(v.row_number, [...(byRow.get(v.row_number) ?? []), v]);
  const res: SplitResult = { accepted: [], rejected: [] };
  rows.forEach((record, i) => {
    const rn = i + 1;
    const list = byRow.get(rn) ?? [];
    const blocking = list.filter((v) => !v.fixable && (v.severity !== "warning" || opts.rejectOnWarning));
    if (blocking.length) res.rejected.push({ row_number: rn, record, reasons: list, max_severity: maxSeverity(list) });
    else res.accepted.push({ row_number: rn, record });
  });
  return res;
}

/** Cleaning returns new objects; originals are never mutated. */
export function clean(rows: { row_number: number; record: Row }[], rules: Rule[], opts: ProcessingOptions) {
  const fills = prepareRules(rules).flatMap((x) => (x.rule ? [x.rule] : [])).filter((r) => r.is_enabled && r.rule_type === "not_null" && r.column_name && r.parameters?.fillValue);
  let changes = 0;
  const out = rows.map(({ row_number, record }) => {
    const next: Row = {};
    for (const [k, v] of Object.entries(record)) {
      let nv = v;
      if (opts.trimWhitespace && typeof nv === "string" && nv !== nv.trim()) nv = nv.trim();
      if (opts.lowercaseEmails && typeof nv === "string" && /email/i.test(k) && nv !== nv.toLowerCase()) nv = nv.toLowerCase();
      if (nv !== v) changes++;
      next[k] = nv;
    }
    for (const f of fills) {
      const c = f.column_name!;
      if (isEmpty(next[c])) {
        next[c] = f.parameters.fillValue;
        changes++;
      }
    }
    return { row_number, record: next };
  });
  return { rows: out, changes };
}

export interface Reconciliation {
  source: number;
  accepted: number;
  rejected: number;
  loaded: number;
  loadFailures: number;
  sourceDiff: number;
  loadDiff: number;
  status: "matched" | "mismatch";
}

export function reconcile(source: number, accepted: number, rejected: number, loaded: number, loadFailures: number): Reconciliation {
  const sourceDiff = source - (accepted + rejected);
  const loadDiff = accepted - (loaded + loadFailures);
  return { source, accepted, rejected, loaded, loadFailures, sourceDiff, loadDiff, status: sourceDiff === 0 && loadDiff === 0 ? "matched" : "mismatch" };
}

/** Turn arbitrary JSON into flat rows. Finds the first array if given an object. */
export function jsonToRows(json: unknown): Row[] {
  let arr: unknown = json;
  if (!Array.isArray(arr) && arr && typeof arr === "object") {
    const firstArr = Object.values(arr as object).find(Array.isArray);
    arr = firstArr ?? [arr];
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => flatten(item && typeof item === "object" ? (item as Row) : { value: item }));
}

function flatten(obj: Row, prefix = "", out: Row = {}): Row {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Row, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

export function qualityPct(accepted: number, source: number) {
  return source === 0 ? 0 : (accepted / source) * 100;
}
