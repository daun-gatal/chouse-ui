# 0026 — Shared Notify Layer, Chat Apps and Actions from Chat

- **Status:** Accepted
- **Date:** 2026-10-25
- **Builds on:** [0016](0016-data-observability-platform.md) (remediation, Slack approvals), [0021](0021-custom-dashboards.md) and [0023](0023-dashboards-v2.md) (panel alerts, reports), [0024](0024-ai-platform-v2.md) (approved actions, memory, triage), [0025](0025-ai-write-tiers-assistant-v3-chobi.md) (tiers, Chobi)
- **Scope:** alert delivery (`services/alerting`), every feature that sends to a channel, `/api/integrations`, AI actions, remediation, Data Health, Chobi, Admin › Alerting, AI Governance › Assistant, the RBAC database. One release, one PR, one commit per step.

## Context

Eight features send to notification channels: fleet threshold alerts, the fleet
root-cause report, scheduled queries (and Data Health, through their outbox),
dashboard panel alerts, dashboard reports, auto-triage, the Chobi hand off and
remediation approvals. They send in three different ways:

- five call `sendChannelMessage` with a `{title, text}` pair;
- fleet alerts and the root-cause report carry their own Slack, Google Chat,
  email and webhook code in `fleetAlerter.ts`, which also skips any channel
  without a `webhookUrl`;
- remediation posts with a Slack bot configured by environment variables
  (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `REMEDIATION_SLACK_CHANNEL`).

Every channel only posts. Nobody can answer from where the alert lands: an
approval that waits on a person (a second approver, a background proposal, a
held MCP call, a remediation) waits until that person opens CHouse. Messages are
never updated, so a resolved alert stays red in the channel. There is no
Telegram. Admin › Alerting shows four of the eight features and records only
successful deliveries, so a failing channel goes unnoticed.

## Decision

### 1. One notify layer for every feature

`services/alerting/notify` takes a structured message — title, severity, facts,
body, links, optional buttons, optional webhook body — and renders it for each
platform: Slack Block Kit, a Google Chat card, Telegram HTML with an inline
keyboard, an HTML email, and webhook JSON. Every feature sends through it,
fleet and the root-cause report included, so every feature works on every
channel type and mode, and the per-feature copies of platform code go away.

Compatibility rules:

- A feature that has a webhook JSON contract today keeps it byte for byte
  (`kind: "fleet_alert"`, `kind: "fleet_rca"`, `{title, text}`, the test's
  `{title, text, test: true}`). The message carries its webhook body.
- Every message a feature sends today is still sent. Edits are additive: when
  an alert resolves, an App-mode channel also edits the original message.
- `sendChannelMessage` and `sendChannelTest` (`alerting/deliver.ts`) are
  removed: every caller moves to the notify layer in the same change.

### 2. Channel modes and Telegram

| Type | Modes | Stored (secrets encrypted with AES-256-GCM) |
|---|---|---|
| Slack | **Webhook** (today) or **App** | App: bot token, signing secret, channel ID |
| Google Chat | **Webhook** (today) or **App** | App: service account key (JSON), space, audience |
| Telegram (new) | always a bot | bot token, chat ID, optional topic ID |
| Email, webhook | unchanged | unchanged |

App mode and Telegram can edit what they posted and carry buttons. Webhook
mode, email and generic webhooks get link buttons only. A channel without a
`mode` is a webhook channel, so every stored channel keeps working.

Platform hosts are fixed (`slack.com`, `oauth2.googleapis.com`,
`chat.googleapis.com`, `www.googleapis.com`, `api.telegram.org`): no channel
setting can point a bot request at another host. For the e2e suite only, an
operator environment variable (`CHOUSE_INTEGRATIONS_TEST_HOSTS`, honoured only
when `CHOUSE_ALLOW_TEST_OVERRIDES=1`) points them at a local fake; it is not a
UI setting and not in the Helm chart.

### 3. Inbound endpoints

| Endpoint | Proves it came from the platform with |
|---|---|
| `POST /api/integrations/slack/interactions` (exists) | `X-Slack-Signature` HMAC over `v0:{ts}:{body}`, 5-minute skew, tried against every Slack App channel's signing secret and the env secret |
| `POST /api/integrations/google-chat/events` | the Google-signed bearer token, checked with `jose` against Google's keys: issuer `chat@system.gserviceaccount.com` with audience = project number, or issuer `https://accounts.google.com` with email `chat@system.gserviceaccount.com` and audience = the endpoint URL |
| `POST /api/integrations/telegram/:botId` | `X-Telegram-Bot-Api-Secret-Token`, an HMAC of the bot token under the server's encryption key, registered with `setWebhook` when the channel is saved |

They are public (the platforms cannot send a CHouse session), rate limited per
platform, and refuse anything that does not verify. A click from a space, chat
or Slack channel other than the one the message was posted to is refused.

### 4. Actions from chat

A button is a named action (`ai_action.approve`, `ai_action.reject`,
`remediation.approve`, `remediation.reject`, `data_health.ack`,
`data_health.snooze`). A feature registers a handler; the endpoints verify the
request, find the CHouse user, check the channel's allowlist and call the
handler, which applies **the same checks as its UI route**:

- **Who clicked.** Slack: `users.info`, confirmed email → CHouse user (as
  remediation does today). Google Chat: the event's email → CHouse user.
  Telegram: a linked account (`chat_identities`), made in the profile with a
  one-time `/start` code that expires in 10 minutes. No mapping → refused.
