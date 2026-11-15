#!/usr/bin/env bash
#
# Connection identity over MCP and the CLI, against the real app (ADR 0033):
# starts a fresh copy of the identity lab (CHouse UI + PostgreSQL + ClickHouse
# 26.3 and 26.5), seeds it, builds the CLI from this tree and runs
# testbed/identity-lab/check.ts.
#
#   ./scripts/e2e-identity-surfaces.sh
#   KEEP=1 ./scripts/e2e-identity-surfaces.sh   # leave it up afterwards
#
# Needs only Docker. It uses its own project and ports, so a lab you started
# by hand with testbed/identity-lab/up.sh is left alone.
set -euo pipefail

cd "$(dirname "$0")/../testbed/identity-lab"

export LAB_UI_PORT="${LAB_UI_PORT:-13000}" LAB_CH_A_PORT="${LAB_CH_A_PORT:-18200}" LAB_CH_B_PORT="${LAB_CH_B_PORT:-18201}"
export LAB_ORIGIN="http://localhost:${LAB_UI_PORT}"
COMPOSE="docker compose -p chouse-identity-surfaces-e2e"

cleanup() {
  if [ -z "${KEEP:-}" ]; then
    $COMPOSE --profile check down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
$COMPOSE --profile check down -v --remove-orphans >/dev/null 2>&1 || true

$COMPOSE up -d --build --wait postgres ch-a ch-b chouse-ui
$COMPOSE run --rm --build seed
$COMPOSE --profile check run --rm --build check
