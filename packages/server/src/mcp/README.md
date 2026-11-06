# MCP Server (`/mcp`)

## Overview
CHouse's Model Context Protocol endpoint (ADR 0013, ADR 0017, ADR 0028),
served at `/mcp` on the main web port using the stateless Streamable HTTP
transport. Each request checks the MCP settings, validates the Origin,
authenticates a personal access token or OAuth access token, then builds a
fresh `McpServer` holding only the tools an administrator enabled and the
caller may use. Tools, resources, and prompts are thin projections of the
existing `/api`: they run as in-process subrequests carrying the caller's own
token, so there is one authn/authz implementation. Tool definitions live in
[tools/](./tools/README.md); the OAuth authorization server in
[oauth/](./oauth/README.md).

## Interface
- `index.ts`: `[index.ts:createMcpApp]` (mounted at `MCP_PATH` by `packages/server/src/index.ts`), `McpAppOptions`.
- `path.ts`: `[path.ts:MCP_PATH]` (`/mcp`).
- `server.ts`: `[server.ts:buildMcpServer]`, `[server.ts:buildMcpDeps]`, `[server.ts:collectTools]`, `[server.ts:listToolDefinitions]`, `[server.ts:toolCatalog]`, `[server.ts:toolParameters]`, `MCP_IMPLEMENTATION`, types `McpToolCatalogEntry`, `McpToolParameter`.
- `auth.ts`: `[auth.ts:createMcpAuthMiddleware]` / `mcpAuthMiddleware`, `[auth.ts:verifyIdentity]`, `[auth.ts:oauthChallenge]`, type `McpTokenVerifier`.
- `origin.ts`: `[origin.ts:originGuard]`.
- `api.ts`: `[api.ts:McpApiClient]`, `[api.ts:McpApiError]`, `[api.ts:runInToolScope]`, `McpToolScope`, `SubrequestOptions`, `MCP_USER_AGENT`.
- `inProcess.ts`: `[inProcess.ts:runAsMcpSubrequest]`, `[inProcess.ts:isMcpSubrequestFor]`.
- `settings.ts`: `[settings.ts:getMcpSettings]`, `[settings.ts:saveMcpSettings]`, `[settings.ts:isToolEnabled]`, `[settings.ts:toolEnabledByDefault]`, `[settings.ts:legacyMcpEnvKeys]`, `resetMcpSettingsCache`, `DEFAULT_MCP_SETTINGS`, `mcpSettingsUpdateSchema`, `OAUTH_REGISTRATION_MODES` (`open | approval`), `OAUTH_MAX_GRANT_DAYS_LIMIT` (365), types `McpSettings`, `StoredMcpSettings`.
- `safety.ts`: `[safety.ts:applyCaps]`, `[safety.ts:cappedJson]`, `[safety.ts:redactSecrets]`, `DEFAULT_MAX_ROWS` (100), `DEFAULT_MAX_CELL_CHARS` (2048), `DEFAULT_MAX_BYTES` (200 KB).
- `guardrails.ts`: `[guardrails.ts:guardMcpResult]`.
- `audit.ts`: `[audit.ts:auditMcpToolCall]`.
- `resources.ts`: `[resources.ts:registerResources]`. `prompts.ts`: `[prompts.ts:registerPrompts]`.
- `types.ts`: `McpIdentity`, `McpToolContext`, `McpDeps`.
- Subdirectories:
  - [tools/](./tools/README.md) - the tool catalog and the shared `runApiTool` wrapper.
  - [oauth/](./oauth/README.md) - MCP OAuth discovery, registration, authorize, token, and revocation endpoints and their store.

## Invariants
- `/mcp` answers 404 unless MCP is enabled in settings `[index.ts:createMcpApp]`.
- A request carrying an `Origin` header not in `allowedOrigins` gets 403 `ORIGIN_NOT_ALLOWED`; headerless requests pass (DNS-rebinding protection) `[origin.ts:originGuard]`.
- Only `ch_pat_` PATs and, when OAuth is on, `ch_oat_` access tokens authenticate; browser JWTs are rejected; PATs can be turned off when OAuth is on (`oauthPatsAllowed === false`) `[auth.ts:createMcpAuthMiddleware]`.
- With OAuth on, every 401 carries `WWW-Authenticate: Bearer resource_metadata=...` (RFC 9728 §5.1) `[auth.ts:oauthChallenge]`.
- Identity is the user's live roles intersected with token scopes on every call, via `verifyBearer`, so revocation or demotion applies on the next tool call `[auth.ts]` header.
- An OAuth access token is accepted by the API's bearer middlewares only inside `runAsMcpSubrequest` for that same token; network requests cannot set the `AsyncLocalStorage` scope `[inProcess.ts]`.
- The server lists a tool only if it is enabled (`isToolEnabled`), the caller holds its permissions, and, for generated action tools, the token's write access allows it `[server.ts:buildMcpServer]`.
- No protocol sessions or authoritative pod-local state: a fresh transport and server are built per request, so multiple replicas are correct (ADR 0010) `[index.ts]` header.
- Tool results are capped and secret-shaped values masked before reaching the model `[safety.ts]`; MCP-scoped guardrails run on tool-result text and fail closed on block or error `[guardrails.ts:guardMcpResult]`.
- Legacy `MCP_*` env keys (dedicated listener) are ignored since 3.14.0; startup only reports them `[settings.ts:legacyMcpEnvKeys]`.

## Side Effects
- Reads/writes the MCP settings JSON document in `obs_settings` with a short per-pod cache `[settings.ts:getMcpSettings]`, `[settings.ts:saveMcpSettings]`.
- In-process HTTP subrequests into the Hono app with the caller's token `[api.ts:McpApiClient]`.
- Best-effort audit entries per tool call `[audit.ts:auditMcpToolCall]`, guardrail trigger events per call `[guardrails.ts]`, and agent-session/client bookkeeping via `services/agents` `[index.ts]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/mcp`
