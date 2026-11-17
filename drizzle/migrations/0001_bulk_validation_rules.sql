-- Bulk validation-rule management.
-- Additive and idempotent: no DROP / TRUNCATE / DELETE. Safe to run more than once.
-- Run in the Supabase SQL editor (or `drizzle-kit migrate`). Existing rules and run results are untouched.

-- 1. Identity of a rule = (dataset, type, column, parameters). Severity / name / enabled are cosmetic.
ALTER TABLE public.validation_rules ADD COLUMN IF NOT EXISTS rule_fingerprint text;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validation_rule_fingerprint(p_type text, p_column text, p_params jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(p_type || '|' || coalesce(p_column, '') || '|' || coalesce(p_params, '{}'::jsonb)::text)
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.set_validation_rule_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.rule_fingerprint := public.validation_rule_fingerprint(NEW.rule_type, NEW.column_name, NEW.parameters);
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER trg_validation_rules_fingerprint
  BEFORE INSERT OR UPDATE OF rule_type, column_name, parameters ON public.validation_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_validation_rule_fingerprint();
--> statement-breakpoint

-- 2. Backfill existing rows (only rows that have no fingerprint yet).
UPDATE public.validation_rules
   SET rule_fingerprint = public.validation_rule_fingerprint(rule_type, column_name, parameters)
 WHERE rule_fingerprint IS NULL;
--> statement-breakpoint

-- 3. Pre-existing exact duplicates are kept (nothing is deleted) but only the oldest keeps its fingerprint,
--    so the unique index below can be created. The extra copies stay enabled/disabled exactly as before.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY dataset_id, rule_fingerprint ORDER BY created_at, id) AS rn
    FROM public.validation_rules
   WHERE rule_fingerprint IS NOT NULL
)
UPDATE public.validation_rules v
   SET rule_fingerprint = NULL
  FROM ranked r
 WHERE v.id = r.id AND r.rn > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS validation_rules_dataset_fingerprint_key
  ON public.validation_rules (dataset_id, rule_fingerprint);
--> statement-breakpoint

-- 4. Bulk insert. One call = one transaction: any invalid rule raises and rolls back the whole batch.
--    Takes data as a jsonb parameter (never concatenated into SQL) and validates it against a whitelist.
--    SECURITY INVOKER: runs with the caller's privileges, so existing RLS policies still apply.
CREATE OR REPLACE FUNCTION public.bulk_insert_validation_rules(
  p_dataset_id uuid,
  p_rules jsonb,
  p_strict_columns boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_schema   jsonb;
  v_known    text[];
  r          jsonb;
  i          integer := 0;
  v_type     text;
  v_col      text;
  v_sev      text;
  v_name     text;
  v_params   jsonb;
  v_count    integer;
  v_inserted integer := 0;
  v_skipped  integer := 0;
BEGIN
  IF p_dataset_id IS NULL THEN
    RAISE EXCEPTION 'Dataset not found: the dataset id is null.';
  END IF;

  SELECT schema_metadata INTO v_schema FROM public.datasets WHERE id = p_dataset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dataset % does not exist.', p_dataset_id;
  END IF;

  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'array' THEN
    RAISE EXCEPTION 'p_rules must be a JSON array of rule objects.';
  END IF;
  IF jsonb_array_length(p_rules) > 500 THEN
    RAISE EXCEPTION 'At most 500 rules can be inserted per call.';
  END IF;

  SELECT coalesce(array_agg(t.e ->> 'name'), '{}'::text[])
    INTO v_known
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_schema) = 'array' THEN v_schema ELSE '[]'::jsonb END) AS t(e);

  FOR r IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
    i := i + 1;
    IF jsonb_typeof(r) <> 'object' THEN
      RAISE EXCEPTION 'Rule #%: must be a JSON object.', i;
    END IF;

    v_name   := btrim(coalesce(r ->> 'rule_name', ''));
    v_type   := r ->> 'rule_type';
    v_col    := nullif(btrim(coalesce(r ->> 'column_name', '')), '');
    v_sev    := coalesce(r ->> 'severity', 'error');
    v_params := coalesce(r -> 'parameters', '{}'::jsonb);

    IF v_name = '' THEN
      RAISE EXCEPTION 'Rule #%: rule_name is required.', i;
    END IF;
    IF v_type IS NULL OR v_type NOT IN ('required_columns','data_type','not_null','duplicate','range','custom','record_count','allowed_values') THEN
      RAISE EXCEPTION 'Rule #% (%): unsupported rule_type "%".', i, v_name, coalesce(v_type, '<null>');
    END IF;
    IF v_sev NOT IN ('critical','error','warning') THEN
      RAISE EXCEPTION 'Rule #% (%): severity must be critical, error or warning.', i, v_name;
    END IF;
    IF jsonb_typeof(v_params) <> 'object' THEN
      RAISE EXCEPTION 'Rule #% (%): parameters must be a JSON object.', i, v_name;
    END IF;
    IF v_type IN ('data_type','not_null','range','custom','allowed_values') AND v_col IS NULL THEN
      RAISE EXCEPTION 'Rule #% (%): a column is required for rule type %.', i, v_name, v_type;
    END IF;
    IF v_type = 'range' AND NOT (v_params ? 'min' AND jsonb_typeof(v_params -> 'min') = 'number'
                                 OR v_params ? 'max' AND jsonb_typeof(v_params -> 'max') = 'number') THEN
      RAISE EXCEPTION 'Rule #% (%): a numeric min and/or max is required.', i, v_name;
    END IF;
    IF v_type = 'allowed_values' AND (jsonb_typeof(v_params -> 'values') IS DISTINCT FROM 'array'
                                      OR jsonb_array_length(v_params -> 'values') = 0) THEN
      RAISE EXCEPTION 'Rule #% (%): a non-empty "values" array is required.', i, v_name;
    END IF;
    IF v_type = 'data_type' AND coalesce(v_params ->> 'type', '') NOT IN ('string','integer','float','date','boolean') THEN
      RAISE EXCEPTION 'Rule #% (%): parameters.type must be string, integer, float, date or boolean.', i, v_name;
    END IF;
    IF v_type = 'custom' AND coalesce(v_params ->> 'operator', 'gt') NOT IN ('gt','gte','lt','lte','eq','neq','email','regex') THEN
      RAISE EXCEPTION 'Rule #% (%): unsupported custom operator.', i, v_name;
    END IF;

    IF p_strict_columns THEN
      IF v_col IS NOT NULL AND NOT (v_col = ANY (v_known)) THEN
        RAISE EXCEPTION 'Rule #% (%): column "%" does not exist in the dataset schema.', i, v_name, v_col;
      END IF;
      IF v_type IN ('duplicate','required_columns') AND jsonb_typeof(v_params -> 'columns') = 'array' THEN
        IF EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_params -> 'columns') AS c(name)
           WHERE NOT (c.name = ANY (v_known))
        ) THEN
          RAISE EXCEPTION 'Rule #% (%): parameters.columns references a column that does not exist in the dataset schema.', i, v_name;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.validation_rules (dataset_id, rule_name, column_name, rule_type, parameters, severity, is_enabled)
    VALUES (p_dataset_id, v_name, v_col, v_type, v_params, v_sev, coalesce((r ->> 'is_enabled')::boolean, true))
    ON CONFLICT (dataset_id, rule_fingerprint) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 1 THEN v_inserted := v_inserted + 1; ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.bulk_insert_validation_rules(uuid, jsonb, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.bulk_insert_validation_rules(uuid, jsonb, boolean) TO anon, authenticated, service_role;
