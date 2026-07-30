type: minor

### Added
- **Production Helm chart** — official Kubernetes deployment via `helm install chouse-ui oci://ghcr.io/daun-gatal/charts/chouse-ui`: SQLite (single replica + PVC) and PostgreSQL/HA topologies with render-time guard rails, automatic `CHOUSE_HA` wiring, optional dedicated scheduled-queries pod, hardened security defaults, and cosign-signed chart releases published automatically alongside app releases (ADR 0008).
