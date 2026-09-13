# Upload & preview

Load files into existing tables and inspect rows without writing SQL.

## File upload

Upload CSV, TSV or JSON files into an existing table (requires `table:insert`):

1. Open the table in the **Explorer** and choose **Upload data**.
2. Select the file — `.csv`, `.tsv` or `.json`.
3. Map/confirm the target columns (header handling follows the format: headers on first row for CSV/TSV, object keys for JSON).
4. Start the upload — rows are inserted via the server proxy in batches.

Behavior notes:

- Uploads append to the table; they don't truncate
- Format errors surface per batch with row context — fix the file and retry rather than fighting partial state
- Very large files: prefer ClickHouse-native bulk loading (`clickhouse-client`) and keep the UI upload for team-sized datasets
- All inserts pass [data access rules](/docs/data-access-rules/) — the target table must be allowed

## Data preview

Every table opens with a paginated sample:

- Bounded reads (server caps rows per page — configurable via preferences' max-rows default)
- Sortable columns and quick filters on the sampled page
- Column types shown alongside values — catches Nullable/stringly-typed issues early

The preview is a `SELECT … LIMIT` through the [security pipeline](/docs/security/); `table:select` gates it.

## From preview to action

| Next step | How |
| --- | --- |
| Run a real query | Open in [SQL editor](/docs/workspace-editor/) |
| Export the sample | [Exports](/docs/explorer-export/) — CSV/JSON/TSV |
| Check schema hygiene | [Schema advisor](/docs/monitoring-schema-advisor/) |
| Diagnose part health | [Parts](/docs/monitoring-parts/) |

> **Tip:** If an upload lands with unexpected types (numbers parsed as strings), check the source file encoding/quoting — ClickHouse types are inferred from the table schema, not the file.
