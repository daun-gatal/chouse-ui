/**
 * `changes` collector (ADR 0016 §9): the change timeline that regressions and
 * RCA link against — DDL, server version upgrades, settings-profile changes
 * and new writer client versions.
 */

import { createHash } from "crypto";

import { sql, type SQL } from "drizzle-orm";

import { hasTable } from "../capabilities";
import { NOT_OBSERVE, selectRows } from "../clickhouse";
import type { CollectorContext, ConnectionCollector } from "../collector";
import { one, runBatch, str } from "../db";

const DAY = 24 * 3600 * 1000;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function event(connectionId: string, id: string, kind: string, occurredAt: number, node: string | null, objectRef: string | null, summary: string, details: Record<string, unknown>): SQL {
  return sql`
    INSERT INTO obs_change_events (id, connection_id, kind, occurred_at, node, object_ref, summary, details)
    VALUES (${id}, ${connectionId}, ${kind}, ${occurredAt}, ${node}, ${objectRef}, ${summary.slice(0, 500)}, ${JSON.stringify(details)})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function setting(key: string): Promise<string | null> {
  const row = await one(sql`SELECT value FROM obs_settings WHERE setting_key = ${key}`);
  return row ? str(row.value) : null;
}

function putSetting(key: string, value: string): SQL {
  const now = Date.now();
  return sql`INSERT INTO obs_settings (setting_key, value, updated_at) VALUES (${key}, ${value}, ${now}) ON CONFLICT (setting_key) DO UPDATE SET value = ${value}, updated_at = ${now}`;
}

export const changesCollector: ConnectionCollector = {
  name: "changes",
  scope: "connection",
  intervalMs: 5 * 60 * 1000,
  requires: ["query_log"],
  async run(ctx: CollectorContext): Promise<void> {
    const connectionId = ctx.connection.id;
    const now = ctx.nowMs;
    const since = Math.max(await ctx.getWatermark(), now - 16 * DAY);
    const statements: SQL[] = [];

    const ddl = await selectRows<{ query_id: string; at_ms: number; node: string; kind: string; obj: string; query: string; usr: string }>(ctx.client, `
      SELECT query_id, toUnixTimestamp64Milli(event_time_microseconds) AS at_ms, hostname AS node, toString(query_kind) AS kind,
        if(length(tables) > 0, tables[1], if(length(databases) > 0, databases[1], '')) AS obj,
        substring(query, 1, 500) AS query, user AS usr
      FROM system.query_log
      WHERE type = 'QueryFinish' AND query_kind IN ('Create', 'Alter', 'Drop', 'Rename') AND event_time > fromUnixTimestamp64Milli({since:Int64}) AND ${NOT_OBSERVE}
      ORDER BY at_ms LIMIT 5000`, { params: { since } });
    for (const d of ddl) {
      statements.push(event(connectionId, `ddl:${d.query_id}`, "ddl", Number(d.at_ms), null, d.obj || null, d.query.replace(/\s+/g, " "), { kind: d.kind, user: d.usr, node: d.node }));
    }

    const [server] = await selectRows<{ v: string; host: string }>(ctx.client, "SELECT version() AS v, hostName() AS host");
    if (server) {
      const key = `version:${connectionId}:${server.host}`;
      const previous = await setting(key);
      if (previous !== null && previous !== server.v) {
        statements.push(event(connectionId, `version:${hash(`${server.host}|${server.v}|${now}`)}`, "version", now, server.host, null, `${previous} → ${server.v}`, { from: previous, to: server.v }));
      }
      if (previous !== server.v) statements.push(putSetting(key, server.v));
    }

    if (hasTable(ctx.capabilities, "settings_profile_elements")) {
      const elements = await selectRows<Record<string, unknown>>(ctx.client, "SELECT * FROM system.settings_profile_elements ORDER BY profile_name, user_name, role_name, index");
      const digest = hash(JSON.stringify(elements));
      const key = `settings_digest:${connectionId}`;
      const previous = await setting(key);
      if (previous !== null && previous !== digest) {
        const targets = [...new Set(elements.map((e) => str(e.profile_name) || str(e.user_name) || str(e.role_name)).filter(Boolean))];
        statements.push(event(connectionId, `settings:${digest}`, "settings", now, null, null, `Settings profiles changed (${targets.slice(0, 5).join(", ")})`, { targets }));
      }
      if (previous !== digest) statements.push(putSetting(key, digest));
    }

    const writers = await selectRows<{ client: string; ver: string; usr: string; first_ms: number }>(ctx.client, `
      SELECT client_name AS client, concat(toString(client_version_major), '.', toString(client_version_minor), '.', toString(client_version_patch)) AS ver,
        user AS usr, toUnixTimestamp64Milli(min(event_time_microseconds)) AS first_ms
      FROM system.query_log
      WHERE type = 'QueryFinish' AND query_kind = 'Insert' AND client_name != '' AND event_time > fromUnixTimestamp64Milli({since:Int64}) AND ${NOT_OBSERVE}
      GROUP BY client, ver, usr`, { params: { since } });
    for (const w of writers) {
      const key = `writer_version:${connectionId}:${w.usr}|${w.client}`;
      const previous = await setting(key);
      if (previous !== null && previous !== w.ver) {
        statements.push(event(connectionId, `writer:${hash(`${key}|${w.ver}`)}`, "writer", Number(w.first_ms), null, null, `${w.client} (${w.usr}) ${previous} → ${w.ver}`, { client: w.client, user: w.usr, from: previous, to: w.ver }));
      }
      if (previous !== w.ver) statements.push(putSetting(key, w.ver));
    }
    statements.push(sql`DELETE FROM obs_change_events WHERE connection_id = ${connectionId} AND occurred_at < ${now - 90 * DAY}`);
    await runBatch(statements);
    const newest = ddl.reduce((m, d) => Math.max(m, Number(d.at_ms)), since);
    await ctx.setWatermark(newest);
  },
};
