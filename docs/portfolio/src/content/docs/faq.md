# FAQ

The questions operators ask most.

## General

**What is CHouse UI in one sentence?**
A self-hosted console for running ClickHouse as a team: query and explore, monitor clusters and the data in them, trace problems to their root cause and fix them with approval — with its own access control, and the same rules for AI agents and scripts. See the [introduction](/docs/overview/).

**Is it really free?**
Yes. Apache 2.0, open source, self-hosted, no license tiers.

**Do I have to replace my existing ClickHouse tooling?**
No. CHouse UI runs next to whatever you use. It connects to ClickHouse like any client and reads `system.*` tables; nothing is installed on the cluster.

## Access & security

**Can the browser see my ClickHouse passwords?**
No. Credentials are encrypted with AES-256-GCM on the server and never sent to the browser. See the [security model](/docs/security/).

**Does CHouse UI's RBAC restrict ClickHouse itself?**
It controls everything that goes *through* CHouse UI: every query is checked against the user's [permissions](/docs/permissions/) and [data access policies](/docs/data-access-rules/) before it reaches ClickHouse. People connecting to ClickHouse directly are governed by ClickHouse's own users, which you can manage in [ClickHouse users & roles](/docs/clickhouse-users-roles/).

**Can we keep our identity provider?**
Yes. [SSO](/docs/sso/) supports OIDC, OAuth2 and SAML with role mapping, and can be made the only way to sign in.

**How do scripts and agents authenticate?**
With [personal access tokens](/docs/personal-access-tokens/). A token carries its owner's permissions, checked live, and can be narrowed with scopes.

## Data & monitoring

**Do I need an exporter or agent on my clusters?**
No. Monitoring and data observability read ClickHouse system tables. See [How data is watched](/docs/data-observability/).

**Does data observability scan my tables?**
No. Baselines come from metadata (`system.parts`, `part_log`, `query_log`). Only the column profiler reads rows — a small sample of your most critical tables.

**Which ClickHouse versions work?**
See the [compatibility matrix](/docs/compatibility/). Features that need a newer version show *unsupported on this version* instead of failing.

## AI

**Can the AI change my cluster?**
Not on its own. The Doctor investigates with read-only queries (`readonly=1`, single `SELECT` on `system.*`). AI can *draft* fixes, but a fix only runs after people approve it, and an AI-drafted fix can't be approved by whoever submitted it. See [fixes with approval](/docs/data-incidents/#fixes-with-approval).

**Which AI providers are supported?**
OpenAI, Anthropic, Google, Azure OpenAI, Amazon Bedrock, Groq, Mistral, Cohere, xAI, DeepSeek, Cerebras, Fireworks, Together, OpenRouter, Ollama and any OpenAI-compatible server. See [AI models](/docs/ai-models/).

**Is AI required?**
No. Everything except the AI features works without a model configured.

## Operations

**SQLite or PostgreSQL?**
SQLite for a single replica; PostgreSQL to run more than one. See [Helm chart](/docs/deploy-helm/) and [Architecture](/docs/architecture/).

**How do I upgrade?**
Replace the image; migrations run on start. Read [What's new](/docs/whats-new/) and [Migrations & upgrades](/docs/migrations-upgrades/) first.

**Where do alerts go?**
Slack, Google Chat, email or any webhook. See [Alerting](/docs/alerting/).

## Automation

**CLI or MCP?**
The [CLI](/docs/cli/) for scripts and CI; [MCP](/docs/mcp/) for AI agents. Both use personal access tokens and the same server rules.

**Can agents change things?**
Only with tools an administrator has switched on in **AI Governance › MCP** — reads are on by default, writes and destructive tools are off — and only within the token owner's permissions. Agent queries also pass [budget policies](/docs/agents/). Agents can propose fixes but there is no tool to approve one.

## Contributing

Bugs and feature requests go to [GitHub issues](https://github.com/daun-gatal/chouse-ui/issues); see [CONTRIBUTING.md](https://github.com/daun-gatal/chouse-ui/blob/main/CONTRIBUTING.md).
