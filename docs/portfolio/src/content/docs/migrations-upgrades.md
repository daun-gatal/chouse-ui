# Migrations & upgrades

Database migrations run **automatically on server startup** — no manual intervention required.

## What happens on boot

| Scenario | Behavior |
| --- | --- |
| **Fresh install** | Creates schema, seeds roles/permissions/admin user |
| **Version upgrade** | Applies only pending migrations |
| **Normal restart** | No migrations needed |

Verification after any boot:

```bash
docker logs chouse-ui | grep RBAC
```

## Upgrading (Docker)

```bash
docker pull ghcr.io/daun-gatal/chouse-ui:latest
docker-compose up -d
docker logs chouse-ui | grep RBAC   # confirm migrations applied
```

## Upgrading (Helm)

```bash
helm upgrade chouse-ui oci://ghcr.io/daun-gatal/charts/chouse-ui \
  --reuse-values
kubectl logs deploy/chouse-ui | grep RBAC
```

## CLI maintenance tools

Manual migration control (packages/server scripts):

```bash
bun run rbac:status    # current migration state
bun run rbac:migrate   # apply pending migrations manually
bun run rbac:seed      # re-seed roles/permissions/admin
```

Use the CLI tools when scripted installs need explicit migration control; the automatic path covers normal operation.

## Release cadence

- Releases are cut automatically from `main` ([auto-release](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md)); the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md) lists every migration-affecting change under **Changed/Added**
- The CLI ships independently (`cli-v*` tags) — see [CLI](/docs/cli/)

## Safe-upgrade checklist

1. Read the changelog entry for the target version
2. Back up the RBAC database (and `/app/data` if SQLite)
3. Pull + restart, watch `RBAC` log lines
4. Smoke-test: login, run a query, open a monitoring tab
5. If a migration fails: restore the DB backup, restart the previous image version, and [open an issue](https://github.com/daun-gatal/chouse-ui/issues)

## RBAC storage and HA

- **SQLite**: file under `/app/data` — single instance only
- **PostgreSQL**: migrations apply once; replicas start against the migrated schema — see [Helm chart](/docs/deploy-helm/) topology
