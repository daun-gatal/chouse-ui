#!/usr/bin/env bash
#
# demo-parts-pressure.sh — generate a realistic "too many parts" scenario for the
# Metrics → Parts Pressure tab (and the 1B predictive alert) against a local
# ClickHouse dev container.
#
# Each INSERT becomes its own part; background merges are stopped on the demo
# table so parts accumulate faster than they're cleared (divergence). A steady
# insert loop keeps the insert-rate window populated so the panel stays "live".
#
# Usage:
#   scripts/demo-parts-pressure.sh up        # create table + stop merges
#   scripts/demo-parts-pressure.sh load [N]  # stream N parts/iteration forever (Ctrl-C to stop)
#   scripts/demo-parts-pressure.sh burst [N]  # one-shot: create N parts now (default 240)
#   scripts/demo-parts-pressure.sh status    # show current parts pressure for the demo table
#   scripts/demo-parts-pressure.sh down       # drop the demo table (resumes merges implicitly)
#
# Env: CH_CONTAINER (default: clickhouse-server)

set -euo pipefail

CONTAINER="${CH_CONTAINER:-clickhouse-server}"
DB="demo"
TABLE="parts_pressure_demo"
FQT="${DB}.${TABLE}"

ch() { docker exec -i "$CONTAINER" clickhouse-client "$@"; }

up() {
  ch --multiquery -q "
    CREATE DATABASE IF NOT EXISTS ${DB};
    DROP TABLE IF EXISTS ${FQT};
    CREATE TABLE ${FQT}
    (
        id UInt64,
        ts DateTime DEFAULT now(),
        payload String
    )
    ENGINE = MergeTree
    PARTITION BY toYYYYMMDD(ts)
    ORDER BY id
    SETTINGS parts_to_throw_insert = 300, parts_to_delay_insert = 250;
    SYSTEM STOP MERGES ${FQT};
  "
  echo "Created ${FQT} with merges stopped (parts will accumulate)."
}

burst() {
  local n="${1:-240}"
  echo "Creating ${n} parts (one INSERT each)..."
  for i in $(seq 1 "$n"); do
    echo "INSERT INTO ${FQT} (id, payload) VALUES (${i}, 'p${i}');"
  done | ch --multiquery
  status
}

load() {
  local per="${1:-20}"
  echo "Streaming ~${per} parts every 30s into ${FQT}. Ctrl-C to stop."
  local id=0
  while true; do
    for _ in $(seq 1 "$per"); do
      id=$((id + 1))
      echo "INSERT INTO ${FQT} (id, payload) VALUES (${id}, 'p${id}');"
    done | ch --multiquery
    echo "  +${per} parts (total inserted: ${id})"
    sleep 30
  done
}

status() {
  ch -q "
    SELECT
      sum(part_count)            AS active_parts,
      max(part_count)            AS max_parts_in_partition,
      (SELECT countIf(event_type='NewPart')/10.0 FROM system.part_log
        WHERE database='${DB}' AND table='${TABLE}' AND event_time >= now() - INTERVAL 10 MINUTE) AS insert_parts_per_min,
      (SELECT countIf(event_type='MergeParts')/10.0 FROM system.part_log
        WHERE database='${DB}' AND table='${TABLE}' AND event_time >= now() - INTERVAL 10 MINUTE) AS merge_parts_per_min
    FROM (SELECT partition_id, count() AS part_count FROM system.parts
          WHERE active AND database='${DB}' AND table='${TABLE}' GROUP BY partition_id)
    FORMAT Vertical"
}

down() {
  ch -q "DROP TABLE IF EXISTS ${FQT}"
  echo "Dropped ${FQT}."
}

cmd="${1:-}"
shift || true
case "$cmd" in
  up) up ;;
  burst) burst "$@" ;;
  load) load "$@" ;;
  status) status ;;
  down) down ;;
  *) echo "Usage: $0 {up|load [N]|burst [N]|status|down}"; exit 1 ;;
esac
