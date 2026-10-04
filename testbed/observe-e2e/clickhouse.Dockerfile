# ClickHouse with the e2e config baked in (bind mounts do not reach a remote
# Docker daemon; build contexts do).
ARG CH_VERSION=26.5-alpine
FROM clickhouse/clickhouse-server:${CH_VERSION}
ARG USERS_FILE=users.xml
COPY clickhouse.xml /etc/clickhouse-server/config.d/observe-e2e.xml
COPY ${USERS_FILE} /etc/clickhouse-server/users.d/observe-e2e.xml
