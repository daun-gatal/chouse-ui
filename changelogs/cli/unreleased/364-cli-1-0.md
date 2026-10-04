type: minor

### Added
- **`chouse mcp status|tools|config|settings`** — whether the server's MCP endpoint is on and its address (`<server>/mcp`), the tools your token gets, ready-to-run setup for Claude Code, Codex, Cursor, VS Code and OpenCode that reads the token from `CH_HOUSE_PAT`, and the administrator's MCP settings (read-only)
- **`chouse agents summary|sessions|session|policies`** — agent activity, session replay and budget policies (read-only)
- **`--ca-cert` / `CHOUSE_CA_CERT`** — trust an internal CA; `auth login --ca-cert` remembers it for the profile. `--insecure-skip-tls-verify` / `CHOUSE_INSECURE_SKIP_TLS_VERIFY` is for debugging, warns and is never stored

### Changed
- **Reads retry on transient failures** — GET requests retry up to three times on network errors, `429` and `502/503/504`, honoring `Retry-After`; writes are never retried
