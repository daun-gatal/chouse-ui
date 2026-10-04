#!/usr/bin/env bash
#
# UI end-to-end suite (ADR 0016, gate 9).
#
#   ./scripts/e2e-ui.sh                 # run the suite
#   ./scripts/e2e-ui.sh --update-snapshots
#
# Starts a throwaway ClickHouse (cheui-ch) with a small fixed dataset, then runs
# Playwright against a production build of CHouse UI (scripts/e2e-ui-server.sh).
# Only the cheui-ch container is created or removed. Works with a remote daemon
# via DOCKER_HOST: set E2E_CH_HOST to the address that reaches the published
# port (defaults to localhost) and E2E_CH_PORT to a free published port.
#
set -euo pipefail

cd "$(dirname "$0")/.."

# Exact patch: the Home page shows the server version, and the baselines were
# captured on this build (a floating tag changes the text on CI).
CH_VERSION="${CH_VERSION:-26.5.7.64-alpine}"
export E2E_CH_HOST="${E2E_CH_HOST:-localhost}"
export E2E_CH_PORT="${E2E_CH_PORT:-18123}"
# Throwaway credentials, generated per run: nothing secret lives in the repo.
export E2E_CH_PASSWORD="${E2E_CH_PASSWORD:-$(openssl rand -hex 16)}"
export E2E_ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD:-$(openssl rand -hex 12)}A!"
NAME=cheui-ch

cleanup() {
  docker rm -f -v "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker run -d --name "$NAME" -p "$E2E_CH_PORT:8123" \
  -e CLICKHOUSE_PASSWORD="$E2E_CH_PASSWORD" -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
  --ulimit nofile=262144:262144 "clickhouse/clickhouse-server:$CH_VERSION" >/dev/null

echo "Waiting for ClickHouse on $E2E_CH_HOST:$E2E_CH_PORT..."
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://$E2E_CH_HOST:$E2E_CH_PORT/ping" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "Seeding the fixed dataset..."
while IFS= read -r statement; do
  [ -z "$statement" ] && continue
  curl -fsS --max-time 30 -u "default:$E2E_CH_PASSWORD" "http://$E2E_CH_HOST:$E2E_CH_PORT/" --data-binary "$statement" >/dev/null
done < testbed/ui-e2e/seed.sql

npx playwright test "$@"
