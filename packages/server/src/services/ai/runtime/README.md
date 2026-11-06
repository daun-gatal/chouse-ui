# AI Runtime

## Overview
Durable chat-run execution (ADR 0024 Phase 1): server-side chat runs that survive the HTTP request, a LangGraph checkpointer on the RBAC DB, per-agent runtime middleware, the QuickJS analysis sandbox and chat output shaping.

## Interface
- `[chatRuns.ts:startChatRun]`, `[chatRuns.ts:resumeChatRun]`, `[chatRuns.ts:cancelChatRun]`, `[chatRuns.ts:getChatRun]`, `[chatRuns.ts:activeRunForThread]`, `[chatRuns.ts:subscribeChatRun]`, `[chatRuns.ts:pruneChatRuns]`, `[chatRuns.ts:startApprovalSweeper]`, `[chatRuns.ts:expireStaleApprovals]`.
- `[checkpointer.ts:ChouseCheckpointSaver]`, `[checkpointer.ts:checkpointSaver]`.
- `[middleware.ts:runtimeMiddleware]`, `[middleware.ts:isTransientError]` - fallback model, retries, call caps, context editing, prompt caching.
- `[analysis.ts:buildAnalysisTool]`, `[analysis.ts:ANALYSIS_TOOL]`, `[analysis.ts:ANALYSIS_LIMITS]` - `js_eval` sandbox.
- `[chatOutput.ts:chatAnswer]`, `[chatOutput.ts:stripScratchpad]`, `[chatOutput.ts:jsonSafe]`.
- `[internalMessages.ts:EMPTY_ANSWER_NUDGE]`, `[internalMessages.ts:isInternalUserMessage]`.

## Invariants
- A chat run's `thread_id` is the run id, so a run paused for approval can resume on any replica (`[checkpointer.ts:ChouseCheckpointSaver]`).
- Closing the panel or refreshing does not stop a run (`[chatRuns.ts:startChatRun]`).
- The analysis sandbox has no network, no modules and no host filesystem, with memory and wall-time limits (`[analysis.ts:ANALYSIS_LIMITS]`).
- Messages CHouse injects never end a turn for the untrusted-data check (`[internalMessages.ts:isInternalUserMessage]`).
- Middleware order matters: the first entry is the outermost (`[middleware.ts:runtimeMiddleware]`).

## Side Effects
- Writes `ai_chat_runs` (`[chatRuns.ts:startChatRun]`), `ai_checkpoints`/`ai_checkpoint_writes` (`[checkpointer.ts:ChouseCheckpointSaver]`).
- `[chatRuns.ts:pruneChatRuns]` deletes `ai_chat_runs` rows (and their checkpoints) whose `rbac_ai_chat_threads` thread is gone; `[chatRuns.ts:expireStaleApprovals]` cancels runs awaiting expired approvals, rejects their actions and deletes their checkpoints.
- Timers: `setInterval` approval sweeper (`[chatRuns.ts:startApprovalSweeper]`); per running chat run a `setInterval` heartbeat every 5 s (`[chatRuns.ts:HEARTBEAT_MS]`) that polls `cancel_requested` and updates `heartbeat_at`, a debounced `setTimeout` step persistence, and a `setTimeout` that drops the live event buffer after `[chatRuns.ts:BUFFER_GRACE_MS]` (60 s).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
