/**
 * ADR 0033 §5, §6 — DDL for connection kinds and the role ceiling.
 *
 * `rbac_clickhouse_connections` gains the kind of each connection, the
 * ClickHouse role CHouse's own work names, a contact shown with refusals, and
 * the latest verdict of the identity checks, stored so every replica reads the
 * same one. `rbac_connection_role_map` says which ClickHouse role a CHouse
 * role's requests name on a connection.
 *
 * Columns are added one by one by the migration, each guarded, so stepwise and
 * skip-version upgrades land in the same state. Timestamps are unix
 * milliseconds.
 */

import type { Dialect } from "./observeSchema";

export interface AddedColumn {
  name: string;
  /** Column type and constraints, per dialect where they differ. */
  type: (dialect: Dialect) => string;
}

export const CONNECTION_IDENTITY_COLUMNS: readonly AddedColumn[] = [
  { name: "identity_mode", type: () => "TEXT NOT NULL DEFAULT 'shared'" },
  { name: "system_role", type: () => "TEXT" },
  { name: "access_contact", type: () => "TEXT" },
  { name: "identity_health", type: () => "TEXT" },
  { name: "identity_health_reason", type: () => "TEXT" },
  { name: "identity_checked_at", type: (dialect) => (dialect === "sqlite" ? "INTEGER" : "BIGINT") },
  { name: "identity_server_version", type: () => "TEXT" },
];

export const CONNECTION_IDENTITY_TABLE_NAMES = ["rbac_connection_role_map"] as const;
export const CONNECTION_IDENTITY_INDEX_NAMES = ["rbac_connection_role_map_pair_idx"] as const;

export function connectionIdentityTableStatements(dialect: Dialect): string[] {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  return [
    `CREATE TABLE IF NOT EXISTS rbac_connection_role_map (
      id               TEXT PRIMARY KEY NOT NULL,
      connection_id    TEXT NOT NULL REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
      role_id          TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      clickhouse_role  TEXT NOT NULL,
      created_by       TEXT,
      created_at       ${bigint} NOT NULL,
      updated_at       ${bigint} NOT NULL
    )`,
  ];
}

export function connectionIdentityIndexStatements(): string[] {
  return [
    "CREATE UNIQUE INDEX IF NOT EXISTS rbac_connection_role_map_pair_idx ON rbac_connection_role_map (connection_id, role_id)",
  ];
}
