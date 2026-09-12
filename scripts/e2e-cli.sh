#!/bin/bash
#
# DinD Docker-Compose E2E for ADR 0012 (chouse CLI).
#
#   ./scripts/e2e-cli.sh
#
# Builds the server image from THIS working tree (docker-compose.local.yml,
# never the published :latest — :latest may predate PAT support), builds the
# CLI from ./cli with the local Go toolchain, then runs
# scripts/e2e-cli-check.py from INSIDE the compose network — published ports
# land on the DinD host, not on this pod, so localhost checks would falsely
# fail (see scripts/e2e-pat.sh and ADR 0012 §4).
#
# Target environment: DOCKER_HOST=tcp://opencode-dind:2375
#
# Preconditions: docker client pointed at DinD, Go 1.23+ locally, no other
# chouse-ui-local stack running (sequential runs only). The login route is
# rate-limited (10/15m/IP), so do not loop this script tightly.
#
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="chouse-cli-e2e"
# Same override as the PAT e2e: drops the ./.config.yaml bind mount
# (unresolvable under DinD) so the server boots from env + defaults.
COMPOSE="docker compose -f docker-compose.local.yml -f scripts/e2e-pat.override.yml -p $PROJECT"
NETWORK="${PROJECT}_default"
RUNNER_IMAGE="chouse-cli-e2e-runner"
TMPDIR="$(mktemp -d)"

# Test-only secrets (never production values).
export JWT_SECRET="${JWT_SECRET:-e2e-test-jwt-secret-min-32-chars-0123456789abcdef}"
export RBAC_ENCRYPTION_KEY="${RBAC_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
export RBAC_ENCRYPTION_SALT="${RBAC_ENCRYPTION_SALT:-fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210}"
export LOG_LEVEL="${LOG_LEVEL:-warn}"

cleanup() {
  $COMPOSE down -v >/dev/null 2>&1 || true
  docker rmi "$RUNNER_IMAGE" >/dev/null 2>&1 || true
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

echo "Checking DinD daemon and Go toolchain..."
docker info >/dev/null 2>&1 || { echo "Docker daemon unreachable (DOCKER_HOST=$DOCKER_HOST)" >&2; exit 1; }
go version >/dev/null 2>&1 || { echo "Go toolchain required (see cli/)" >&2; exit 1; }

echo "Checking for collisions on the shared daemon..."
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -Eq '^(chouse-ui-local|clickhouse-local)$'; then
  echo "A chouse-ui-local stack already exists on this daemon. Stop it first (sequential runs only)." >&2
  exit 1
fi

echo "Building server image from working tree and starting stack..."
$COMPOSE up --build -d

echo "Building CLI binary and runner image..."
cd cli
gofmt -l . | grep . && { echo "gofmt findings above" >&2; exit 1; }
go vet ./...
go test -count=1 ./...
go build -o "$TMPDIR/chouse" ./cmd/chouse
cd ..
cp scripts/e2e-cli-runner.Dockerfile "$TMPDIR/Dockerfile"
docker build -t "$RUNNER_IMAGE" "$TMPDIR"

echo "Running CLI checks from inside the compose network..."
# NOTE: the checker is streamed over stdin, NOT bind-mounted — DinD resolves
# volume sources on the DinD host, where this working tree does not exist.
set +e
docker run --rm -i --network "$NETWORK" "$RUNNER_IMAGE" python3 - < scripts/e2e-cli-check.py
CHECK_STATUS=$?
set -e
if [ "$CHECK_STATUS" -ne 0 ]; then
  echo "--- chouse-ui-local logs (tail) ---"
  docker logs chouse-ui-local 2>&1 | tail -40 || true
  exit "$CHECK_STATUS"
fi
echo "E2E PASSED"
