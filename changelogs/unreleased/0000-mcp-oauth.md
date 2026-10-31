type: minor

### Added
- **Sign in to MCP with OAuth** — agents connect to `/mcp` with the URL alone: they open CHouse in the browser, the person signs in (password or SSO) and picks the agent's write tools and how long access lasts, and the agent gets a token that only works on MCP. CHouse is its own OAuth 2.1 server following the MCP authorization specification (protected resource and authorization server metadata, dynamic client registration, PKCE, resource indicators, refresh-token rotation with reuse detection, revocation). Off by default; turn it on in **AI Governance › MCP › Sign-in for agents**, where administrators can also turn pasted tokens off for MCP, hold new agents for approval, limit return addresses and the longest access, and block an agent or revoke a person's access. People see and revoke their agents under **Preferences › Personal access tokens › Connected apps** (ADR 0028)

### Fixed
- **Watch test** — the `watch_table` test no longer fails once its hardcoded end date has passed
