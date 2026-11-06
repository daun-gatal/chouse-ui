# approvals

## Overview

AI Governance > Approvals: filterable table of AI write actions with a review sheet to approve (optionally with edited JSON args) or reject, plus `@/api/aiActions` hooks shared with Chobi.

## Interface

- `[ApprovalsPanel.tsx:ApprovalsPanel]` - status-filtered actions table and review sheet
- `[hooks.ts:approvalKeys]` - keys rooted at `['ai-actions']`
- `[hooks.ts:useAiActions]`, `usePendingAiActionCount`, `useApprovalMutations`, `useAiInbox`, `useAiActivity`, `useDecide` - queries and decision mutations
- `[lib.ts:effectiveStatus]`, `sourceLabel`, `chatHint`, `tierLabel`, `STATUS_FILTERS` - presentation helpers

## Invariants

- Approve/Reject and editable args only when server `action.canDecide` `[ApprovalsPanel.tsx:ApprovalsPanel]`
- Edited args must parse as JSON and are only sent when changed `[ApprovalsPanel.tsx:ReviewSheet]`
- Pending past `expiresAt` reads as expired `[lib.ts:effectiveStatus]`
- Reject reason max 1000 chars `[ApprovalsPanel.tsx:ReviewSheet]`; buttons disabled while busy `[hooks.ts:useDecide]`

## Side Effects

- `listAiActions`, `getPendingAiActionCount`, `approveAiAction`, `rejectAiAction`, `undoAiAction`, `getAiActionInbox`, `getAiActivity` `[hooks.ts:useApprovalMutations]` `[hooks.ts:useDecide]`
- Polling 30s (list, inbox) and 60s (count, activity) `[hooks.ts:useAiActions]` `[hooks.ts:usePendingAiActionCount]`
- Invalidates `['ai-actions']` after decisions; toasts `[hooks.ts:useDecide]`
- Opens the originating chat via `openChatThread`, imported from `@/features/agents/usage/lib`; JSON args text helpers `argsToText` / `parseArgsText` come from `@/lib/aiApprovals` `[ApprovalsPanel.tsx:ApprovalsPanel]`

## Verification

- Run: `bunx vitest run src/features/agents/approvals` (from repo root; full suite: `bunx vitest run`)
