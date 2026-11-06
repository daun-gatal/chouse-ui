# Shared Notify Layer

## Overview
The shared notify layer (ADR 0026): every feature that talks to a notification channel builds a structured `NotifyMessage` and goes through here for rendering, claimed delivery, message log, later edits, chat buttons and actor resolution. Platform renderers live in [platforms](./platforms/README.md).

## Interface
- `[index.ts:sendToChannel]`, `[index.ts:editSubject]`, `[index.ts:checkChannel]`, `[index.ts:capabilitiesOf]`, `[index.ts:isDeliverable]`, `[index.ts:notifyChannelIds]`, `[index.ts:TEST_MESSAGE]`.
- `[types.ts:NOTIFY_FEATURES]`, `[types.ts:isNotifyFeature]`.
- `[log.ts:claimMessage]`, `[log.ts:markSent]`, `[log.ts:markFailed]`, `[log.ts:openMessages]`, `[log.ts:markEdited]`, `[log.ts:channelHealth]`, `[log.ts:pruneMessages]`, `[log.ts:MESSAGE_RETENTION_MS]` (90 days).
- `[actions.ts:registerChatAction]`, `[actions.ts:handleClick]` - buttons from chat.
- `[actors.ts:resolveActor]`, `[actors.ts:allowedToAct]`, `[actors.ts:linkIdentity]`, `[actors.ts:createLinkCode]`, `[actors.ts:consumeLinkCode]`, `[actors.ts:unlinkIdentity]`, `[actors.ts:pruneLinkCodes]`, `[actors.ts:UnmappedError]`.
- `[googleVerify.ts:verifyGoogleChatToken]`; `[telegramWebhook.ts:registerTelegramWebhook]`, `[telegramWebhook.ts:telegramSecretToken]`.
- `[hosts.ts:platformHost]`; `[links.ts:appLink]`, `[links.ts:linkTo]`, `[links.ts:publicBaseUrl]`.
- `[text.ts:requestJson]`, `[text.ts:isPublicHttpsUrl]`, `[text.ts:escapeHtml]`, `[text.ts:escapeSlack]`, `[text.ts:clip]`.
- Subpackage: [platforms](./platforms/README.md).

## Invariants
- Inserting the `channel_messages` row is the claim: the unique key on (channel, feature, subject, kind) prevents duplicate sends across replicas or outbox retries; an existing row is claimed again only when it is `failed` or stuck `sending` past `STALE_SENDING_MS` (`[log.ts:claimMessage]`).
- Bot requests only go to fixed platform origins; no channel setting can redirect them (`[hosts.ts:platformHost]`). Test host overrides come from `CHOUSE_INTEGRATIONS_TEST_HOSTS` (JSON) and apply only with `CHOUSE_ALLOW_TEST_OVERRIDES=1`.
- HTTP calls have a timeout and never leak secrets in errors (`[text.ts:requestJson]`).
- Link-back URLs require `PUBLIC_BASE_URL`; otherwise links are null (`[links.ts:appLink]`).

## Side Effects
- Writes `channel_messages` (`[log.ts:claimMessage]`), `chat_identities` and `chat_link_codes` (`[actors.ts:linkIdentity]`, `[actors.ts:createLinkCode]`).
- Deletes `channel_messages` older than 90 days (`[log.ts:pruneMessages]`), stale `chat_link_codes` (`[actors.ts:pruneLinkCodes]`) and `chat_identities` rows (`[actors.ts:unlinkIdentity]`).
- Outbound HTTP and email delivery through `platforms/`; `[telegramWebhook.ts:registerTelegramWebhook]` calls Telegram `setWebhook`; `[googleVerify.ts:verifyGoogleChatToken]` fetches Google's remote JWKS.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