- **Who can act from this channel.** A per-channel allowlist: anyone with the
  permission (default), or only listed platform users or groups (Slack users
  and user groups, Google emails and domains, Telegram user IDs) and CHouse
  users or roles. It only narrows; it never grants.
- **The feature's own rule.** The handler re-checks the user is active, holds
  the permission, can reach the connection and is not the requester where the
  feature forbids it (T3 actions, class-2 and AI-proposed remediation). Held MCP
  calls are confirmed only by their own user.
- **Running as the approver.** An AI action approved from chat runs as the
  approver through the in-process API with an access token minted for that
  approver, valid for two minutes and never sent anywhere.
- Every decision is audited with the platform, the channel and the platform
  user. The two-person race is settled by the existing conditional updates.

Arguments are never edited from chat, and messages never carry an action's
raw arguments — only its description, who asked, where and when it expires.

### 5. One message log

`channel_messages` records every send: channel, feature, subject, kind, the
platform's message reference, outcome and error. It is the claim that keeps two
replicas from sending the same message (unique on channel, feature, subject,
kind), what lets a feature edit what it posted, and where Admin › Alerting reads
delivery health. `chat_identities` holds linked platform accounts and
`chat_link_codes` the one-time linking codes. `alert_events` gains an indexed
`source` column, filled in for existing rows, so history can be filtered.
Migration 1.74.0.

### 6. Chobi › Need You

AI Governance › Assistant › Chobi › Alerts: on or off, which events (second
approver, background approvals, held MCP calls), a delay ("only if still
waiting after N minutes") and the channels, each with **Approve from chat**
where the channel supports buttons. A sweeper on a lease sends what is due and
edits messages once a request is decided, expires or finishes, whichever
replica decided it. `PUBLIC_BASE_URL` is required for the review link; without
it the alert is not sent and Admin says why.

Remediation approvals move onto channels chosen in Admin › Alerting; the
environment-variable bot keeps working as a fallback. Data Health alerts get
**Acknowledge** and **Snooze 1h**; fleet and dashboard alerts edit their own
message when they resolve.

### 7. Admin › Alerting

Tabs **Overview**, **Channels**, **Rules**, **Activity**, with search, filters and
pagination kept in the URL. Channels show health and what uses them; adding a
channel is four steps (platform, connect, test, who can act) shared with every
channel picker. Rules lists every source, edits fleet rules in place and links
the rest to where they are managed. Activity filters on the server through new
optional parameters on `GET /alerting/events`; with only `limit` it answers as
before. Routes, permissions and delete guards are unchanged.

### 8. AI and MCP

`list_alerting` / `list_alerts` gain the same filters, channel mode, health and
"used by" (never secrets), and a `sources` kind. Existing write tools reach every
platform through the notify layer. Channel credentials and modes, allowlists,
Chobi alert settings, chat identities and chat approvals are never AI tools; a
test fails if any chat, MCP or CLI tool can write them.

### 9. Memory suggestions

When a Chobi thread goes quiet, one AI call suggests up to three notes worth
keeping; Chobi shows them as chips (**Save to me**, **Propose to team**,
**Dismiss**). Nothing is saved without a click. Suggestions pass the same
guardrail screen and duplicate check as `remember`, count toward usage, and can
be turned off in Chobi settings.

## Consequences

- One rendering path: a new platform is one module, a new feature is one
  message builder. Fleet emails change look (the shared layout) but not content.
- Three new public endpoints. Each is authenticated by its platform, refuses
  unmapped people and re-checks CHouse permissions, so a leaked webhook URL or
  a compromised chat account can do no more than the CHouse user behind it.
- A minted two-minute access token exists in-process while an approved action
  runs. It is signed like any session token and carries the approver's current
  roles and permissions, read when it is minted.
- Admins configure apps on the platforms (a Slack app from a manifest, a Google
  Chat app, a Telegram bot). Webhook channels keep working with no change.
- No Helm change: new settings live in the database and `PUBLIC_BASE_URL`
  already exists.

## Alternatives considered

- **Chobi-only alerts, other features unchanged.** Rejected: Telegram and App
  mode would reach one feature, and fleet alerts would silently skip App-mode
  channels.
- **Allowlists in each feature's settings.** Rejected: the same channel's
  buttons would answer to different people per feature; the channel is where
  the audience lives.
- **One-click signed links in email.** Rejected: mail scanners open links.
  Email gets a review link to a page that needs sign-in.
- **Telegram long polling.** Deferred: needs one replica holding the poll.
  Webhooks work on any number of replicas.

## As shipped

| Section | Commit | Notes |
|---|---|---|
| §1, §5 | Shared notify layer | Every feature moved, fleet and the root-cause report included; `sendChannelMessage`/`sendChannelTest` removed. Messages a channel cannot edit are closed when sent. Migration 1.74.0 (`channel_messages` also stores the rendered message, so an edit can start from it on any replica). |
| §2 | Telegram, Slack and Google Chat App mode | Checks before the test message; a mode switch needs the new mode's secrets. |
| §3, §4 | Act from chat | A click is routed to the channel that posted its message, even when several share a bot or a space. Telegram buttons only show once its webhook is registered. |
| §6 | Need You alerts | Approved and running requests keep their message open until they land; an edit that changes nothing makes no platform call. |
| §7, §8 | Alerting hub, AI and MCP reads | `GET /alerting/events/search`, `/overview`, `/sources`; *Firing now* counts only enabled fleet rules. |
| §9 | Memory suggestions | Asked 45 s after a conversation goes quiet, or on demand; the model answer is cached per thread length and re-filtered against memory on every ask. |
