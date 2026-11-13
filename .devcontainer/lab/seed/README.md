# .devcontainer/lab/seed

## Overview

The lab's loader and smoke check. Both run on the Bun inside the CHouse UI
image (`docker compose run --rm seed`), so the lab pulls no extra image, and
under Vitest for unit tests. They talk to CHouse UI only through its public
HTTP API and to ClickHouse over HTTP, and import nothing from the app.

## Interface

- `[lib.ts:readConfig]` - lab settings from the environment; fails fast naming any missing secret.
- `[lib.ts:chooseAi]` - the visitor's AI provider from `ANTHROPIC_API_KEY` (preferred) or `OPENAI_API_KEY`; `LAB_AI_MODEL` overrides the model; no key means AI off.
- `[lib.ts:ChouseApi]` - minimal API client (sends `X-Requested-With`, bearer token after `login`).
- `[lib.ts:clickhouseQuery]`, `[lib.ts:runStep]`, `[lib.ts:LabError]`, field readers `stringField`, `booleanField`, `arrayField`, `objectField`, `isRecord`.
- `[seed.ts:runSeed]` - the loader: sample data (`SAMPLE_SCHEMA`, `SAMPLE_DATA`), admin login, the default connection (`ensureConnection`), first-run setup (`completeSetup`), the visitor's AI provider (`ensureAi`), then the showcase. Prints a JSON report on stdout.
- `[showcase.ts:runShowcase]` - example content for every area, one step each (`SHOWCASE_STEPS`): teammates (`TEAM`), an analyst data access policy, saved queries, dashboards, a fleet alert rule, a scheduled report, two data-health promises (one breaks on purpose), and table context.
- `[smoke.ts:runSmoke]` - the CI smoke check: login without a password change, setup complete, exactly one lab connection, a query through the API, the analyst boundary (`checkAnalystBoundary`), the AI flag, the showcase content, and the planted slow query in `system.query_log`.

## Invariants

- Every step checks what exists (by name) before creating, so re-runs change nothing `[seed.ts:ensureConnection]`, `[showcase.ts:ensureDashboards]`.
- Table context the visitor has written is never overwritten `[showcase.ts:ensureTableContext]`.
- Setting a role's data access policies replaces the list, so the analyst role keeps its existing policies `[showcase.ts:ensureAnalystPolicy]`.
- Login runs once per run and a 429 is reported, never retried; only requests that got no HTTP response are retried `[lib.ts:fetchWithRetry]`.
- A failed AI or showcase step is reported as `WARN` and does not fail the run; sample data, login, connection and setup are required `[seed.ts:OPTIONAL_STEPS]`.
- If adding the AI model fails, the new provider is deleted so the next run starts clean `[seed.ts:ensureAi]`.

## Side Effects

- ClickHouse: creates the `shop`, `analytics` and `finance` databases and fills empty tables (2 million orders).
- CHouse UI (RBAC database): connection, users, policy, saved queries, dashboards, alert rule, scheduled query (run once), data-health promises (run once), table context, and an AI provider when a key is given. Each write is audited by the app as the lab admin.

## Verification

- Run: `bunx vitest run .devcontainer/lab/seed`
- Type-check: `bunx tsc -p .devcontainer/lab/seed/tsconfig.json`
