CREATE TABLE public.datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('csv','api')),
  source_reference text,
  uploaded_filename text,
  api_method text,
  api_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_auth boolean NOT NULL DEFAULT false,
  schema_metadata jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  record_count integer NOT NULL DEFAULT 0,
  is_sample boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.validation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  rule_name text NOT NULL,
  column_name text,
  rule_type text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('critical','error','warning')),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.validation_rules(dataset_id);
CREATE TABLE public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL UNIQUE,
  dataset_id uuid REFERENCES public.datasets(id) ON DELETE SET NULL,
  dataset_name text NOT NULL,
  source_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  stages jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  source_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  loaded_count integer NOT NULL DEFAULT 0,
  load_failure_count integer NOT NULL DEFAULT 0,
  violation_count integer NOT NULL DEFAULT 0,
  reconciliation_status text,
  schema_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.pipeline_runs(dataset_id);
CREATE INDEX ON public.pipeline_runs(started_at DESC);
CREATE TABLE public.validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL REFERENCES public.pipeline_runs(run_id) ON DELETE CASCADE,
  row_number integer,
  column_name text,
  rule_id uuid,
  rule_name text,
  error_type text NOT NULL,
  severity text NOT NULL,
  error_message text NOT NULL,
  record_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.validation_results(run_id);
CREATE TABLE public.pipeline_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL REFERENCES public.pipeline_runs(run_id) ON DELETE CASCADE,
  stage text NOT NULL,
  log_level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  "timestamp" timestamptz NOT NULL DEFAULT clock_timestamp(),
  seq integer NOT NULL DEFAULT 0
);
CREATE INDEX ON public.pipeline_logs(run_id);
CREATE TABLE public.accepted_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL REFERENCES public.pipeline_runs(run_id) ON DELETE CASCADE,
  dataset_id uuid REFERENCES public.datasets(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  record_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, row_number)
);
CREATE INDEX ON public.accepted_records(dataset_id);
CREATE TABLE public.rejected_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL REFERENCES public.pipeline_runs(run_id) ON DELETE CASCADE,
  dataset_id uuid REFERENCES public.datasets(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  record_data jsonb NOT NULL,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_severity text NOT NULL DEFAULT 'error',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, row_number)
);
CREATE INDEX ON public.rejected_records(dataset_id);
CREATE TABLE public.app_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.app_settings (id, settings) VALUES (1, '{}'::jsonb);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['datasets','validation_rules','pipeline_runs','validation_results','pipeline_logs','accepted_records','rejected_records','app_settings'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "single-user workspace access" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;