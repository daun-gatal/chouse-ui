---
app: Data › Incidents
route: /data/incidents
permissions: observe:view, data_health:view
---
# Incidents, root cause & fixes

## The investigation view

**Data › Incidents** merges Data Health incidents and pipeline, freshness, part, replication and capacity incidents. Opening one shows:

1. **Root-cause chain** — a deterministic walk from the symptom upstream through the lineage graph across layers: **data → transform → ingestion → external → engine**. Each step names the system table its evidence came from. The root is the deepest, earliest, most severe signal — computed, not guessed.
2. **Blast radius** — everything downstream of the root: tables, promises, scheduled jobs, saved queries and agents.
3. **Explain with Chouse AI** (`ai:optimize`) — separates observed facts from interpretation and drafts fixes. The AI narrates the stored chain; it never picks the root cause, and drafts outside the remediation catalog are dropped.
4. **Fixes** — see below.
5. **Notebook** — a shared investigation notebook: AI findings, read-only query cells with saved snapshots (re-runnable), and notes. **Export postmortem** downloads it as Markdown. Writing needs `notebooks:edit`; query cells also `query:execute` and run under your own data access.

Acknowledge and snooze work as before for Data Health incidents (`data_health:edit`); pipeline incidents are acknowledged with `observe:edit`.

## Fixes with approval

Fixes come from a closed catalog — nothing else can run:

| Area | Actions |
| --- | --- |
| Queries & jobs | Kill query · pause / resume / delay a scheduled job |
| Settings | Set one setting on a user, role or settings profile |
| Tables | Optimize a partition · restart replica · add skip index · modify TTL · modify column codec |
| Pipelines | Restart an engine table (detach/attach) · reload dictionary · refresh view · flush Distributed |

Every action shows the exact statements, how it is verified, and its rollback before anyone approves it.

| Rule | Detail |
| --- | --- |
| Propose | `remediation:propose`, from the UI, a Chouse AI draft, or an agent (MCP `propose_remediation`) |
| Approve | `remediation:approve`; **high-impact** actions need `remediation:approve_high` and **two** approvers |
| Self-approval | Never for high-impact actions, and never for anything proposed by Chouse AI or an agent |
| Where | The UI, Slack (signed buttons) or `chouse remediation approve` |
| When | TTL and codec changes run only inside the maintenance window (`REMEDIATION_MAINTENANCE_WINDOW`, UTC, default `02:00-04:00`) |
| As whom | A separate **remediation credential** per connection (Admin › Connections › Edit), never the connection's own user |
| After | A verification probe confirms the effect; rollback restores the previous TTL, codec or settings |

## Schema change preflight

Before DDL runs — from the SQL editor, the Explorer's drop buttons, the API, CLI or MCP — CHouse checks what depends on it. A change that breaks a view, dictionary, Distributed table, scheduled job, promise or saved query is stopped with the impact and, when possible, a safer plan. Users with `schema:override` (Admin by default) can confirm and run it anyway; the override is audited.
