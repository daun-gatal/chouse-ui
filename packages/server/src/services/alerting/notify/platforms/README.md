# Notify Platforms

## Overview
Per-platform rendering and delivery of a `NotifyMessage` (ADR 0026): Slack, Google Chat, Telegram, email and generic webhooks.

## Interface
- `[slack.ts:renderSlack]`, `[slack.ts:postSlackWebhook]`, `[slack.ts:postSlackApp]`, `[slack.ts:updateSlackApp]`, `[slack.ts:slackIdentity]`, `[slack.ts:slackApi]` (one Web API call).
- `[googleChat.ts:renderGoogleChat]`, `[googleChat.ts:postGoogleChatWebhook]`, `[googleChat.ts:postGoogleChatApp]`, `[googleChat.ts:updateGoogleChatApp]`, `[googleChat.ts:parseServiceAccount]`, `[googleChat.ts:googleChatSpace]`, `[googleChat.ts:spaceName]`.
- `[telegram.ts:renderTelegram]`, `[telegram.ts:postTelegram]`, `[telegram.ts:updateTelegram]`, `[telegram.ts:telegramIdentity]`, `[telegram.ts:telegramApi]` (one Bot API call), `[telegram.ts:botIdOf]`.
- `[email.ts:renderEmailHtml]`, `[email.ts:sendEmail]`, `[email.ts:emailConfig]`.
- `[webhook.ts:postWebhook]`.

## Invariants
- Slack and Google Chat: webhook mode can only post; App mode (Slack bot token, Google Chat service account) can edit posted messages and carry buttons (`[slack.ts:renderSlack]`, `[googleChat.ts:renderGoogleChat]` headers).
- Telegram has no webhook-only mode: it is always a bot, which can always edit what it posted (`[telegram.ts:renderTelegram]` header).
- Telegram buttons work only once the webhook is registered (`[telegram.ts:renderTelegram]` header).

## Side Effects
- Outbound HTTP to Slack, Google Chat, Telegram and webhook endpoints via `../text.ts:requestJson`; SMTP via nodemailer (`[email.ts:sendEmail]`).
- Google Chat App mode signs a JWT with the service-account key, exchanges it at Google's OAuth token endpoint, and caches access tokens in a process-local `Map` until shortly before expiry (`[googleChat.ts:postGoogleChatApp]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
