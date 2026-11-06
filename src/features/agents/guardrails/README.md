# guardrails

## Overview

AI Governance > Guardrails: list, create, edit, drag-reorder, test and roll back guardrails and view paged trigger events, via `@/api/aiGuardrails`.

## Interface

- `[GuardrailsPanel.tsx:GuardrailsPanel]` - KPIs, stage filter, sortable table, triggers
- `[GuardrailEditor.tsx:GuardrailEditor]` - edit sheet with test, revisions, reset/delete
- `[NewGuardrailDialog.tsx:NewGuardrailDialog]` - 4-step wizard with optional AI draft
- `[GuardrailForm.tsx:BasicsSection]`, `ConfigSection`, `ScopeSection`, `TestSection`
- `[hooks.ts:guardrailKeys]`, `useGuardrails`, `useGuardrailEvents`, `useGuardrailMutations`, `useGuardrailTest`, `useGuardrailDraft`, `useGuardrailRevisions`
- `[lib.ts:blankGuardrail]`, `withStages`, `allowedActions`, `uniqueSlug`, `moveId`, `appliesToAgent`, `kindStages`, `defaultConfig`, plus small `slugify` / `linesOf` / `listOf` and label maps

## Invariants

- Managing gated on `RBAC_PERMISSIONS.AI_GUARDRAILS_MANAGE` `[GuardrailsPanel.tsx:GuardrailsPanel]` `[GuardrailEditor.tsx:GuardrailEditor]`
- Reorder only when stage filter is `all` and none pending `[GuardrailsPanel.tsx:GuardrailsPanel]`
- New guardrails default to shadow mode `[lib.ts:blankGuardrail]`
- Action kept only if allowed by every stage; MCP scope needs `tool_result` stage and non-judge kind `[lib.ts:withStages]`
- Updates/deletes send `version` (optimistic concurrency) `[hooks.ts:useGuardrailMutations]`

## Side Effects

- `@/api/aiGuardrails` get/create/update/state/reorder/delete/reset/rollback/test/draft `[hooks.ts:useGuardrailMutations]`
- Invalidates `['ai-guardrails']` after mutations `[hooks.ts:useInvalidating]`
- Toasts; trigger rows link to `/ai/usage?request=<id>` `[GuardrailsPanel.tsx:TriggersPanel]`

## Verification

- Run: `bunx vitest run src/features/agents/guardrails` (from repo root; full suite: `bunx vitest run`)
