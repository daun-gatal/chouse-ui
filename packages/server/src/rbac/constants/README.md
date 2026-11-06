# RBAC AI Constants

## Overview
Single source of truth for AI provider types, per-model runtime parameters,
and per-model token pricing stored on RBAC AI model rows
(`rbac_ai_models.params`, `rbac_ai_models.pricing`). Pure data and validators,
used by the AI provider/model routes and services.

## Interface
- `aiProviders.ts`
  - `[aiProviders.ts:PROVIDER_TYPES]` / `[aiProviders.ts:ProviderType]` - 16 providers (`openai`, `anthropic`, `google`, `openai-compatible`, `azure-openai`, `groq`, `mistral`, `cohere`, `ollama`, `xai`, `deepseek`, `cerebras`, `bedrock`, `fireworks`, `together`, `openrouter`).
  - `[aiProviders.ts:PROVIDER_REQUIREMENTS]` / `[aiProviders.ts:ProviderRequirements]` - `requiresBaseUrl` / `requiresApiKey` per provider.
  - `[aiProviders.ts:isValidProviderType]` - type guard.
- `aiModelParams.ts`
  - `[aiModelParams.ts:AiModelParams]`, `AiModelParamKey`, `ReasoningEffort`, `Verbosity`, `InputModality`, `StructuredOutputPolicy`, `AiSafetySetting`.
  - `[aiModelParams.ts:PROVIDER_PARAM_KEYS]` - params each provider accepts; `[aiModelParams.ts:PARAM_BOUNDS]`, `[aiModelParams.ts:STOP_SEQUENCES_MAX]`.
  - `[aiModelParams.ts:EXTRA_BLOCKED_KEYS]`, `EXTRA_MAX_KEYS` (20), `EXTRA_MAX_BYTES` (8192) - limits on the free-form `extra` object.
  - `[aiModelParams.ts:validateAiModelParams]` - returns a list of human-readable errors (empty = valid); `[aiModelParams.ts:hasAnyParams]`; `[aiModelParams.ts:isStructuredOutputPolicy]`; `INPUT_MODALITIES`, `STRUCTURED_OUTPUT_POLICIES`.
- `aiModelPricing.ts`
  - `[aiModelPricing.ts:AiModelPricing]` (USD per 1M tokens: `input`, `output`, optional `cacheRead`, `cacheWrite`).
  - `[aiModelPricing.ts:aiModelPricingSchema]` - strict Zod schema; `[aiModelPricing.ts:MAX_PRICE_PER_MILLION]` (10,000).

## Invariants
- `aiModelParams.ts` is mirrored in the frontend at `src/constants/aiModelParams.ts`; keep both in sync (header of `[aiModelParams.ts]`).
- `validateAiModelParams` stays pure (no Zod) so the frontend mirror can reuse it verbatim `[aiModelParams.ts:validateAiModelParams]`.
- An absent or `NULL` param means "use the built-in default" `[aiModelParams.ts]` header.
- `extra` may never contain `model`, `messages`, `stream`, `tools`, `tool_choice`, `api_key`, `max_tokens`, `temperature` `[aiModelParams.ts:EXTRA_BLOCKED_KEYS]`.
- A model with no pricing is valid (tokens shown without cost); prices must be finite, >= 0, <= `MAX_PRICE_PER_MILLION`, and unknown keys are rejected (`.strict()`) `[aiModelPricing.ts:aiModelPricingSchema]`.
- Adding a provider means updating `PROVIDER_TYPES`, the provider registry in `aiConfig.ts`, `PROVIDER_REQUIREMENTS`, and a DB migration if needed (header of `[aiProviders.ts]`); `PROVIDER_PARAM_KEYS` and `STOP_SEQUENCES_MAX` are typed `Record<ProviderType, ...>` so they must cover it too.
- For `bedrock`, the API-key slot holds encrypted JSON credentials `{region, accessKeyId, secretAccessKey}` `[aiProviders.ts:PROVIDER_REQUIREMENTS]`.

## Side Effects
- None. Pure constants, types, and validators.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/rbac/constants`
