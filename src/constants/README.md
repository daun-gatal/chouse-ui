# constants

## Overview
Client mirrors of the server's AI provider and AI model-parameter constants, used by the admin AI configuration forms to validate input before it is sent. The server copies are the source of truth.

## Interface
- `aiProviders.ts` - `PROVIDER_TYPES`, `ProviderType`, `formatProviderType`, `PROVIDER_REQUIREMENTS` / `ProviderRequirements`, `PROVIDER_BASE_URL_PLACEHOLDERS` [aiProviders.ts:PROVIDER_TYPES]
- `aiModelParams.ts` - `AiModelParams`, `AiModelParamKey`, `PROVIDER_PARAM_KEYS`, `PARAM_BOUNDS`, `STOP_SEQUENCES_MAX`, `EXTRA_BLOCKED_KEYS`, `EXTRA_MAX_KEYS`, `EXTRA_MAX_BYTES`, `validateAiModelParams`, `hasAnyParams`, `isStructuredOutputPolicy`, `STRUCTURED_OUTPUT_POLICIES`, `INPUT_MODALITIES`; UI metadata `NUMBER_PARAM_FIELDS`, `REASONING_EFFORT_OPTIONS`, `VERBOSITY_OPTIONS` [aiModelParams.ts:validateAiModelParams]

## Invariants
- `aiProviders.ts` MUST stay in sync with `packages/server/src/rbac/constants/aiProviders.ts`; add new providers to both [aiProviders.ts:PROVIDER_TYPES].
- `aiModelParams.ts` MUST stay in sync with `packages/server/src/rbac/constants/aiModelParams.ts` (types, allowed keys, bounds, `validateAiModelParams`); the server copy is the source of truth [aiModelParams.ts:validateAiModelParams].
- `validateAiModelParams` returns human-readable errors and an empty array means valid; keys outside `PROVIDER_PARAM_KEYS[providerType]` are rejected [aiModelParams.ts:validateAiModelParams].

## Side Effects
- None. Constants and pure functions only.

## Verification
- Run: `bunx vitest run src/constants`
