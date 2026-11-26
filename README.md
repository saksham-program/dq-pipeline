# DQ Pipeline

**Automated Data Quality & Pipeline Observability Platform**

A platform for ingesting datasets, applying configurable validation rules, executing ETL pipelines, monitoring data quality, tracking rejected records, and generating reports.

## Problem statement and objectives

Invalid source data can silently reach downstream systems. DQ Pipeline makes validation explicit, preserves original input, separates accepted and rejected records, and reconciles source-to-target counts with execution logs. Its objectives are repeatable validation, traceable cleaning, and observable pipeline execution.

## Key features

- CSV upload, inferred schema, dataset preview, replacement, editing and deletion.
- JSON API ingestion through a server function, with GET/POST support and configurable headers.
- Seven validation types: required columns, data type, not null, duplicate detection, numerical range, custom condition and record count.
- Rule creation, editing, enable/disable, severity, bulk entry, suggestions, SQL import/export and confirmed dataset/all-rule deletion.
- Extract → validate → clean → load → publish execution with unique run IDs, status, timings and logs.
- Accepted/rejected record exploration, row-level rejection reasons, reconciliation, history, charts and CSV reports.
- Existing Soft Azure light and Obsidian Black dark themes, system preference, theme-aware logos and signature waves.

Standalone JSON rule-file import/export is **not implemented** in the supplied source. JSON is used for rule parameters and API responses; SQL exports carry JSON parameters. Cleanup does not add missing features.

## Screenshots

Screenshots from the verification session are included in `docs/screenshots/` when available. They contain only temporary demonstration data, not production database records.

## Technology stack

React 19, TypeScript, TanStack Start/Router/Query, Vite 8, Tailwind CSS 4, Radix UI-based controls, Lucide icons, Recharts, Papa Parse, Zod, Sonner, Supabase JavaScript client, PostgreSQL SQL migrations, Drizzle Kit, Nitro, Bun, Vitest, Testing Library, ESLint and Prettier.

Package versions and resolutions are defined by `package.json` and `bun.lock`; no framework versions were upgraded during cleanup.

## Architecture

```text
TanStack routes → AppShell + AppStateProvider + WorkspaceGate
                             ↓
               Query hooks → db.ts → workspaceClient
                                        ├─ local/preview: disposable memory
                                        └─ deployed domain: existing database client

CSV/API → datasets.raw_records → runner.ts → engine.ts
                                     ↓
                     runs + logs + validation results
                         + accepted/rejected records
```

The engine is pure TypeScript. Orchestration and persistence are separate. API ingestion uses `src/lib/dq/api-fetch.functions.ts`; browser requests use the existing session-attaching middleware. There are no detected payment, email, AI, webhook, OAuth callback or scheduled application endpoints. An unused cron-authentication utility is retained conservatively.

## Repository structure

```text
public/                     Existing favicon, touch icon and robots policy
src/assets/                 Bundled original theme-aware logo artwork
src/components/dq/          App shell, waves, execution and bulk-rule controls
src/components/ui/          Shared Radix-based design-system controls
src/hooks/                  Shared UI hooks
src/integrations/supabase/   Existing database/session clients and database types
src/lib/dq/                 Validation engine, parser, CSV, analytics, persistence, tests
src/lib/app-state.tsx        Theme and date-range preferences
src/routes/                 File-based pages and root layout
src/test/                   Test setup and route regression test
src/start.ts                Server middleware, CSRF and session attachment
src/server.ts               SSR error wrapper
src/styles.css              Existing theme tokens and visual styles
drizzle/migrations/         Original ordered SQL migrations and metadata
drizzle/schema.ts           Empty generated schema placeholder (not schema authority)
supabase/config.toml        Original project identifier
.env.example                Placeholder configuration only
CLEANUP_REPORT.md           Changes, checks, retained dependencies and limitations
FUNCTIONAL_ENHANCEMENTS.md  Historical feature notes (not this audit's test results)
```

## Requirements and local setup

Use Bun and a Node.js version supported by the pinned Vite package (Node 22.12+ is a suitable baseline). Install Bun before running the commands below. Keep the supplied lockfile.

