#!/bin/bash
#
# Docker-backed e2e for issue #336 (ON CLUSTER DDL false JSON parse error).
#
#   ./scripts/e2e-oncluster-ddl.sh
#
# Starts the local testbed cluster plus the Keeper overlay
# (testbed/docker-compose.yml + testbed/docker-compose.oncluster.yml —
# Keeper is required: ClickHouse refuses ON CLUSTER DDL without one),
# waits for it to accept queries, runs the ON CLUSTER e2e test, then tears
# everything down — containers and the e2e tables (the test itself drops
# its tables in `finally`; compose down runs via trap even on failure).
#
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f testbed/docker-compose.yml -f testbed/docker-compose.oncluster.yml"

cleanup() {
  $COMPOSE down >/dev/null 2>&1 || true;
}
trap cleanup EXIT

$COMPOSE up -d

echo "Waiting for ClickHouse testbed (http://localhost:8200)..."
READY=0
for _ in $(seq 1 60); do
  if curl -fsS -u "default:default" "http://localhost:8200/?query=SELECT%201" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done
if [ "$READY" -ne 1 ]; then
  echo "ClickHouse testbed did not become ready" >&2
  exit 1
fi

CH_E2E_URL=http://localhost:8200 CH_E2E_USER=default CH_E2E_PASSWORD=default \
  bun test packages/server/src/services/clickhouse.oncluster.e2e.test.ts

echo "Verifying cleanup (no e2e tables left)..."
LEFT=$(curl -fsS -u "default:default" --data-binary \
  "SELECT count() FROM system.tables WHERE name LIKE 'e2e\\_oc\\_%' FORMAT TabSeparated" \
  http://localhost:8200/ 2>/dev/null || echo "unknown")
echo "Remaining e2e tables: $LEFT"
