# AI Write Actions

## Overview
Everything about AI write tools (ADR 0024 Phase 2, ADR 0025): tiers, grants, untrusted-data taint, token write policy, the action log with approvals and undo, and the catalog entries chat/MCP/CLI expose. Toolkit definitions live in [toolkits](./toolkits/README.md).

## Interface
- `[definitions.ts:ACTION_DEFINITIONS]`, `[definitions.ts:actionDefinition]`, `[definitions.ts:parseEditedArgs]` - the registered write tools.
- `[executor.ts:performAction]`, `[executor.ts:fileForApproval]`, `[executor.ts:undoAction]`, `[executor.ts:undoAvailable]`, `[executor.ts:UndoError]` - run and undo actions.
- `[tiers.ts:resolveTier]`, `[tiers.ts:bumpTier]`, `[tiers.ts:connectionEnvironment]` - effective tier per call.
- `[grants.ts:createGrant]`, `[grants.ts:hasGrant]`, `[grants.ts:pruneGrants]` - per-thread / one-hour T2 grants.
- `[taint.ts:turnIsTainted]`, `[taint.ts:UNTRUSTED_RESULT_TOOLS]` - untrusted-data detection.
- `[tokenPolicy.ts:getTokenPolicy]`, `[tokenPolicy.ts:saveTokenPolicy]`, `[tokenPolicy.ts:handlingFor]`, `[tokenPolicy.ts:toolkitAllowed]` - MCP/CLI token write policy.
- `[store.ts:createAction]`, `[store.ts:decideAction]`, `[store.ts:claimApprovedAction]`, `[store.ts:claimUndo]`, `[store.ts:expireActions]` - action log persistence.
- `[resources.ts:RESOURCES]` - undo adapters per resource kind.
- `[coverage.ts:NOT_FOR_AI]`, `[coverage.ts:isWritePermission]` - permissions the AI may never act on.
- `[tools.ts:ACTION_TOOLS]`, `[tools.ts:mayAct]` - catalog entries for the write tools.
- `[types.ts:TIERS]`, `[types.ts:TOOLKITS]`, `[types.ts:RESOURCE_KINDS]` - shared enums.
- Subpackage: [toolkits](./toolkits/README.md).

## Invariants
- Chat, MCP, the CLI and the approval queue all execute through `[executor.ts:performAction]`, so every write is recorded the same way.
- Tier is computed in one place: base tier bumped one step on a production connection (`[tiers.ts:resolveTier]`).
- A grant only skips a T2 confirmation, never a T3 approval, and never after the run read untrusted data (`[grants.ts:hasGrant]` header, `[taint.ts:turnIsTainted]`).
- Every write permission has a write tool or a `[coverage.ts:NOT_FOR_AI]` entry; a test enforces this.
- Undo steps go through the same routes as the UI, as the person undoing (`[resources.ts:RESOURCES]`).

## Side Effects
- Writes table `ai_actions` (`[store.ts:createAction]`), `ai_action_grants` (`[grants.ts:createGrant]`), `mcp_token_policies` (`[tokenPolicy.ts:saveTokenPolicy]`).
- Actions call CHouse routes in-process as the caller (`[definitions.ts:ACTION_DEFINITIONS]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
