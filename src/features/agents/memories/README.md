# memories

## Overview

AI Governance > Memories: private per-user memories (CRUD, toggle, JSON export) and connection-scoped team memories with propose/approve/reject, plus a per-table memories panel, via `@/api/aiMemories`.

## Interface

- `[MemoriesPanel.tsx:MemoriesPanel]` - my memories and team memories
- `[TableMemories.tsx:TableMemories]` - team memories for one table
- `[hooks.ts:memoryKeys]`, `useMyMemories`, `useTeamMemories`, `useTableMemories`, `usePendingMemoryCount`, `useMemoryMutations`

## Invariants

- `TableMemories` needs AI_CHAT, AI_OPTIMIZE or AI_MEMORIES_MANAGE and renders null when empty `[TableMemories.tsx:TableMemories]`
- Approve/reject only with server `canManage` and status `proposed` `[TableMemories.tsx:TableMemories]`
- Notes 3 to `MEMORY_MAX_CHARS` chars `[MemoriesPanel.tsx:NoteEditor]`
- Team memories need an active connection `[MemoriesPanel.tsx:TeamMemoriesPanel]`

## Side Effects

- `@/api/aiMemories` calls incl. `exportMyMemories` `[hooks.ts:useMemoryMutations]` `[MemoriesPanel.tsx:MyMemoriesPanel]`
- Invalidates `['ai-memories']`; pending count polled every 60s `[hooks.ts:usePendingMemoryCount]`
- Blob download of exports; toasts

## Verification

- Run: `bunx vitest run src/features/agents/memories` (from repo root; full suite: `bunx vitest run`)
