# Customize an AI feature

This guide teaches the SQL editor's **Optimize** your team's SQL conventions — without touching the built-in agent, and with a one-click way back. The same steps work for any AI feature: the Doctor scan, an error diagnosis, a DataOps brief.

You need `ai_agents:manage` and `ai:optimize`, a configured [AI model](/docs/ai-models/), and an active connection with a table to try it on.

## 1. Write the conventions as a skill

**Agents › Assistant › Skills › New skill**:

- **Path**: `custom/team-sql-conventions`
- **SKILL.md**:

```md
---
name: team-sql-conventions
description: Our SQL conventions for rewritten queries — naming, filters and functions we standardize on.
---

When you rewrite a query:
- Keep the column aliases the user wrote; downstream dashboards depend on them.
- Filter on `event_date` (the partition key) as well as `event_time` for any time range.
- Use `uniqCombined` instead of `uniqExact` unless the user asks for exact counts.
- Never add `FINAL`; our ReplacingMergeTree tables are deduplicated by a nightly job.
```

**Create** it. A skill on its own does nothing until an agent links it.

## 2. Copy the built-in agent

**Agents › Assistant › Features** → *SQL editor* → **Optimize query** → **Edit agent**. This opens *SQL Optimizer*. Click **Duplicate**: an editor opens for a new agent, *SQL Optimizer (copy)* with the slug `sql-optimizer-copy` — the same prompt, task template, tools and skills. It isn't saved, or bound to anything, until you say so.

Working on a copy keeps the built-in untouched: CHouse upgrades keep improving it, and switching back is a rebind.

## 3. Change the copy

In the copy's editor:

1. **Name**: `SQL Optimizer (team)`.
2. **Skills** → `team-sql-conventions` → **Pinned: SKILL.md**. Pinning puts the rules in every run instead of leaving it to the model to look them up.
3. **Prompt** → at the end of the system prompt, add a line that ties it together:

   ```text
   Apply the team-sql-conventions rules to every rewrite, and say in the explanation which ones you applied.
   ```

4. **Create**.

The copy isn't bound to a feature yet, so the editor's **Preview** has no feature variables to render with. The test console in the next step renders it with a real query instead.

## 4. Test it before anyone else gets it

**Agents › Assistant › Test console**:

- **Feature**: Optimize query
- **Agent**: SQL Optimizer (team)
- **Feature input (JSON)**: one of your real slow queries, for example

```json
{ "query": "SELECT user_id, uniqExact(session_id) AS sessions FROM events WHERE event_time > now() - INTERVAL 7 DAY GROUP BY user_id" }
```

**Run**. In the result, check that:

- **Result** has a rewrite that follows the conventions (here: `uniqCombined`, and an `event_date` filter next to `event_time`)
- **Tool calls** show the agent fetched the DDL and ran EXPLAIN — the conventions shouldn't replace the investigation
- **System prompt (with the output contract)** contains your skill, before the JSON schema

Run the same input with **Agent: Bound agent** to compare with the built-in. Iterate in the copy's editor — its **Test** tab runs unsaved changes, so you only save what works.

## 5. Switch the feature over

**Features** → **Optimize query** → pick **SQL Optimizer (team)** in the agent menu. Only agents that fit the feature are offered, and the server validates the binding again.

From now on **Optimize** in the SQL editor uses the team agent for everyone. Try it on a query in the [SQL editor](/docs/workspace-editor/).

## 6. Roll back if needed

- To switch back, pick **SQL Optimizer** in the same menu. The built-in was never changed.
- To undo a change to the team agent, open its **History** and **Restore** an earlier version.
- Every step is in the audit log: `ai_skill.create`, `ai_agent.create`, `ai_binding.update` — see [Versions, upgrades & audit](/docs/ai-versions/#audit-trail).

## Variations

- **Change the built-in in place** instead of copying: simpler, but it becomes *customized* and stops receiving CHouse's improvements until you reset it.
- **Use a different model** for one feature: set **Settings › Model** on its agent. Users who pick a model in the SQL editor still override it.
- **Give a feature more room**: raise **Step budget** or **Timeout** in **Settings** when runs stop early.
