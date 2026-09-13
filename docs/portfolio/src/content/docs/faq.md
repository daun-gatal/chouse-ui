# FAQ

The questions operators ask most.

## General

**What is CHouse UI in one sentence?**
The team operator's console for on-prem ClickHouse: a secure access layer (RBAC, audit, encrypted credentials), multi-cluster monitoring with alerts, and an autonomous read-only AI SRE — see the [overview](/docs/overview/).

**Is it really free?**
Apache 2.0, open source, self-hosted. No license tiers.

**Do I have to replace my existing ClickHouse tooling?**
No — CHouse UI sits next to whatever you use. It proxies through ClickHouse itself and reads `system.*` tables; nothing is installed on the cluster.

## Access & security

**Can the browser see my ClickHouse passwords?**
No. Credentials are AES-256-GCM encrypted server-side and never leave the server — see the [Security model](/docs/security/).

**Does RBAC restrict ClickHouse itself?**
CHouse UI's RBAC gates the *web interface*; enforcement happens before queries reach ClickHouse. For native ClickHouse identities, use the optional [ClickHouse user management](/docs/rbac-roles/).

**Can we keep our identity provider?**
Yes — [SSO](/docs/sso/) supports OIDC, OAuth2 and SAML with role mapping.

**How do scripts authenticate without a browser?**
[Personal access tokens](/docs/personal-access-tokens/) for the [CLI](/docs/cli/), [MCP](/docs/mcp/) and API calls.

## Monitoring & AI

**Do I need to install an exporter or agent?**
No — monitoring reads ClickHouse system tables natively; see [Monitoring overview](/docs/monitoring-overview/).

**Can the AI damage my cluster?**
No — it is read-only (`readonly=1`, single-SELECT `system.*` tools) and advisory; suggestions require human review. See [Fleet Doctor](/docs/ai-fleet-doctor/).

**Which AI providers are supported?**
OpenAI, Anthropic, Google, Bedrock, Groq, Mistral, Cohere, Ollama, xAI, DeepSeek, Cerebras, Fireworks, Together, OpenRouter — and any OpenAI-compatible API. See [AI Assist](/docs/workspace-ai-assist/).

**Does the AI send my data rows anywhere?**
No — only schema context and query text, with a visible context preview.

## Operations

**How do I upgrade safely?**
Migrations run on boot; follow the [upgrade checklist](/docs/migrations-upgrades/).

**SQLite or PostgreSQL?**
SQLite for single-instance; PostgreSQL for anything multi-replica or HA — see [Architecture](/docs/architecture/).

**How does scheduling survive multiple pods?**
Per-job atomic leases make redundant ticks harmless; multi-replica HA requires PostgreSQL — see [Scheduled queries](/docs/scheduled-queries/).

**Where do alerts go?**
Slack (Block Kit) and email via SMTP — see [Alerting](/docs/alerting/).

## Automation

**CLI or MCP for automation?**
CLI for scripts/CI; MCP for AI agents — both use PATs. Compare them in [CLI](/docs/cli/) and [MCP](/docs/mcp/).

**Can agents write to ClickHouse?**
Only if you explicitly enable MCP writes/destructive server-side, and even then the client prompts a human for destructive tools — see the [MCP safety model](/docs/mcp/).

## Contributing

Bugs and feature requests go through [GitHub issues](https://github.com/daun-gatal/chouse-ui/issues); contribution guidelines live in [CONTRIBUTING.md](https://github.com/daun-gatal/chouse-ui/blob/main/CONTRIBUTING.md).
