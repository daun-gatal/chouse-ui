#!/usr/bin/env bash
#
# Serve a production build of CHouse UI for the Playwright UI suite
# (ADR 0016, gate 9). Every start uses a brand-new SQLite RBAC database so the
# seeded admin, roles and onboarding state are identical on every run.
#

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${E2E_UI_PORT:-5599}"
STATE_DIR="$(mktemp -d -t chouse-e2e-ui-XXXXXX)"
trap 'rm -rf "$STATE_DIR"' EXIT

if [[ "${E2E_SKIP_BUILD:-}" != "1" ]]; then
  bun run build:web >/dev/null
fi

export PORT
export NODE_ENV=development
export STATIC_PATH=./dist
export LOG_LEVEL="${LOG_LEVEL:-warn}"
export RBAC_DB_TYPE=sqlite
export RBAC_SQLITE_PATH="$STATE_DIR/rbac.db"
# Throwaway secrets for a throwaway RBAC database, generated per server start.
export RBAC_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export RBAC_ENCRYPTION_SALT="$(openssl rand -hex 32)"
export JWT_SECRET="$(openssl rand -hex 32)"
export RBAC_ADMIN_EMAIL=admin@localhost
export RBAC_ADMIN_USERNAME=admin
: "${E2E_ADMIN_PASSWORD:?run through scripts/e2e-ui.sh, which generates it}"
export RBAC_ADMIN_PASSWORD="$E2E_ADMIN_PASSWORD"
export ALERT_CONFIG_FILE="$STATE_DIR/alert-config.json"
export DOCTOR_SCHEDULE_FILE="$STATE_DIR/doctor-schedule.json"

exec bun run packages/server/src/index.ts
