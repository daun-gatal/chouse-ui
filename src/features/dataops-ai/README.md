# dataops-ai

## Overview

AI DataOps presentation components: an operational brief card for scheduled queries and data-health promises, an insight dialog shell and read-only result views, via `@/api/dataOpsAi`.

## Interface

- `[index.ts]` - re-exports all components below
- `[OperationalBriefCard.tsx:OperationalBriefCard]` - AI brief with feedback
- `[AiInsightDialog.tsx:AiInsightDialog]` - dialog shell with loading/error
- `[InsightViews.tsx:InvestigationView]`, `AssessmentView`, `TuningView`, `CorrelationView`

## Invariants

- Brief gated on AI_OPTIMIZE and an id; `retry: false`, 5 min stale time `[OperationalBriefCard.tsx:OperationalBriefCard]`
- Feedback optimistic, reverted on failure `[OperationalBriefCard.tsx:recordFeedback]`

## Side Effects

- `summarizeScheduledQuery` / `summarizeDataHealth` and `submitDataOpsAiFeedback` `[OperationalBriefCard.tsx:OperationalBriefCard]`

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features` (from repo root; full suite: `bunx vitest run`)
