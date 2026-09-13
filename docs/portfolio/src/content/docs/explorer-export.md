# Exports

Result sets leave CHouse UI as files — CSV, JSON or TSV — from the query workspace and the explorer.

## Where export lives

| Surface | What you export |
| --- | --- |
| [SQL editor](/docs/workspace-editor/) result grid | The current result set (subject to the row cap) |
| [Data preview](/docs/explorer-upload/) | The sampled rows of a table |
| Query logs / monitoring grids | Selected rows in some views |

The **Download dialog** lets you choose format and scope before the file is produced.

## Formats

| Format | Best for | Notes |
| --- | --- | --- |
| CSV | Spreadsheets, BI tools | Quoting/escaping per RFC 4180 |
| JSON | APIs, further processing | Full-fidelity types where possible |
| TSV | ClickHouse-native pipelines | Tab-separated, minimal quoting |

## How it works

- Export requests run through the same [security pipeline](/docs/security/) as queries — `table:select` / `query:execute` plus [data access rules](/docs/data-access-rules/) apply
- The server streams the file; the browser never talks to ClickHouse directly
- Row caps apply: exporting "everything" of a huge table will export what the query/preview returned, not the full table — write an explicit query for full extracts
- Analyst role and below typically have select+export; guests may be read-only depending on your [permission setup](/docs/permissions/)

## Auditability

Exports are logged in the [audit log](/docs/audit-log/) like any other action — who exported what and when.

> **Tip:** For recurring extracts, save the query as a [saved query](/docs/workspace-saved-queries/) or automate it with [Scheduled queries](/docs/scheduled-queries/) / the [CLI](/docs/cli/) instead of hand-pulling files.
