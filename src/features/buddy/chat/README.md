# buddy/chat

## Overview

Chobi's Chat tab: per-connection threads, server-side chat runs streamed live (ADR 0024) with approvals, attachments, /skill commands and UI tool actions, plus a handoff dialog and memory-note suggestions.

## Interface

- `[ChobiChat.tsx:ChobiChat]` / `ChobiChatProps` - chat tab (open, visible, width, plain, onShowChat)
- `[ChobiChat.tsx:preprocessMarkdown]` - normalises AI markdown, leaving code fences alone
- `[HandoffDialog.tsx:HandoffDialog]` - send a conversation to an incident notebook, alert channel, clipboard or .md file
- `[MemorySuggestions.tsx:MemorySuggestions]` / `QUIET_MS` - memory suggestions after 45s of quiet
- No `index.ts` barrel

## Invariants

- One run per thread; events dropped after a connection change; UI tools act only on steps seen running in this session `[ChobiChat.tsx:useAiChatInvoke]`
- CANCELLED and AI_BUDGET_EXHAUSTED failures are not retryable; refused approvals (400/403) restore the card `[ChobiChat.tsx:failurePatch]` `[ChobiChat.tsx:answerApprovals]`
- Attachments re-checked against model modalities on send; pending approvals cancelled first `[ChobiChat.tsx:handleSend]`
- Approval `canAct` from AI_ACT; models/agents/skills fetched only with AI_CHAT `[ChobiChat.tsx:ChobiChat]`
- Notebook handoff needs NOTEBOOKS_EDIT and OBSERVE_VIEW or DATA_HEALTH_VIEW; posting needs ALERTING_EDIT and a two-click confirm `[HandoffDialog.tsx:HandoffDialog]`
- Nothing is saved as memory without a click `[MemorySuggestions.tsx:MemorySuggestions]`

## Side Effects

- `@/api/ai-chat`: thread CRUD, `streamChatRun`, `followChatRun`, `cancelChatRun`, `resumeChatRun`, `getAiModels`, `getChatAgents`, `getChatSkills` `[ChobiChat.tsx:ChobiChat]`
- UI tool steps: `fill_sql` adds a tab via `useWorkspaceStore.addTab` and navigates to `/explorer` `[ChobiChat.tsx:handleUiStep]`
- Window listeners `ai-config-updated`, `ai-agents-updated`, `OPEN_CHAT_THREAD_EVENT`; `useChobiStore.setBusy`/`takeAsk` `[ChobiChat.tsx:ChobiChat]`
- Toasts, Blob markdown export, clipboard writes `[ChobiChat.tsx:handleExportThread]` `[HandoffDialog.tsx:HandoffDialog]`
- `getAiActivity`, `listIncidents`, `listChannels`, `postChannelMessage`, `ensureNotebook`, `addCell` `[HandoffDialog.tsx:HandoffDialog]`; `suggestMemories`, `createMemory` `[MemorySuggestions.tsx:MemorySuggestions]`

## Verification

- Run: `bunx vitest run src/features/buddy/chat` (from repo root; full suite: `bunx vitest run`)
