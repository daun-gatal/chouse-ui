type: patch

### Fixed
- **Query row cap honored everywhere** — `POST /query/table/select` dropped the validated `maxResultRows` field, so `--limit` had no effect on the default read path. The cap is now passed through and additionally enforced server-side (truncation), since recent ClickHouse builds ignore small `max_result_rows` values.
