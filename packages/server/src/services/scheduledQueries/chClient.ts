/**
 * Build a pooled ClickHouse client for a stored connection. Shared by the
 * runner, scheduler (KILL QUERY), and the builder preview endpoint so they all
 * use the connection's own credentials — the data-access boundary (D8).
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { ClientManager } from "../clientManager";
import { getConnectionWithPassword } from "../../rbac/services/connections";
import type { ConnectionConfig } from "../../types";

export async function clientForConnection(connectionId: string, logComment?: string): Promise<ClickHouseClient> {
  const conn = await getConnectionWithPassword(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);
  const protocol = conn.sslEnabled ? "https" : "http";
  const config: ConnectionConfig = {
    url: `${protocol}://${conn.host}:${conn.port}`,
    username: conn.username,
    password: conn.password || "",
    database: conn.database || undefined,
  };
  return ClientManager.getInstance().getClient(config, logComment);
}
