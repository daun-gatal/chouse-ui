# Migrations & upgrades

CHouse UI migrates its own database automatically when it starts. Upgrading is: back up, replace the image, watch the logs.

## What happens when the server starts

| Situation | What happens |
| --- | --- |
| **Fresh install** | Creates the schema, the built-in roles and permissions, and the first-run admin (`RBAC_ADMIN_*`) |
| **Upgrade** | Applies only the migrations the database hasn't had, in order — including the default grants of new permissions to the built-in roles |
| **Restart** | Nothing to do |

Migrations work on SQLite and PostgreSQL, forward only. With several replicas on PostgreSQL, one pod migrates while the others wait on a lock, so starting them together is safe. Skipping releases is fine: an old install jumps straight to the latest schema.

```bash
docker logs chouse-ui 2>&1 | grep RBAC      # Docker
kubectl logs deploy/chouse-ui | grep RBAC   # Kubernetes
```

## Upgrade checklist

1. **Read [What's new](/docs/whats-new/)** and the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md) for every release you are crossing — especially *Removed* and *Changed*.
2. **Back up** the RBAC database: a PostgreSQL dump, or the `/app/data` directory for SQLite. Keep `RBAC_ENCRYPTION_KEY` and `RBAC_ENCRYPTION_SALT` with it — a backup is useless without them.
3. **Replace the image** and start it:

   :::tabs
   @tab Docker
   ```bash
   docker pull ghcr.io/daun-gatal/chouse-ui:latest
   docker compose up -d
   ```
   @tab Helm
   ```bash
   helm upgrade chouse-ui oci://ghcr.io/daun-gatal/charts/chouse-ui --reuse-values
   ```
   :::

4. **Watch the `RBAC` log lines** until migrations finish.
5. **Smoke-test**: sign in, run a query, open Monitoring and Data.

If a migration fails, restore the backup, start the previous image, and [open an issue](https://github.com/daun-gatal/chouse-ui/issues) with the log.

## Maintenance commands

For scripted installs or recovery, the server package has an RBAC CLI (run in `packages/server`, or `docker exec` into the container with the same environment as the server):

```bash
bun run rbac:status    # migration state
bun run rbac:version   # schema version
bun run rbac:migrate   # apply pending migrations now
bun run rbac:seed      # create missing built-in roles and the first-run admin
CONFIRM_RESET=yes bun run rbac:reset   # wipe the RBAC database — destroys all users, connections and settings
```

> **Warning:** `rbac:reset` deletes everything CHouse UI stores. It refuses to run unless `CONFIRM_RESET=yes` is set.

## Releases

- The server image, the Helm chart and the CLI are versioned separately: image `v3.x`, chart `2.x` (with `appVersion` matching the image), CLI `cli-v1.x`.
- Every release lists its changes in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md). Breaking changes are called out under *Removed* and *Changed*, with what to do.
- The CLI checks the server version: `chouse status` tells you whether your CLI supports the server.
