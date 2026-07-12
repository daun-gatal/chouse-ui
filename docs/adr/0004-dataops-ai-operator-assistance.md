# 0004 — Evidence-grounded DataOps AI operator assistance

**Status:** Accepted

## Context

Scheduled Queries and Data Health already execute durable work, retain bounded run
evidence, enforce RBAC, and expose incidents and runtime lineage. Operators still have to
translate intent into safe configuration, interpret raw failures, select useful health
expectations, tune noisy monitors, and decide how to recover. A generic chat surface does
not solve those jobs and can hide whether an answer is grounded in current operational
evidence.

The existing AI runtime provides model selection, structured output, read-only ClickHouse
tools, capability permissions, and audit logging. DataOps must reuse that boundary while
also enforcing Scheduled Queries and Data Health ownership and permissions. Scheduling,
health evaluation, access checks, and remediation must remain deterministic.

## Decision

### Product contract

DataOps AI is embedded in the object the operator is viewing. It provides:

- a cached operational brief for every Scheduled Query and protected dataset;
- intent-to-job drafting and a preflight risk review before activation;
- evidence-grounded investigation of failed runs and health incidents;
- health-check and threshold recommendations backed by bounded history;
- noise-tuning and related-incident correlation recommendations;
- recovery planning for missed Scheduled Query windows;
- reviewable action drafts that are revalidated and require explicit approval.

Every response separates observed facts, AI interpretation, suggested actions, confidence,
and evidence references. “Insufficient evidence” is a valid result. AI is not invoked in
the scheduler or evaluator hot path and its availability never blocks normal DataOps.

### Operational briefs

Briefs answer four questions: what the object does, whether it is healthy, what changed,
and whether action is needed. They are generated on demand, cached by an evidence
fingerprint, and invalidated naturally when the definition, latest run/evaluation,
incident, or lineage evidence changes. The UI always renders deterministic object data
immediately and adds the brief when available.

### Evidence foundation

The server assembles bounded, permission-scoped evidence before the model runs:

- job/promise definition and schedule;
- recent runs, samples, incidents, and result metadata;
- the target run's correlated `system.query_log` record when available;
- previous successful behavior for comparison;
- runtime lineage and configured destinations;
- bounded schema and aggregate diagnostics;
- transparent historical distributions used for recommendations.

Raw source rows are excluded by default. Any diagnostic sample is separately requested,
bounded, never persisted in the AI result, and checked against the current viewer's data
access.

### Capabilities

The structured AI registry gains these capability contracts:

- `draft-scheduled-query`
- `assess-scheduled-query`
- `summarize-scheduled-query`
- `diagnose-scheduled-run`
- `plan-scheduled-recovery`
- `recommend-health-promise`
- `summarize-data-health`
- `diagnose-health-incident`
- `tune-health-promise`
- `correlate-health-incidents`

Capabilities return schema-validated objects. The model may explain and rank evidence but
does not calculate schedule occurrences, historical statistics, schema diffs, access
decisions, or backtest outcomes; deterministic services do.

### Actions and remediation

AI-produced changes are drafts. Applying a draft passes through the existing create/update
schemas, read-only SQL validation, data-access enforcement, materialization checks, and
feature permissions. Run, retry, and historical recovery actions require the corresponding
run permission and explicit user confirmation. There are no silent mutations and no
model-authored raw write statements.

Historical recovery uses the existing runner with deterministic slot timestamps. The
server previews slot count and duplicate/idempotency risk before execution, bounds each
request, and records every run normally. Materialize recovery is rejected when the mode
cannot meet the existing idempotency contract.

### Authorization and safety

AI access is the intersection of `ai:optimize` and the relevant feature permission. Object
visibility follows the existing owner/`view_all` rules. Applying changes additionally
requires edit/write/run permissions. Target connection access and data-access policies are
re-evaluated server-side.

Stored SQL, descriptions, errors, and database values are untrusted evidence, not
instructions. Prompts explicitly delimit them. ClickHouse investigation stays read-only,
bounded by time and row limits, and auditable. Sensitive connection material is never
included in prompts or logs.

### User experience

Scheduled Query detail provides the operational brief, preflight assessment, failed-run
investigation, and recovery planner. The creation wizard can draft from intent and shows
preflight results before save.

Data Health detail provides its operational brief, health-check coverage, incident
investigation, tuning recommendations, correlated incidents, and evidence. The promise
wizard can request recommendations and apply selected checks as an editable draft.

All AI panels display generation time, evidence freshness, confidence, a manual refresh,
and a deterministic unavailable/insufficient-evidence state.

### Verification and outcome measures

Tests cover schemas, evidence fingerprinting, ownership, permission intersections,
bounded queries, prompt isolation, soft failure, frontend API envelopes, and draft
application. Existing Scheduled Queries and Data Health server/frontend tests must remain
green, followed by typecheck, lint, and production build.

Product instrumentation records capability, object type, latency, accepted/edited/rejected
drafts, and useful/not-useful feedback without storing prompt data or source rows. Target
outcomes are reduced time to a valid job, reduced run/incident investigation time, fewer
repeat false-positive alerts, and zero unauthorized exposure or unapproved mutation.

## Consequences

Operators receive assistance at the decision point instead of navigating to a generic
chat. The approach is explainable and degrades safely, but evidence collection and
structured schemas require more engineering than unconstrained prompting. On-demand model
latency remains visible, so caching and deterministic page rendering are required.

The first implementation is one release and one product contract. Capabilities can evolve
independently after release without changing the safety boundary.

## Alternatives considered

- **Generic DataOps chat.** Rejected because it lacks an object-scoped evidence contract
  and makes safe action review difficult.
- **Autonomous remediation.** Rejected because scheduled materialization and monitor
  changes can affect production data and alert coverage.
- **LLM-generated anomaly decisions.** Rejected because health outcomes must remain
  reproducible, transparent, and available without a model.
- **Generate every summary on page load.** Rejected because it adds latency, cost, and
  wording churn when evidence has not changed.
- **Send raw rows to the model.** Rejected because aggregates, schema, bounded structural
  evidence, and viewer-initiated diagnostics are sufficient for the supported workflows.
