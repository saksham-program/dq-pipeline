import { planBulkInsert, type RuleDraft } from "./rule-templates";
import type { Rule } from "./types";

/** The slice of the Supabase client the bulk save needs (lets tests pass an in-memory fake). */
export interface RulesClient {
  from(table: "validation_rules"): {
    select(columns: string): { eq(column: string, value: string): PromiseLike<{ data: unknown; error: { message: string } | null }> };
    insert(rows: unknown[]): PromiseLike<{ error: { message: string } | null }>;
  };
  rpc(fn: "bulk_insert_validation_rules", args: { p_dataset_id: string; p_rules: unknown; p_strict_columns: boolean }): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface BulkInsertResult {
  inserted: number;
  /** Skipped because an identical rule already existed (client pre-check + database unique index). */
  skipped: number;
  /** "rpc" = one database transaction via bulk_insert_validation_rules; "insert" = migration not applied, one atomic INSERT. */
  mode: "rpc" | "insert";
}

/** Friendly message for the unique-rule index (a rule with the same dataset/type/column/parameters exists). */
export function ruleErrorMessage(message: string): string {
  return /validation_rules_dataset_fingerprint_key|duplicate key/i.test(message) ? "An identical rule already exists for this dataset." : message;
}

/** The exact JSON objects sent as the function's p_rules argument — property names match the SQL function. */
export const toRulePayload = (d: RuleDraft) => ({ rule_name: d.rule_name.trim(), column_name: d.column_name, rule_type: d.rule_type, parameters: d.parameters, severity: d.severity, is_enabled: d.is_enabled });

/**
 * Save many rules for one dataset atomically — all new rules are stored or none are.
 * Primary path: the bulk_insert_validation_rules database function (whitelist validation, unique
 * fingerprint index, one transaction). If that migration is not applied, falls back to ONE multi-row
 * INSERT (also atomic) after de-duplicating against the stored rules. No user-entered text is executed
 * as SQL; values travel as bound JSON parameters.
 */
export async function persistRules(client: RulesClient, datasetId: string, drafts: RuleDraft[]): Promise<BulkInsertResult> {
  if (!drafts.length) return { inserted: 0, skipped: 0, mode: "rpc" };
  const ex = await client.from("validation_rules").select("rule_type,column_name,parameters").eq("dataset_id", datasetId);
  if (ex.error) throw new Error(ex.error.message);
  const existing = ((ex.data ?? []) as { rule_type: string; column_name: string | null; parameters: unknown }[]).map((e) => ({ rule_type: e.rule_type as Rule["rule_type"], column_name: e.column_name, parameters: (e.parameters ?? {}) as Rule["parameters"] }));
  const plan = planBulkInsert(existing, drafts);
  if (!plan.toInsert.length) return { inserted: 0, skipped: plan.duplicates.length, mode: "rpc" };
  const payload = plan.toInsert.map(toRulePayload);

  const rpc = await client.rpc("bulk_insert_validation_rules", { p_dataset_id: datasetId, p_rules: payload, p_strict_columns: true });
  if (!rpc.error) {
    const r = (rpc.data ?? {}) as { inserted?: number; skipped?: number };
    return { inserted: r.inserted ?? 0, skipped: (r.skipped ?? 0) + plan.duplicates.length, mode: "rpc" };
  }
  const missing = rpc.error.code === "PGRST202" || (/could not find the function|does not exist/i.test(rpc.error.message) && /bulk_insert_validation_rules/i.test(rpc.error.message));
  if (!missing) throw new Error(ruleErrorMessage(rpc.error.message));

  const ins = await client.from("validation_rules").insert(payload.map((d) => ({ ...d, dataset_id: datasetId })));
  if (ins.error) throw new Error(ruleErrorMessage(ins.error.message));
  return { inserted: plan.toInsert.length, skipped: plan.duplicates.length, mode: "insert" };
}
