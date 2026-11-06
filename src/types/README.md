# types

## Overview
Shared TypeScript types: the ClickHouse EXPLAIN / query-explainer model with node styling metadata, and the global `Window.env` runtime-config declaration.

## Interface
- `explain.ts` - `ExplainPlanNode`, `ExplainIndex`, `ExplainEstimate`, `ExplainPipeline`, `ExplainPipelineProcessor`, `ExplainResult`, `CostEstimate`, `CostEstimateTable`, `ExplainType`, `EXPLAIN_TYPES`, `NodeCategory`, `NodeStyle`, `NODE_CATEGORIES`, `NODE_STYLES`, `getNodeCategory`, `getNodeStyle` [explain.ts:EXPLAIN_TYPES], [explain.ts:getNodeStyle]
- `env.d.ts` - global `Window.env.VITE_CLICKHOUSE_URLS?: string[]` [env.d.ts:Window]

## Invariants
- `ExplainType` is limited to `plan`, `ast`, `syntax`, `pipeline`, `estimate`; `EXPLAIN_TYPES` holds a label, description, and query prefix for each [explain.ts:EXPLAIN_TYPES].
- Unknown EXPLAIN node types fall back to the `other` category [explain.ts:getNodeCategory].

## Side Effects
- None. Types, constants, and pure lookups only.

## Verification
- No co-located tests; covered by `bun run typecheck` (and indirectly by the full suite, `bunx vitest run`)
