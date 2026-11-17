-- DQ Pipeline validation rules — exported 2026-11-14T11:04:14.180Z
-- Dataset: dq_pipeline_demo_dataset · 11 rule(s)
-- Idempotent: existing identical rules are skipped. Requires migration 0001_bulk_validation_rules.sql.
SELECT public.bulk_insert_validation_rules(
  (SELECT id FROM public.datasets WHERE name = 'dq_pipeline_demo_dataset' ORDER BY created_at LIMIT 1),
  $dq_rules$[
  {
    "rule_name": "order_id — Required",
    "column_name": "order_id",
    "rule_type": "not_null",
    "parameters": {
      "treatEmptyAsNull": true
    },
    "severity": "error",
    "is_enabled": true
  },
  {
    "rule_name": "order_id — Unique",
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
    "rule_name": "email — Required",
    "column_name": "email",
    "rule_type": "not_null",
    "parameters": {
      "treatEmptyAsNull": true
    },
    "severity": "error",
    "is_enabled": true
  },
  {
    "rule_name": "email — Valid email format",
    "column_name": "email",
    "rule_type": "custom",
    "parameters": {
      "operator": "email",
      "value": null
    },
    "severity": "error",
    "is_enabled": true
  },
  {
    "rule_name": "age — Between 18 and 100",
    "column_name": "age",
    "rule_type": "range",
    "parameters": {
      "min": 18,
      "max": 100
    },
    "severity": "error",
    "is_enabled": true
  },
  {
    "rule_name": "order_amount — Greater than 0",
    "column_name": "order_amount",
    "rule_type": "custom",
    "parameters": {
      "operator": "gt",
      "value": 0
    },
    "severity": "error",
    "is_enabled": true
  },
  {
    "rule_name": "order_date — Valid date",
    "column_name": "order_date",
    "rule_type": "data_type",
    "parameters": {
      "type": "date"
    },
    "severity": "error",
    "is_enabled": true
  },
  {
    "rule_name": "payment_status — Allowed values: Paid, Pending, Delivered, Cancelled",
    "column_name": "payment_status",
    "rule_type": "allowed_values",
    "parameters": {
      "values": [
        "Paid",
        "Pending",
        "Delivered",
        "Cancelled"
      ],
      "caseSensitive": false
    },
    "severity": "error",
    "is_enabled": true
  },
  {
    "rule_name": "delivery_days — Between 0 and 30",
    "column_name": "delivery_days",
    "rule_type": "range",
    "parameters": {
      "min": 0,
      "max": 30
    },
    "severity": "error",
    "is_enabled": true
  },
  {
    "rule_name": "rating — Between 1 and 5",
    "column_name": "rating",
    "rule_type": "range",
    "parameters": {
      "min": 1,
      "max": 5
    },
    "severity": "error",
    "is_enabled": true
  },
  {
    "rule_name": "quantity — Greater than 0",
    "column_name": "quantity",
    "rule_type": "custom",
    "parameters": {
      "operator": "gt",
      "value": 0
    },
    "severity": "error",
    "is_enabled": true
  }
]$dq_rules$::jsonb,
  true
);
