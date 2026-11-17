<<<<<<< HEAD
# DQ Pipeline — Automated Data Quality & Pipeline Observability Platform

DQ Pipeline is a web application for validating, monitoring, cleaning, tracking and publishing datasets. You bring a CSV file or a JSON API endpoint, define data-quality rules, run the pipeline, and inspect exactly which records were accepted or rejected — and why — with full run history, execution logs and downloadable reports.

## Objectives

- Make data-quality checks configurable and repeatable instead of ad hoc.
- Keep every pipeline run traceable: run ID, stage-by-stage status, logs, counts and reconciliation.
- Never lose the original data: source rows are stored untouched; cleaning only affects the accepted copy.
- Give teams a clear view of quality trends across datasets and sources.

## Key features

- **Dashboard** — quality scores, run outcomes and trends over a selectable date range.
- **Data Sources** — upload CSV files or register JSON API endpoints (GET/POST, custom headers), inspect inferred schemas and preview records.
- **Validation Rules** — configurable rules per dataset: `required_columns`, `data_type`, `not_null`, `duplicate`, `range`, `custom` (comparison operators, email, regex) and `record_count`, each with a severity of `critical`, `error` or `warning`.
- **Pipeline Runs** — five-stage execution (`ingest → validate → clean → load → publish`) with live stage status, per-run IDs and execution logs.
- **Data Explorer** — browse accepted and rejected records per run, with rejection reasons, and export them as CSV.
- **Run History** — search and filter past runs, compare two executions side by side, with the option to clear run output while keeping datasets and rules.
- **Reports** — quality analytics and CSV downloads (accepted records, rejected records, validation results, pipeline execution report).
- **Reconciliation** — source, accepted, rejected and loaded counts are reconciled for every run.
- **Settings** — theme (light / dark / system), default date range, default rule severity, cleaning options (trim whitespace, lower-case emails, reject on warnings), CSV upload limit, data retention, and optional demonstration data.

## Technology stack

| Area | Technology |
| --- | --- |
| Language | TypeScript |
| UI | React 19, Tailwind CSS 4, Radix UI primitives, shadcn/ui-style components, lucide-react icons |
| Framework & routing | TanStack Start, TanStack Router (file-based routing), TanStack Query |
| Charts | Recharts |
| Backend / persistence | Supabase (PostgreSQL) via `@supabase/supabase-js` |
| Schema / migrations | Drizzle ORM schema and `drizzle-kit` |
| CSV parsing | PapaParse |
| Validation of inputs | Zod |
| Build tooling | Vite, Nitro (server build) |
| Testing | Vitest, Testing Library, jsdom |
| Linting / formatting | ESLint, Prettier |

## Architecture

- **Pure TypeScript pipeline engine** — validation, cleaning and reconciliation live in `src/lib/dq/engine.ts` (unit-tested in `engine.test.ts`). Orchestration and persistence are in `src/lib/dq/runner.ts`, which writes run status, logs, results and records to Supabase.
- **Traceability** — original rows are stored unchanged in `datasets.raw_records`; accepted and rejected rows are stored per run.
- **API ingestion** — goes through the `fetchApiSource` server function (`src/lib/dq/api-fetch.functions.ts`), which avoids browser CORS limits, enforces a 15 s timeout and a 5 MB response cap, and blocks private-network addresses.
- **Single-user workspace** — there is no sign-in. Row-level security is enabled on every table with an open policy for `anon`/`authenticated`. Add authentication and tighten the policies before exposing the app to multiple users.
- **Theming** — light and dark themes are driven by CSS tokens in `src/styles.css`; the decorative waves (`src/components/dq/Waves.tsx`) are generated SVG coloured only by `--wave-*` tokens.
- **Server error handling** — `src/server.ts` wraps the SSR entry and renders a fallback page for unhandled server errors (error details are logged via `src/lib/error-capture.ts`); `src/routes/__root.tsx` provides the React error boundary and reports boundary errors through `src/lib/error-reporting.ts`.

## Folder structure

```
.
├── drizzle/                  # Drizzle schema and SQL migration(s)
│   ├── schema.ts
│   └── migrations/0000_migration.sql
├── public/                   # Favicons, app icons, web manifest, social preview image
├── src/
│   ├── components/
│   │   ├── dq/               # App shell, waves, run dialog, tables, shared widgets
│   │   └── ui/               # Reusable UI primitives
│   ├── integrations/supabase/# Supabase clients, auth middleware, generated types
│   ├── lib/
│   │   ├── dq/               # Engine, runner, CSV, analytics, hooks, types, samples
│   │   ├── app-state.tsx     # Theme and date-range state
│   │   ├── error-reporting.ts, error-capture.ts, error-page.ts
│   ├── routes/               # File-based routes (see "Application routes")
│   ├── test/                 # Vitest setup and routing test
│   ├── router.tsx, server.ts, start.ts, styles.css
├── supabase/config.toml      # Supabase project reference
├── drizzle.config.ts, vite.config.ts, vitest.config.ts, eslint.config.js
└── package.json
```

