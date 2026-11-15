#!/usr/bin/env bash
#
# Connection-identity lab: build, start and seed, or tear down.
#
#   ./up.sh                                   start on http://localhost:3000
#   LAB_ORIGIN=http://my-host:3000 ./up.sh    when the browser reaches it under another address
#   ./up.sh down                              stop and delete everything, volumes included
#
# Needs only Docker. Works with a remote daemon via DOCKER_HOST.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "down" ]; then
  docker compose down -v --remove-orphans
  exit 0
fi

docker compose up -d --build --wait postgres ch-a ch-b chouse-ui docs
docker compose run --rm --build seed
echo
echo "CHouse UI:  ${LAB_ORIGIN:-http://localhost:${LAB_UI_PORT:-3000}}"
echo "Docs site:  http://localhost:${LAB_DOCS_PORT:-5173} (same host as CHouse UI when remote)"
echo "Sign in as admin / ${LAB_ADMIN_PASSWORD:-Lab-admin-123!}, or ann.lee, ben.ortiz, chris.wu, dana.kim, eve.park, omar.admin / ${LAB_USER_PASSWORD:-Lab-pass-123!}"
echo "See README.md for what to try."
