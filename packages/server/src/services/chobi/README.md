# Chobi

## Overview
Chobi assistant surfaces (ADR 0025 §6, ADR 0026 §6): the data-built Now briefing, Need You alerts for requests waiting on a person, and organization settings.

## Interface
- `[briefing.ts:buildBriefing]`.
- `[needYou.ts:NeedYouSweeper]`, `[needYou.ts:sendDue]`, `[needYou.ts:refreshActionMessages]`, `[needYou.ts:settleOpen]`, `[needYou.ts:needYouMessage]`, `[needYou.ts:needYouKind]`.
- `[settings.ts:getChobiSettings]`, `[settings.ts:saveChobiSettings]`, `[settings.ts:resetChobiSettingsCache]`, `[settings.ts:DEFAULT_CHOBI_SETTINGS]`, `[settings.ts:DEFAULT_CHOBI_ALERTS]`, `[settings.ts:chobiAlertsSchema]`, `[settings.ts:chobiSettingsUpdateSchema]`.

## Invariants
- The briefing makes no model call and reads only through in-process API routes as the viewer, so it shows only what the viewer could open (`[briefing.ts:buildBriefing]`).
- Settings are one JSON document in `obs_settings` shared by all replicas, cached for 5 s (`[settings.ts:CACHE_TTL_MS]`, `[settings.ts:getChobiSettings]`).

## Side Effects
- `[needYou.ts:NeedYouSweeper]` ticks every 15 s on a `setInterval` under a 60 s `obs_leases` lease, sends/edits channel messages via the notify layer, and every 6 h prunes `channel_messages` and `chat_link_codes` (`pruneMessages`, `pruneLinkCodes`).
- `[needYou.ts:sendDue]` writes an `AUDIT_ACTIONS.CHOBI_ALERT_SENT` audit entry per alert that reached a channel.
- At module load `needYou.ts` registers the chat actions `ai_action.approve` / `ai_action.reject`, which POST in-process to `/api/ai-actions/:id/approve|reject` (`registerChatAction`).
- `[settings.ts:saveChobiSettings]` writes `obs_settings`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
