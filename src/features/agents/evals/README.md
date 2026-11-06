# evals

## Overview

The agent editor's Evals tab: eval case CRUD, starting runs against the current draft, polling results and showing the threshold save gate, backed by `@/api/aiEvals`.

## Interface

- `[EvalsTab.tsx:EvalsTab]` - threshold, case table, editor, runs
- `[hooks.ts:evalKeys]`, `useAgentEvals`, `useEvalRun`, `useEvalGate`, `useEvalMutations`
- `[lib.ts:caseProblems]`, `caseFromConsole`, `thresholdFromPercent`, `percent`, `parseToolList`, `isRunning`

## Invariants

- Requires a saved agent (`agentId` non-null) `[EvalsTab.tsx:EvalsTab]`
- Name required; chat cases need a message; feature cases need a `featureId` and a JSON-object input `[lib.ts:caseProblems]`
- Threshold > 0 and <= 100 percent or empty `[lib.ts:thresholdFromPercent]`
- Add disabled at `maxCases` (fallback 50); run disabled while read-only or running `[EvalsTab.tsx:EvalsTab]`

## Side Effects

- `getAgentEvals`, `getEvalRun`, `getEvalGate`, case CRUD, `startEvalRun` `[hooks.ts:useEvalMutations]`
- `fromRequest` calls `createEvalCaseFromRequest` (used by `usage/RequestSheet.tsx` "Save as test case") `[hooks.ts:useEvalMutations]`
- Polls every 2s while running and invalidates when done `[hooks.ts:useEvalRun]`
- Toasts; writes `tuning.evalThreshold` via `onThreshold` `[EvalsTab.tsx:EvalsTab]`

## Verification

- Run: `bunx vitest run src/features/agents/evals` (from repo root; full suite: `bunx vitest run`)
