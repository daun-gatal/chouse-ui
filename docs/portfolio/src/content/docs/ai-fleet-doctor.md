# Chouse AI — Fleet Doctor

The Fleet Doctor (`/doctor`, permissions `doctor:view` to read, `doctor:run` to trigger) is an autonomous, **read-only** AI SRE: it scans your fleet, pins root causes and writes structured reports you can act on.

## What a scan does

1. **Guarded query tool** — the doctor's only tool is a single `SELECT` restricted to `system.*`, executed with ClickHouse `readonly=1`
2. **Evidence gathering** — query costs, memory pressure, parts/merges, replica lag, error trends across the fleet (scoped to the nodes you select)
3. **Structured report** — per-node verdict, recommendations, cited evidence, and a heavy-query deep-dive

## Reading a report

| Section | Use |
| --- | --- |
| Per-node verdict | healthy / degraded / troubled at a glance |
| Recommendations | Ordered, concrete next steps |
| Evidence | The queries that justify the verdict — verify anything before acting |
| Heavy-query deep-dive | The costliest statements with [EXPLAIN](/docs/workspace-explain/) context |

## History rail

Reports persist with a history rail — scan the past runs to see what changed between two dates. **Scope** (node subset) and **time window** are selectable per run.

## Schedules & auto-RCA

- `DOCTOR_SCHEDULE_FILE` stores scheduled scan definitions (cron-style cadence)
- On an [alert breach](/docs/alerting/), the doctor can auto-run **RCA** on the affected cluster and deliver the analysis to Slack/email — rate-limited by `DOCTOR_AUTO_RCA_COOLDOWN_MINUTES` (default 60 min per server)

## Safety model

| Guarantee | Mechanism |
| --- | --- |
| No mutations | `readonly=1` + single-SELECT tool surface, `system.*` only |
| No credential sprawl | Runs through CHouse UI's server with its [RBAC](/docs/permissions/) checks |
| No silent advice | Every recommendation carries cited evidence |
| Spend control | `doctor:run` gates who can trigger scans; provider budgets live at the AI provider |

## Providers

The doctor runs on the same pluggable provider list as [AI Assist](/docs/workspace-ai-assist/) — configure in **Admin → AI models**. Self-hosted models (e.g. Ollama) keep prompts in-network.

> **Tip:** Treat doctor reports as a second pair of eyes, not a replacement for the tabs — the report links back into [query logs](/docs/monitoring-query-logs/) and [cluster activity](/docs/monitoring-cluster-activity/) for verification.
