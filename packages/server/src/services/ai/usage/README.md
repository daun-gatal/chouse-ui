# AI Usage Tracking

## Overview
AI usage and data-egress tracking (ADR 0020): one usage run per AI request with LLM and tool steps, the ClickHouse queries tools ran, token cost, caller origin, persistence and read-side queries.

## Interface
- `[index.ts:UsageCallbackHandler]` barrel re-exports handler, origin and store symbols.
- `[run.ts:withUsageRun]`, `[run.ts:UsageRun]`, `[run.ts:ToolStep]`, `[run.ts:currentUsageRun]`, `[run.ts:runInToolStep]`, `[run.ts:recordChouseSource]`.
- `[handler.ts:UsageCallbackHandler]` - LangChain callback turning model calls into `llm` steps.
- `[origin.ts:requestCallerMiddleware]`, `[origin.ts:runAsCaller]`, `[origin.ts:currentCaller]`, `[origin.ts:USAGE_ORIGINS]`.
- `[pricing.ts:normalizeTokenUsage]`, `[pricing.ts:usageFromResult]`, `[pricing.ts:costOf]`.
- `[store.ts:writeUsageRun]`, `[store.ts:persistUsageRun]`, `[store.ts:flushUsageWrites]`, `[store.ts:pruneAiUsage]`, `[store.ts:usageRetentionDays]`.
- `[queries.ts:usageSummary]`, `[queries.ts:usageByModel]`, `[queries.ts:egressBySource]`, `[queries.ts:listUsageRequests]`, `[queries.ts:usageRequestDetail]`.
- `[tables.ts:tablesOf]` - tables a read-only statement reads, for egress labels.

## Invariants
- A run lives in an AsyncLocalStorage context for the whole engine call (`[run.ts:withUsageRun]`); the caller likewise (`[origin.ts:runAsCaller]`).
- A usage write never fails or slows the AI call: it starts after the run closes and errors are logged (`[store.ts:writeUsageRun]` header).
- Read queries take a scope: `userId: null` reads everyone (`ai_usage:view`), otherwise only that user (`[queries.ts:usageSummary]` header).

## Side Effects
- Writes `ai_usage_requests`, `ai_usage_steps`, `ai_usage_egress`, `ai_guardrail_events` and prunes by `AI_USAGE_RETENTION_DAYS` (`[store.ts:persistUsageRun]`, `[store.ts:pruneAiUsage]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
