# ClickHouse with the lab fixture baked in (a bind mount does not reach a remote
# Docker daemon; a build context does). The entrypoint runs everything in
# /docker-entrypoint-initdb.d once, as the default user.
ARG CH_VERSION=26.3.63.123
FROM clickhouse/clickhouse-server:${CH_VERSION}
COPY fixture.sql /docker-entrypoint-initdb.d/00-fixture.sql
