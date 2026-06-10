---
name: parts-diagnosis
description: Diagnose part/partition health of a MergeTree table — too many parts, slow/stuck merges, bad partition key.
when_to_use: User asks why a table has too many parts, slow merges, TOO_MANY_PARTS insert failures, or whether its partitioning is healthy.
---

## WHEN TO USE
The user is worried about a specific table's part/partition health: too many
parts, merge pressure, TOO_MANY_PARTS on insert, or a partition key that may be
too fine. Investigate that one table read-only, then give a concrete fix.

## TOOLS TO RUN (in order)
1. `get_table_ddl` — engine (is it MergeTree-family?), `PARTITION BY`, `ORDER BY`.
2. `run_select_query` on `system.parts` for active part count + sizes per partition: `SELECT partition, count() AS parts, sum(rows) AS rows, sum(bytes_on_disk) AS bytes FROM system.parts WHERE database='<db>' AND table='<t>' AND active GROUP BY partition ORDER BY parts DESC`. Many small active parts in a partition (e.g. >300) = merge pressure / tiny inserts; hundreds/thousands of partitions = key too fine.
3. `run_select_query` on `system.merges` / `system.mutations` filtered to the table — are merges running or stuck?
4. `get_table_size` — overall scale context.

## REFERENCES TO LOAD
- `load_reference` "system-table-reference" — exact `system.parts` / `system.merges` / `system.mutations` columns.
- `load_reference` "clickhouse-playbook" — the mutations/merges + partition-cardinality guidance.

## RULES
- Ground the cause in the real part counts/sizes you found — never invent numbers.
- Typical fixes: batch inserts (never 1 row per INSERT); coarser `PARTITION BY` (e.g. toYYYYMM not toYYYYMMDD); let merges catch up or find why they're stuck (memory); the parts_to_throw_insert / max_parts_in_total context; when (and when NOT) to `OPTIMIZE TABLE … FINAL`.
- READ-ONLY; never append a `FORMAT` clause. A human applies any change.