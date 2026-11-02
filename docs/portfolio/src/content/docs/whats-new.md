# What's new in 3.17

3.17 lets AI agents sign in to CHouse MCP. Paste the MCP URL into an agent that supports sign-in — including hosted agents with nowhere to paste a token — and it opens CHouse in your browser: you sign in, choose what it may do and for how long, and it gets a token that only works on MCP, running as you with your own access.

## Highlights

**Sign in to MCP with OAuth** — Agents connect with `https://<your CHouse>/mcp` alone. They discover where to sign in, register themselves, and send you to a consent page that shows the agent's name, marked unverified, and the address it returns to. Pick its write tools and how long access lasts, then **Allow**. CHouse is its own OAuth 2.1 server, following the MCP authorization specification, so it works with the same password or SSO sign-in you already use. → [Sign in with OAuth](/docs/mcp/#sign-in-with-oauth)

![The consent page an agent opens](/docs/img/app/oauth-consent.jpg "An agent asks to use CHouse as you: check where it returns to, choose what it may change, and Allow")

**Tokens that only work on MCP** — What an agent gets is an access token for an hour, renewed with a refresh token that works once; a copied refresh token used twice revokes the whole grant. Every call runs with your live roles and data access, and the token is refused by the rest of the API. → [Sign in with OAuth](/docs/mcp/#sign-in-with-oauth)

**See and revoke your agents** — Agents you connected are listed under **Preferences › Personal access tokens › Connected apps**, with their write tools and **Revoke**. → [Connected apps](/docs/personal-access-tokens/#connected-apps)

**Administrators stay in control** — Sign-in starts off. **AI Governance › MCP › Sign-in for agents** turns it on, and can turn pasted personal access tokens off for MCP, hold new agents until you approve them, limit where agents may return to, and cap how long access lasts. The **Agents** list shows every agent and who is connected through it: block an agent to cut everyone off at once, or revoke one person's access. → [Sign in with OAuth](/docs/mcp/#sign-in-with-oauth), [Connect an AI agent](/docs/guide-connect-an-agent/)

![Sign-in for agents in AI Governance › MCP](/docs/img/app/agents-mcp-sign-in.jpg "Turn sign-in on, decide whether tokens still work on MCP, approve new agents and see who is connected")

**Check what a ClickHouse upgrade changes for you** — **Monitoring › Upgrades** now shows whether your version is still supported and which versions to move to, then checks a target against your real workload: removed functions, types and engines you use, changed defaults, obsolete settings you still set, and the release notes that name what you use. It is exact when another of your connections already runs the target line, and Chouse AI can read the notes for you. It also plans your top queries on your current server with the target's settings, without running them, so you see which ones the new analyzer or a changed default breaks before you upgrade. On the Fleet page, a version that is out of support or behind on patches is coloured and links to the check. → [Upgrades](/docs/monitoring-upgrades/), [Plan a ClickHouse upgrade](/docs/guide-plan-an-upgrade/)

![Monitoring › Upgrades after an exact check](/docs/img/app/monitoring-upgrades.jpg "A check of 25.8 against 26.8: what breaks, what changes, and the notes to read")

## Upgrading from 3.16

Migrations run on start; nothing to run by hand. Check these:

| What changed | What to do |
| --- | --- |
| Migration 1.75.0 adds tables for agents, sign-ins and tokens, and marks every existing personal access token as one | Nothing to do: tokens keep working |
| Sign-in for agents is off | To use it, set an https public address (**AI Governance › MCP**, or `PUBLIC_BASE_URL`, Helm `publicBaseUrl`) and turn on **Sign-in for agents**. If your proxy forwards only some paths, also forward `/oauth/` and `/.well-known/oauth-` to CHouse |
| Upgrades fetches release data and notes only when allowed | Set `UPGRADE_CHECK_ENABLED=true` (Helm `observability.upgradeCheckEnabled: true`) and allow egress to `raw.githubusercontent.com` and `hub.docker.com`. Without it, Upgrades compares only with a connection on the target line |
| The upgrade rollout tracker and the workload replay on a canary are gone | Versions are on the Fleet page, and a check now tries your queries on the current server. Agents using the MCP tool `get_upgrade_rollout` should use `get_upgrade_status`; `get_canary_replay`, `run_canary_replay` and `chouse upgrades replay` are removed; `chouse upgrades rollout` now runs `chouse upgrades fleet` |

The full list of changes is in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md).
