CREATE OR REPLACE FUNCTION public.reset_demo_workspace()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pipeline_runs WHERE status = 'running' AND started_at > now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'A pipeline is running; workspace not reset';
  END IF;
  DELETE FROM public.accepted_records WHERE run_id IS NOT NULL;
  DELETE FROM public.rejected_records WHERE run_id IS NOT NULL;
  DELETE FROM public.pipeline_logs WHERE run_id IS NOT NULL;
  DELETE FROM public.validation_results WHERE run_id IS NOT NULL;
  DELETE FROM public.pipeline_runs WHERE run_id IS NOT NULL;
  DELETE FROM public.validation_rules WHERE id IS NOT NULL;
  DELETE FROM public.datasets WHERE id IS NOT NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_demo_workspace() TO anon, authenticated, service_role;