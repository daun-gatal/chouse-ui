# Security model

CHouse UI is built for teams that share a database. The model assumes untrusted browsers, shared accounts and audited actions.

## Feature matrix

| Feature | Mechanism |
| --- | --- |
| **No browser credentials** | ClickHouse passwords never reach the frontend — the server proxies everything |
| **Encrypted storage** | AES-256-GCM for connection passwords (key + salt) |
| **Password hashing** | Argon2id for user passwords |
| **JWT tokens** | Short-lived access, long-lived refresh — see [Sessions & JWT](/docs/sessions-jwt/) |
| **RBAC enforcement** | Every request checked against [permissions](/docs/permissions/) |
| **Query validation** | SQL parsed and validated against [data access rules](/docs/data-access-rules/) |
| **Audit logging** | All actions recorded with user context — see [Audit log](/docs/audit-log/) |

## Defense in depth

```
Browser ──▶ JWT/PAT auth ──▶ RBAC permission check
        ──▶ SQL parse (node-sql-parser)
        ──▶ Data access rules (deny wins)
        ──▶ Server-side ClickHouse client (readonly paths where applicable)
        ──▶ Audit entry
```

Each layer is independent: a rule change doesn't need a redeploy, a permission revocation applies on the next request, and a leaked browser token still can't reach tables the rules deny.

## The AI boundary

All Chouse AI surfaces (Fleet [Doctor](/docs/ai-fleet-doctor/), [in-tab actions](/docs/ai-in-tab/), [chat](/docs/workspace-ai-assist/)) are:

- **Read-only** — `readonly=1`, guarded single-SELECT tool surface limited to `system.*`
- **Advisory** — suggestions require human review; nothing mutates automatically
- **Permission-gated** — `ai:optimize` / `ai:chat` / `doctor:run`

## MCP & CLI safety

- [MCP](/docs/mcp/): read-only by default; writes/destructive are server-policy opt-ins with in-host human approval
- [CLI](/docs/cli/): destructive verbs need `--yes`, `--dry-run` previews
- Both verify tokens live against RBAC — revocation is instant

## Reporting vulnerabilities

See [SECURITY.md](https://github.com/daun-gatal/chouse-ui/blob/main/SECURITY.md) for responsible disclosure.

## Operations

- [Production checklist](/docs/production-checklist/) — the pre-exposure gate
- [Secrets generation](/docs/configuration-secrets/) — and rotation caveats
- [Audit log](/docs/audit-log/) — retention and export practices
