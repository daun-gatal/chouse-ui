#!/bin/bash
#
# DinD Docker-Compose E2E for ADR 0013 (CHouse MCP server).
#
#   ./scripts/e2e-mcp.sh
#
# Builds the image from THIS working tree (docker-compose.local.yml, never the
# published :latest), starts chouse-ui + ClickHouse in the shared DinD daemon
# with MCP_ENABLED=true, then runs scripts/e2e-mcp-check.py from INSIDE the
# compose network — published ports land on the DinD host, not on this pod,
# so localhost checks would falsely fail (see ADR 0012 §4 notes).
#
# Target environment: DOCKER_HOST=tcp://opencode-dind:2375
#
# Preconditions: docker client pointed at DinD, ports 5521/8752/8124 free on
# the DinD host, no other chouse stack running (sequential runs only).
#
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="chouse-mcp-e2e"
# The override drops the ./.config.yaml bind mount (unresolvable under DinD)
# and enables the MCP endpoint for the run.
COMPOSE="docker compose -f docker-compose.local.yml -f scripts/e2e-mcp.override.yml -p $PROJECT"
NETWORK="${PROJECT}_default"
SIDECAR_IMAGE="python:3.12-slim"

# Test-only secrets (never production values). The production image refuses to
# boot without all three (see validateEnvironmentVariables in server index).
export JWT_SECRET="${JWT_SECRET:-e2e-test-jwt-secret-min-32-chars-0123456789abcdef}"
export RBAC_ENCRYPTION_KEY="${RBAC_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
export RBAC_ENCRYPTION_SALT="${RBAC_ENCRYPTION_SALT:-fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210}"
export LOG_LEVEL="${LOG_LEVEL:-warn}"

cleanup() {
  $COMPOSE down -v >/dev/null 2>&1 || true;
}
trap cleanup EXIT

echo "Checking DinD daemon..."
docker info >/dev/null 2>&1 || { echo "Docker daemon unreachable (DOCKER_HOST=$DOCKER_HOST)" >&2; exit 1; }

echo "Checking for collisions on the shared daemon..."
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -Eq '^(chouse-ui-local|clickhouse-local)$'; then
  echo "A chouse-ui-local stack already exists on this daemon. Stop it first (sequential runs only)." >&2
  exit 1
fi

echo "Building image from working tree and starting stack (MCP enabled)..."
$COMPOSE up --build -d

echo "Running MCP checks from inside the compose network..."
# NOTE: the script is streamed over stdin, NOT bind-mounted — DinD resolves
# volume sources on the DinD host, where this working tree does not exist.
set +e
docker run --rm -i --network "$NETWORK" "$SIDECAR_IMAGE" python3 - < scripts/e2e-mcp-check.py
CHECK_STATUS=$?
set -e
if [ "$CHECK_STATUS" -ne 0 ]; then
  echo "--- chouse-ui-local logs (tail) ---"
  docker logs chouse-ui-local 2>&1 | tail -40 || true
  exit "$CHECK_STATUS"
fi
