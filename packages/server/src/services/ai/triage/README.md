# AI Auto-Triage

## Overview
Auto-triage (ADR 0024 Phase 4): per-trigger rules, a runner that investigates new incidents, alerts, failed runs or Doctor reports without being asked, and the subject sources.

## Interface
- `[runner.ts:startTriageRunner]`, `[runner.ts:stopTriageRunner]`, `[runner.ts:triageTick]`, `[runner.ts:triageSubject]`.
- `[store.ts:listRules]`, `[store.ts:saveRule]`, `[store.ts:claimRun]`, `[store.ts:finishRun]`, `[store.ts:listRuns]`, `[store.ts:tokensToday]`, `[store.ts:failStaleRuns]`, `[store.ts:pruneRuns]`, `[store.ts:TRIAGE_DEFAULTS]`, `[store.ts:TRIAGE_RETENTION_MS]` (90 days).
- `[subjects.ts:TRIAGE_TRIGGERS]`, `[subjects.ts:newSubjects]`, `[subjects.ts:SUBJECTS_PER_TICK]`.

## Invariants
- One replica at a time holds the lease and ticks every minute: the private `tick()` in `runner.ts` takes the lease (`acquireLease`), fails stale runs, calls `[runner.ts:triageTick]` (which takes no lease itself) and prunes once a day (`[runner.ts:startTriageRunner]`).
- Each subject is claimed once (`[store.ts:claimRun]`).
- A trigger without a stored rule is off; turning a rule on moves its watermark to now so older subjects are never triaged (`[store.ts:saveRule]`, `[store.ts:setWatermark]`).

## Side Effects
- Writes `ai_triage_rules`, `ai_triage_runs` (`[store.ts:saveRule]`, `[store.ts:claimRun]`).
- `setInterval` tick and `obs_leases` lease (`[runner.ts:startTriageRunner]`); model calls through the triage capability.
- `[runner.ts:triageSubject]` adds an `ai_finding` cell to the subject's investigation notebook (`ensureNotebook` / `addCell`) and, when the rule has channels, sends a notice via `notifyChannelIds` and records it with `recordEvent` (`alert_events`).
- `[store.ts:pruneRuns]` deletes `ai_triage_runs` older than `[store.ts:TRIAGE_RETENTION_MS]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
