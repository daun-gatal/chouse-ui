type: minor

### Added
- **Chat apps** — Slack and Google Chat channels gain an **App** mode (a Slack bot token and signing secret; a Google Chat app with a service account), and **Telegram** channels arrive. These channels edit what they posted — a fleet or dashboard alert shows *resolved* in place, a request shows who decided it — and carry buttons that call back to CHouse
- **Act from chat** — **Acknowledge** and **Snooze 1h** on Data Health alerts, **Approve** and **Reject** on remediation proposals, **Approve** and **Decline** on AI requests. Every press is checked by its platform, matched to an active CHouse user (Slack and Google Chat by email, Telegram by an account linked in **Preferences › Linked chat accounts**), and runs through the same route the UI uses as that person. Audited as `alerting.chat_action`
- **Who can act from this channel** — an allowlist per channel (Slack users and user groups, Google emails and domains, Telegram user IDs, CHouse users and roles) that narrows who may press its buttons
- **Need You alerts** — AI Governance › Assistant › Chobi › Alerts sends second-approver changes, background proposals and optionally held MCP calls to team channels after a delay, with Approve and Decline where the channel allows, and edits them once they are settled
- **Memory suggestions** — after a quiet Chobi conversation, up to three notes worth keeping appear as chips (**Save to me**, **Propose to team**, **Dismiss**); nothing is saved without a click, and administrators can turn it off
- **Remediation channels** — post remediation proposals to any alert channel, picked in Admin › Alerting › Rules; the Slack bot set by environment variables keeps working
- **Alerting history API** — `GET /api/alerting/events/search` with search, source, severity, channel, delivery and time filters and cursor pages; `GET /api/alerting/overview` and `GET /api/alerting/sources`; channels report delivery health and what uses them. `list_alerting` and the MCP `list_alerts` gain `sources`, `overview` and filtered `events`

### Changed
- **Admin › Alerting** — becomes Overview, Channels, Rules and Activity, with search, filters and pages kept in the address. Adding a channel is four steps (platform, connect, test, who can act); Rules lists every feature that sends alerts; Activity shows where each alert went and whether it got there
- **One alert format** — every feature sends through one notify layer, so every channel type and mode works for fleet alerts, the Doctor's root-cause report, scheduled queries, Data Health, dashboard alerts and reports, auto-triage and hand off. Webhook JSON bodies are unchanged; fleet emails use the shared alert layout

### Fixed
- **Slack mentions from data** — text in Slack alerts is escaped, so a table name or message containing `<!channel>` can no longer ping a channel
- **Auto-RCA cooldown docs** — `DOCTOR_AUTO_RCA_COOLDOWN_MINUTES` defaults to 15, as the server applies it
