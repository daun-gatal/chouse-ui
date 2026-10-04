#!/bin/bash
#
# Capture the screenshots the docs site shows, from THIS working tree.
#
#   ./scripts/docs-screenshots.sh
#
# Builds the server image from the working tree (docker-compose.local.yml),
# starts it with a ClickHouse, seeds a small demo workload, waits for the
# collector, and captures every screen in dark mode with Playwright from
# INSIDE the compose network — on DinD the published ports live on the Docker
# host, not here (see scripts/e2e-cli.sh). The JPEGs land in
# docs/portfolio/public/docs/img/app/, where pages reference them with
# `screenshot:` frontmatter.
#
# Env: DOCKER_HOST (e.g. tcp://dind:2375), SHOTS_WAIT_SECONDS (collector wait,
# default 150). Sequential runs only: it refuses to start next to another
# chouse-ui-local stack.
#
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="chouse-docs-shots"
COMPOSE="docker compose -f docker-compose.local.yml -f scripts/e2e-pat.override.yml -p $PROJECT"
NETWORK="${PROJECT}_default"
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v1.49.1-jammy"
OUT_DIR="docs/portfolio/public/docs/img/app"

# Demo-only secrets (never production values).
export JWT_SECRET="${JWT_SECRET:-docs-shots-jwt-secret-min-32-chars-0123456789ab}"
export RBAC_ENCRYPTION_KEY="${RBAC_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
export RBAC_ENCRYPTION_SALT="${RBAC_ENCRYPTION_SALT:-fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210}"
export LOG_LEVEL="${LOG_LEVEL:-warn}"

TMP_TAR="$(mktemp)"
cleanup() {
  $COMPOSE down -v >/dev/null 2>&1 || true
  rm -f "${TMP_TAR:?}"
}
trap cleanup EXIT

docker info >/dev/null 2>&1 || { echo "Docker daemon unreachable (DOCKER_HOST=${DOCKER_HOST:-unset})" >&2; exit 1; }
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -Eq '^(chouse-ui-local|clickhouse-local)$'; then
  echo "A chouse-ui-local stack already exists on this daemon. Stop it first (sequential runs only)." >&2
  exit 1
fi

echo "Building the server image from the working tree and starting the stack..."
$COMPOSE up --build -d

echo "Seeding and capturing (this takes a few minutes)..."
# The script is streamed over stdin, not bind-mounted (DinD resolves volume
# sources on the Docker host); the screenshots come back as a tar on stdout.
docker run --rm -i --network "$NETWORK" -e SHOTS_WAIT_SECONDS="${SHOTS_WAIT_SECONDS:-150}" "$PLAYWRIGHT_IMAGE" \
  bash -c 'cat > /tmp/shots.mjs && cd /tmp && npm init -y >/dev/null 2>&1 && npm i --silent playwright-core@1.49.1 >&2 && { node shots.mjs >&2; status=$?; tar -C /out -cf - .; exit $status; }' \
  < scripts/docs-screenshots.mjs > "$TMP_TAR" || {
    status=$?
    mkdir -p "$OUT_DIR"
    tar -C "$OUT_DIR" -xf "$TMP_TAR" --wildcards '*_debug.*' 2>/dev/null || true
    echo "Capture failed (exit $status); see $OUT_DIR/_debug.*" >&2
    exit "$status"
  }

mkdir -p "$OUT_DIR"
find "${OUT_DIR:?}" -maxdepth 1 -name '*.jpg' -delete
tar -C "$OUT_DIR" -xf "$TMP_TAR"
echo "Captured $(find "$OUT_DIR" -maxdepth 1 -name '*.jpg' | wc -l) screenshots into $OUT_DIR"
