/**
 * The collection schedule as Admin › Connections shows it (issue #380): every
 * collector with its built-in, default and per-connection interval, whether
 * it is paused, and what its runs cost ClickHouse — the last run, and that
 * cost projected over a day at the interval it runs on.
 */

import { listConnections } from "../../rbac/services/connections";
import { all, numOrNull, sql, str, strOrNull } from "./db";
import {
  COLLECTOR_INFO,
  effectiveSchedule,
  getCollectorSettings,
  MAX_INTERVAL_SECONDS,
  type CollectorInfo,
  type Schedule,
  type ScheduleSource,
} from "./collectorSettings";
import { ALL_COLLECTORS } from "./index";

const DAY_SECONDS = 24 * 3600;

export interface RunStatus {
  state: string;
  lastRunAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  durationMs: number | null;
  readRows: number | null;
  readBytes: number | null;
  queryCount: number | null;
}

export interface ScheduleRow extends CollectorInfo {
  maxSeconds: number;
  builtInSeconds: number;
  /** What the defaults set (empty: built-in). */
  defaults: Schedule;
  /** What this connection sets (connection view only). */
  override: Schedule | null;
  effective: { intervalSeconds: number; intervalSource: ScheduleSource; paused: boolean; pausedSource: ScheduleSource };
  /** Last run on this connection (connection view only). */
  status: RunStatus | null;
  /** Bytes read per day at the effective interval, from the last run(s); null until a run recorded its cost. */
  projectedBytesPerDay: number | null;
  /** Defaults view: connections that override this collector, and that have it paused. */
  overriddenOn: number;
  pausedOn: number;
}

export interface ScheduleView {
  collectors: ScheduleRow[];
  updatedBy: string | null;
  updatedAt: number | null;
}

function builtInMs(name: string): number {
  return ALL_COLLECTORS.find((c) => c.name === name)?.intervalMs ?? 15 * 60 * 1000;
}

function projected(readBytes: number | null, intervalSeconds: number, paused: boolean): number | null {
  if (readBytes === null) return null;
  return paused ? 0 : readBytes * (DAY_SECONDS / intervalSeconds);
}

async function statusRows(connectionId: string | null): Promise<Array<RunStatus & { connectionId: string; collector: string }>> {
  const rows = connectionId === null
    ? await all(sql`SELECT * FROM obs_collector_status`)
    : await all(sql`SELECT * FROM obs_collector_status WHERE connection_id = ${connectionId}`);
  return rows.map((r) => ({
    connectionId: str(r.connection_id),
    collector: str(r.collector),
    state: str(r.state),
    lastRunAt: numOrNull(r.last_run_at),
    lastOkAt: numOrNull(r.last_ok_at),
    lastError: strOrNull(r.last_error),
    durationMs: numOrNull(r.duration_ms),
    readRows: numOrNull(r.read_rows),
    readBytes: numOrNull(r.read_bytes),
    queryCount: numOrNull(r.query_count),
  }));
}

/**
 * The schedule for every connection (`connectionId` null: the defaults, with
 * each collector's projected cost summed over the active connections) or for
 * one connection.
 */
export async function scheduleView(connectionId: string | null): Promise<ScheduleView> {
  const settings = await getCollectorSettings(0);
  const { connections } = await listConnections({ activeOnly: true });
  const active = connections.map((c) => c.id);
  const statuses = await statusRows(connectionId);

  const collectors = COLLECTOR_INFO.map((info): ScheduleRow => {
    const builtIn = builtInMs(info.name);
    const scope = info.global ? null : connectionId;
    const effective = effectiveSchedule(settings, info.name, builtIn, scope);
    const intervalSeconds = Math.round(effective.intervalMs / 1000);
    const base = {
      ...info,
      maxSeconds: MAX_INTERVAL_SECONDS,
      builtInSeconds: Math.round(builtIn / 1000),
      defaults: settings.defaults[info.name] ?? {},
      effective: { intervalSeconds, intervalSource: effective.intervalSource, paused: effective.paused, pausedSource: effective.pausedSource },
      overriddenOn: 0,
      pausedOn: 0,
    };

    if (connectionId !== null) {
      // The global fleet collector records its runs under no connection; it has no per-connection status.
      const status = info.global ? null : statuses.find((s) => s.collector === info.name) ?? null;
      return {
        ...base,
        override: info.global ? null : settings.connections[connectionId]?.[info.name] ?? {},
        status,
        projectedBytesPerDay: projected(status?.readBytes ?? null, intervalSeconds, effective.paused),
      };
    }

    let total: number | null = null;
    let overriddenOn = 0;
    let pausedOn = 0;
    if (!info.global) {
      for (const id of active) {
        const own = settings.connections[id]?.[info.name];
        if (own && (own.intervalSeconds != null || own.paused != null)) overriddenOn++;
        const perConnection = effectiveSchedule(settings, info.name, builtIn, id);
        if (perConnection.paused) pausedOn++;
        const status = statuses.find((s) => s.connectionId === id && s.collector === info.name);
        const day = projected(status?.readBytes ?? null, Math.round(perConnection.intervalMs / 1000), perConnection.paused);
        if (day !== null) total = (total ?? 0) + day;
      }
    }
    return { ...base, override: null, status: null, projectedBytesPerDay: total, overriddenOn, pausedOn };
  });

  return { collectors, updatedBy: settings.updatedBy, updatedAt: settings.updatedAt };
}
