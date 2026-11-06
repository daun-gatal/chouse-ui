# Schema Change Preflight

## Overview
Schema change preflight (ADR 0016 §11): what a DDL statement breaks or affects before it runs (views, materialized views, dictionaries, Distributed tables, scheduled jobs, Data Health promises, saved queries).

## Interface
- `[impact.ts:analyzeDdl]`.
- `[parse.ts:parseDdl]`, `[parse.ts:referencesColumn]`, `[parse.ts:referencesTable]`, `[parse.ts:unquote]`.

## Invariants
- `[parse.ts:parseDdl]` is a deliberately small allowlist parser: only statements whose effect on dependents can be reasoned about are recognised.

## Side Effects
- Reads `obs_catalog_tables`, `obs_catalog_columns`, `obs_usage_rollups`, `data_health_promises`, `data_health_promise_checks`, `scheduled_queries` and `rbac_saved_queries` from the RBAC DB to find dependents (`[impact.ts:analyzeDdl]`); no writes and no ClickHouse queries.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
