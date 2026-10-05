ClickHouse column types, codecs & compression reference — use this to ground schema advice (column too wide, Nullable overhead, weak compression). Inspect real numbers first via system.columns / system.parts_columns; never guess.

## Picking the narrowest integer
- Sample the real range: `SELECT min(col) AS lo, max(col) AS hi FROM db.table SAMPLE 0.01`.
- UInt8 (0–255), UInt16 (0–65 535), UInt32 (0–4.29B), UInt64 — pick the smallest that fits. Use the signed Int* variants only when `lo < 0`.
- An oversized integer (e.g. UInt64 where UInt16 fits) multiplies on-disk + read bytes for no benefit. Fix: `ALTER TABLE db.table MODIFY COLUMN col <narrower type>`.

## Nullable
- `Nullable(T)` stores a separate null-mask byte stream per value and blocks some optimizations.
- Check the real null share: `SELECT count() AS total, countIf(col IS NULL) AS nulls FROM db.table`.
- If nulls = 0 (or a tiny share), drop the wrapper: `ALTER TABLE db.table MODIFY COLUMN col T` — pick a sentinel DEFAULT if a few nulls exist (0 for ints, '' for strings, epoch for dates).

## LowCardinality
- `LowCardinality(String)` (or LowCardinality of other types) dictionary-encodes a column with < ~10 000 distinct values — big space + speed win for repetitive strings (status, country, host, enum-like).
- Not for high-cardinality / unique columns (ids, free text) — the dictionary then hurts.

## Codecs (match the codec to the column shape)
- Monotonic / slowly-changing integers & timestamps → `Delta, ZSTD(3)` or `DoubleDelta, ZSTD(3)` (store deltas, then compress).
- Floats / sensor / metric series → `Gorilla, ZSTD(3)`.
- Repetitive strings → prefer `LowCardinality(<inner>)` over a raw codec.
- Already-compressed or near-random data (compression ratio ~1×) → a higher ZSTD level, e.g. `ZSTD(6)`–`ZSTD(12)`.
- Apply with: `ALTER TABLE db.table MODIFY COLUMN col <type> CODEC(<spec>)`.

## Measuring compression
- Per-column on-disk vs uncompressed bytes: `SELECT column, sum(data_compressed_bytes) AS comp, sum(data_uncompressed_bytes) AS uncomp FROM system.parts_columns WHERE database='…' AND table='…' GROUP BY column ORDER BY comp DESC`.
- Ratio = uncompressed / compressed. A ratio near 1× means the data isn't compressing — change the codec or type, don't just bump ZSTD blindly.

Any schema change is applied by a human and should be validated on a copy/sample first; MODIFY COLUMN rewrites the column's data across all parts (I/O cost).