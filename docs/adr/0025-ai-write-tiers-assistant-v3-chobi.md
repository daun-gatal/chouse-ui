# 0025 — AI Write Tiers, CHouse Assistant v3 and Chobi

- **Status:** Accepted
- **Date:** 2026-10-24
- **Builds on:** [0013](0013-chouse-mcp.md) and [0017](0017-mcp-managed-in-the-ui.md) (MCP), [0018](0018-cli-1-0.md) (CLI), [0019](0019-deepagents-managed-in-the-ui.md) (agent registry), [0022](0022-ai-guardrails.md) (guardrails), [0024](0024-ai-platform-v2.md) (durable runs, approved actions, triage, evals)
- **Scope:** the action layer (`services/ai/actions`), the chat runtime, the MCP endpoint, the CLI, the built-in agents, the chat UI (replaced by Chobi), Data Health (watches) and the RBAC database. One release, one PR, one commit per step.

## Context

ADR 0024 gave the AI seven write tools, each paused for the user's approval.
Three problems showed up as soon as people used them:

1. **Approval on every write is friction, not safety.** Saving a query and
   dropping a table get the same card. People click through cards they stop
   reading, and an approval that is always clicked protects nothing.
2. **The AI can do very little of CHouse.** Seven tools cover a sliver of what
   the UI does. MCP clients (Claude Code, Cursor) only get the hand-written MCP
   tools, and MCP approval is entirely the client's permission prompt — CHouse
   never sees a human decision.
3. **The assistant is a router, not a teammate.** `chouse-assistant` routes to
   `clickhouse-data` or to `chouse-admin`, which routes again to three auditors:
   three model hops for an admin question, sub-agents that do not see the
   conversation, no work across domains, and no idea which page the user is on.
   The chat itself is a side tab that waits to be asked and sits at the same
   z-index as every dialog, so opening one closes the other.

## Decision

### 1. Tiers instead of "approve every write"

Every write tool has a **tier** — how it is checked — decided per call:

| Tier | Meaning | Check |
|---|---|---|
| read | changes nothing | none |
| **T1** | reversible | runs at once; recorded with an **undo** |
| **T2** | has effects that undo cannot reverse (runs a job, sends a message, creates a table) | one confirmation where the user already is |
| **T3** | privileged or irreversible (DROP, ALTER, grants, roles, policies) | a **second person** who holds the same permission approves in CHouse |
| No | never exposed to AI | — |

The effective tier of a call is computed in one place (`resolveTier`):

1. the tool's base tier (a function of the arguments where it matters, e.g.
   raw SQL is tiered by statement type, `kill_query` by whose query it is);
2. **production bump**: on a connection an admin marked `production` (the
   connection's new Environment field, kept in its metadata), T1 → T2 and
   T2 → T3;
3. **self-access**: a call that changes the caller's own access (their roles,
   policies, ClickHouse grants) is always T3 with a different approver.

**Undo.** A T1 call snapshots the object before and after it runs. Undo is
offered for 24 hours, and only while the object still matches the "after"
snapshot: if a person or another call changed it since, undo refuses rather
than overwrite their change. Undo runs as the user, through the same routes.

**Plans.** When the model asks for two or more writes in one step, they are
confirmed together once (a plan), at the highest tier among them.

**Grants (chat only).** A T2 confirmation can be "allow for this thread" or
"allow for 1 hour". A grant never covers T3, and never covers a call made after
the run read untrusted data (see below).

**Untrusted data.** Tool results that carry row data or other user-controlled
text (`run_select_query`, samples, exports, investigator summaries) mark the
run *tainted*. After that, every T2/T3 call asks again even under a grant, so
instructions hidden in data cannot ride on an earlier "yes". The MCP endpoint
is stateless and cannot see the client's context, so MCP and CLI have no grants
at all: T2 always confirms unless the token's own policy says `auto`.

### 2. One action registry, every surface

`ACTION_DEFINITIONS` stays the only place a write tool is defined, now with
`tier`, `toolkit`, a resource adapter for undo, and the surfaces it appears on.
Chat tools, MCP tools and the CLI's `chouse action` commands are all generated
from it, so the three can never disagree on what a tool does or how it is
checked. Every definition calls an existing API route in-process as the caller;
no tool reaches a service directly. About 60 write tools are added across seven
toolkits (Data & Query, Scheduling, Data Health, Observe & Ops, Dashboards &
Context, Access, Platform & Audit).

**Never exposed** (a "No" entry with a reason, enforced by a coverage test that
fails when a write permission has neither a tool nor a "No" entry): passwords
and other secrets, creating or editing connections, SSO, personal access
tokens, deleting users, guardrails, budgets, MCP and agent governance,
approving actions/memories/fixes, deleting audit entries and file upload. AI
never changes its own controls.

### 3. Where each tier is decided

| | T1 | T2 | T3 |
|---|---|---|---|
| Chat | runs, "Done · Undo" | approval card (or plan) in the chat | filed for a second approver; the chat continues |
| MCP | runs (unless the token policy says `confirm`) | the call is held (5 minutes by default, with progress notifications) while the user confirms in CHouse; then a pending `action_id` that `get_action_status` runs once confirmed | filed for a second approver (off unless an admin enables T3) |
| CLI | runs | prompt on a terminal, or `--yes` | filed; `--yes` never covers it |

Every write, whatever its tier, is a row in `ai_actions` with its origin
(`chat`, `mcp`, `cli`, `background`), tier, connection and outcome, so the
activity feed and audit show one history.

### 4. MCP

- Generated action tools join the existing MCP tools; an existing tool of the
  same name (e.g. `kill_query`, `create_saved_query`) keeps its arguments and
  behaviour.
