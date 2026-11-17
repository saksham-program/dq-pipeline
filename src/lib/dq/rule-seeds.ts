import { buildDraft, type RuleDraft } from "./rule-templates";

/** Dataset the seed targets (matched by dataset name). */
export const ECOMMERCE_DATASET_NAME = "dq_pipeline_demo_dataset";

/**
 * Bulk seed for the e-commerce demonstration dataset. All rules are "error" severity because a
 * violation means the record is unusable and must be rejected. Mirrored verbatim in
 * supabase/seeds/seed_ecommerce_validation_rules.sql (a test keeps the two in sync).
 */
export function ecommerceSeedRules(): RuleDraft[] {
  const E = "error" as const;
  return [
    buildDraft("required", "order_id", E),
    buildDraft("unique", "order_id", E),
    buildDraft("required", "email", E),
    buildDraft("email", "email", E),
    buildDraft("numeric_range", "age", E, { min: 18, max: 100 }),
    buildDraft("positive", "order_amount", E),
    buildDraft("date", "order_date", E),
    buildDraft("allowed_values", "payment_status", E, { values: ["Paid", "Pending", "Delivered", "Cancelled"] }),
    buildDraft("numeric_range", "delivery_days", E, { min: 0, max: 30 }),
    buildDraft("numeric_range", "rating", E, { min: 1, max: 5 }),
    buildDraft("numeric_range", "quantity", E, { min: 1, max: 100 }),
  ].map(({ template: _t, reason: _r, ...rule }) => rule);
}

/**
 * The 11 rules of the importable export file `supabase/seeds/dq_pipeline_demo_dataset.rules-export.sql`
 * (and its .json twin). Names are the user-facing labels. Quantity is "greater than 0" here.
 */
export function ecommerceImportRules(): RuleDraft[] {
  const E = "error" as const;
  const named = (name: string, d: RuleDraft): RuleDraft => {
    const { template: _t, reason: _r, ...rule } = d;
    return { ...rule, rule_name: name };
  };
  return [
    named("order_id — Required", buildDraft("required", "order_id", E)),
    named("order_id — Unique", buildDraft("unique", "order_id", E)),
    named("email — Required", buildDraft("required", "email", E)),
    named("email — Valid email format", buildDraft("email", "email", E)),
    named("age — Between 18 and 100", buildDraft("numeric_range", "age", E, { min: 18, max: 100 })),
    named("order_amount — Greater than 0", buildDraft("positive", "order_amount", E)),
    named("order_date — Valid date", buildDraft("date", "order_date", E)),
    named("payment_status — Allowed values: Paid, Pending, Delivered, Cancelled", buildDraft("allowed_values", "payment_status", E, { values: ["Paid", "Pending", "Delivered", "Cancelled"] })),
    named("delivery_days — Between 0 and 30", buildDraft("numeric_range", "delivery_days", E, { min: 0, max: 30 })),
    named("rating — Between 1 and 5", buildDraft("numeric_range", "rating", E, { min: 1, max: 5 })),
    named("quantity — Greater than 0", buildDraft("positive", "quantity", E)),
  ];
}
