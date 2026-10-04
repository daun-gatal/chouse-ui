---
app: Preferences › Personal access tokens
route: /preferences
---
# Personal access tokens

Personal access tokens (PATs) let the [CLI](/docs/cli/), [MCP](/docs/mcp/) agents, scripts and CI act as *you* without a browser. They look like `ch_pat_…` and are sent as `Authorization: Bearer ch_pat_…`.

## Create a token

1. **Preferences › Personal access tokens › New token**.
2. Give it a **name** that says where it's used (`nightly-report`, `cursor-agent`).
3. Pick an **expiry** — 7, 30, 60 or 90 days, a custom date, or *no expiry*.
4. Optionally narrow its **scopes** to a subset of your permissions. Scopes can only narrow what you can already do, never widen it.
5. Copy the token. It is shown **once**; CHouse UI stores only a hash.

## How a token is checked

- A token carries your identity, not a frozen copy of your rights: every call checks your **current** roles, intersected with the token's scopes. Removing a role, deactivating you or revoking the token takes effect on the next call.
- Data access policies apply exactly as in the UI.
- Tokens are independent of browser sessions; signing out doesn't affect them.
- Every MCP tool call is audited with the token's user, and agent activity appears on [Agents](/docs/agents/).

## Rotate and revoke

From the token's menu: **Rotate token** issues a new secret for the same token (update wherever it is used), **Revoke token** stops it immediately. Both are recorded in the audit log (`pat.rotate`, `pat.revoke`).

> **Tip:** Create one token per consumer — each CI pipeline, each agent — with the smallest scopes and a sensible expiry, so you can revoke one without breaking the others.

## Where tokens are used

| Consumer | How |
| --- | --- |
| [CLI](/docs/cli/) | `chouse auth login` prompts for it (or `--token-stdin` in CI) |
| [MCP agents](/docs/mcp/) | Read from the `CH_HOUSE_PAT` environment variable or a secret prompt in the client config |
| Scripts | The same `/api/*` endpoints the UI uses, with the bearer header |

Treat a token like a password: it can do whatever its scopes and your roles allow.
