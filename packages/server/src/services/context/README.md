# Table Context Engine

## Overview
The context engine (ADR 0016 §11): what a table means for people and agents. Combines derived facts from collectors with curated fields and metrics, the Context AI draft (bounded table profile plus draft guards), and plain-language watchers.

## Interface
- `[store.ts:getTableContext]`, `[store.ts:upsertCurated]`, `[store.ts:verifyContext]`, `[store.ts:listMetrics]`, `[store.ts:upsertMetric]`, `[store.ts:deleteMetric]`, `[store.ts:importDbtManifest]`, `[store.ts:queryGuidance]`.
- `[draft.ts:draftTableContext]`, `[watchers.ts:compileWatcher]` - thin wrappers that run `draftTableContextCapability` / `compileWatcherCapability` (`../ai/capabilities/observe.ts`) via `runStructuredCapability`; the capability does the permission and table-access checks, runs the profile and applies the draft guards.
- `[profile.ts:profileTable]`, `[profile.ts:buildProfileQuery]`, `[profile.ts:isPiiColumn]`.
- `[draftRules.ts:redactQueryLiterals]`, `[draftRules.ts:validMetrics]`, `[draftRules.ts:validMetricExpression]`, `[draftRules.ts:normalizeTags]`.
- `[watchers.ts:CompileWatcherInput]` carries an `allowed` callback that `[watchers.ts:compileWatcher]` does not use.

## Invariants
- The model never writes or runs SQL: the server builds the profile query from catalog names only and runs it read-only with hard limits (`[profile.ts:profileTable]`, `[profile.ts:PROFILE_MAX_ROWS]`).
- Model output is untrusted until it passes `[draftRules.ts:validMetrics]` and related guards.
- Drafts and watchers store nothing; a person saves through the ordinary endpoints (`[draft.ts:draftTableContext]`, `[watchers.ts:compileWatcher]`).

## Side Effects
- Writes `ctx_table_context`, `ctx_metrics` (`[store.ts:upsertCurated]`, `[store.ts:upsertMetric]`, `[store.ts:verifyContext]`, `[store.ts:importDbtManifest]` with `source = "dbt"`, never overwriting `manual` rows).
- Model calls via `runStructuredCapability` (`[draft.ts:draftTableContext]`, `[watchers.ts:compileWatcher]`).
- Read-only ClickHouse profile query (`[profile.ts:profileTable]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
