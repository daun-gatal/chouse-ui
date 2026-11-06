# triage

## Overview

AI Governance > Auto-triage: per-trigger rules for automatic AI investigation (agent, cooldown, token budget, channels), investigation runs list and an AI-investigated badge, via `@/api/aiTriage`.

## Interface

- `[TriagePanel.tsx:TriagePanel]` - rules and runs panels
- `[AiInvestigatedBadge.tsx:AiInvestigatedBadge]` - badge for subjects with a completed run
- `[hooks.ts:triageKeys]`, `useTriageRules`, `useTriageRuns`, `useTriageRunForSubject`, `useSaveTriageRule`, `RUNS_PAGE` (25)
- `[lib.ts:subjectLink]`, `ruleProblems`, `budgetShare`, `cooldownLabel`

## Invariants

- Cooldown int 0-1440, daily token budget int >= 1000 `[lib.ts:ruleProblems]`
- Edit gated on server `canManage` `[TriagePanel.tsx:RulesPanel]`
- Badge only for status `completed`; subject query uses `retry: false` `[AiInvestigatedBadge.tsx:AiInvestigatedBadge]` `[hooks.ts:useTriageRunForSubject]`

## Side Effects

- `getTriageRules`, `listTriageRuns`, `getTriageRunForSubject`, `saveTriageRule` `[hooks.ts:useSaveTriageRule]`
- Runs refetch every 30s `[hooks.ts:useTriageRuns]`
- Toasts; links to subject routes `[lib.ts:subjectLink]`

## Verification

- Run: `bunx vitest run src/features/agents/triage` (from repo root; full suite: `bunx vitest run`)
