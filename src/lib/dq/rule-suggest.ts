import { isEmpty } from "./engine";
import { buildDraft, type RuleDraft, type TemplateId } from "./rule-templates";
import type { ColumnInfo, Row, Severity } from "./types";

export type Confidence = "high" | "medium" | "low";

export interface SuggestedRule extends RuleDraft {
  /** Stable identity inside one suggestion run: `${template}:${column}`. */
  key: string;
  template: TemplateId;
  reason: string;
  confidence: Confidence;
  /** The user must confirm or fill in values — never inferred as a business constraint. */
  needsReview: boolean;
}

const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const isIdLike = (n: string) => n === "id" || /(^|_)id$/.test(n) || /^id_/.test(n) || /(^|_)uuid$/.test(n);
const isEmailLike = (n: string) => /(^|_)e?_?mail($|_)/.test(n) || n.includes("email");
const isDateLikeName = (n: string) => /(^|_)(date|dt|dob|timestamp)($|_)/.test(n) || /_(at|on)$/.test(n);
const isCategoryName = (n: string) => /(^|_)(status|type|category|gender|method|tier|channel)$/.test(n);
const isPositiveName = (n: string) => /(amount|price|cost|total|salary|revenue|qty|quantity)/.test(n);

const MAX_CATEGORY_VALUES = 12;

interface Stats {
  nonEmpty: number;
  distinct: number;
  counts: Map<string, number>;
  min: number | null;
  max: number | null;
}

function stats(rows: Row[], col: string): Stats {
  const counts = new Map<string, number>();
  let nonEmpty = 0;
  let min: number | null = null;
  let max: number | null = null;
  for (const r of rows) {
    const v = r[col];
    if (isEmpty(v)) continue;
    nonEmpty++;
    const k = String(v).trim();
    counts.set(k, (counts.get(k) ?? 0) + 1);
    const n = Number(k);
    if (k !== "" && Number.isFinite(n)) {
      min = min === null ? n : Math.min(min, n);
      max = max === null ? n : Math.max(max, n);
    }
  }
  return { nonEmpty, distinct: counts.size, counts, min, max };
}

/**
 * Suggest rules from detected column types, column names and (when available) observed values.
 * Suggestions are inert drafts: they only become rules after the user selects and applies them.
 */
export function suggestRules(columns: ColumnInfo[], rows: Row[] = [], severity: Severity = "error"): SuggestedRule[] {
  const out: SuggestedRule[] = [];
  const haveRows = rows.length > 0;
  const add = (template: TemplateId, col: string | null, draft: RuleDraft, s: { reason: string; confidence: Confidence; needsReview?: boolean }) =>
    out.push({ ...draft, template, key: `${template}:${col ?? "*"}`, reason: s.reason, confidence: s.confidence, needsReview: s.needsReview ?? false });

  columns.forEach((c, idx) => {
    const n = norm(c.name);
    const st = haveRows ? stats(rows, c.name) : null;
    const numeric = c.type === "integer" || c.type === "float";

    if (isIdLike(n)) {
      add("required", c.name, buildDraft("required", c.name, severity), {
        reason: `"${c.name}" looks like an identifier${c.nullCount ? `; ${c.nullCount} empty value(s) detected` : "; no empty values detected"}. Identifiers are normally required.`,
        confidence: "high",
      });
      const dup = st ? st.nonEmpty - st.distinct : null;
      const likelyKey = n === "id" || idx === 0;
      add("unique", c.name, buildDraft("unique", c.name, severity), {
        reason:
          `ID-like columns are not always unique (e.g. a customer_id repeats across that customer's orders) — confirm that "${c.name}" identifies one record. ` +
          (dup === null ? "No sample data available to check." : dup > 0 ? `${dup} repeated value(s) currently exist and would be flagged.` : "All current values are distinct."),
        confidence: likelyKey ? "medium" : "low",
        needsReview: true,
      });
    }

    if (isEmailLike(n)) {
      add("required", c.name, buildDraft("required", c.name, severity), { reason: `"${c.name}" looks like an email address${c.nullCount ? `; ${c.nullCount} empty value(s) detected` : ""}.`, confidence: "high" });
      add("email", c.name, buildDraft("email", c.name, severity), { reason: `Column name suggests email addresses; checks format.`, confidence: "high" });
    }

    if (numeric) {
      add("data_type", c.name, buildDraft("data_type", c.name, severity, { type: c.type }), { reason: `Detected as ${c.type} (≥90% of values match).`, confidence: "high" });
      const observed = st && st.min !== null ? ` Observed values currently span ${st.min} to ${st.max} — those may include bad data, so limits are not pre-filled.` : "";
      add("numeric_range", c.name, buildDraft("numeric_range", c.name, severity), { reason: `Numeric column. Enter the minimum/maximum that is valid for your business.${observed}`, confidence: "medium", needsReview: true });
      if (isPositiveName(n)) add("positive", c.name, buildDraft("positive", c.name, severity), { reason: `"${c.name}" is usually greater than zero (name suggests an amount, price or quantity).`, confidence: "medium", needsReview: true });
    }

    if (c.type === "date" || isDateLikeName(n)) {
      add("date", c.name, buildDraft("date", c.name, severity), {
        reason: c.type === "date" ? `Detected as a date column.` : `Name suggests a date but values did not all parse as dates (detected: ${c.type}); validates each value.`,
        confidence: c.type === "date" ? "high" : "medium",
        needsReview: c.type !== "date",
      });
    }

    if (isCategoryName(n) && st && st.distinct >= 2 && st.distinct <= MAX_CATEGORY_VALUES) {
      const entries = [...st.counts.entries()].sort((a, b) => b[1] - a[1]);
      add("allowed_values", c.name, buildDraft("allowed_values", c.name, severity, { values: entries.map(([v]) => v) }), {
        reason: `Few distinct values observed: ${entries.map(([v, k]) => `${v} (${k})`).join(", ")}. The list is pre-filled from the data — remove any value that is actually invalid.`,
        confidence: "medium",
        needsReview: true,
      });
    }
  });

  if (haveRows) {
    const seen = new Set<string>();
    let exact = 0;
    for (const r of rows) {
      const k = JSON.stringify(Object.keys(r).sort().map((x) => [x, r[x]]));
      if (seen.has(k)) exact++;
      else seen.add(k);
    }
    if (exact > 0) add("duplicate_record", null, buildDraft("duplicate_record", null, severity), { reason: `${exact} exact duplicate row(s) found in the current data.`, confidence: "medium", needsReview: true });
  }
  return out.filter((r, i) => out.findIndex((o) => o.key === r.key) === i);
}
