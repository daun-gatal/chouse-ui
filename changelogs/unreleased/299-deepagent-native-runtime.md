type: patch

### Changed
- **Faster Chouse AI runtime** — AI capabilities now use bounded, focused DeepAgents tool loops
  without synchronous planning/delegation overhead. Chat uses one cancellable invoked request and
  keeps the UI responsive with immediate working states before rendering the complete answer,
  activity trail, and charts.
- **Richer AI charts** — chart results now infer and label the correct axes, normalize ClickHouse
  numeric values, use responsive readable layouts, and add improved tooltips, legends, accessible
  chart navigation, and a range brush for longer time series.
- **Consistent AI windows** — Query Logs, Explorer, Errors, Parts, Schema Advisor, query debugging,
  and scheduled fleet scans now share the same model dropdown with provider/model details and
  default-model labeling. Query optimization shows the attached SQL and context for review before
  the request is submitted.

### Fixed
- **AI chart rendering** — unwrap JSON-serialized LangChain tool results and recover missing or
  mismatched chart metadata so valid query results no longer fall through to “No data to display.”
