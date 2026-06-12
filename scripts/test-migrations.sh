#!/bin/bash
#
# Run the RBAC migration tests against BOTH SQLite and PostgreSQL.
#
# PostgreSQL is exercised in a throwaway Docker container that is created and
# destroyed automatically by the test harness. Docker is REQUIRED — see CLAUDE.md.
#
set -e

cd "$(dirname "$0")/../packages/server"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

if ! docker info >/dev/null 2>&1; then
  echo -e "${RED}Docker is not available.${NC} The migration tests require Docker to run the PostgreSQL leg."
  echo "Start Docker and re-run this script."
  exit 1
fi

echo "🧪 Running migration tests (SQLite + PostgreSQL via Docker)…"
echo ""

if bun test src/rbac/db/migrations.test.ts; then
  echo ""
  echo -e "${GREEN}✓ Migration tests passed (both dialects).${NC}"
else
  echo ""
  echo -e "${RED}✗ Migration tests failed.${NC}"
  exit 1
fi
