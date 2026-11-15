# ClickHouse with the connection-identity fixture baked in (bind mounts do not
# reach a remote Docker daemon; build contexts do). The entrypoint runs
# everything in /docker-entrypoint-initdb.d once, as the default user.
ARG CH_VERSION=26.5.7.64
FROM clickhouse/clickhouse-server:${CH_VERSION}
COPY fixture.sql /docker-entrypoint-initdb.d/00-fixture.sql
