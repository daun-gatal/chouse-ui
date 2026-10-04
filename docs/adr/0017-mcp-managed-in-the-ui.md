# 0017 — MCP Served on the Web Port and Managed in the UI

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** [0013](0013-chouse-mcp.md) §1 (dedicated listener and port) and §4 (operator toolsets and `MCP_ALLOW_*` flags); the "operator's flags" gate in [0014](0014-mcp-destructive-client-approval.md). Everything else in 0013/0014 stands: stateless Streamable HTTP, PAT-only auth through `verifyBearer()`, tools as projections of the API, result caps and redaction, the privilege fence, and human approval of destructive calls in the client.
- **Builds on:** [0010](0010-pod-local-state-and-multi-replica-correctness.md) (no pod-local authority), [0011](0011-personal-access-tokens.md) (PATs), [0016](0016-data-observability-platform.md) §10 (Agents page, `agents:view` / `agents:manage`, `obs_settings`)

## Context

ADR 0013 shipped MCP as a second listener on port 8752, configured entirely
through `MCP_*` environment variables (or `mcp.*` YAML/Helm values). Running
it in production surfaced four problems:

1. **Too much to deploy.** Reaching agents needed a second container port, a
   `<release>-mcp` Service, a second Ingress that had to mirror the UI's
   class, annotations and TLS by hand, and a NetworkPolicy rule. Every one
   of those is a place for the MCP endpoint to drift from the UI it fronts.
2. **Changing anything meant a redeploy.** Turning MCP on, allowing writes or
   adding an origin was a values change and a rollout, done by whoever owns
   the deployment — not by the administrator who governs agents in the UI.
3. **Toolsets were too coarse.** `MCP_TOOLSETS` + `MCP_ALLOW_WRITES` +
   `MCP_ALLOW_DESTRUCTIVE` let an operator allow *all* writes or none. There
   was no way to allow `run_health_check` without also allowing
   `test_alert_channel`, or to hide one read tool. The "MCP tools" page in
   the UI was a hard-coded list that could not show what was actually on.
4. **Agents saw tools they could not use.** Every enabled tool was listed to
   every token; a token without `scheduled_queries:view` still got the
   scheduling tools and learned only on the call that it was refused.

## Decision

1. **Serve MCP at `/mcp` on the web port.** The MCP Hono app is mounted on
   the main server (`app.route("/mcp", …)`), before static serving. It
   shares the UI's Service, Ingress, TLS and NetworkPolicy; the dedicated
   listener, port 8752 and every `MCP_*` / `mcp.*` setting are removed. The
   global CORS middleware bypasses `/mcp` so the MCP Origin allowlist is the
   only origin control there (CORS_ORIGIN lists the UI, not agent hosts).
   Tools keep calling the API in-process through the same app.
2. **Settings live in the database, managed in Agents › MCP.** One JSON
   document in `obs_settings` (`mcp_settings`): `enabled` (default **off**),
   `allowedOrigins`, `timeoutSeconds` (1–600, default 60) and
   `toolOverrides` (tool → on/off). Each pod caches it for 5 seconds, so a
   change reaches every replica without a restart; a corrupt document
   falls back to the defaults (endpoint off). `GET /api/agents/mcp` needs
   `agents:view`; `PUT /api/agents/mcp` needs `agents:manage` and is audited
   as `agent.mcp_update`. No new permission: `agents:manage` already holds
   the stronger switch (pausing all agent access), and MCP is part of the
   same governance surface.
3. **A declared tool catalog with per-tool switches.** Every tool declares a
   title, a category, an access level (`read`, `write`, `destructive`),
   whether it spends LLM budget, and the permissions it needs (any of).
   A tool without an override uses its default: **reads on; writes,
   destructive and LLM-spending tools off**, so tools added later arrive in
   their safe state. The UI shows the whole catalog with parameters and
   asks for confirmation before turning on anything that is not read-only.
4. **List only what a token can use.** Each request builds the McpServer
   with the tools that are on **and** for which the token holds at least one
   required permission. The projected route still authorizes every call;
   the listing filter only keeps refused tools out of the agent's context.
5. **Annotations follow the access level.** `readOnlyHint`,
   `destructiveHint`, `idempotentHint` and `title` are derived from the
   catalog, so clients' approval prompts (0014) fire on the right tools.
6. **Disabled means 404.** While MCP is off the endpoint answers
   `404 MCP_DISABLED` with a pointer to Agents › MCP, before auth.
7. **Legacy configuration is ignored loudly.** Startup logs a warning naming
   any `MCP_*` key still set (YAML `mcp.*` flattens into those). The Helm
   chart (2.0.0) keeps `mcp` in its schema only so old values files still
   render, and its install notes warn while it is set.

The CLI follows the same model: `chouse mcp status|tools|config|settings`
and `chouse agents …` are read-only, and changing MCP settings stays in the
UI, like the other governance writes.

## Consequences

- One address for people and agents (`https://<host>/mcp`), with nothing to
  deploy; the MCP surface can no longer drift from the UI's TLS or ingress.
- **Breaking for 3.13 deployments that enabled MCP:** after the upgrade MCP
  is off until an administrator turns it on, and agents must move from
  `:8752/mcp` to `/mcp` on the UI address. Chart users get a major chart
  version and an install-notes warning; the server logs the ignored keys.
- MCP traffic now shares the web port's request limits and proxy timeouts;
  proxies that buffer responses need buffering off for `/mcp`, as for AI
  chat (both stream SSE).
- An administrator can open writes one tool at a time; there is no longer a
  deploy-time ceiling an administrator cannot raise. Scoped PATs and the
  pause switch remain the controls that do not depend on the UI setting.
- Tool metadata is code, held honest by tests: every tool must name known
  permissions and a category, and the HTTP/e2e checks prove the switch and
  the per-token listing.

## Alternatives considered

- **Keep env as the ceiling and the UI below it.** Two places to look, and
  the common change (allow one write tool) would still need a redeploy.
  Rejected: the pause switch and scoped PATs already give operators a hard
  stop.
- **A new `mcp:manage` permission.** Possible, but it would split agent
  governance across two permissions that every default role would hold
  together. Rejected in favor of `agents:view` / `agents:manage`.
- **Keep the dedicated port as an option.** Doubles the deployment matrix
  for no capability the shared port lacks; network separation of agent
  traffic is still possible with an Ingress path rule for `/mcp`.
