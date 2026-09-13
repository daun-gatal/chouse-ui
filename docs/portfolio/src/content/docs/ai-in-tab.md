# Chouse AI in-tab

The same read-only AI engine that powers the [Fleet Doctor](/docs/ai-fleet-doctor/) is surfaced *inside the monitoring tabs* — so you fix a problem without leaving the tab you found it in. Gated by `ai:optimize`.

## The three actions

### Optimize (query logs)

On a [query-log](/docs/monitoring-query-logs/) row:

1. Click **Optimize with Chouse AI**
2. Receive an optimized rewrite that produces the same result
3. Review the **before → after `EXPLAIN` estimate** as proof
4. One click **Open in Explorer** to run the rewrite yourself

The AI never runs the rewritten query — you do, after review.

### Fix (errors)

On a [system.errors](/docs/monitoring-errors/) row, **Fix** returns cause / impact / ordered solutions for that specific error.

### Diagnose (parts)

On a [part-log](/docs/monitoring-parts/) row, **Diagnose** reads part health: merge pressure, too-many-parts symptoms, partition-key evaluation.

## Why in-tab matters

The classic flow — copy an error into a chatbot, paste back a guess, hunt for the query, guess again — loses the context. Here the diagnosis and the fix live next to the problem, with the cluster's real telemetry one click away.

## Safety model

| Guarantee | Mechanism |
| --- | --- |
| Read-only | `readonly=1`, single-SELECT tool surface, `system.*` only |
| Advisory only | Suggestions require human review before anything runs |
| Auditable | Usage lands in the [audit log](/docs/audit-log/) |
| Spend-gated | `ai:optimize` controls who can invoke it; provider budgets apply |

## Provider setup

Uses the same providers as [AI Assist](/docs/workspace-ai-assist/) — configure under **Admin → AI models**. No provider configured = AI actions hidden.

## Quick tour

1. Open [query logs](/docs/monitoring-query-logs/) → pick your slowest pattern
2. **Optimize with Chouse AI** → read the rewrite + EXPLAIN delta
3. **Open in Explorer** → run the improved query
4. Re-check the pattern's cost after a day — the [Patterns](/docs/monitoring-query-logs/) sub-view shows the before/after in Total duration

> **Warning:** The AI can be wrong — EXPLAIN estimates are estimates. The evidence chain (rewrite → EXPLAIN → your run) is designed so you can verify every step before trusting it.
