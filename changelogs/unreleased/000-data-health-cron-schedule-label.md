type: patch

### Fixed
- **Data Health cron schedule label** — promise details now show the saved cron expression instead of the preset hour field.
- **Promise schedule timezone and event time** — schedule previews now render in the configured timezone, and table promises automatically select a valid ClickHouse `Date` or `DateTime` event-time column without retaining a stale selection from another table.
- **Deterministic event-time normalization** — Data Health now persists native/string encoding, explicit Unix precision, and the timezone of naïve values; sampled previews validate conversion to UTC, while datasets without event time show an actionable warning and can continue with non-windowed checks.
