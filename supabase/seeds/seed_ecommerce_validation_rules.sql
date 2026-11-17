-- ============================================================================
-- Seed: validation rules for the e-commerce demonstration dataset
-- Dataset : dq_pipeline_demo_dataset
-- Rules   : 11 (all "error" severity — a violation rejects the record)
--
-- Prerequisite: run drizzle/migrations/0001_bulk_validation_rules.sql once.
-- Safe to re-run: identical rules that already exist are skipped (reported in the NOTICE).
-- Atomic: this DO block is a single transaction — if any rule is invalid (e.g. a column that is
-- not in the dataset schema) nothing is inserted. No DROP / TRUNCATE / DELETE is used.
-- ============================================================================
DO $seed$
DECLARE
  v_dataset_name constant text := 'dq_pipeline_demo_dataset';
  v_matches      integer;
  v_dataset_id   uuid;
  v_result       jsonb;
BEGIN
  SELECT count(*) INTO v_matches
    FROM public.datasets
   WHERE lower(name) = lower(v_dataset_name)
      OR lower(uploaded_filename) IN (lower(v_dataset_name), lower(v_dataset_name || '.csv'));

  IF v_matches = 0 THEN
    RAISE EXCEPTION 'Dataset "%" was not found. Upload it on the Sources page first (or edit v_dataset_name above).', v_dataset_name;
  ELSIF v_matches > 1 THEN
    RAISE EXCEPTION '% datasets match "%". Rename or delete the extras, or edit v_dataset_name to the exact name.', v_matches, v_dataset_name;
  END IF;

  SELECT id INTO v_dataset_id
    FROM public.datasets
   WHERE lower(name) = lower(v_dataset_name)
      OR lower(uploaded_filename) IN (lower(v_dataset_name), lower(v_dataset_name || '.csv'));

  v_result := public.bulk_insert_validation_rules(
    v_dataset_id,
    $json$
  [
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "order_id — Required",
      "column_name": "order_id",
      "rule_type": "not_null",
      "parameters": {
        "treatEmptyAsNull": true
      }
    },
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "order_id — Unique",
      "column_name": null,
      "rule_type": "duplicate",
      "parameters": {
        "columns": [
          "order_id"
        ],
        "ignoreEmpty": true
      }
    },
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "email — Required",
      "column_name": "email",
      "rule_type": "not_null",
      "parameters": {
        "treatEmptyAsNull": true
      }
    },
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "email — Email format",
      "column_name": "email",
      "rule_type": "custom",
      "parameters": {
        "operator": "email",
        "value": null
      }
    },
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "age — Range 18 to 100",
      "column_name": "age",
      "rule_type": "range",
      "parameters": {
        "min": 18,
        "max": 100
      }
    },
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "order_amount — Positive",
      "column_name": "order_amount",
      "rule_type": "custom",
      "parameters": {
        "operator": "gt",
        "value": 0
      }
    },
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "order_date — Valid date",
      "column_name": "order_date",
      "rule_type": "data_type",
      "parameters": {
        "type": "date"
      }
    },
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "payment_status — Allowed values",
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
      }
    },
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "delivery_days — Range 0 to 30",
      "column_name": "delivery_days",
      "rule_type": "range",
      "parameters": {
        "min": 0,
        "max": 30
      }
    },
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "rating — Range 1 to 5",
      "column_name": "rating",
      "rule_type": "range",
      "parameters": {
        "min": 1,
        "max": 5
      }
    },
    {
      "severity": "error",
      "is_enabled": true,
      "rule_name": "quantity — Range 1 to 100",
      "column_name": "quantity",
      "rule_type": "range",
      "parameters": {
        "min": 1,
        "max": 100
      }
    }
  ]
    $json$::jsonb,
    true  -- strict: every referenced column must exist in the dataset's schema
  );

  RAISE NOTICE 'Seed finished for dataset % — inserted: %, already existed (skipped): %',
    v_dataset_id, v_result ->> 'inserted', v_result ->> 'skipped';
END
$seed$;