```sh
git clone <your-repository-url>
cd <your-repository-directory>
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

Fill in your **existing** database URL and publishable key locally. This archive intentionally excludes `.env`. Do not commit credentials. `VITE_` variables are exposed in browser code: never put a service-role key or private token there.

Localhost starts with an empty disposable workspace by default. CSV workflows work without production database access. API ingestion still initializes the database client through the preserved session middleware, so it requires valid public client configuration even in disposable mode.

## Environment configuration

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Existing browser-reachable database/auth endpoint |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public publishable/anon key; access remains controlled by existing policies |
| `SUPABASE_URL` | Server-reachable endpoint for the same database |
| `SUPABASE_PUBLISHABLE_KEY` | Server publishable/anon key |
| `VITE_SUPABASE_PROJECT_ID`, `SUPABASE_PROJECT_ID` | Original project metadata; no required app call site detected |
| `VITE_DQ_DEMO_RESET` | Optional `on`/`off` override; unset retains hostname-based behavior |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional trusted admin helper only; server-only, no current app caller |
| `LOVABLE_DB_MIGRATION_URL` | Retained existing Drizzle tooling connection variable |
| `LOVABLE_CRON_SECRET`, `LOVABLE_CRON_SECRET_PREVIOUS` | Retained unused cron helper; configure only if actually integrated |

Configuration values in the original local environment were not overwritten or copied into the download. Deployment must supply environment values securely. Browser values are build-time configuration; rebuild when changing them.

## Development, testing and build commands

These scripts exist in the supplied repository:

```sh
bun run dev          # Vite development server; use the URL it prints
bun run build        # Production client and Nitro server build
bun run build:dev    # Build with development mode
bun run preview      # Preview generated build; not a deployment command
bun run test         # All Vitest tests
bun run test:watch   # Vitest watch mode
bun run lint         # ESLint plus Prettier checks
bun run format       # Formats the repository; review changes before committing
```

There is no `typecheck` package script. In this verification environment the installed checker was run as `oj typecheck -b --noEmit`; `oj` is an environment tool, not a repository dependency. The existing TypeScript compiler dependency can be used in your own development environment.

The cleanup report distinguishes checks that passed from pre-existing lint failures. Do not disable lint or tests to hide problems.

## Existing database setup

The database was **not migrated or modified**. Continue using the original project and policies. Tables are `datasets`, `validation_rules`, `pipeline_runs`, `validation_results`, `pipeline_logs`, `accepted_records`, `rejected_records` and `app_settings`.

For a deliberately new database, review and apply the existing SQL migrations in order using your database's SQL tooling:

1. `0000_migration.sql`
2. `0001_reset_demo_workspace.sql`
3. `0002_disable_unscoped_workspace_reset.sql`

Do not stop after migration 0001: migration 0002 disables the earlier unscoped workspace reset. Do not apply migrations blindly to an existing production database. The empty `drizzle/schema.ts` is not a complete schema definition; do not regenerate migrations from it or use a schema push as a substitute for the supplied SQL.

The supplied database design is a **single-user, no-sign-in workspace with open anonymous/authenticated policies**. It is not safe for private multi-user data. Adding authentication and ownership policies is future work, not part of branding cleanup.

## Example dataset and validation workflow

Save this as `orders.csv`:

```csv
id,price,date
1,10,2026-11-20
2,-5,2026-11-21
3,20,not-a-date
```

1. Open **Data Sources**, upload the CSV, preview it and register the dataset.
2. Open **Validation Rules**, select **Import SQL** and review:

```sql
INSERT INTO validation_rules
  (rule_name, column_name, rule_type, severity, is_enabled, parameters)
VALUES
  ('Price not negative', 'price', 'range', 'error', true, '{"min":0}'),
  ('Valid date', 'date', 'data_type', 'error', true, '{"type":"date"}');
```

3. Import the two valid rules. SQL is parsed as literal data; it is never executed.
4. Select **Run pipeline**, choose the dataset, execute and open run details.
5. Expect one accepted row, two rejected rows, visible reasons, and matching reconciliation.
6. Open **Data Explorer**, **Run History** and **Reports**; download results before reloading a disposable workspace.

Critical/error violations reject rows; warnings are recorded without independently rejecting a row. Original rows remain untouched. Cleaning affects accepted copies only. Rule deletion preserves historical run results.

## Workspace lifecycle

Localhost, loopback and the existing editor preview hostname use an in-memory store. Navigation and hot reload retain it; a full browser reload creates an empty workspace. Deployed/custom domains use the original persistent database by default. The `on` override selects disposable memory without deleting database records; `off` selects persistence. Sample loading is always user-triggered.

## Deployment

Run `bun run build` with the intended environment. The retained configuration uses Nitro and normally targets a Cloudflare module, while Nitro's supported environment-based target detection may choose a different host outside the original platform. Inspect the emitted server configuration and follow your hosting provider's deployment instructions. Do not publish only the static client folder: API ingestion and SSR need the generated server handler. No deployment, domain cutover or provider configuration was performed during this cleanup.

## Known limitations and future improvements

- Required `@lovable.dev/vite-tanstack-config` remains; the project is not fully free of platform-specific dependencies.
- Original logo bytes are bundled for standalone use; no platform asset proxy is needed for branding.
- Standalone JSON rule import/export is absent in the original.
- Lint has pre-existing errors; see the report for counts and exact checks.
- Production database connectivity and writes must be verified privately against your existing service. No shared production records were changed during this audit.
- API proxy validation has known limits: private-network checks are incomplete and redirects/DNS resolution are not comprehensively restricted. Do not expose it as an unrestricted public proxy.
- Stored API headers can contain credentials. Avoid sensitive headers in the openly accessible single-user database.
- Persistent cross-tab rule imports do not have a database-backed uniqueness constraint.
- Settings expose some preferences that are not fully wired into processing, including configurable API timeout; the proxy currently uses a fixed 15-second timeout.
- Future work: ownership-based access, hardened API target validation, concurrency constraints and JSON rule-file support. None was added here.

## Contribution and provenance

Keep changes focused, preserve the visual system, run tests, and review lint/build results. Do not rewrite published Git history or remove third-party notices. The project originated in a visual development environment; removing promotional text does not establish exclusive authorship or change development history. No fabricated contributors or commit history were added.

## License

No project license file was supplied and no license was selected during cleanup. Choose an appropriate license before granting reuse rights. Dependency license obligations still apply; no third-party notices were removed.
