type: minor

### Added
- **Bundled evaluation databases in the Helm chart** — `postgresql.enabled` and `clickhouse.enabled` stand up PostgreSQL and a single-node ClickHouse alongside CHouse UI, with the connection form pre-filled, so a Kubernetes install can be tried end to end without provisioning anything first. Disabled by default and intended for evaluation and CI only; production installs should continue to use a managed PostgreSQL and a ClickHouse operator (ADR 0009).
