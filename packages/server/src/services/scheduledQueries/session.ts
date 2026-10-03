/**
 * Thin statement executor over a ClickHouse client. A *pinned* session runs every
 * statement of one materialize run in a single ClickHouse session and sends
 * `session_check = 1` after the first, so a non-sticky load balancer that moves a
 * statement to another node fails the run (SESSION_NOT_FOUND) instead of staging on
 * one replica and swapping on another (ADR 0015 §4).
 */

import type { ClickHouseClient, ClickHouseSettings, CommandResult } from "@clickhouse/client";

export interface CommandOptions {
  queryId?: string;
  params?: Record<string, unknown>;
  settings?: ClickHouseSettings;
}

export interface ChSession {
  /** Run a read and return its JSON rows. */
  rows<T>(query: string, params?: Record<string, unknown>): Promise<T[]>;
  command(query: string, opts?: CommandOptions): Promise<CommandResult>;
}

function build(client: ClickHouseClient, signal: AbortSignal | undefined, sessionId: string | undefined): ChSession {
  let opened = false;
  const settingsFor = (settings?: ClickHouseSettings): ClickHouseSettings | undefined => {
    if (!sessionId) return settings;
    const out: ClickHouseSettings = opened ? { ...settings, session_check: 1 } : { ...settings };
    opened = true;
    return out;
  };
  return {
    async rows<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
      const rs = await client.query({
        query,
        format: "JSON",
        query_params: params,
        abort_signal: signal,
        session_id: sessionId,
        clickhouse_settings: settingsFor(),
      });
      const json = (await rs.json()) as { data?: T[] };
      return json.data ?? [];
    },
    command(query: string, opts: CommandOptions = {}): Promise<CommandResult> {
      return client.command({
        query,
        query_id: opts.queryId,
        query_params: opts.params,
        abort_signal: signal,
        session_id: sessionId,
        clickhouse_settings: settingsFor(opts.settings),
      });
    },
  };
}

/** Stateless executor (builder preview, save-time validation). */
export function plainSession(client: ClickHouseClient, signal?: AbortSignal): ChSession {
  return build(client, signal, undefined);
}

/** Session-pinned executor for one materialize run. */
export function pinnedSession(client: ClickHouseClient, sessionId: string, signal: AbortSignal): ChSession {
  return build(client, signal, sessionId);
}
