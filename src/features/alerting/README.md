# alerting

## Overview

Alerting dialogs: notification channel wizard (Platform, Connect, Test, Who can act), fleet alert rule editor and the who-can-act allowlist editor, via `@/api/alerting`.

## Interface

- `[ChannelDialog.tsx:ChannelDialog]` - channel create/edit wizard
- `[ChannelDialog.tsx:ALERTING_KEYS]` - shared alerting query keys; `DIALOG_SAVE_BTN`
- `[RuleDialog.tsx:RuleDialog]` - alert rule editor
- `[WhoCanActEditor.tsx:WhoCanActEditor]` - allowlist editor
- `[actors.ts:actorsOf]`, `ANYONE`, `classifyEntry`, `withEntry`, `withoutEntry`, `actorsSummary`, `ENTRY_HINT` (per-platform entry placeholder)

## Invariants

- Only one enabled FleetThreshold rule allowed; name required `[RuleDialog.tsx:RuleDialog]`
- Webhook URL must match the provider `[ChannelDialog.tsx:urlTypeMismatch]`
- Secrets write-only: empty secret fields omitted `[ChannelDialog.tsx:input]`
- Who can act only for app/bot channels `[ChannelDialog.tsx:saveActors]`
- Entry formats validated per platform `[actors.ts:classifyEntry]`; `only` with an empty list means nobody `[actors.ts:actorsSummary]`

## Side Effects

- `createChannel`, `updateChannel`, `testChannel`, `listChannels`, `listRules`, `createRule`, `updateRule`; `fetchDoctorModels`; `rbacRolesApi.list`, `rbacUsersApi.list` `[ChannelDialog.tsx:ChannelDialog]` `[RuleDialog.tsx:RuleDialog]` `[WhoCanActEditor.tsx:WhoCanActEditor]`
- Invalidates `ALERTING_KEYS.channels` `[ChannelDialog.tsx:saveConnect]` and `ALERTING_KEYS.rules` `[RuleDialog.tsx:RuleDialog]`
- Auto test after save; clipboard copy of callback URL `[ChannelDialog.tsx:callbackUrl]`; toasts and `log.error`

## Verification

- Run: `bunx vitest run src/features/alerting` (from repo root; full suite: `bunx vitest run`)