- **Admin ceiling** (AI Governance › MCP): which toolkits MCP may expose, the
  highest tier (T3 is off until an admin turns it on), and how long a held call
  waits for confirmation.
- **Per-token policy** (set on the token by its owner, from a browser session):
  its toolkits (default: Data & Query) and how each tier is handled
  (`auto`/`confirm`/`off`; T3 `approver`/`off`). Rotating a token keeps it.
- `get_action_status` and `undo_action` are listed whenever a token has write
  tools.
- The endpoint is stateless, so a policy change applies on the client's next
  `tools/list`; there is no session to push `tools/list_changed` to. For the
  same reason it cannot ask the client back (elicitation): a client's answer
  would arrive as a separate request with nothing to match it to. The user
  confirms in CHouse instead, where the decision is audited.
- If a token's policy cannot be read, the token gets no write tools: the
  endpoint fails closed rather than failing.
- A token gets write tools only when its user has `ai:act` (or is an
  administrator) — the same rule as the chat and the CLI.

### 5. CHouse Assistant v3

One main agent owns the conversation, the page context, memory and **every
write**:

- **Core tools** always loaded; **toolkits** loaded by the page the user is on,
  by `load_toolkit`, and always filtered by the user's permissions. The model
  sees 20–40 tools, not 160.
- **UI tools** (`navigate`, `open_entity`, `fill_form`) are carried out by the
  browser; `fill_form` only fills a form that opted in, and nothing is saved
  until the user clicks Save.
- **Investigators** (`clickhouse-data`, `operations-analyst`, `access-auditor`,
  `platform-auditor`) are read-only sub-agents with their own context. Their
  summaries reach the main agent marked untrusted, and data they read can never
  trigger a write because they have no write tools.
- `chouse-admin` (it only delegated) is retired; seed sync removes it unless an
  administrator customized it, and moves its bindings and references.

### 6. Chobi

The chat becomes **Chobi** — a mascot built from the logo's three bars — that
lives above every dialog and is the single place for AI in the UI:

- **Layering:** one named z-index scale; Chobi sits above dialogs and the
  full-screen review, below the onboarding tour and toasts. Clicking Chobi never
  dismisses a dialog (Radix `DismissableLayer.Branch`); its panel takes focus
  while open and gives it back.
- **Panel** in four sizes (Peek, Bubble, Docked, Focus) with three tabs:
  **Now** (a briefing built from data, no model call), **Chat** (CHouse
  Assistant) and **Activity** (what the AI did, with undo, plus the approval
  inbox).
- **Nudges** come from events (incidents, approvals, watch trips, triage
  results), never from a model call; rate-limited, mutable, with quiet hours.
- **Watches**: "keep an eye on X" creates a personal, expiring health promise
  (default 09:00 tomorrow, max 7 days, 5 per user, per connection).
- **Drag to ask**, item actions, SQL selection and `Ctrl/⌘+J` quick ask.
- **Plain mode** (an organization setting) shows the logo instead of the
  character.

### 7. Data model

| Migration | Change |
|---|---|
| 1.71.0 | `ai_actions`: `tier`, `origin`, `token_id`, `undo`, `undo_expires_at`, `undone_at`, `undone_by`, `tool_call_id`; new `ai_action_grants` |
| 1.72.0 | `mcp_token_policies` (per-token toolkits and tier handling) |
| 1.73.0 | health promises: `owner_id`, `expires_at` (watches) |

Built-in agent changes ship through seed sync, which already upgrades
uncustomized built-ins on boot.

## Consequences

- Routine, reversible work stops asking; people only confirm what can hurt.
- A second approver is real: the requester can never approve their own T3.
- MCP gains server-side approval, which CHouse can audit, instead of trusting
  the client's prompt.
- The undo snapshot reads the object twice per T1 write; cheap compared with
  the model call that produced it.
- A larger catalog needs tool selection to stay accurate: toolkits keep the
  model's view small, and built-in evals cover toolkit choice and tier
  behaviour.

## Alternatives considered

- **Keep approve-every-write, add "approve all".** Rejected: it turns approval
  into a habit and still gives dangerous calls no second look.
- **Router with seven domain specialists.** Rejected: hand-offs lose the
  conversation, writes end up in seven places, and cross-domain work needs a
  coordinator anyway.
- **Stateful MCP sessions** for grants and `list_changed`. Rejected for now: it
  needs session affinity across replicas for little gain; per-token policies
  cover the same need.
- **Executing UI tools on the server.** Rejected: filling a form the user then
  saves keeps the UI's own validation and leaves the final click to a person.

## As shipped

| Step | Commit |
|---|---|
| Action framework v2, tiers, undo, grants, environment (1.71.0) | `c30f143` |
| Write tools (three toolkit batches), "No" list, coverage test | `8dd0d84`, `40b8fb5`, `0730db1` |
| Chat approvals (Done · Undo, plans, grants) | `7eae470` |
| MCP approvals, toolsets, admin ceiling (1.72.0) | `8756c86` |
| CLI `chouse action` | `8066913` |
| Chobi: layering, panel, mascot, Chat and Activity | `7e14d69` |
| Chobi: Now briefing, nudges, plain mode | `ed3a985` |
| Watches (1.73.0), drag to ask, quick ask | `5ec71a8` |
| Hand off (notebook, alert channel) | `f2a375e` |
| CHouse Assistant v3 | `65f2d7f` |
| Built-in evals | `cf7d416` |
| Docs, release notes, MCP `ai:act` gate | this PR's last commit |

Differences from the plan: Focus is a panel size (with the thread history docked) rather than a separate mode; the handoff to a notebook goes to an open incident's notebook, so it is readable by whoever can see the incident; nudges come from the briefing's data (a new item since the last look), polled every minute while the page is visible, rather than a server event stream.
