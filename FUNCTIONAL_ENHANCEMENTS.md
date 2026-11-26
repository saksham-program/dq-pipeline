# DQ Pipeline functional enhancements

## Findings and root causes
- The original Rules page only had single-rule creation and deletion. No earlier SQL importer/export generator or secure rule-import RPC was present in the inspected source. The new format is explicit rather than claiming compatibility with an unknown format.
- Persistent Cloud data previously appeared on every reload. Clearing shared tables based on a browser hostname would risk persistent data. The initial reset RPC was therefore disabled and its public execution grant removed before browser verification.
- An unevaluated dashboard displayed a dash; it now explicitly says **Not evaluated** and **Not available**.

## Import SQL
1. Upload/register a dataset on Data Sources.
2. Open Validation Rules → **Import SQL** and choose the target dataset.
3. Upload a `.sql` file (up to 1 MB), or paste supported SQL.
4. Click **Review rules**. Every invalid/unsupported rule is shown with an error. Statement-level errors block import entirely. Invalid individual rules cannot be selected.
5. Edit names, columns, severity, enabled state and JSON parameters; select/deselect individual valid rules.
6. Click **Import N rule(s)**. Rules are saved through the normal persistence layer and used on the next pipeline execution.

### Supported export format
```sql
INSERT INTO validation_rules
  (dataset, rule_name, column_name, rule_type, severity, is_enabled, parameters)
VALUES
  ('Orders', 'Price not negative', 'price', 'range', 'error', true, '{"min":0}'),
  ('Orders', 'ID required', 'id', 'not_null', 'critical', true, '{}'),
  ('Orders', 'Valid date', 'date', 'data_type', 'warning', false, '{"type":"date"}');
```
- `rule_name` and `rule_type` are mandatory. Omitted severity defaults to error; omitted enabled state defaults to true; omitted parameters default to an empty object.
- Column order may vary. `public.validation_rules` and quoted table/column names are accepted. Multiple literal INSERT statements and line comments are supported. Apostrophes are escaped as `''`.
- `dataset` is optional source metadata. A different export dataset name is displayed; importing into the explicitly chosen target is intentional. Target columns are validated.
- Supported types: `required_columns`, `not_null`, `range`, `duplicate`, `data_type`, `custom`, `record_count`.
- Date validation uses `data_type` with `{"type":"date"}`. Unique checks use `duplicate` with `{"columns":["id"]}`. Allowed-values is not a native engine type and is reported as unsupported; existing custom regex conditions can express an explicitly authored pattern.
- SQL expressions, arbitrary statements, unknown fields/parameters and unsupported rule types are never executed. There are no service-role credentials in this flow.
- **Export SQL** downloads the selected dataset's rules, or all rules when the filter is All datasets. Its output round-trips through Import SQL.
- Duplicate identity is dataset + type + column + normalized parameters, independent of rule name. Duplicate rows are displayed; imports recheck persisted rules and serialize submissions in the current browser.

## Bulk add and suggested rules
**Bulk add rules** opens editable rows; add more rows and select valid ones before saving. **Generate suggested rules** derives required-value and detected-type checks from the registered schema. Suggestions are never saved or seeded automatically.

## Delete all rules
1. Select a dataset in the page filter for dataset-scoped deletion, or use All datasets for a workspace-wide deletion.
2. Click **Delete all rules**.
3. Choose the scope. The confirmation displays the exact number currently selected for deletion.
4. Click **Delete N rule(s)**. Duplicate submissions are disabled; errors are shown as notifications.

Deletion targets the IDs returned by the active workspace read. It removes only validation rules, refreshes shared rule/dataset queries, and keeps datasets, uploads, runs, accepted/rejected results, logs and historical reports. Old run violation totals remain historical facts rather than being rewritten when configuration is deleted.

