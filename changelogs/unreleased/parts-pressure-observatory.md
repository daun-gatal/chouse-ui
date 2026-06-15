type: minor

### Added
- **Parts pressure monitoring** — a new Parts tab in Metrics surfaces the insert-vs-merge race behind ClickHouse's "too many parts" failure mode. For each table it shows the worst partition against `parts_to_throw_insert`, live insert/merge rates, and a projected ETA until the threshold is crossed. Also collected fleet-wide as the `parts_pressure` metric for historical trends.
