---
app: Data › Coverage
route: /data/coverage
permissions: observe:view
screenshot: data-coverage
---
# Coverage

**Data › Coverage** shows how well your tables are protected and what to protect next. Every table with data is watched from day one by its learned baseline — no table is scanned for it — so coverage is about where you should add explicit intent with a [promise](/docs/data-health/).

## What's on the screen

| Panel | Shows |
| --- | --- |
| **Learned baselines** | Tables watched by their learned freshness and volume baseline |
| **Promises** | Tables with at least one promise |
| **Critical coverage** | Share of *critical* tables that have a promise |
| **Read but unprotected** | Tables people read that have no promise |
| **Never read · 7d** | Tables nobody read in the last week |
| **Coverage by criticality** | Promised vs. baseline-only, split by *critical*, *important* and *normal* |
| **Suggested promises** | Read-heavy tables without a promise, with who writes them |
| **Cold data** | Tables that are still ingested but haven't been read for a week |

Criticality comes from real read volume; see [How data is watched](/docs/data-observability/#what-every-table-gets-from-day-one).

## Act on suggestions

- **Accept** opens the promise wizard pre-filled for that table (needs `data_health:edit`). Review the checks, then save.
- **Dismiss** hides the suggestion (needs `observe:edit`).

Work top-down: critical tables first, then important ones that many people read.

## Cold data

A table that is still written but never read costs ingestion, merges and disk for nothing. Check with its owner, then stop the writer, add a TTL, or drop it. [Capacity](/docs/monitoring-capacity/) shows how much space it holds.
