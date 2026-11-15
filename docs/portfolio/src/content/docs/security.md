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
| **Request limits** | Queries (300 a minute), AI calls (60 a minute) and the rest of the API (1,000 a minute) are counted per user, whether they come from the browser or an API or MCP token; signed-out requests count per client IP. Each server replica keeps its own count |
| **Permissions** | Every API, CLI and MCP request is checked against the caller's [permissions](/docs/permissions/), live |
| **Data access** | ClickHouse parses each query, and every database and table it touches is checked against the caller's [data access policies](/docs/data-access-rules/); what can't be fully checked is refused |
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

## Who a statement runs as

Every statement CHouse UI sends to ClickHouse goes through one server module, and that module needs to know who the statement is for: a signed-in person, or a named background purpose such as the collector. It then sets three things on the request that the caller's code cannot change:

| On the request | Value | What it is for |
| --- | --- | --- |
| `query_id` | `chouse:p:<account id>:<random>` for a person, `chouse:s:<purpose>:<random>` for background work | A ClickHouse administrator can see in `system.query_log` and `system.processes` which CHouse account a statement was sent for. A statement cannot change its own query id. |
| `log_comment` | JSON with the account or purpose, plus context such as the dashboard or job | Context for reading the log. A statement can overwrite it with its own `SETTINGS log_comment`, so treat it as a hint, not as proof. |
| Quota key (`X-ClickHouse-Quota` header) | The account id, or `chouse-<purpose>` | Lets a ClickHouse quota created with `KEYED BY client_key` count each CHouse account separately. ClickHouse 23.8 refuses a quota key next to the way CHouse UI authenticates, so no key is sent to such a server; 24.8 and 26.5 accept it. Nothing changes until you create such a quota. On ClickHouse 26.5.7 an account that had already sent statements kept its earlier quota after a keyed one was created; we did not measure for how long, so create the quota before relying on it and check `system.quota_usage`. |

A query id proves who sent a statement only on rows whose ClickHouse `user` is the connection's own login. Someone with their own ClickHouse login can choose any id for statements they send directly.

CHouse UI's own reports read the account from the query id, not from `log_comment`: Live Queries, the Logs page, lineage, table usage and the AI tools that list your own queries. A statement that sets its own `log_comment` does not change who it is shown for, and cannot hide itself from those reports. On rows logged before 3.18, which have no such id, the account is still read from `log_comment`.

Three rules apply to everyone, administrators included:

- **`EXECUTE AS` is refused.** CHouse UI decides which ClickHouse user a statement runs as. The check reads ClickHouse's own parse of the statement, so a comment or a wrapper cannot hide the keyword.
- **Every typed statement is parsed by ClickHouse before it runs.** Administrators still skip permission and data access checks, but a statement ClickHouse cannot parse, or cannot parse right now, is not run.
- **Typed text runs only after it is checked.** The server sends a typed statement to ClickHouse only as the exact text, parameters, connection and account that the access check approved. This holds for the SQL editor, saved and scheduled queries, dashboard panels, notebook cells and the SQL the AI tools write.

### Reads are sent read-only

CHouse UI also asks ClickHouse to refuse a write, so a mistake in CHouse UI's own check cannot turn a read into a write:

| Statement | `readonly` on the request |
| --- | --- |
| A read (`SELECT`, `SHOW`, `DESCRIBE`, `EXISTS`, `CHECK`, `EXPLAIN`), from anyone | `2` |
| Anything from a person whose roles hold no permission to change data, tables or settings | `2` |
| Every statement of a feature that only reads: dashboard panels, data health checks, notebook cells, the fleet AI's investigation queries | `1`, or `2` for scheduled queries |
| A write from a person who may write | none |

Whether a statement is a read comes from ClickHouse's parse of it, not from its first word. With `readonly = 2` ClickHouse refuses every write (error 164, shown as "You may only read here") but still lets a statement set its own settings, such as `SETTINGS max_threads = 4`; it cannot switch `readonly` off.

A connection whose ClickHouse login is itself limited with `readonly = 2` keeps working. A login limited with `readonly = 1` has never worked with CHouse UI, because ClickHouse then refuses the settings CHouse UI sends with every request.

The design and the stages that follow it are in [ADR 0033](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0033-every-statement-gets-a-clickhouse-identity.md).

## AI

- The [Doctor](/docs/doctor/) and [in-tab AI](/docs/ai-in-tab/) investigate with single `SELECT` statements on `system.*` under `readonly=1`.
- AI never runs SQL you didn't review: rewrites and drafts are suggestions, and AI-drafted fixes go through the same approval — and can't be approved by whoever submitted them.
- Using AI needs `ai:optimize`, `ai:chat` or `doctor:run`. Prompts go only to the providers you configure; use a self-hosted model to keep them in your network ([AI models](/docs/ai-models/)).

## Tokens, CLI and agents

- [Personal access tokens](/docs/personal-access-tokens/) act as their owner, can be narrowed with scopes and given an expiry, and are re-checked on every call.
- [MCP](/docs/mcp/) is off by default, and so is [sign-in for agents](/docs/mcp/#sign-in-with-oauth), whose tokens work only on `/mcp`; only read tools are on until an administrator turns on more, destructive tools are approved in the client, and token, user, policy, SSO and secret management are never exposed as tools. [AI Governance](/docs/agents/) adds budgets and a pause switch.
- The [CLI](/docs/cli/) asks before any change (`--yes` without a terminal) and never prints tokens, even with `--debug`.

## Reporting vulnerabilities

See [SECURITY.md](https://github.com/daun-gatal/chouse-ui/blob/main/SECURITY.md) for responsible disclosure.

## Operations

- [Production checklist](/docs/production-checklist/) — the gate before exposing CHouse UI
- [Secrets](/docs/configuration-secrets/) — generating and rotating them
- [Audit event catalog](/docs/audit-events/) — what is recorded
