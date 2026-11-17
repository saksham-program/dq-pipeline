-- Workspace lifecycle: scoped rule deletion, workspace reset, and launch tracking for "Fresh Demo Workspace".
-- Additive and idempotent. Creates one small table and three functions; no existing table or data is modified.
-- The functions NEVER touch public.app_settings, the schema, or migrations.

-- 1. Workspace state: which application launch last initialised the workspace, and whether the user has
--    confirmed that automatic fresh starts may delete the data in this database.
--    (Kept out of app_settings on purpose: saving Settings rewrites that whole JSON document.)
CREATE TABLE IF NOT EXISTS public.workspace_state (
  id                   integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_launch_id       text,
  auto_reset_confirmed boolean NOT NULL DEFAULT false,
  last_reset_at        timestamptz,
  last_reset_summary   jsonb
);
--> statement-breakpoint

INSERT INTO public.workspace_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

ALTER TABLE public.workspace_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_state' AND policyname = 'single-user workspace access') THEN
    CREATE POLICY "single-user workspace access" ON public.workspace_state FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END
$policy$;
--> statement-breakpoint

-- 2. Delete validation rules — only rules, never datasets, runs or history.
--    p_scope = 'dataset' (requires p_dataset_id) or 'all'. Returns the number of rules deleted.
CREATE OR REPLACE FUNCTION public.delete_validation_rules(p_scope text, p_dataset_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_scope = 'dataset' THEN
    IF p_dataset_id IS NULL THEN
      RAISE EXCEPTION 'A dataset id is required when scope is "dataset".';
    END IF;
    DELETE FROM public.validation_rules WHERE dataset_id = p_dataset_id;
  ELSIF p_scope = 'all' THEN
    IF p_dataset_id IS NOT NULL THEN
      RAISE EXCEPTION 'Do not pass a dataset id when scope is "all".';
    END IF;
    DELETE FROM public.validation_rules WHERE id IS NOT NULL;
  ELSE
    RAISE EXCEPTION 'Unknown scope "%": use "dataset" or "all".', p_scope;
  END IF;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
--> statement-breakpoint

-- 3. Reset the workspace in foreign-key order, in ONE transaction (any error rolls everything back).
--    p_scope = 'all'     → every dataset, rule, run, log, result and accepted/rejected record
--    p_scope = 'samples' → only built-in sample data (datasets/runs flagged is_sample)
--    p_confirm must be the literal text RESET so the function cannot be fired by accident.
--    Preserves app_settings, workspace_state (except bookkeeping), the schema and all migrations.
CREATE OR REPLACE FUNCTION public.reset_workspace(p_scope text, p_confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n_acc integer := 0; n_rej integer := 0; n_log integer := 0; n_res integer := 0;
  n_runs integer := 0; n_rules integer := 0; n_ds integer := 0;
  v_summary jsonb;
BEGIN
  IF p_confirm IS DISTINCT FROM 'RESET' THEN
    RAISE EXCEPTION 'Reset refused: confirmation text must be RESET.';
  END IF;
  IF p_scope NOT IN ('all', 'samples') THEN
    RAISE EXCEPTION 'Unknown scope "%": use "all" or "samples".', p_scope;
  END IF;
  IF EXISTS (SELECT 1 FROM public.pipeline_runs WHERE status = 'running') THEN
    RAISE EXCEPTION 'Reset refused: a pipeline run is still in progress.';
  END IF;

  IF p_scope = 'all' THEN
    DELETE FROM public.accepted_records    WHERE run_id IS NOT NULL;  GET DIAGNOSTICS n_acc  = ROW_COUNT;
    DELETE FROM public.rejected_records    WHERE run_id IS NOT NULL;  GET DIAGNOSTICS n_rej  = ROW_COUNT;
    DELETE FROM public.pipeline_logs       WHERE run_id IS NOT NULL;  GET DIAGNOSTICS n_log  = ROW_COUNT;
    DELETE FROM public.validation_results  WHERE run_id IS NOT NULL;  GET DIAGNOSTICS n_res  = ROW_COUNT;
    DELETE FROM public.pipeline_runs       WHERE run_id IS NOT NULL;  GET DIAGNOSTICS n_runs = ROW_COUNT;
    DELETE FROM public.validation_rules    WHERE id IS NOT NULL;      GET DIAGNOSTICS n_rules = ROW_COUNT;
    DELETE FROM public.datasets            WHERE id IS NOT NULL;      GET DIAGNOSTICS n_ds   = ROW_COUNT;
  ELSE
    DELETE FROM public.accepted_records   WHERE run_id IN (SELECT run_id FROM public.pipeline_runs WHERE is_sample);  GET DIAGNOSTICS n_acc = ROW_COUNT;
    DELETE FROM public.rejected_records   WHERE run_id IN (SELECT run_id FROM public.pipeline_runs WHERE is_sample);  GET DIAGNOSTICS n_rej = ROW_COUNT;
    DELETE FROM public.pipeline_logs      WHERE run_id IN (SELECT run_id FROM public.pipeline_runs WHERE is_sample);  GET DIAGNOSTICS n_log = ROW_COUNT;
    DELETE FROM public.validation_results WHERE run_id IN (SELECT run_id FROM public.pipeline_runs WHERE is_sample);  GET DIAGNOSTICS n_res = ROW_COUNT;
    DELETE FROM public.pipeline_runs      WHERE is_sample;                                                            GET DIAGNOSTICS n_runs = ROW_COUNT;
    SELECT count(*) INTO n_rules FROM public.validation_rules WHERE dataset_id IN (SELECT id FROM public.datasets WHERE is_sample);
    DELETE FROM public.datasets           WHERE is_sample;                                                            GET DIAGNOSTICS n_ds = ROW_COUNT; -- rules cascade
  END IF;

  v_summary := jsonb_build_object('scope', p_scope, 'datasets', n_ds, 'rules', n_rules, 'runs', n_runs,
                                  'results', n_res, 'logs', n_log, 'accepted_records', n_acc, 'rejected_records', n_rej);
  INSERT INTO public.workspace_state (id, last_reset_at, last_reset_summary) VALUES (1, now(), v_summary)
  ON CONFLICT (id) DO UPDATE SET last_reset_at = now(), last_reset_summary = v_summary;
  RETURN v_summary;
END;
$$;
--> statement-breakpoint

-- 4. Claim an application launch. Returns true for exactly ONE caller per distinct launch id
--    (a single UPDATE takes the row lock, so two browser tabs cannot both win).
--    A browser refresh or hot reload sends the same launch id → false → nothing is reset.
CREATE OR REPLACE FUNCTION public.begin_workspace_launch(p_launch_id text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_launch_id IS NULL OR btrim(p_launch_id) = '' THEN
    RAISE EXCEPTION 'A launch id is required.';
  END IF;
  INSERT INTO public.workspace_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  UPDATE public.workspace_state SET last_launch_id = p_launch_id
   WHERE id = 1 AND last_launch_id IS DISTINCT FROM p_launch_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.delete_validation_rules(text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reset_workspace(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.begin_workspace_launch(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.delete_validation_rules(text, uuid) TO anon, authenticated, service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.reset_workspace(text, text) TO anon, authenticated, service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.begin_workspace_launch(text) TO anon, authenticated, service_role;
