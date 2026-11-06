# buddy

## Overview

Chobi, the floating AI buddy (ADR 0025): a draggable drop-target launcher and a three-size panel (bubble, docked, focus) with Now, Chat and Activity tabs, rendered in a portal above dialogs; briefing and settings come from TanStack Query hooks.

## Interface

- `[index.ts:Chobi]` - sole re-export
- `[Chobi.tsx:Chobi]` - root: store, hooks, Launcher, Panel, tabs, nudges, Ctrl/Cmd+J quick ask
- `[hooks.ts:chobiKeys]`, `useBriefing`, `useRefreshBriefing`, `useChobiSettings` - briefing and org Chobi settings
- `[Mascot.tsx:Mascot]` / `ChobiMood` / `MOOD_LABELS` - SVG character with 6 moods
- `[Launcher.tsx:Launcher]` / `CHOBI_DRAG_TYPE` / `droppedContext` - edge launcher accepting `application/x-chobi-context` drops
- `[Panel.tsx:Panel]` - three-size panel dialog; every tab stays mounted
- `[NowTab.tsx:NowTab]`, `itemPath`, `askAbout`, `orderConnections` - model-free briefing view
- `[ActivityTab.tsx:ActivityTab]` - approvals needing the user and recent AI changes with undo
- `[ChobiLayer.tsx:ChobiLayer]` - body portal above Radix dialogs
- `[NudgeMenu.tsx:NudgeMenu]` - mute nudges and quiet hours

### Subdirectories

- chat: [chat](./chat/README.md) - Chobi's Chat tab: per-connection threads, server-side chat runs streamed live (ADR 0024) with approvals, attachments, /skill commands and UI tool actions, plus a handoff dialog and memory-note suggestions.

## Invariants

- Without `RBAC_PERMISSIONS.AI_CHAT` nothing renders; with AI chat disabled only a sleeping launcher shows during onboarding `[Chobi.tsx:Chobi]`
- Launcher drag needs 5px (`DRAG_THRESHOLD`) and is disabled while `unavailable` `[Launcher.tsx:Launcher]`; dropped JSON counts only with string `name` and `content`, otherwise a `text/plain` drop becomes `selection.txt` `[Launcher.tsx:droppedContext]`
- Nudges respect org settings, mutes and quiet hours and clear after 12s `[Chobi.tsx:Chobi]`
- Approve/Reject render only when `action.canDecide`; Undo only when `undoAvailable` `[ActivityTab.tsx:ActivityTab]`
- Connections ordered active, unreachable, attention, ok, then name `[NowTab.tsx:orderConnections]`

## Side Effects

- `getBriefing` (60s refetch) and `getChobiSettings` from `@/api/chobi` `[hooks.ts:useBriefing]` `[hooks.ts:useChobiSettings]`
- `usePendingAiActionCount` (60s refetch) for the launcher badge `[Chobi.tsx:Chobi]`
- `getChatStatus` from `@/api/ai-chat` re-checked on window `ai-config-updated` `[Chobi.tsx:Chobi]`
- `useAiInbox`, `useAiActivity`, `useDecide` from `@/features/agents/approvals/hooks` `[ActivityTab.tsx:ActivityTab]`
- Navigation and `useAuthStore.setActiveConnection` with toasts `[NowTab.tsx:NowTab]`
- Global keydown listener (Ctrl/Cmd+J), mood/nudge timers `[Chobi.tsx:Chobi]`; persisted chobi store mutations `[NudgeMenu.tsx:NudgeMenu]`; DOM listeners and MutationObserver `[ChobiLayer.tsx:ChobiLayer]`

## Verification

- Run: `bunx vitest run src/features/buddy` (from repo root; full suite: `bunx vitest run`)
