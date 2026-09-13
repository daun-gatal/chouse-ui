# Visual EXPLAIN

Visual EXPLAIN shows what the planner will do with a query before you run it — access paths, join order, and where the cost is.

## What you get

- **Plan estimate** for the statement in the editor, rendered as readable stages
- **Popout view** (`/explain-popout`) — the plan in a dedicated window for side-by-side work
- **Debug dialog** — combines the plan with error context when a query misbehaves

## When to use it

| Situation | What EXPLAIN tells you |
| --- | --- |
| Query feels slow | Full-scan vs index/granule reads, join order, sorting stages |
| Unexpected result volume | Which parts/filters apply before the join |
| Pre-flight check for heavy queries | Estimated cost before committing cluster resources |
| Teaching/reviewing SQL | Concrete plan stages for the team |

## Workflow

1. Write the query in the [SQL editor](/docs/workspace-editor/).
2. Invoke **EXPLAIN** (editor action or debug dialog).
3. Read the plan; adjust the query; repeat.
4. Run when satisfied — or let [Chouse AI](/docs/ai-in-tab/) propose an optimized rewrite with a before → after EXPLAIN comparison.

## AI-assisted optimization

With `ai:optimize`, the in-tab **Optimize** action pairs an optimized rewrite with the same-result guarantee and EXPLAIN evidence — see [Chouse AI in-tab](/docs/ai-in-tab/). The AI is advisory: review the rewrite before running it.

## Relationship to monitoring

- EXPLAIN answers "what will this query do?"; the [query logs](/docs/monitoring-query-logs/) answer "what did it actually do?"
- Profile events in the query-log drill-down show the real granule reads and memory against the plan's estimates
