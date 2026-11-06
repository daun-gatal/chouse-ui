# usage

## Overview

AI Governance > AI activity: usage KPIs, data sent to providers, usage by model, searchable request list with step timeline, and token/cost budget CRUD, via `@/api/aiUsage`.

## Interface

- `[AiActivityPanel.tsx:AiActivityPanel]` - usage page
- `[RequestSheet.tsx:RequestSheet]` - one request's LLM/tool timeline
- `[BudgetsPanel.tsx:BudgetsPanel]` - budget list and editor
- `[hooks.ts:aiUsageKeys]`, `useAiUsageSummary`, `useAiUsageByModel`, `useAiEgress`, `useAiUsageRequests`, `useAiUsageRequest`, `useAiBudgets`, `useSaveAiBudget`, `useDeleteAiBudget`
- `[lib.ts:formatUsd]`, `formatTokens`, `buildTimeline`, `budgetFormProblems`, `openChatThread`, `OPEN_CHAT_THREAD_EVENT`, `queryLogsLink`

## Invariants

- Budget needs a name and a positive token or cost limit; a user when scoped to a user; a fallback model when `onExhaust` is `fallback` `[lib.ts:budgetFormProblems]`
- `BudgetsPanel` hides on 403; edits need server `canManage` `[BudgetsPanel.tsx:BudgetsPanel]`
- Save as test case needs AI_AGENTS_MANAGE and a chat request (`featureId === "chat"`) with a `threadId` and `agentId`; Open in chat only for the viewer's own requests `[RequestSheet.tsx:Detail]`
- `formatUsd` never shows a priced non-zero cost as $0.00 `[lib.ts:formatUsd]`

## Side Effects

- `@/api/aiUsage` summary/models/egress/requests/budgets calls `[hooks.ts:useAiUsageSummary]`
- 60s refetch, 300ms search debounce `[hooks.ts:useAiUsageSummary]` `[AiActivityPanel.tsx:AiActivityPanel]`
- `?request=` URL state `[AiActivityPanel.tsx:AiActivityPanel]`; window `chouse:open-chat-thread` event `[lib.ts:openChatThread]`
- Toasts on budget and test-case actions

## Verification

- Run: `bunx vitest run src/features/agents/usage` (from repo root; full suite: `bunx vitest run`)
