# AI Guardrails

## Overview
Administrator-configured guardrails applied at stages of every agent run (ADR 0022): kinds and their schemas, built-in detectors, text matching/redaction, the per-run runner and middleware, management operations, trigger events and AI drafting.

## Interface
- `[types.ts:GUARDRAIL_KINDS]`, `[types.ts:GUARDRAIL_STAGES]`, `[types.ts:GUARDRAIL_ACTIONS]`, `[types.ts:GUARDRAIL_MODES]`, `[types.ts:REDACT_STRATEGIES]`.
- `[kinds.ts:KIND_SPECS]`, `[kinds.ts:guardrailProblems]`, `[kinds.ts:regexProblem]` - save-time validation.
- `[detectors.ts:DETECTORS]`, `[detectors.ts:detectorById]` - built-in pattern detectors.
- `[text.ts:redactSpans]`, `[text.ts:patternFinder]`, `[text.ts:maskColumns]`, `[text.ts:capRows]`, `[text.ts:GuardrailInputTooLarge]`.
- `[runner.ts:GuardrailRunner]`, `[runner.ts:guardrailsForRun]`, `[runner.ts:GuardrailBlockedError]`, `[runner.ts:GuardrailFailedError]`, `[runner.ts:mcpCapable]` (kinds that can apply to MCP tool results).
- `[runtime.ts:runnerForRun]`, `[middleware.ts:guardrailMiddleware]` - per-run wiring and agent middleware.
- `[service.ts:createGuardrail]`, `[service.ts:updateGuardrail]`, `[service.ts:setGuardrailState]`, `[service.ts:reorderGuardrails]`, `[service.ts:deleteGuardrail]`, `[service.ts:rollbackGuardrail]`, `[service.ts:resetGuardrail]` (built-ins only, back to shipped content), `[service.ts:guardrailUpdateAvailable]`.
- `[events.ts:triggerCounts]`, `[events.ts:guardrailEvents]`, `[events.ts:writeMcpGuardrailEvents]`.
- `[draft.ts:GuardrailDraftSchema]`, `[draft.ts:finalizeGuardrailDraft]`.

## Invariants
- Routes, the AI drafter and seed tests accept exactly the same shapes because validation lives in `[kinds.ts:guardrailProblems]`.
- Guardrails are registry rows: every write is validated, recorded as a revision and bumps the registry version (`[service.ts:createGuardrail]` header).
- `[middleware.ts:guardrailMiddleware]` is built per agent node and returns `null` when no guardrail applies to that node; the `input` stage runs only on the root agent.
- AI drafts never save and start in shadow mode (`[draft.ts:finalizeGuardrailDraft]` header).

## Side Effects
- Writes registry rows through `../registry/store` (`[service.ts:createGuardrail]`).
- Writes `ai_guardrail_events` for MCP triggers (`[events.ts:writeMcpGuardrailEvents]`); run triggers are recorded on the usage run (`[runtime.ts:runnerForRun]`).
- `[runtime.ts:judgeText]` makes model calls for judge-based guardrails.
- `[runtime.ts:runnerForRun]` runs `EXPLAIN ESTIMATE` against ClickHouse for `SELECT`/`WITH` statements of session tools, to estimate rows read.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
