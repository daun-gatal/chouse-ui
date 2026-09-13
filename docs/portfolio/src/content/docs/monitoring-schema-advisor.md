# Schema advisor

The schema advisor (`/monitoring/schema`, permission `schema_advisor:view`) is a data-hygiene linter over `system.parts_columns` — it finds columns that waste on-disk space and ranks them by bytes.

> Formerly named "Schema doctor" — renamed to disambiguate from the AI Fleet [Doctor](/docs/ai-fleet-doctor/).

## What it lints

| Finding | Why it matters |
| --- | --- |
| **Nullable columns** | Every `Nullable(T)` column pays an extra per-row null mask — often unnecessary for NOT-NULL-in-practice data |
| **Oversized integers** | `Int64` where `Int32` would do — doubles storage for the column |

## The ranking

Findings are ranked by **on-disk bytes attributable to the column** across `system.parts_columns`, so the list is an actionable ordering, not a theoretical one. Fix the top of the list first.

## Recommended fixes

1. Confirm the column never holds NULLs in practice (`SELECT count() WHERE col IS NULL`)
2. `ALTER TABLE … MODIFY COLUMN` to drop Nullable or shrink the integer type
3. Watch the [parts](/docs/monitoring-parts/) view for the mutation churn the ALTER creates

The advisor reads; it never alters anything itself.

## Workflow placement

| You just did | Do next |
| --- | --- |
| Ran an ALTER from the advisor | Monitor [parts](/docs/monitoring-parts/) for mutation pressure |
| Shrunk a big table | Re-check [Metrics → Storage](/docs/monitoring-metrics/) over the following days |
| Found repeated Nullable columns | Fix at source (ingestion schema), not just in ClickHouse |

## Underlying data

| Table | Used for |
| --- | --- |
| `system.parts_columns` | Per-column sizes on disk |

> **Tip:** Nullable removal changes the merge behavior of a table — schedule the ALTERs during a quiet window and confirm with the parts view.
