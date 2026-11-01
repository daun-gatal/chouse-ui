type: patch

### Fixed
- **Dependency security updates** — `@hono/node-server` moves to 2.1.3, fixing a static-file path-decoding issue that could skip middleware, and `qs` moves to 6.16.1, fixing a crash (denial of service) in `qs.stringify`. Both come in through the MCP SDK on the server. The lint-only `minimatch` advisory is recorded as an accepted risk until eslint ships a compatible fix
