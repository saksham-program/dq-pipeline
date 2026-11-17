/**
 * Run the REAL validation engine on a CSV and a rules export, outside the browser — no database needed.
 *
 *   bun run verify:dataset <data.csv> <rules.json | rules.sql>
 *
 * Prints what the pipeline would do: source/accepted/rejected counts, reconciliation, rule coverage,
 * violations per rule, and every rejected row with its reasons. Nothing is hardcoded: every number is
 * computed from the files you pass. Exit code 1 if reconciliation mismatches or a rule cannot run.
 */
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/lib/dq/csv";
import { inferSchema, qualityPct, reconcile, ruleCoverage, split, validate } from "../src/lib/dq/engine";
import { parseRulesAuto } from "../src/lib/dq/rule-io";
import { DEFAULT_OPTIONS, type Rule } from "../src/lib/dq/types";

const [csvPath, rulesPath] = process.argv.slice(2);
if (!csvPath || !rulesPath) {
  console.error("Usage: bun run verify:dataset <data.csv> <rules.json | rules.sql>");
  process.exit(2);
}

const { rows, errors: csvErrors, fields } = parseCsv(readFileSync(csvPath, "utf8"));
const parsed = parseRulesAuto(readFileSync(rulesPath, "utf8"));
if (parsed.errors.length) {
  console.error("Rules file problems:\n  " + parsed.errors.join("\n  "));
  if (!parsed.rules.length) process.exit(2);
}
const rules: Rule[] = parsed.rules.map((d, i) => ({ id: `rule-${i + 1}`, rule_name: d.rule_name, column_name: d.column_name, rule_type: d.rule_type, parameters: d.parameters, severity: d.severity, is_enabled: d.is_enabled }));

const cov = ruleCoverage(rows, rules);
const violations = validate(rows, rules);
const parts = split(rows, violations, DEFAULT_OPTIONS);
const rec = reconcile(rows.length, parts.accepted.length, parts.rejected.length, parts.accepted.length, 0);

console.log(`File           : ${csvPath}  (${fields.length} columns: ${fields.join(", ")})`);
if (csvErrors.length) console.log(`CSV warnings   : ${csvErrors.join(" | ")}`);
console.log(`Rules          : ${rulesPath}  → ${rules.length} rule(s), ${cov.executable} executable, ${cov.skipped.length} skipped (missing column), ${cov.unsupported.length} unsupported`);
for (const n of parsed.notes ?? []) console.log(`  note: ${n}`);
console.log(`Schema         : ${inferSchema(rows).map((c) => `${c.name}:${c.type}`).join("  ")}`);
console.log("");
console.log(`Source records : ${rows.length}`);
console.log(`Accepted       : ${parts.accepted.length}`);
console.log(`Rejected       : ${parts.rejected.length}`);
console.log(`Quality        : ${cov.executable === 0 ? "Not evaluated (no executable rules)" : `${qualityPct(parts.accepted.length, rows.length).toFixed(1)}%`}`);
console.log(`Reconciliation : ${rec.status.toUpperCase()}  (source − accepted − rejected = ${rec.sourceDiff})`);
console.log("");
console.log("Violations per rule:");
for (const r of rules) {
  const v = violations.filter((x) => x.rule_id === r.id);
  console.log(`  ${String(v.length).padStart(3)}  ${r.rule_name}  [${r.severity}${r.is_enabled ? "" : ", disabled"}]${v.length ? "  rows " + v.map((x) => x.row_number ?? "dataset").join(", ") : ""}`);
}
console.log("");
console.log("Rejected rows:");
for (const rej of parts.rejected) console.log(`  row ${String(rej.row_number).padStart(3)}: ${rej.reasons.map((x) => `${x.rule_name} — ${x.error_message}`).join("  ||  ")}`);
if (!parts.rejected.length) console.log("  (none)");
process.exit(rec.status === "matched" && cov.unsupported.length === 0 ? 0 : 1);
