# Security model

CHouse UI is built for teams that share ClickHouse. It assumes browsers and tokens can leak, that several people use the same clusters, and that every change must be traceable.

## Layers

| Layer | How |
| --- | --- |
| **No credentials in the browser** | ClickHouse passwords live only on the server; the browser, CLI and agents never receive them |
| **Encrypted at rest** | Connection and remediation passwords and AI provider keys use AES-256-GCM (`RBAC_ENCRYPTION_KEY` + `RBAC_ENCRYPTION_SALT`) |
| **Password hashing** | Argon2id for CHouse UI user passwords; tokens are stored hashed |
| **Sessions** | Short-lived access JWTs and refresh tokens, signed with `jose` — see [Sessions & JWT](/docs/sessions-jwt/) |
| **Sign-in protection** | Rate limiting per client IP (from `X-Forwarded-For` — your proxy must set it); optional [SSO](/docs/sso/)-only sign-in |
| **Permissions** | Every API, CLI and MCP request is checked against the caller's [permissions](/docs/permissions/), live |
| **Data access** | SQL is parsed (`node-sql-parser`) and every database and table checked against the caller's [data access policies](/docs/data-access-rules/) |
| **Schema preflight** | DDL that would break dependents is stopped unless someone with `schema:override` confirms |
| **Approved changes** | [Fixes](/docs/data-incidents/#fixes-with-approval) come from a closed catalog, need approval (two people for high-impact ones), and run with a separate remediation credential |
| **Audit** | Sign-ins, admin changes, queries, fixes and every MCP call are [recorded](/docs/audit-log/) |
| **Browser hardening** | Content security policy, strict CORS in production (`CORS_ORIGIN`), `dangerouslySetInnerHTML` only through DOMPurify |

## Request path

```
client ──▶ authenticate (JWT or PAT, checked live)
       ──▶ permission check
       ──▶ parse SQL ──▶ data access (first matching rule by priority; no match = deny)
       ──▶ schema preflight for DDL
       ──▶ ClickHouse, with the connection's credentials
       ──▶ audit entry
```

Each layer stands alone: a role change applies on the next request, a revoked token fails on its next call, and a stolen session still can't reach tables its user's policies deny. ClickHouse's own grants on the connection user remain the outer limit.

## AI

- The [Doctor](/docs/doctor/) and [in-tab AI](/docs/ai-in-tab/) investigate with single `SELECT` statements on `system.*` under `readonly=1`.
- AI never runs SQL you didn't review: rewrites and drafts are suggestions, and AI-drafted fixes go through the same approval — and can't be approved by whoever submitted them.
- Using AI needs `ai:optimize`, `ai:chat` or `doctor:run`. Prompts go only to the providers you configure; use a self-hosted model to keep them in your network ([AI models](/docs/ai-models/)).

## Tokens, CLI and agents

- [Personal access tokens](/docs/personal-access-tokens/) act as their owner, can be narrowed with scopes and given an expiry, and are re-checked on every call.
- [MCP](/docs/mcp/) is off by default; only read tools are on until an administrator turns on more, destructive tools are approved in the client, and token, user, policy, SSO and secret management are never exposed as tools. [Agents](/docs/agents/) adds budgets and a pause switch.
- The [CLI](/docs/cli/) asks before any change (`--yes` without a terminal) and never prints tokens, even with `--debug`.

## Reporting vulnerabilities

See [SECURITY.md](https://github.com/daun-gatal/chouse-ui/blob/main/SECURITY.md) for responsible disclosure.

## Operations

- [Production checklist](/docs/production-checklist/) — the gate before exposing CHouse UI
- [Secrets](/docs/configuration-secrets/) — generating and rotating them
- [Audit event catalog](/docs/audit-events/) — what is recorded
