#!/usr/bin/env bash
#
# Data Observability Platform e2e (ADR 0016, gate 8).
#
#   ./scripts/e2e-observe.sh            # build, run both suites, tear down
#   KEEP=1 ./scripts/e2e-observe.sh     # leave the testbed running afterwards
#
# Starts testbed/observe-e2e: ClickHouse (current and 23.8) fed by Redpanda,
# RabbitMQ, NATS, an S3-compatible store, Azurite and PostgreSQL, then runs the
# server's observe e2e suites inside that network. Needs only Docker with the
# compose plugin; works against a remote daemon (DOCKER_HOST) because configs
# are baked into images instead of bind-mounted. Only the compose project
# `chouse-observe-e2e` is created or removed.
set -euo pipefail

cd "$(dirname "$0")/../testbed/observe-e2e"

cleanup() {
  if [ -z "${KEEP:-}" ]; then
    docker compose --profile runner down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker compose up -d --build --wait
docker compose --profile runner build runner
docker compose --profile runner run --rm runner