### Application routes

`/` Dashboard · `/sources` Data Sources · `/rules` Validation Rules · `/runs` Pipeline Runs · `/runs/:runId` Run detail · `/explorer` Data Explorer · `/history` Run History · `/reports` Reports · `/settings` Settings

## Prerequisites

- A current Node.js LTS release (the project is developed against Node 22).
- [Bun](https://bun.sh) — the repository ships a `bun.lock`, so Bun is the primary package manager. `npm` also works, but it will not use the committed lockfile.
- A Supabase project (free tier is sufficient) — see [Database and Supabase setup](#database-and-supabase-setup).

## Installation

```sh
git clone <this-repository-url>
cd <repository-folder>
bun install        # or: npm install
```

## Environment variables

Copy the template and fill in your Supabase values:

```sh
cp .env.example .env
```

| Variable | Used by | Required |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser client (inlined at build time) | Yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser client (inlined at build time) | Yes |
| `SUPABASE_URL` | Server-side rendering and server functions | Yes |
| `SUPABASE_PUBLISHABLE_KEY` | Server-side rendering and server functions | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin client (`client.server.ts`); not used by the current pages | No |
| `DB_MIGRATION_URL` | `drizzle-kit` (see `drizzle.config.ts`) | Only when using Drizzle tooling |
| `CRON_SECRET`, `CRON_SECRET_PREVIOUS` | `cron-auth.ts` helper; currently not wired to any route | No |

The publishable key is designed to be public, but treat `SUPABASE_SERVICE_ROLE_KEY` and any database connection string as secrets and never commit them.

## Local development

```sh
bun run dev        # starts the Vite dev server
```

## Production build

```sh
bun run build      # production build
bun run preview    # serve the production build locally
```

`bun run build:dev` produces a development-mode build. The server build is generated through Nitro; the preset defaults to a Cloudflare target, so adjust the Nitro/preset configuration in `vite.config.ts` if you deploy elsewhere.

## Testing, linting and type checking

```sh
bun run test       # run the Vitest suite once
bun run test:watch # watch mode
bun run lint       # ESLint
bunx tsc --noEmit  # TypeScript type check (no dedicated script is defined)
bun run format     # Prettier
```

Automated tests cover the validation engine (`src/lib/dq/engine.test.ts`), analytics, run-data helpers and route matching.

## Bulk validation-rule management

The **Validation Rules** page supports **New rule**, **Bulk add rules**, **Import SQL** and **Generate suggested rules**, plus bulk enable/disable/delete, JSON/SQL export, and applying rules to another dataset.

**One-time database step** (Supabase SQL editor, or `drizzle-kit migrate`): run `drizzle/migrations/0001_bulk_validation_rules.sql`. It is additive and idempotent. It adds a rule fingerprint with a unique index (duplicate prevention) and the `bulk_insert_validation_rules` function (validated, one transaction per call). Without it the app still saves rules in a single atomic INSERT, but database-level duplicate protection is inactive.

**Seed the e-commerce demo rules:** after the migration, run `supabase/seeds/seed_ecommerce_validation_rules.sql` (dataset name `dq_pipeline_demo_dataset`; edit `v_dataset_name` if yours differs). Re-running is safe.

| Rule type | Template(s) | Executed by |
| --- | --- | --- |
| `not_null` | Required field | `engine.ts` |
| `duplicate` | Unique field, Duplicate record (composite key / whole row) | `engine.ts` |
| `range` | Numeric range | `engine.ts` |
| `custom` | Positive value (`gt 0`), Email format, Custom | `engine.ts` |
| `data_type` | Data type, Date validation | `engine.ts` |
| `allowed_values` | Allowed values | `engine.ts` |
| `required_columns`, `record_count` | (existing schema / volume rules) | `engine.ts` |

### Rule-type conventions (unique, date and the other template names)

Rules are **stored and executed** under eight canonical types: `not_null`, `duplicate`, `range`, `custom`, `data_type`, `allowed_values`, `required_columns`, `record_count`. The template names are accepted as aliases wherever rules enter the app (SQL/JSON import, manual editor) and are normalised to a canonical rule:

| You write | Stored as |
| --- | --- |
| `unique` (column `order_id`) | `duplicate` with `columns: ["order_id"]`, `ignoreEmpty: true` |
| `date` (column `order_date`, optional `format: "YYYY-MM-DD"`) | `data_type` with `type: "date"` |
| `required`, `numeric_range`, `positive`, `email`, `duplicate_record` | `not_null`, `range`, `custom` (> 0), `custom` (email), `duplicate` |

The import preview lists every normalisation and every ignored parameter. Exports always contain canonical types. A stored rule with a genuinely unknown type is **never silently skipped**: it is reported as an "unsupported rule" violation and does not count as an executing rule (so the dataset reads "Not evaluated", not 100%).

Unique: every repeat after the first occurrence is flagged ("first seen at row N"); blanks are ignored unless `ignoreEmpty` is false; `caseInsensitive` is optional; values are compared as trimmed text, so CSV and API data behave the same. Date: real calendar dates only (`2026-13-26` and `2026-02-30` fail); `format: "YYYY-MM-DD"` additionally rejects every other layout; blanks are left to a Required rule.

### Checking a CSV against a rules export (no database needed)

```bash
bun run verify:dataset <data.csv> <rules.json | rules.sql>
bun run verify:dataset examples/retail_orders_sample.csv examples/retail_orders_sample.rules.json   # bundled sample
```

It runs the real engine and prints source/accepted/rejected counts, reconciliation, rule coverage, violations per rule and every rejected row with its reasons. Every number is computed from the files you pass.

### Dataset evaluation warnings

The Dashboard and the Validation Rules page render the same `DatasetStatusNotice`, driven by one function (`dataset-status.ts`) over the live datasets, rules and runs — so a deleted dataset or a reset workspace can never appear in a warning. States: no enabled runnable rules → **Not evaluated**; rules but no run → **Awaiting first validation run** (no quality figure); then the actual run status (success / partial success / failed) with quality computed from the run. No datasets → no warning.

If old datasets still appear after you expected a clean workspace, they are real rows in your database: Fresh Demo auto-reset only runs when migration `0002` is applied, you have confirmed the one-time prompt, and the app was started with `bun run dev`. Otherwise use **Settings → Reset workspace**.

### Importing a rule export

On **Validation Rules → Import SQL**, upload or paste a file made by **Export SQL** / **Export JSON** (examples: `supabase/seeds/dq_pipeline_demo_dataset.rules-export.sql` and `.json`). The dialog selects the dataset named in the file, lists every rule for review, and saves the ones you keep when you click **Apply selected rules**. Re-importing the same file adds nothing.

The SQL file must contain a call of this form (one per dataset). Equivalent spellings are accepted (`$$…$$` or `'…'` quoting, no `public.` prefix, `ASC/DESC`, `::jsonb` optional); any other statement rejects the file, and the error names the line and the reason. Pasted SQL is only read as data — it is never executed.

```sql
SELECT public.bulk_insert_validation_rules(
  (SELECT id FROM public.datasets WHERE name = '<dataset name>' ORDER BY created_at LIMIT 1),
  $dq_rules$[ { "rule_name": "…", "column_name": "…", "rule_type": "…", "parameters": {}, "severity": "error", "is_enabled": true } ]$dq_rules$::jsonb,
  true
);
```

`supabase/seeds/seed_ecommerce_validation_rules.sql` is a different kind of file: a `DO` block to run in the Supabase SQL editor. It cannot be imported in the dialog.

Runs with no executable rules finish as **Not evaluated** — quality is never reported as 100% for data that was not validated.

## Workspace startup, reset and clean slate

**Where old datasets come from.** DQ Pipeline never seeds data on its own. Datasets such as `iris` or `bank` are rows you uploaded earlier that still live in your Supabase database; the app never cleared them between launches. (`jsonplaceholder.typicode.com/users` is only the default URL in the Connect API form.)

**Workspace Startup Mode** (Settings → Workspace):

| Mode | Behaviour |
| --- | --- |
| **Fresh Demo Workspace** (default) | Each *new launch of the dev server* starts with zero datasets, rules, runs, logs and records, and shows a "Fresh demo workspace initialized" notification. A browser refresh or hot reload never resets anything. |
| **Persistent Workspace** | Nothing is ever deleted automatically; everything survives restarts. |

How a "new launch" is detected: `vite.config.ts` creates one launch id per dev-server start. The database lets exactly one page load claim each id (`begin_workspace_launch`), so refreshes, hot reloads and extra tabs are ignored.

Safety rules: automatic resets run only under `vite dev` (or when `VITE_DEMO_AUTO_RESET=true` is set); a production build never deletes on its own. Because the app cannot tell your uploads from demo data, the **first** time Fresh Demo mode finds existing data it shows the exact counts and asks once — nothing is deleted until you choose *Start fresh*; *Keep my data* switches to Persistent. Settings, the schema and migrations are never reset.

**Reset workspace** (Settings → Workspace) deletes in foreign-key order (accepted/rejected records, logs, results, runs, rules, datasets) after you type `RESET`. Choose *Everything* or *Built-in sample data only*.

**Delete all rules** (Validation Rules page) deletes rules only — for one dataset or all datasets — and never touches datasets or run history.

**Sample data** is optional: use *Load sample datasets* on an empty dashboard or in Settings.

### Applying the migration

Run `drizzle/migrations/0002_workspace_lifecycle.sql` once in the Supabase SQL editor (after `0001`). It creates a small `workspace_state` table and three functions (`delete_validation_rules`, `reset_workspace`, `begin_workspace_launch`); it is additive and safe to repeat. Without it, Delete all rules and Reset still work (ordered client-side deletes, not one transaction) but automatic fresh starts stay off.

```bash
bun install
bun run dev        # new `bun run dev` = new launch = fresh workspace (once confirmed)
bun run test
bun run build
```

## Database and Supabase setup

1. Create a project at [supabase.com](https://supabase.com) and copy the project URL and publishable key into `.env`.
2. Apply the schema by running `drizzle/migrations/0000_migration.sql` in the Supabase SQL editor (or against your database with your preferred Postgres client). It creates these tables: `datasets`, `validation_rules`, `pipeline_runs`, `validation_results`, `pipeline_logs`, `accepted_records`, `rejected_records` and `app_settings`, enables row-level security, and seeds the single `app_settings` row.
3. `drizzle/schema.ts` is the Drizzle representation of the same schema. `supabase/config.toml` stores your Supabase project reference.

Because the app is single-user, the migration creates open RLS policies for `anon` and `authenticated`. Review them before any multi-user or public deployment.

## CSV ingestion and pipeline workflow

1. **Add a source** — on *Data Sources*, upload a `.csv` file (limit configurable in Settings, default 5 MB) or register a JSON API endpoint. Source rows are stored untouched and the schema is inferred.
2. **Define rules** — on *Validation Rules*, add rules for the dataset and choose a severity for each.
3. **Run the pipeline** — start a run from *Pipeline Runs*. Each run gets a run ID and progresses through five stages:
   - `ingest` — load the source rows;
   - `validate` — evaluate every enabled rule and record violations;
   - `clean` — apply cleaning (e.g. trim whitespace, lower-case emails, fill values) to the accepted copy only;
   - `load` — persist accepted and rejected records;
   - `publish` — finalise the run and reconcile the counts.
4. **Inspect results** — open the run for stage status, execution logs and reconciliation; use *Data Explorer* for accepted/rejected records and rejection reasons.
5. **Review and export** — *Run History* shows past runs; *Reports* provides quality analytics and CSV downloads.

## Screenshots

> Add real screenshots to `docs/screenshots/` and reference them here.

| View | Screenshot |
| --- | --- |
| Dashboard | `docs/screenshots/dashboard.png` *(placeholder)* |
| Data Sources | `docs/screenshots/data-sources.png` *(placeholder)* |
| Validation Rules | `docs/screenshots/validation-rules.png` *(placeholder)* |
| Pipeline Run detail | `docs/screenshots/pipeline-run.png` *(placeholder)* |
| Data Explorer | `docs/screenshots/data-explorer.png` *(placeholder)* |
| Reports | `docs/screenshots/reports.png` *(placeholder)* |
| Dark theme | `docs/screenshots/dark-theme.png` *(placeholder)* |

## Build configuration

`vite.config.ts` registers the Vite plugins directly: `vite-tsconfig-paths` (the `@/` alias), Tailwind CSS, TanStack Start (with `src/server.ts` as the server entry), React, and Nitro for production builds. `.env` values are loaded into `process.env` so server code can read them.

Nitro uses its default preset. If you deploy to a specific platform (Cloudflare, Node server, etc.), set it explicitly, e.g. `nitro({ preset: "node-server" })`.

## Authors and contributors

- **Author / maintainer:** _add your name here_
- Contributions are welcome — open an issue or pull request describing the change.

## License

_No license file is included in this repository. Add one that matches how you intend to distribute the project._
=======
# dq-pipeline
Automated Data Quality and Pipeline Observability Platform for data ingestion, validation, ETL processing, error tracking, reconciliation, and analytics.
>>>>>>> 8cb829a3a79db1968c4c592de5d19e00cc59c064
