---
name: schema-diagnosis
description: Diagnose a column/table schema issue — Nullable overhead, oversized integer, or weak compression — and propose an ALTER.
when_to_use: User asks whether a column or table schema is wasteful (Nullable when rarely null, oversized int, poor compression/codec) and wants a concrete fix.
---

## WHEN TO USE
The user wants to know if a column/table is storing data wastefully and how to
fix it. Three common categories: `nullable` (a Nullable wrapper that's rarely
null), `oversized` (an integer wider than the data needs), `compression` (a
column compressing poorly / wrong codec). Ground every recommendation in real
numbers, then propose a concrete `ALTER TABLE`.

## TOOLS TO RUN (in order)
1. `get_table_ddl` — current column type, codec, engine.
2. `run_select_query`, by category:
   - nullable → null share: `SELECT count() AS total, countIf(col IS NULL) AS nulls FROM db.table`. If ~0, drop the wrapper.
   - oversized → real range: `SELECT min(col) AS lo, max(col) AS hi FROM db.table SAMPLE 0.01`. Pick the narrowest fitting Int/UInt.
   - compression → `SELECT sum(data_compressed_bytes) AS comp, sum(data_uncompressed_bytes) AS uncomp FROM system.parts_columns WHERE database='db' AND table='t' AND column='col'`. Ratio ≈ uncomp/comp.
3. `get_table_size` — scale context for the rewrite cost.

## REFERENCES TO LOAD
- `load_reference` "types-codecs-compression" — integer sizing, LowCardinality, Nullable, codec selection (Delta/DoubleDelta/Gorilla/ZSTD).
- `load_reference` "system-table-reference" — exact `system.columns` / `system.parts_columns` columns.

## RULES
- Propose a concrete `ALTER TABLE db.table MODIFY COLUMN …` (drop Nullable / narrow the int / set CODEC), grounded in the numbers you measured.
- READ-ONLY investigation only; never append a `FORMAT` clause. MODIFY COLUMN rewrites the column across all parts — note a human should validate on a sample first.