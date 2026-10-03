#!/bin/bash
#
# Docker-backed e2e for cluster-aware scheduled-query materialize (ADR 0015).
#
#   ./scripts/e2e-scheduled-cluster.sh
#
# Fully isolated, so it is safe on a Docker host that already runs other
# containers (including the chouse-fleet testbed):
# - its own network (sqe2e-net) and containers (sqe2e-*); no published ports
# - 3 ClickHouse nodes + 1 Keeper, configured from testbed/scheduled-cluster-e2e/
#   with per-node {shard}/{replica} macros and two logical clusters:
#   fleet_cluster (3 shards x 1 replica) and fleet_replicated (1 shard x 3 replicas)
# - the e2e test is bundled locally (`bun build`) and runs in a Bun container on
#   the same network, so no host port and no `bun install` in the container
#
# Only sqe2e-* containers and sqe2e-net are created or removed (trap on EXIT).
# Works with a remote daemon via DOCKER_HOST.
#
set -euo pipefail

cd "$(dirname "$0")/.."

CH_VERSION="${CH_VERSION:-26.5-alpine}"
BUN_VERSION="$(bun --version)"
IMG_CH="clickhouse/clickhouse-server:$CH_VERSION"
IMG_KEEPER="clickhouse/clickhouse-keeper:$CH_VERSION"
IMG_BUN="oven/bun:$BUN_VERSION-alpine"
NET=sqe2e-net
# Throwaway password of the isolated nodes (testbed/scheduled-cluster-e2e/users.xml).
CH_PASSWORD=default
CONF=testbed/scheduled-cluster-e2e
NODES=(sqe2e-ch1 sqe2e-ch2 sqe2e-ch3)
WORK=""

cleanup() {
  docker rm -f -v sqe2e-runner "${NODES[@]}" sqe2e-keeper >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  [ -n "$WORK" ] && rm -rf "$WORK"
  return 0
}
trap cleanup EXIT
cleanup
WORK="$(mktemp -d)"

echo "Bundling the e2e test..."
bun build packages/server/src/services/scheduledQueries/cluster.e2e.test.ts \
  --target bun --outfile "$WORK/bundle/cluster.e2e.test.js" >/dev/null

docker network create "$NET" >/dev/null

docker create --name sqe2e-keeper --hostname sqe2e-keeper --network "$NET" "$IMG_KEEPER" >/dev/null
docker cp "$CONF/keeper.xml" sqe2e-keeper:/etc/clickhouse-keeper/keeper_config.xml
docker start sqe2e-keeper >/dev/null

for i in "${!NODES[@]}"; do
  node="${NODES[$i]}"
  printf '<clickhouse><macros><shard>0%d</shard><replica>%s</replica></macros></clickhouse>\n' "$((i + 1))" "$node" >"$WORK/macros.xml"
  docker create --name "$node" --hostname "$node" --network "$NET" \
    -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 --memory 2g --cpus 2 \
    --ulimit nofile=262144:262144 "$IMG_CH" >/dev/null
  docker cp "$CONF/node-base.xml" "$node":/etc/clickhouse-server/config.d/zz-base.xml
  docker cp "$CONF/clusters.xml" "$node":/etc/clickhouse-server/config.d/zzz-clusters.xml
  docker cp "$WORK/macros.xml" "$node":/etc/clickhouse-server/config.d/zzz-macros.xml
  docker cp "$CONF/users.xml" "$node":/etc/clickhouse-server/users.d/zz-users.xml
  docker start "$node" >/dev/null
done

for node in "${NODES[@]}"; do
  echo "Waiting for $node (with Keeper)..."
  READY=0
  for _ in $(seq 1 60); do
    if [ "$(docker exec "$node" clickhouse-client --password "$CH_PASSWORD" -q 'SELECT count() FROM system.zookeeper_connection' 2>/dev/null)" = "1" ]; then
      READY=1
      break
    fi
    sleep 2
  done
  if [ "$READY" -ne 1 ]; then
    echo "$node did not become ready" >&2
    docker logs --tail 40 "$node" >&2
    exit 1
  fi
done

URLS="$(printf 'http://%s:8123,' "${NODES[@]}")"
docker create --name sqe2e-runner --network "$NET" -w /e2e \
  -e NODE_ENV=production \
  -e CH_E2E_URLS="${URLS%,}" -e CH_E2E_USER=default -e CH_E2E_PASSWORD="$CH_PASSWORD" \
  "$IMG_BUN" bun test ./cluster.e2e.test.js >/dev/null
docker cp "$WORK/bundle/." sqe2e-runner:/e2e
docker start -a sqe2e-runner
