type: minor

### Added
- **Chobi** — the chat becomes Chobi, a buddy made of the logo's three bars that parks on the screen edge (drag to move, Ctrl/⌘ J) and stays usable above any dialog. Panels in Bubble, Docked and Focus sizes with three tabs: **Now** (what needs a look across every connection you can reach, built from data), **Chat** and **Activity** (changes waiting for you and what AI changed, with Undo)
- **Nudges** — Chobi points out new incidents, failed jobs, unreachable clusters and approvals waiting for you, from data and never an AI call; at most one every two minutes and six an hour, with mute and quiet hours per person
- **AI write tiers** — 74 write tools in seven toolkits, each checked by tier: undoable changes run at once with **Done · Undo** for 24 hours, changes undo can't reverse ask once (or once for a plan of several, with "allow in this chat / for 1 hour"), and privileged or destructive ones need a second person who holds the same permission. A production connection makes every change one tier stricter; passwords, connections, SSO, tokens, guardrails and approvals are never AI tools
- **Connection environment** — mark a connection Production, Staging or Development in **Admin › Connections**
- **MCP write tools** — the same write tools over MCP for tokens whose user has `ai:act`, bounded by an administrator ceiling (**AI Governance › MCP › Write tools**) and each token's write policy (the wrench in **Preferences › Access tokens**); a call that asks is held while you confirm in CHouse, then returns its result or a pending action id for `get_action_status`; `undo_action` reverses undoable ones
- **CHouse Assistant v3** — one agent that owns the conversation and every change: Data & Query and the page's toolkit loaded up front, others with `load_toolkit`; four read-only investigators; `navigate`, `open_entity` and `fill_form` to show a page or put SQL in the editor; plans for multi-step changes. Ships with 40 eval cases
- **Watches** — "keep an eye on this table until tomorrow": a personal Data Health check every 15 minutes that removes itself when it ends (default 09:00 tomorrow, at most 7 days, five per connection)
- **Ask from anywhere** — Ctrl/⌘ J with text selected, drop text or an item on Chobi, Ctrl/⌘ J or **Ask Chobi about this SQL** in the SQL editor, or **Ask** on a Now item
- **Hand off** — turn a conversation into a note for an incident's notebook, a Markdown file, or a short post to an alert channel (new `POST /api/alerting/channels/:id/message` and `post_alert_message` tool)
- **Plain mode** — administrators can show the CHouse logo instead of the character and turn nudges off, in **AI Governance › Assistant › Chobi**
- **Scheduled job links** — `/data/scheduled-queries/jobs?job=<id>` opens one job

### Changed
- **Chat agents** — the chat runs CHouse Assistant; ClickHouse Data becomes its read-only investigator, and CHouse Admin is retired (agents and features that used it move to its replacements; a customized copy stays)
- **AI approvals** — undoable AI changes no longer pause for approval: they run and show Undo

### Fixed
- **Alert channel deliveries time out** — a webhook or Slack channel that never answers fails the delivery after 15 seconds instead of holding the request or the scheduler open
