# 0028 — Sign In to MCP with OAuth

- **Status:** Accepted
- **Date:** 2026-10-31
- **Amends:** [0013](0013-chouse-mcp.md) §2 (*MCP accepts personal access tokens only*)
- **Scope:** `mcp/oauth/*` (authorization server), `mcp/auth.ts`, `rbac/services/patAuth.ts`, the bearer middlewares, migration 1.75.0, the consent page, Preferences › Personal access tokens, AI Governance › MCP, the docs. One PR.

## Context

An agent connects to CHouse MCP with a personal access token pasted into its
configuration. That works for agents that let you set a header (Claude Code,
Cursor, the desktop apps), but many hosted agents and agents inside chat apps
have nowhere to paste one: they expect a remote MCP server to support the sign-in
flow in the MCP authorization specification, which is OAuth 2.1.

MCP already acts as the person behind the token: their live roles and data
access, the per-token write policy (ADR 0025) and the administrator's ceiling.
What is missing is a way to get such a token by signing in.

## Decision

### 1. CHouse is its own authorization server

CHouse issues the tokens itself, from its own sign-in (password or SSO). There is
no separate identity service. It follows the MCP authorization specification:

| Piece | Standard | Where |
|---|---|---|
| Protected resource metadata | RFC 9728 | `GET /.well-known/oauth-protected-resource[/mcp]` |
| Authorization server metadata | RFC 8414 | `GET /.well-known/oauth-authorization-server` |
| Dynamic client registration | RFC 7591 | `POST /oauth/register` |
| Authorization code with PKCE (S256 only) | OAuth 2.1 | `GET /oauth/authorize`, `POST /oauth/token` |
| Resource indicators | RFC 8707 | `resource` must be the MCP URL when sent |
| Token revocation | RFC 7009 | `POST /oauth/revoke` |

The issuer is the MCP public address (AI Governance › MCP), else
`PUBLIC_BASE_URL`. OAuth can't be turned on without one, and it must be `https`
unless the host is `localhost` or a loopback address. A 401 from `/mcp` carries
`WWW-Authenticate: Bearer resource_metadata="…"` so agents can discover the rest.
When OAuth is off, every one of these endpoints answers 404 and the 401 says
nothing about them.

Clients are **public** (no client secret; PKCE protects the code). Redirect URIs
are matched exactly and must be `https` or a loopback address; an administrator
can narrow them to a list of hosts. The only scope is `mcp`.

### 2. A grant is a personal access token

Approving an agent creates a row in `rbac_api_keys` with `kind = 'oauth'` and the
client's id. So the per-token write policy (`mcp_token_policies`), last-used
tracking, AI usage, agent sessions and revocation work unchanged, and every call
resolves the owner's **live** permissions as a PAT does. Approving the same agent
again replaces the earlier grant.

| Token | Form | Lifetime |
|---|---|---|
| Authorization code | random, stored hashed | 60 s, single use |
| Access token | `ch_oat_…`, stored hashed | 1 hour, never past the grant |
| Refresh token | `ch_ort_…`, stored hashed | 30 days, never past the grant; replaced on every use |

Reusing a refresh token that was already exchanged revokes the whole grant
(theft detection). The grant itself lasts what the person picked on the consent
screen, never more than the administrator's limit.

### 3. OAuth tokens only work on MCP

`verifyBearer()` refuses `ch_oat_` tokens unless the request is an in-process
subrequest made by an MCP tool for that same token (an `AsyncLocalStorage` scope
set by the MCP API client, which no outside request can carry). So an agent token
can call `/mcp`, and the tools it calls reach the API as before, but the token
itself is useless against `/api/*`. Tokens are never passed on to ClickHouse or
anything else.

### 4. Consent

`/oauth/authorize` checks the request, stores it as a pending request for 10
minutes (in the database, so any replica can finish it) and redirects to the
consent page, `/preferences/connect?request=…`. It is a standalone page in the
login page's layout; a signed-out person signs in first through the normal login
(password or SSO) and comes back.

The page shows the agent's name, marked **unverified** because agents name
themselves, and the host it will return to. The person picks which write
toolkits it gets and how each tier is handled (the token write policy, bounded by
the administrator's ceiling; people without `ai:act` get reads only) and how long
access lasts. **Allow** creates the grant and returns a code; **Deny** returns
`access_denied`. Errors that can't safely redirect (unknown client, wrong
redirect URI) stay on CHouse.

### 5. Administration and self-service

- **AI Governance › MCP › Sign-in for agents** (`agents:manage`): on/off (off by
  default), whether pasted personal tokens still work on MCP, open registration
  or admin approval of new agents, allowed return hosts, the longest grant. A
  list of registered agents to approve or block (blocking revokes every grant
  through it), and of everyone's connected agents.
- **Preferences › Personal access tokens › Connected apps**: each person's
  agents, with their write policy and Revoke.
- Personal access tokens keep working on MCP unless an administrator turns them
  off there; the CLI is unaffected either way.

### 6. Abuse limits and audit

`/oauth/register`, `/oauth/token` and `/oauth/revoke` are rate-limited per client
address (the existing key, which never trusts the left of `X-Forwarded-For`);
the metadata and these endpoints answer CORS with `*` and no credentials, since
they take no cookies. Registration, consent, refresh-token reuse, revocation and
client approval/blocking are audited. Expired requests and tokens are deleted
as new ones are made.

## Consequences

- Hosted agents connect with the MCP URL alone; nothing secret is pasted.
- A CHouse reachable only inside a network still works with local agents; hosted
  agents need a public address, as before.
- New public endpoints, off until an administrator turns OAuth on.
- One more kind of row in `rbac_api_keys`; PAT listing, rotation and the PAT
  routes ignore OAuth grants.
- The access check reads a few rows per MCP call, as PATs already do.

## Alternatives considered

- **Signed JWT access tokens.** Rejected: revocation and live permissions need a
  database read on every call anyway, and opaque tokens can't be replayed on the
  rest of the API by accident.
- **An external identity provider.** Rejected: CHouse already has sign-in and SSO;
  a second system doubles the setup for the person deploying it.
- **Confidential clients with client secrets.** Not needed for the agents in
  scope; public clients with PKCE are what the MCP specification expects.
- **Dropping personal access tokens on MCP.** Rejected: agents without a browser
  (CI, schedulers) and clients without OAuth still need them. Administrators can
  turn them off for MCP.

## As shipped

| Section | Commit | Notes |
|---|---|---|
| §2 storage | Migration 1.75.0 | `oauth_clients`, `oauth_requests` (pending sign-ins and their one-time codes), `oauth_tokens`; `rbac_api_keys.kind` and `oauth_client_id`. Tested on SQLite and PostgreSQL. |
| §1–§3, §5–§6 server | Sign agents in to MCP with OAuth | `mcp/oauth/*`, `routes/oauth.ts`, admin routes under `/api/agents/mcp/oauth`. The in-process scope is `mcp/inProcess.ts`. Authorize requires `redirect_uri`; loopback redirects match on any port (RFC 8252 §7.3). |
| §4–§5 UI | Consent page, connected apps and sign-in settings | `/preferences/connect`; the write-policy controls are shared with the token dialog. |
| Docs | Docs and release notes | MCP › Sign in with OAuth, Connected apps, What's new in 3.17. |
