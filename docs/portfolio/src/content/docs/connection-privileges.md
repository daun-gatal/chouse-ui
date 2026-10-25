---
generated: PRIVILEGE_FEATURES in packages/server/src/services/connectionPrivileges.ts
---
# ClickHouse privileges

What a [connection](/docs/connections/)'s ClickHouse user must be able to do for every CHouse UI feature to work. **Test connection** checks the user against every feature below, and a connection is only saved once every check passes: **Create** and **Update** run the same check on the server first. Whatever is missing comes back as `GRANT` statements you can copy and run as a ClickHouse admin.

## What each feature needs

| Feature | Covers | Read (`SELECT`) | Privileges |
| --- | --- | --- | --- |
| **Core** | Connect, explorer, SQL editor | `system.databases`, `system.tables`, `system.columns`, `system.functions`, `system.keywords` | — |
| **Monitoring and fleet** | Metrics, live queries, dashboards | `system.query_log`, `system.processes`, `system.metrics`, `system.events`, `system.asynchronous_metrics`, `system.metric_log`, `system.asynchronous_metric_log`, `system.parts`, `system.parts_columns`, `system.part_log`, `system.merges`, `system.mutations`, `system.replicas`, `system.replication_queue`, `system.disks`, `system.errors`, `system.clusters`, `system.macros`, `system.distributed_ddl_queue`, `system.distribution_queue`, `system.crash_log` | — |
| **Data health and observability** | Collectors, pipelines, Doctor, upgrades | `system.tables`, `system.columns`, `system.databases`, `system.dictionaries`, `system.parts`, `system.part_log`, `system.query_log`, `system.query_views_log`, `system.processes`, `system.merges`, `system.mutations`, `system.replicas`, `system.disks`, `system.errors`, `system.settings_profile_elements`, `system.kafka_consumers`, `system.s3queue`, `system.s3queue_log`, `system.azure_queue`, `system.azure_queue_log`, `system.view_refreshes`, `system.distribution_queue`, `system.asynchronous_insert_log`, `system.asynchronous_inserts`, `system.asynchronous_metrics`, `system.data_skipping_indices`, `system.server_settings`, `system.merge_tree_settings` | — |
| **Query control** | Kill running queries | — | `KILL QUERY` on `*.*` |
| **Data editing** | Create, import, alter and drop tables | — | `CREATE TABLE`, `INSERT`, `ALTER TABLE`, `DROP TABLE` on the default database |
| **ClickHouse access admin** | ClickHouse users and roles pages | `system.users`, `system.roles`, `system.grants`, `system.role_grants` | `CREATE USER`, `ALTER USER`, `DROP USER`, `CREATE ROLE`, `ALTER ROLE`, `DROP ROLE`, `ROLE ADMIN` on `*.*` |

Data editing is checked on the connection's **default database** (`default` when none is set). Grant the same on any other database people should be able to change.

## How the check works

- **System tables** are read with `LIMIT 0`, so a grant that comes through a role, or a revoke on one table, counts exactly as ClickHouse applies it. A table the server doesn't have, such as `system.crash_log` on a server that never crashed, or `system.distributed_ddl_queue` without Keeper, is shown as *not available* and doesn't count — except `system.query_log`, which every server creates on its first flush, so its grant is checked even before the table exists.
- **Other privileges** are checked against the user's own `SHOW GRANTS`, with roles expanded (`SHOW GRANTS FINAL` where the server supports it, each enabled role on older servers) and ClickHouse's privilege tree from `system.privileges`, so `ALL`, `ACCESS MANAGEMENT` or `ALTER` cover the privileges under them.
- The check needs no privilege of its own and changes nothing on the server.

Existing connections are never blocked: the check runs when you create one, change its host, port, user, password, SSL or default database, or press **Test**. **Test** on a row of the connection list warns when that connection's user is missing something.

## A user with everything

Change the password and database names, then run as a ClickHouse admin. The admin needs these privileges itself (`WITH GRANT OPTION` for the access-management ones); `GRANT CURRENT GRANTS` is a shortcut when it has more.

```sql
CREATE USER chouse_ui IDENTIFIED BY 'change-me';
-- What people query: repeat for each database
GRANT SELECT ON analytics.* TO chouse_ui;
GRANT SELECT ON system.databases TO chouse_ui;
GRANT SELECT ON system.tables TO chouse_ui;
GRANT SELECT ON system.columns TO chouse_ui;
GRANT SELECT ON system.functions TO chouse_ui;
GRANT SELECT ON system.keywords TO chouse_ui;
GRANT SELECT ON system.query_log TO chouse_ui;
GRANT SELECT ON system.processes TO chouse_ui;
GRANT SELECT ON system.metrics TO chouse_ui;
GRANT SELECT ON system.events TO chouse_ui;
GRANT SELECT ON system.asynchronous_metrics TO chouse_ui;
GRANT SELECT ON system.metric_log TO chouse_ui;
GRANT SELECT ON system.asynchronous_metric_log TO chouse_ui;
GRANT SELECT ON system.parts TO chouse_ui;
GRANT SELECT ON system.parts_columns TO chouse_ui;
GRANT SELECT ON system.part_log TO chouse_ui;
GRANT SELECT ON system.merges TO chouse_ui;
GRANT SELECT ON system.mutations TO chouse_ui;
GRANT SELECT ON system.replicas TO chouse_ui;
GRANT SELECT ON system.replication_queue TO chouse_ui;
GRANT SELECT ON system.disks TO chouse_ui;
GRANT SELECT ON system.errors TO chouse_ui;
GRANT SELECT ON system.clusters TO chouse_ui;
GRANT SELECT ON system.macros TO chouse_ui;
GRANT SELECT ON system.distributed_ddl_queue TO chouse_ui;
GRANT SELECT ON system.distribution_queue TO chouse_ui;
GRANT SELECT ON system.crash_log TO chouse_ui;
GRANT SELECT ON system.dictionaries TO chouse_ui;
GRANT SELECT ON system.query_views_log TO chouse_ui;
GRANT SELECT ON system.settings_profile_elements TO chouse_ui;
GRANT SELECT ON system.kafka_consumers TO chouse_ui;
GRANT SELECT ON system.s3queue TO chouse_ui;
GRANT SELECT ON system.s3queue_log TO chouse_ui;
GRANT SELECT ON system.azure_queue TO chouse_ui;
GRANT SELECT ON system.azure_queue_log TO chouse_ui;
GRANT SELECT ON system.view_refreshes TO chouse_ui;
GRANT SELECT ON system.asynchronous_insert_log TO chouse_ui;
GRANT SELECT ON system.asynchronous_inserts TO chouse_ui;
GRANT SELECT ON system.data_skipping_indices TO chouse_ui;
GRANT SELECT ON system.server_settings TO chouse_ui;
GRANT SELECT ON system.merge_tree_settings TO chouse_ui;
GRANT SELECT ON system.users TO chouse_ui;
GRANT SELECT ON system.roles TO chouse_ui;
GRANT SELECT ON system.grants TO chouse_ui;
GRANT SELECT ON system.role_grants TO chouse_ui;
GRANT KILL QUERY, CREATE USER, ALTER USER, DROP USER, CREATE ROLE, ALTER ROLE, DROP ROLE, ROLE ADMIN ON *.* TO chouse_ui;
-- The connection's default database
GRANT CREATE TABLE, INSERT, ALTER TABLE, DROP TABLE ON analytics.* TO chouse_ui;
```

To let [ClickHouse users & roles](/docs/clickhouse-users-roles/) hand out privileges to others, the connection user also needs those privileges `WITH GRANT OPTION`.
