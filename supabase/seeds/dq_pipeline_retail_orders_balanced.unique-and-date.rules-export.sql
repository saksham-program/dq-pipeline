-- DQ Pipeline validation rules — exported 2026-11-17T01:54:23.014Z
-- Dataset: dq_pipeline_retail_orders_balanced · 2 rule(s)
-- Idempotent: existing identical rules are skipped. Requires migration 0001_bulk_validation_rules.sql.
SELECT public.bulk_insert_validation_rules(
  (SELECT id FROM public.datasets WHERE name = 'dq_pipeline_retail_orders_balanced' ORDER BY created_at LIMIT 1),
  $dq_rules$[
  {
    "rule_name": "Order ID must be unique",
    "column_name": null,
    "rule_type": "duplicate",
    "parameters": {
      "columns": [
        "order_id"
      ],
      "ignoreEmpty": true
    },
    "severity": "error",
    "is_enabled": true
  },
  {
    "rule_name": "Order date must be valid",
    "column_name": "order_date",
    "rule_type": "data_type",
    "parameters": {
      "type": "date",
      "format": "YYYY-MM-DD"
    },
    "severity": "error",
    "is_enabled": true
  }
]$dq_rules$::jsonb,
  true
);