## Fresh workspace lifecycle and safety
- Localhost, loopback and the editor's `id-preview--…lovable.app` host use an isolated browser-memory demo workspace.
- Every full browser reload or fresh launch creates an empty memory store: zero datasets, rules, runs, results and logs. Reports derive from those same empty runs.
- Ordinary navigation, React re-renders and remounts retain the store. A global initialization promise and global store retain it across module hot reloads.
- Initialization gates the whole shell before any query or run dialog can access data. It does not send a Cloud reset request.
- No automatic sample seeding occurs. The existing optional **Load sample data** action remains user-triggered.
- Published/custom domains use the unchanged persistent Cloud client by default. `VITE_DQ_DEMO_RESET=on` explicitly selects disposable memory; `off` explicitly selects persistence. Even an accidental `on` never deletes Cloud data.
- Settings in demo mode also remain local to that page session. Browser tabs have independent demo stores.
- Data lives only in memory during demos. Export required results before reloading. This is intentional and not persistent Cloud storage.
- The older shared reset function remains only as a disabled deprecated stub. No schema, migrations, authentication configuration, environment variables or Cloud rows were deleted by the final demo startup mechanism.

## Database changes
- `drizzle/migrations/0001_reset_demo_workspace.sql`: initial reset RPC from the first implementation pass.
- `drizzle/migrations/0002_disable_unscoped_workspace_reset.sql`: replaces it with an exception-only stub, revokes PUBLIC/anon/authenticated execution and marks it deprecated.
- Database inspection verified anonymous execution is false and the function contains no deletion logic.
- No arbitrary SQL import RPC was added; normal rule insertion remains the only write path.

## Files introduced/modified across this enhancement
- `src/lib/dq/rule-sql.ts`, `rule-sql.test.ts`: parser, validation, duplicate identity, export.
- `src/lib/dq/rule-suggestions.ts`: supported schema-based suggestions.
- `src/components/dq/RuleBulkActions.tsx`, `src/routes/rules.tsx`: review/import/export/bulk/suggested/delete controls.
- `src/lib/dq/demo-store.ts`, `workspace.ts`, `workspace.test.ts`, `workspace-flow.test.ts`: disposable store, mode detection and lifecycle/persistence tests.
- `src/components/dq/WorkspaceGate.tsx`, `src/routes/__root.tsx`: startup barrier.
- `src/lib/dq/db.ts`, `runner.ts`: shared workspace adapter and scoped bulk persistence/deletion.
- `src/routes/index.tsx`, `sources.tsx`: truthful empty metrics and source wording.
- Generated database types and migrations above; `AGENTS.md`, `roadmap.md`, this document.

## Verified results
- **40 tests passed across 7 files**, including all existing tests, all seven engine rule types after export/import, malformed SQL/parameters, duplicate detection, concurrent same-browser imports, scoped/all deletion, record preservation and isolated lifecycle.
- Browser: CSV upload → SQL review of three valid rules plus one unsupported type → import → export → re-import with zero duplicate selections → execute pipeline → one accepted/two rejected records from three source rows → 33.3% quality and matched reconciliation → Explorer → Reports → delete one dataset's rules while another remains → delete remaining rules while both datasets and the existing run remain → reload → clean dashboard/sources/rules.
- No page errors and zero Cloud table requests during the demo end-to-end flow.
- Module re-evaluation retained the same populated store; navigation did not reset data.
- Phone-sized browser verification covered bulk entry, suggestions, review name/parameter edits, selection/deselection, saved rules and no horizontal page overflow. Desktop and 883px dashboard screenshots were inspected; existing themes/waves were preserved.
- The platform's latest automatic compilation check reported **build OK**. A separate production deployment/build was not manually run.

## Remaining verification limits
- A supervised development-server stop/restart was not performed. A fresh browser launch/reload was verified; an already-open tab retains memory until the restart causes a full document reload.
- Production deployment behavior is covered by mode/delegation tests, not a published live-site test.
- Existing API ingestion was preserved but not re-exercised against a live external API during this enhancement.
- Persistent workspace remains the existing no-login single-user architecture. It is not a secure multi-user production workspace; add authentication and owner policies before sharing private data.
- Cross-tab concurrent imports in persistent mode are not backed by a database uniqueness constraint; same-browser repeated/concurrent imports and all disposable demo imports are protected and tested.