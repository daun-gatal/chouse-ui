# AI Services

## Overview
The single DeepAgents runtime for every CHouse AI feature (ADR 0019): the engine resolves `feature -> bound agent -> agent tree` from the registry, resolves the model, applies budgets, and extracts structured output. Subpackages hold capabilities, the registry, write actions, guardrails, memory, runtime, evals, triage, usage tracking and seeds.

## Interface
- `[engine.ts:runStructuredCapability]`, `[engine.ts:runFeature]`, `[engine.ts:invokeChat]`, `[engine.ts:boundAgent]`, `[engine.ts:budgetedModel]`.
- `[model.ts:resolveDeepAgentModel]`, `[model.ts:usageModelRef]`; `[modelProfile.ts:applyContextWindow]`, `[modelProfile.ts:profileContextWindow]`; `[sampling.ts:acceptsSampling]`, `[sampling.ts:samplingFields]`.
- `[budgets.ts:checkBudgets]`, `[budgets.ts:createBudget]`, `[budgets.ts:updateBudget]`, `[budgets.ts:deleteBudget]`, `[budgets.ts:budgetStatuses]`, `[budgets.ts:budgetSpend]`.
- `[structuredOutput.ts:structuredOutput]`, `[structuredOutput.ts:extractJson]`.
- `[errors.ts:handleAiError]`; `[langchainTools.ts:createAgentTool]`, `[langchainTools.ts:toolsArray]`.
- `[dataOpsEvidence.ts:buildScheduledQueryEvidence]`, `[dataOpsEvidence.ts:buildDataHealthEvidence]`, `[dataOpsEvidence.ts:getDataOpsAiCache]`.
- `types.ts` - shared capability types (type-only module).
- Subpackages: [actions](./actions/README.md), [assistant](./assistant/README.md), [capabilities](./capabilities/README.md), [evals](./evals/README.md), [guardrails](./guardrails/README.md), [memory](./memory/README.md), [registry](./registry/README.md), [runtime](./runtime/README.md), [seeds](./seeds/README.md), [triage](./triage/README.md), [usage](./usage/README.md).

## Invariants
- Every AI feature runs through the engine against its registry-bound agent (`[engine.ts:boundAgent]`).
- Budgets are checked before a run starts; spend is read from `ai_usage_requests`, so every recorded request in the period counts (`[budgets.ts:checkBudgets]`).
- Missing or invalid model config surfaces as `AppError.badRequest` (`[model.ts:resolveDeepAgentModel]`).
- Provider failures map to the same user-facing messages for every capability (`[errors.ts:handleAiError]`).
- Sampling parameters are omitted for models that reject them (`[sampling.ts:samplingFields]`).

## Side Effects
- Model/provider network calls via the engine.
- Writes `ai_budgets` (`[budgets.ts:createBudget]`).
- In-memory caches: `[dataOpsEvidence.ts:setDataOpsAiCache]`, `[structuredOutput.ts:clearStructuredOutputStrategyCache]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
