# Query History

## Overview
Persistence for per-user SQL editor query history in the RBAC database.

## Interface
- `[store.ts:listQueryHistory]`, `[store.ts:recordQueryHistory]`, `[store.ts:deleteQueryHistoryItem]`, `[store.ts:clearQueryHistory]`.

## Invariants
- Every read and delete is scoped by `user_id` (`[store.ts:listQueryHistory]`, `[store.ts:deleteQueryHistoryItem]`, `[store.ts:clearQueryHistory]`).
- Recording trims each user's history to the newest 100 rows (`[store.ts:recordQueryHistory]`, `OFFSET 100`).

## Side Effects
- Writes `rbac_query_history` (`[store.ts:recordQueryHistory]`, `[store.ts:clearQueryHistory]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
