type: minor

### Added
- **MCP managed in Agents › MCP** — turn the MCP endpoint on or off, set its allowed origins, tool call timeout and the public address agents use (the endpoint otherwise follows `PUBLIC_BASE_URL` or the address the UI is opened on, with a warning for `localhost`), and copy ready-made setup for Claude Code, Codex, Cursor, VS Code, OpenCode and curl, all from the UI. Every tool is listed with its description, access level (read, write, destructive), LLM spend, required permissions and parameters, and can be switched on or off on its own or per category; categories collapse and expand. Reads are on by default; writes, destructive and LLM-spending tools stay off until an administrator turns them on (with a confirmation). Viewing needs `agents:view`, changing needs `agents:manage`; changes apply to every replica within seconds and are audited as `agent.mcp_update`.
- **Agents see only the tools they can use** — `tools/list` now holds only tools that are on and that the token's permissions allow, and each tool's MCP annotations (read-only, destructive) follow its access level so clients prompt for the right calls.

### Changed
- **MCP is served at `/mcp` on the web port** — agents use the same address, Service, Ingress and TLS as the UI (`https://<host>/mcp`); the MCP endpoint starts off and answers `404 MCP_DISABLED` until it is turned on. The dock's MCP indicator opens Agents › MCP.
- **Helm chart 2.0.0** — MCP needs no chart values any more. Leftover `mcp:` values are ignored and the install notes warn until they are removed.

### Removed
- **Dedicated MCP port and `MCP_*` settings** — port 8752, `MCP_ENABLED`, `MCP_HOST`, `MCP_PORT`, `MCP_ALLOW_WRITES`, `MCP_ALLOW_DESTRUCTIVE`, `MCP_TOOLSETS`, `MCP_ALLOWED_ORIGINS`, `MCP_TIMEOUT_SECONDS` (and the matching `mcp.*` YAML keys), plus the chart's `mcp.*` values, `<release>-mcp` Service and MCP Ingress. The server logs a warning naming any that are still set. After upgrading from 3.13, point agents at `/mcp` on the UI address and turn MCP on in Agents › MCP.

### Fixed
- **Explorer button on Data › Datasets** — opened an information tab for an empty database instead of the selected table; the command palette's table and database results had the same problem.
- **Role cards grouped every new permission under "Other"** — the cards now use the server's permission categories, so Data Observability, Performance & Capacity, Remediation and Agents permissions show in their own groups.
