# AiModels

## Overview

Admin page with Deployments, Provider models and Providers tabs for CRUD of AI providers, base models (runtime params and per-1M-token pricing) and deployment configs via the `rbacAi*Api` clients in `@/api/rbac`.

## Interface

- `[index.tsx:AiModelsManagement]` - default export; tab shell (default tab `configs`)
- `[ConfigsTab.tsx:ConfigsTab]` - list/create/rename/activate/make-default/delete deployment configs
- `[BaseModelsTab.tsx:BaseModelsTab]` - base model CRUD with provider-specific params (`@/constants/aiModelParams`), modalities and pricing
- `[ProvidersTab.tsx:ProvidersTab]` - provider CRUD and active toggle (API key, base URL, Bedrock AWS credentials)
- `[pricing.ts:MAX_PRICE_PER_MILLION]` - 10_000 USD bound matching the server
- `[pricing.ts:PricingDraft]`, `EMPTY_PRICING_DRAFT`, `PRICING_FIELDS`, `pricingDraftFrom`, `buildPricing`, `pricingSummary` - price form model, validation and formatting

## Invariants

- `canEdit` = AI_MODELS_UPDATE or AI_MODELS_CREATE, `canDelete` = AI_MODELS_DELETE via `useRbacStore().hasPermission` `[ConfigsTab.tsx:ConfigsTab]` `[ProvidersTab.tsx:ProvidersTab]` `[BaseModelsTab.tsx:BaseModelsTab]`
- Pricing: all-empty means null; otherwise input and output required, finite, >= 0 and <= `MAX_PRICE_PER_MILLION` `[pricing.ts:buildPricing]`
- Only `PROVIDER_PARAM_KEYS[providerType]` params are sent; JSON extras must parse; `validateAiModelParams` blocks submit on error `[BaseModelsTab.tsx:BaseModelsTab]`
- Bedrock edit requires all three AWS fields or none; empty key/credentials on edit keep the current ones; provider type locked on edit `[ProvidersTab.tsx:ProvidersTab]`
- Config edit sends only `name` (modelId fixed after create) `[ConfigsTab.tsx:ConfigsTab]`

## Side Effects

- `rbacAiConfigsApi`, `rbacAiBaseModelsApi`, `rbacAiProvidersApi` list/create/update/delete calls held in local `useState` with manual refetch (no TanStack Query) `[ConfigsTab.tsx:ConfigsTab]` `[BaseModelsTab.tsx:BaseModelsTab]` `[ProvidersTab.tsx:ProvidersTab]`
- Dispatches window `CustomEvent('ai-config-updated')` after config mutations `[ConfigsTab.tsx:ConfigsTab]`
- sonner toasts on success and failure in all tabs

## Verification

- Run: `bunx vitest run src/features/admin/components/AiModels` (from repo root; full suite: `bunx vitest run`)
