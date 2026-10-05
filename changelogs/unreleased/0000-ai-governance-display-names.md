type: patch

### Added
- **Policies for many roles and tokens** — a budget policy is created and edited in a two-step wizard (limits, then who it applies to) and can apply to every agent, any number of roles and any number of tokens at once, picked by display name; tokens show their owner and key prefix, and revoked tokens aren't offered
- **More on each agent session** — Sessions shows the client the agent came from (Claude Code, Cursor, Codex, VS Code, the `chouse` CLI, …), the user and their roles by display name, and the policy that governs the session with its daily budget

### Changed
- **Agents is now AI Governance** — the page moved to `/ai` (old `/agents/…` links redirect) and is called AI Governance, since CHouse's own AI agents live under its Assistant tab
- **Names instead of ids on the Data page** — incidents show their connection and who acknowledged them; related incidents show their titles; root-cause chains, blast radius, lineage, pipelines and cost by consumer name the scheduled query, token or person instead of an id

### Fixed
- **Agent budgets not applied to token queries** — queries made over MCP or with a personal access token skipped budget policies, the incident block and the pause switch, were not counted on the agent's session, and were not attributed to the token in `log_comment`; they are now governed, counted and attributed
- **Policies for missing roles or tokens** — saving a policy for a role or token that doesn't exist (or a revoked token) is rejected instead of silently matching nothing
- **Dataset button on system tables** — in lineage, the Dataset button is disabled for `system` and `information_schema` tables, which have no dataset page
- **Wrong connection in the promise editor** — editing a promise on another connection showed the active connection's name; scheduled-query details no longer fall back to a raw connection id
