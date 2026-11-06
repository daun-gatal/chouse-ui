# agents

## Overview

AI Governance panels for the MCP endpoint (server settings, OAuth sign-in, client snippets, write-tool bounds, per-tool toggles) and agent budget policies, plus pure MCP and policy-form helpers; child folders hold the other AI Governance tabs.

## Interface

- `[McpPanel.tsx:McpPanel]` - MCP page (server, OAuth, connect, write tools, tools panels)
- `[McpOAuthPanels.tsx:OAuthSettingsPanel]` / `OAuthAgentsPanel` / `connectedLabel` - OAuth settings and registered clients/grants
- `[PoliciesPanel.tsx:PoliciesPanel]` - budget policy table with a two-step wizard
- `[mcp.ts:mcpEndpointUrl]`, `isLocalHost`, `parsePublicUrl` - endpoint URL resolution
- `[mcp.ts:mcpClientSnippets]` / `mcpSignInSnippets` - client configs referencing `MCP_TOKEN_ENV`
- `[mcp.ts:filterMcpTools]`, `groupMcpTools`, `bulkToolOverrides`, `defaultToolOverrides`, `parseOrigins`, `parseRedirectHosts`, `mcpConnectMode` - tool catalog and validation helpers
- `[mcp.ts:OAUTH_MAX_DAY_OPTIONS]` - OAuth max access lifetime choices (7/30/90/180/365 days)
- `[policyForm.ts:policyToForm]`, `formToSettings`, `groupPolicies`, `assignment`, `budgetShare`, `targetKey` - policy form/API conversion (`targetKey` = `scopeKind:scopeId`)

### Subdirectories

- approvals: [approvals](./approvals/README.md) - AI Governance > Approvals: filterable table of AI write actions with a review sheet to approve (optionally with edited JSON args) or reject, plus `@/api/aiActions` hooks shared with Chobi.
- assistant: [assistant](./assistant/README.md) - AI Governance > Assistant: the AI agent registry UI (feature bindings, agent tree, harnesses, skills, tool catalog, test console, Chobi org settings) with AI drafting, revision history and rollback, backed by `@/api/aiAgents`.
- evals: [evals](./evals/README.md) - The agent editor's Evals tab: eval case CRUD, starting runs against the current draft, polling results and showing the threshold save gate, backed by `@/api/aiEvals`.
- guardrails: [guardrails](./guardrails/README.md) - AI Governance > Guardrails: list, create, edit, drag-reorder, test and roll back guardrails and view paged trigger events, via `@/api/aiGuardrails`.
- memories: [memories](./memories/README.md) - AI Governance > Memories: private per-user memories (CRUD, toggle, JSON export) and connection-scoped team memories with propose/approve/reject, plus a per-table memories panel, via `@/api/aiMemories`.
- triage: [triage](./triage/README.md) - AI Governance > Auto-triage: per-trigger rules for automatic AI investigation (agent, cooldown, token budget, channels), investigation runs list and an AI-investigated badge, via `@/api/aiTriage`.
- usage: [usage](./usage/README.md) - AI Governance > AI activity: usage KPIs, data sent to providers, usage by model, searchable request list with step timeline, and token/cost budget CRUD, via `@/api/aiUsage`.

## Invariants

- Mutating UI gated on `RBAC_PERMISSIONS.AGENTS_MANAGE` `[McpPanel.tsx:McpPanel]` `[PoliciesPanel.tsx:PoliciesPanel]`
- Enabling a write/destructive tool requires a confirmation dialog `[McpPanel.tsx:ToolsPanel]`
- Timeout int 1-600 `[McpPanel.tsx:ServerPanel]`; origins must be bare http(s) origins, public URL without query/fragment `[mcp.ts:parseOrigins]` `[mcp.ts:parsePublicUrl]`
- Write tools: toolkit set, highest tier (`t1`/`t2`/`t3`) and approval wait as an integer 0-900 s; save disabled until valid and dirty `[McpPanel.tsx:WriteToolsPanel]`
- OAuth requires an enabled endpoint and non-null issuer; connect mode falls back to `tokens` `[McpOAuthPanels.tsx:OAuthSettingsPanel]` `[mcp.ts:mcpConnectMode]`
- Policy limits positive, alert multiplier 1-1000, >= 1 target `[policyForm.ts:formToSettings]` `[policyForm.ts:assignment]`
- Snippets never embed a token `[mcp.ts:mcpClientSnippets]`

## Side Effects

- `useMcpOverview`, `useUpdateMcpSettings`, `useMcpOAuth`, `useAgentPolicies`, `useAgentPolicyScopes` (while the wizard is open), `useAgentMutations`, `useSetMcpOAuthClientStatus`, `useRevokeMcpOAuthGrant` from `@/features/observe/hooks` `[McpPanel.tsx:McpPanel]` `[McpOAuthPanels.tsx:OAuthAgentsPanel]` `[PoliciesPanel.tsx:PoliciesPanel]`
- Toasts; clipboard writes with 1500ms reset `[McpPanel.tsx:CopyButton]`
- Navigation to `/preferences`; reads `window.location.origin` and `getBasePath()` `[McpPanel.tsx:McpPanel]`

## Verification

- Run: `bunx vitest run src/features/agents` (from repo root; full suite: `bunx vitest run`)
