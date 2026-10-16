type: minor

### Added
- **CHouse's own AI** — `chouse ai usage [--by origin|model]`, `chouse ai egress [--search]`, `chouse ai requests [--origin ui|mcp|token|background] [--search] [--limit] [--offset]`, `chouse ai request <id>` and `chouse ai agents`: usage, estimated cost, data sent to providers, request timelines and how the AI agents are set up (needs a 3.15 server)
- **Performance, capacity and upgrades** — `chouse perf regressions|shape <fingerprint>`, `chouse capacity [--view forecasts|growth|cold|trials]`, `chouse upgrades list|get|replay|rollout`
- **Observability collectors** — `chouse collectors status` (last run, last error, missing grants) and `chouse collectors schedule` (defaults, or the `-c` connection's schedule with bytes read per day)
- **Context and notebooks** — `chouse context get <db.table>` and `chouse context metrics [name]`; `chouse notebook show|export <data-health|observe|doctor> <ref>`, where `export` writes the Markdown postmortem to stdout

All are read-only; flags are validated before any request, and connection-scoped reads need `-c`.
