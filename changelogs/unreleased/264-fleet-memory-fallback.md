type: patch

### Fixed
- **Fleet memory tile no longer shows `0%` / `0 Bytes` on cgroup-limited nodes** ([#264](https://github.com/daun-gatal/chouse-ui/issues/264)) — containerised ClickHouse nodes that don't expose `OSMemoryTotal` were rendering a phantom `~2 GB / 0 Bytes → 0%`. The fleet `summary` metric now falls back through `OSMemoryTotal` → `CGroupMemoryTotal` (excluding the `~2^63` "no limit" sentinel) → `max_server_memory_usage` for the memory ceiling. When none is available the card shows `X used / —` and `—%` honestly instead of a misleading `0%`. `formatBytes()` was also extended to `PB`/`EB` and clamped so an out-of-range value can never render as `"8 undefined"`.
