# 0014 — MCP Destructive-Tool Approval Moves to the Client

- **Status:** Accepted
- **Date:** 2026-09-13
- **Amends:** the destructive-approval aspect of [0013](0013-chouse-mcp.md) §4 — every other decision in 0013 stands.
- **Builds on:** [0013](0013-chouse-mcp.md) (MCP server), [0010](0010-pod-local-state-and-multi-replica-correctness.md) (fail-closed, stateless)

## Context

ADR 0013 required every destructive MCP tool call (`kill_query`, `query_raw`,
`delete_saved_query`, `delete_scheduled_job`) to run an MCP elicitation
(`elicitation/create`, form mode) in the agent host before executing. Three
findings break that flow in practice:

1. **Stateless HTTP cannot carry elicitation responses.** The transport is
   stateless — a fresh transport + server instance per POST (0013 §1). A
   client's elicitation answer arrives as a response-only POST, which the SDK
   answers `202` and hands to the *fresh* instance; the pending request on
   the *first* instance can never be resolved. The MCP 2026-07-28 protocol
   revision removes server→client elicitation for stateless HTTP outright.
2. **Host support is thin.** OpenCode's MCP client does not implement
   elicitation at all (upstream anomalyco/opencode#23066), and hosts that do
   cannot complete the round-trip over this transport (finding 1). Every
   destructive call therefore hung until one side's timeout — the agent saw a
   timeout error, no human was ever asked anything, and the eventual failure
   message blamed the client.
3. **Authorization was never the gap.** These tools already execute under two
   server-side gates: the operator's flags (`MCP_ALLOW_WRITES`,
   `MCP_ALLOW_DESTRUCTIVE`) and the PAT's live scopes intersected with the
   projected routes' permissions (`live_queries:kill[_all]`,
   `scheduled_queries:delete`, saved-queries delete, `validateQueryAccess`).
   The missing piece was only the human-in-the-loop UX.

## Decision

- **Remove elicitation** from the destructive toolset. Destructive tools
  execute directly under the server-side flags + PAT scopes; there is no
  in-band server→client approval protocol on this transport.
- **Human approval is client-native.** Every supported host has a permission
  system that can prompt a human before a named tool runs; `docs/mcp.md`
  documents the exact per-client configuration (OpenCode `permission` ask
  rules, Claude Code `permissions.ask` with default Manual prompting, Codex
  `default_tools_approval_mode` / per-tool `approval_mode`, and the default
  per-call confirmation in VS Code Copilot, Cursor, and Claude Desktop).
  CI/headless agents have no human present — there, the flags and a scoped
  PAT are the only layer, and the docs say so explicitly.
- **Tool descriptions and the server `instructions` string** direct agents to
  ask the human via the client's permission prompt instead of an in-protocol
  approval.

## Consequences

- Destructive calls can be human-gated on every host — including OpenCode —
  with zero server-side protocol coupling: no hangs, no misreported timeouts,
  no host-capability matrix baked into server code.
- The approval layer is host-enforced but user-configured; an operator who
  needs a hard guarantee that no unattended host can fire these tools keeps
  `MCP_ALLOW_DESTRUCTIVE=false` (the default) and mints destructive-capable
  PATs only for attended use.
- `destructiveHint: true` annotations stay — annotation-aware hosts (e.g.
  Codex's `writes` approval mode) use them to pick their default policy.
- Elicitation stays out until a stateless-safe host-native mechanism exists;
  the `InMemoryTransport` elicitation test harness is removed with the code
  path.

## Alternatives considered

- **Two-phase approval tokens** (server-side pending queue + UI/CLI approval
  + one-shot token) — rejected: adds a table, UI page, routes, and TTL
  semantics to solve what is a client-UX problem; authorization already lives
  in RBAC, and every relevant host already ships a permission prompt.
- **Keep elicitation for elicitation-capable hosts** — rejected: no host can
  complete it over this stateless transport (finding 1), so the branch is
  dead code that can only ever hang.
- **Confirm-argument soft gate** (first call returns "ask the user", retry
  with `confirm: "yes"`) — rejected for the same reason ADR 0013 rejected
  client-side flags: an LLM eagerly passes any confirmation argument it is
  offered; the model cannot be the enforcement point.
