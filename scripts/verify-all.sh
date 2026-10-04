#!/usr/bin/env bash
#
# Every gate of ADR 0016 in order, stopping at the first failure.
#
#   ./scripts/verify-all.sh           # gates 1-6 (no cluster e2e)
#   FULL=1 ./scripts/verify-all.sh    # all gates, including the Docker e2e suites
#
# Gates 7-10 need Docker (and helm for gate 10); gate 11 (image build + Trivy)
# runs in CI only.
set -euo pipefail

cd "$(dirname "$0")/.."

gate() {
  echo
  echo "=== Gate $1: $2"
}

gate 1 "Install"
bun install --frozen-lockfile
(cd packages/server && bun install --frozen-lockfile)

gate 2 "Lint & types"
bun run lint
bun run typecheck
(cd packages/server && bun run typecheck)

gate 3 "Frontend tests"
bunx vitest run

gate 4 "Server tests"
./scripts/test-isolated-server.sh

gate 5 "Build"
bun run build

gate 6 "Migrations (SQLite + PostgreSQL)"
./scripts/test-migrations.sh

if [ -z "${FULL:-}" ]; then
  echo
  echo "Gates 1-6 passed. Set FULL=1 for the Docker e2e gates (7-9)."
  exit 0
fi

gate 7 "Cluster e2e (existing)"
./scripts/e2e-scheduled-cluster.sh
./scripts/e2e-oncluster-ddl.sh
./scripts/e2e-mcp.sh
./scripts/e2e-pat.sh
./scripts/e2e-cli.sh

gate 8 "Observability e2e"
./scripts/e2e-observe.sh

gate 9 "Helm"
helm lint charts/chouse-ui --strict --values charts/chouse-ui/ci/default-values.yaml
helm unittest charts/chouse-ui

echo
echo "All gates passed."
