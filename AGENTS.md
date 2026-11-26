# Development guidelines

Preserve published Git history and all third-party notices.

## DQ Pipeline architecture
- Render navigation and loading branding through BrandLogo using bundled original-artwork files; keep derived favicon binaries in public. Why: standalone exports must display the original theme-aware logo without a platform asset proxy.
- Data processing (validation, cleaning, reconciliation) lives in pure TypeScript in `src/lib/dq/engine.ts` with tests in `engine.test.ts`; orchestration and persistence are in `src/lib/dq/runner.ts`. Why: the hosting runtime cannot run Python/FastAPI; keeping the engine pure lets it be swapped for an external Pandas service behind the same `runPipeline` contract.
- Single-user app with no sign-in: every public table has an open RLS policy for anon/authenticated. Why: the product brief explicitly forbids accounts; add auth before exposing to multiple users.
- Original source rows are stored untouched in `datasets.raw_records`; cleaning only affects the accepted copy. Why: traceability of rejected/cleaned rows.
- API ingestion goes through the `fetchApiSource` server function (`api-fetch.functions.ts`), which returns raw JSON text. Why: avoids browser CORS and blocks private-network URLs.
- Run-history cleanup is shared between the Runs and History pages and removes run-linked results before run entries, while preserving datasets and rules. Why: users can clear execution output without losing reusable source configuration.
- Decorative waves are generated SVG in `src/components/dq/Waves.tsx` (one composition per top-level route, colored only by `--wave-*` tokens) and mounted once by `AppShell`. Why: pages stay free of decoration code and both themes restyle the waves through tokens alone.
- Route all DQ reads/writes through workspaceClient after WorkspaceGate initializes: local/preview sessions use a browser-memory store retained on globalThis for HMR; published sites use the existing Cloud client. Why: disposable reloads must never reset shared persistent data.
- SQL rule imports parse only literal INSERT rule exports as data, then use the normal rule persistence path; never execute pasted SQL. Why: arbitrary statements must not cross the security boundary.

- Keep cleanup changes presentation-only unless explicitly approved; retain build configuration, database migrations, workspace routing and session storage adapters. Why: branding cleanup must not change execution or persistence behavior.
