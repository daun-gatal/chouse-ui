# AI Agent Evals

## Overview
Eval cases and runs for registry agents (ADR 0024 Phase 6). Cases run against an agent draft through the test-console paths with write tools simulated; a judge model scores answers against rubrics.

## Interface
- `[runner.ts:startEvalRun]`, `[runner.ts:evalGate]` - run a draft's evals; publish gate.
- `[judge.ts:judgeAnswer]`, `[judge.ts:parseJudgeAnswer]` - rubric judging.
- `[scoring.ts:matchToolSequence]`, `[scoring.ts:agentDraftHash]`, `[scoring.ts:casePassed]`, `[scoring.ts:runScore]` - scoring.
- `[store.ts:createCase]`, `[store.ts:updateCase]`, `[store.ts:deleteCase]`, `[store.ts:getCase]`, `[store.ts:listCases]`, `[store.ts:caseCount]` - cases.
- `[store.ts:createRun]`, `[store.ts:finishRun]`, `[store.ts:getRun]`, `[store.ts:listRuns]`, `[store.ts:latestCompletedRun]` - runs.
- `[store.ts:MAX_CASES_PER_AGENT]` (50, enforced by the route via `[../../../routes/ai-evals.ts:caseCount]`, not the store), `[store.ts:STALE_EVAL_RUN_MS]` (30 min).
- `[builtin.ts:BUILTIN_EVAL_CASES]`, `[builtin.ts:syncBuiltinEvalCases]` - built-in Assistant cases.

## Invariants
- Evals run in simulate mode, so no case changes anything (`[builtin.ts:BUILTIN_EVAL_CASES]` header, `[runner.ts:startEvalRun]`).
- A run is tied to the exact draft it scored via `[scoring.ts:agentDraftHash]`.
- A `running` run older than 30 min is reported as `failed` on read (`[store.ts:STALE_EVAL_RUN_MS]`).
- The judge treats the agent's answer as data and is told never to follow it (`[judge.ts:judgeAnswer]` header).

## Side Effects
- Writes `ai_eval_cases`, `ai_eval_runs` (`[store.ts:createCase]`, `[store.ts:createRun]`); `[builtin.ts:syncBuiltinEvalCases]` also touches `obs_settings`.
- Model calls for agent runs and judging; rubric judging runs inside `withUsageRun` under feature `evals`, so it writes `ai_usage_requests` / `ai_usage_steps` (`[runner.ts:persistUsageRun]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
