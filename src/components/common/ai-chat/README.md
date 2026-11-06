# components/common/ai-chat

## Overview
Building blocks for the AI chat surfaces (ADR 0024, ADR 0026): approval cards for tool calls waiting on the user, receipts for actions the assistant took (with undo), notes it saved to memory (with undo), and composer attachment chips plus the `/` skill picker.

## Interface
- `ApprovalCard` - `pending`, `canAct`, `busy`, `onSubmit(decisions: ApprovalDecision[])`; approve, edit args, or reject each pending action [ApprovalCard.tsx:ApprovalCard]
- `ActionReceipts({ ids })` - loads and lists the AI actions behind a reply, with undo [ActionReceipts.tsx:ActionReceipts]
- `MemoryNotes({ notes })` - shows `SavedMemoryNote`s kept during a reply, with undo [MemoryNotes.tsx:MemoryNotes]
- `ComposerChips`, `SkillSuggestions`, `ComposerAttachment` - attachments and pinned skills for the next message, and the skill picker [ComposerExtras.tsx:ComposerChips], [ComposerExtras.tsx:SkillSuggestions]

## Invariants
- Without the `ai:act` permission (`canAct` false) a user can only reject; Approve and Edit are disabled [ApprovalCard.tsx:ApprovalCard].
- A team memory note is only a proposal until an admin approves it; undo deletes the proposal [MemoryNotes.tsx:MemoryNotes].
- `ApprovalCard` counts down to the earliest `expiresAt` of the pending calls and disables every action once it passes [ApprovalCard.tsx:useNow].
- With 2+ pending calls the card is a plan: per-step decisions are collected and sent together by "Run plan" (unset steps approved) or "Cancel plan" (all rejected); a single call submits on its own [ApprovalCard.tsx:ApprovalCard].
- T2 tools can be approved with `remember` ("In this chat" / "For 1 hour") only when `canAct` [ApprovalCard.tsx:ApprovalCard].

## Side Effects
- `ActionReceipts` calls `getAiActivity` and `undoAiAction` [ActionReceipts.tsx:ActionReceipts].
- `MemoryNotes` calls `deleteMemory` on undo, invalidates the TanStack query `['ai-memories']` when it receives notes and after an undo, and calls `toast.error` only on failure [MemoryNotes.tsx:MEMORY_QUERY_KEY].
- `ApprovalCard` only reports decisions through `onSubmit`; the caller sends them. It runs a 1 s `setInterval` countdown while not busy [ApprovalCard.tsx:useNow].

## Verification
- Run: `bunx vitest run src/components/common/ai-chat`
