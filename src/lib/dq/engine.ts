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
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$|^\d{1,2}\/\d{1,2}\/\d{4}$/;

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
      return DATE_RE.test(s) && !Number.isNaN(Date.parse(s.includes("/") ? s : s.replace(" ", "T")));
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
  const n = typeof v === "number" ? v : Number(String(v).trim());
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
  for (const rule of rules.filter((r) => r.is_enabled)) {
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
        rows.forEach((r, i) => {
          const key = keyCols ? JSON.stringify(keyCols.map((c) => String(r[c] ?? "").trim())) : JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));
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
  const fills = rules.filter((r) => r.is_enabled && r.rule_type === "not_null" && r.column_name && r.parameters?.fillValue);
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
