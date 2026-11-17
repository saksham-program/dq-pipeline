import type { Rule, RuleParams, RuleType } from "./types";

/**
 * Rule-type conventions used everywhere (engine, importer, exporter, editor, database function):
 *
 *   canonical types  — what is STORED and what the engine executes:
 *     not_null · duplicate · range · custom · data_type · allowed_values · required_columns · record_count
 *   aliases          — the names of the UI templates, accepted on input and normalised to a canonical type:
 *     required         → not_null
 *     unique           → duplicate   { columns: [column], ignoreEmpty: true }   (column_name is stored as null)
 *     duplicate_record → duplicate   { columns: [...] | whole row }
 *     numeric_range    → range
 *     positive         → custom      { operator: gt, value: 0 }
 *     email            → custom      { operator: email }
 *     date             → data_type   { type: date [, format: "YYYY-MM-DD"] }
 *
 * The engine normalises every rule before running it, so a stored alias still executes; an unrecognised
 * type is reported as a violation and counted as NOT executed — it never silently passes.
 */
export const CANONICAL_RULE_TYPES: RuleType[] = ["required_columns", "data_type", "not_null", "duplicate", "range", "custom", "record_count", "allowed_values"];
export const RULE_TYPE_ALIASES = ["required", "unique", "duplicate_record", "numeric_range", "positive", "email", "date"] as const;
export type RuleTypeAlias = (typeof RULE_TYPE_ALIASES)[number];

export const KNOWN_PARAM_KEYS: (keyof RuleParams)[] = ["columns", "allowExtraColumns", "type", "format", "treatEmptyAsNull", "fillValue", "min", "max", "operator", "value", "maxChangePct", "values", "caseSensitive", "ignoreEmpty", "caseInsensitive"];

export const DATE_FORMATS = ["YYYY-MM-DD"] as const;

/** Keep only known parameter keys; report the rest instead of dropping them silently. */
export function pickParams(raw: unknown): { params: RuleParams; dropped: string[] } {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const params: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(src)) {
    if ((KNOWN_PARAM_KEYS as string[]).includes(k)) {
      if (v !== undefined) params[k] = v;
    } else dropped.push(k);
  }
  return { params: params as RuleParams, dropped };
}

export interface RuleShape {
  rule_type: string;
  column_name: string | null;
  parameters: unknown;
}
export interface Canonicalized {
  /** null when the type is not supported (see error). */
  rule: { rule_type: RuleType; column_name: string | null; parameters: RuleParams } | null;
  /** the alias that was normalised, if any */
  aliasOf?: string;
  /** human-readable notes: normalisations applied, parameters ignored */
  notes: string[];
  error?: string;
}

const cols = (p: RuleParams, column: string | null): string[] => (Array.isArray(p.columns) && p.columns.length ? p.columns.map(String) : column ? [column] : []);

/** Normalise a rule (canonical or alias) to the shape the engine executes and the database stores. */
export function canonicalizeRuleShape(input: RuleShape): Canonicalized {
  const type = String(input.rule_type ?? "").trim().toLowerCase();
  const column = input.column_name && String(input.column_name).trim() ? String(input.column_name).trim() : null;
  const { params, dropped } = pickParams(input.parameters);
  const notes: string[] = dropped.length ? [`Ignored unsupported parameter(s): ${dropped.join(", ")}.`] : [];
  const needCol = (what: string): string | null => (column ? null : `A column is required for "${what}".`);
  const fail = (error: string): Canonicalized => ({ rule: null, notes, error });
  const done = (rule_type: RuleType, column_name: string | null, parameters: RuleParams, alias?: string, note?: string): Canonicalized => ({ rule: { rule_type, column_name, parameters }, notes: note ? [...notes, note] : notes, ...(alias ? { aliasOf: alias } : {}) });

  if ((CANONICAL_RULE_TYPES as string[]).includes(type)) return { rule: { rule_type: type as RuleType, column_name: column, parameters: params }, notes };

  switch (type) {
    case "required": {
      const e = needCol("required");
      return e ? fail(e) : done("not_null", column, { ...params, treatEmptyAsNull: params.treatEmptyAsNull ?? true }, type, `"required" is stored as "not_null".`);
    }
    case "unique": {
      const c = cols(params, column);
      if (!c.length) return fail('A column is required for "unique".');
      const { columns: _c, ...rest } = params;
      return done("duplicate", null, { ...rest, columns: c, ignoreEmpty: params.ignoreEmpty ?? true }, type, `"unique" is stored as "duplicate" on ${c.join(" + ")} (blank values are ${params.ignoreEmpty === false ? "counted" : "ignored — use a Required rule for blanks"}).`);
    }
    case "duplicate_record": {
      const c = cols(params, column);
      const { columns: _c, ...rest } = params;
      return done("duplicate", null, { ...rest, columns: c }, type, `"duplicate_record" is stored as "duplicate" on ${c.length ? c.join(" + ") : "the whole row"}.`);
    }
    case "numeric_range": {
      const e = needCol("numeric_range");
      return e ? fail(e) : done("range", column, { min: params.min ?? null, max: params.max ?? null }, type, `"numeric_range" is stored as "range".`);
    }
    case "positive": {
      const e = needCol("positive");
      return e ? fail(e) : done("custom", column, { operator: "gt", value: 0 }, type, `"positive" is stored as a custom rule: value > 0.`);
    }
    case "email": {
      const e = needCol("email");
      return e ? fail(e) : done("custom", column, { operator: "email", value: null }, type, `"email" is stored as a custom email-format rule.`);
    }
    case "date": {
      const e = needCol("date");
      if (e) return fail(e);
      const supported = params.format !== undefined && (DATE_FORMATS as readonly string[]).includes(String(params.format));
      const out = done("data_type", column, { type: "date", ...(supported ? { format: params.format as string } : {}) }, type, `"date" is stored as "data_type" = date.`);
      return params.format !== undefined && !supported ? { ...out, notes: [...out.notes, `Unsupported date format "${String(params.format)}" (supported: ${DATE_FORMATS.join(", ")}); any real calendar date is accepted instead.`] } : out;
    }
  }
  return fail(`Unsupported rule type "${input.rule_type}". Supported types: ${CANONICAL_RULE_TYPES.join(", ")}. Also accepted: ${RULE_TYPE_ALIASES.join(", ")}.`);
}

export interface PreparedRule {
  /** the rule in canonical form, ready to execute; null if its type is unsupported */
  rule: Rule | null;
  original: Rule;
  error?: string;
}

/** Canonicalise stored rules for execution. Rules with unsupported types come back with rule = null. */
export function prepareRules(rules: Rule[]): PreparedRule[] {
  return rules.map((original) => {
    const c = canonicalizeRuleShape({ rule_type: original.rule_type, column_name: original.column_name, parameters: original.parameters });
    if (!c.rule) return { rule: null, original, ...(c.error ? { error: c.error } : {}) };
    // keep ALL original parameters for canonical types (only aliases are rebuilt) so existing rules behave exactly as before
    const isAlias = c.aliasOf !== undefined;
    return { original, rule: { ...original, rule_type: c.rule.rule_type, column_name: c.rule.column_name, parameters: isAlias ? c.rule.parameters : (original.parameters ?? {}) } };
  });
}
