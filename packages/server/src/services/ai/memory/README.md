# AI Memory

## Overview
Short notes agents keep (ADR 0024 Phase 3): per-user memories and team (connection) memories, the prompt section that shows them, and the `remember` tool.

## Interface
- `[store.ts:createMemory]`, `[store.ts:listUserMemories]`, `[store.ts:listConnectionMemories]`, `[store.ts:decideMemory]`, `[store.ts:updateMemoryContent]`, `[store.ts:pendingMemoryCount]`, `[store.ts:deleteMemory]`, `[store.ts:memoryEnabled]`, `[store.ts:setMemoryEnabled]`.
- `[store.ts:MEMORY_SCOPES]`, `[store.ts:MEMORY_STATUSES]`, `[store.ts:MEMORY_MAX_CHARS]`, `[store.ts:MEMORY_MAX_PER_OWNER]`.
- `[runtime.ts:loadRunMemory]`, `[runtime.ts:lazyRunMemory]`, `[runtime.ts:memoryPrompt]`, `[runtime.ts:buildRememberTool]`, `[runtime.ts:screenNote]`, `[runtime.ts:mentionsTable]`.

## Invariants
- `user` memories belong to one owner, are active at once and cascade-delete with the user (`[store.ts:MEMORY_SCOPES]` header).
- Callers (the `remember` tool and the memory routes) screen notes with `[runtime.ts:screenNote]` before storing; `[store.ts:createMemory]` itself does not screen. A matching `user` note is refused; a matching `connection` note is stored with a `flag` (`[runtime.ts:buildRememberTool]`).
- `[store.ts:createMemory]` returns an existing matching note instead of a duplicate and refuses past `[store.ts:MEMORY_MAX_PER_OWNER]`.

## Side Effects
- Writes `ai_memories` and `ai_memory_settings` (`[store.ts:createMemory]`, `[store.ts:updateMemoryContent]`, `[store.ts:deleteMemory]`, `[store.ts:setMemoryEnabled]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
