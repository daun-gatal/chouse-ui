# Personal access tokens

Personal access tokens (PATs) let scripts, CI pipelines and AI agents authenticate as *you* without a browser. Minted once in the UI, sent as a bearer token, verified live against RBAC on every call.

## Minting a token

1. Open **Preferences → Personal access tokens**.
2. Name the token (e.g. `ci-pipeline`, `cursor-agent`) and create it.
3. Copy the token immediately — it is shown once, in the `ch_pat_…` format.

Tokens are stored hashed server-side; losing the display copy means minting a new one.

## Where tokens are used

| Consumer | Auth header | Notes |
| --- | --- | --- |
| [CLI](/docs/cli/) | `Authorization: Bearer ch_pat_…` | `chouse auth login --token ch_pat_…` |
| [MCP server](/docs/mcp/) | Same | Agents pass the token; every call verified against RBAC |
| CI scripts | HTTP API | Same `/api/*` endpoints the UI uses |

## Behavior

- **Live permission checks** — a token carries your identity, not a frozen permission set: revoking your role revokes the token's access instantly
- **Revocation** — delete the token in Preferences; it stops working on the next call
- **Separate from JWT sessions** — PATs don't expire with your browser session
- **Server compatibility** — the server must be ≥ the 1.51.0 PAT backfill; older servers fail closed with `401`

> **Tip:** Mint one token per consumer (CI, each agent, each script) so you can revoke precisely without disturbing the rest.

## Security notes

- A PAT grants whatever *you* can do — treat it like a password
- For destructive MCP toolsets, the human-approval layer applies on top of RBAC — see [MCP server](/docs/mcp/)
- Rotate tokens when a team member leaves: revoke theirs, reissue for shared pipelines
