#!/usr/bin/env bash
#
# Connection kinds on real ClickHouse (ADR 0033 §10.5): the identity checks,
# the switch and the role ceiling on 24.3, 24.4, 25.10, 26.3 and 26.5, and
# personal connections, which only 26.3.63 may be and the others must refuse.
#
#   ./scripts/e2e-connection-identity.sh
#   KEEP=1 ./scripts/e2e-connection-identity.sh   # leave the servers up afterwards
#
# Needs only Docker. Works with a remote daemon via DOCKER_HOST: the suite runs
# in a container on the testbed network.
set -euo pipefail

cd "$(dirname "$0")/../testbed/connection-identity"

cleanup() {
  if [ -z "${KEEP:-}" ]; then
    docker compose --profile runner down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker compose up -d --build --wait
docker compose --profile runner build runner
docker compose --profile runner run --rm runner
