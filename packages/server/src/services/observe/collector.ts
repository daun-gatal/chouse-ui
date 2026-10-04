/**
 * The observability collector (ADR 0016 §1). Replaces the fleet poller.
 *
 * One scheduler loop ticks every few seconds. Each registered collector runs
 * at its own cadence, either once globally (fleet) or once per active
 * connection. Every (collector, connection) run is claimed through a row lease
 * so several pods sharing the RBAC database never double-collect, and its
 * outcome is recorded in `obs_collector_status` for the UI.
 */

import { randomUUID } from "crypto";

import type { ClickHouseClient } from "@clickhouse/client";

import { listConnections } from "../../rbac/services/connections";
import { logger } from "../../utils/logger";
import { probeCapabilities, type Capabilities } from "./capabilities";
import { observeClient } from "./clickhouse";
import { num, one, run, sql } from "./db";
import { acquireLease, releaseAll } from "./lease";

export interface ConnectionRef {
  id: string;
  name: string;
}

export interface CollectorContext {
  connection: ConnectionRef;
  client: ClickHouseClient;
  capabilities: Capabilities;
  nowMs: number;
  getWatermark(): Promise<number>;
  setWatermark(value: number): Promise<void>;
}

export interface ConnectionCollector {
  name: string;
  scope: "connection";
  intervalMs: number;
  /** System tables this collector cannot work without (privilege report). */
  requires: string[];
  run(ctx: CollectorContext): Promise<void>;
}

export interface GlobalCollector {
  name: string;
  scope: "global";
  intervalMs: number;
  run(connections: ConnectionRef[], nowMs: number): Promise<void>;
}

export type Collector = ConnectionCollector | GlobalCollector;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const OBSERVE_TICK_MS = 5_000;
const MAX_PARALLEL = envInt("OBSERVE_MAX_PARALLEL", 4);
const RUN_TIMEOUT_MS = envInt("OBSERVE_RUN_TIMEOUT_SECONDS", 120) * 1000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function recordStatus(connectionId: string, collector: string, outcome: { ok: boolean; error?: string | null; missingPrivileges?: string[] | null; durationMs: number }): Promise<void> {
  const now = Date.now();
  const state = outcome.ok ? "ok" : outcome.missingPrivileges && outcome.missingPrivileges.length > 0 ? "missing_privileges" : "error";
  const missing = outcome.missingPrivileges && outcome.missingPrivileges.length > 0 ? JSON.stringify(outcome.missingPrivileges) : null;
  const error = outcome.error ? outcome.error.slice(0, 1000) : null;
  // On failure keep the previous last_ok_at so the UI can say "last good 12m ago".
  const lastOk = outcome.ok ? sql`${now}` : sql`obs_collector_status.last_ok_at`;
  await run(sql`
    INSERT INTO obs_collector_status (connection_id, collector, state, last_run_at, last_ok_at, last_error, missing_privileges, duration_ms)
    VALUES (${connectionId}, ${collector}, ${state}, ${now}, ${outcome.ok ? now : null}, ${error}, ${missing}, ${outcome.durationMs})
    ON CONFLICT (connection_id, collector) DO UPDATE SET
      state = ${state}, last_run_at = ${now}, last_ok_at = ${lastOk},
      last_error = ${error}, missing_privileges = ${missing}, duration_ms = ${outcome.durationMs}
  `);
}

async function getWatermark(connectionId: string, collector: string): Promise<number> {
  const row = await one(sql`SELECT watermark FROM obs_watermarks WHERE connection_id = ${connectionId} AND collector = ${collector}`);
  return row ? num(row.watermark) : 0;
}

async function setWatermark(connectionId: string, collector: string, value: number): Promise<void> {
  const now = Date.now();
  await run(sql`
    INSERT INTO obs_watermarks (connection_id, collector, watermark, updated_at) VALUES (${connectionId}, ${collector}, ${value}, ${now})
    ON CONFLICT (connection_id, collector) DO UPDATE SET watermark = ${value}, updated_at = ${now}
  `);
}

function accessDeniedTables(message: string): string[] {
  const tables = [...message.matchAll(/system\.([a-z_0-9]+)/gi)].map((m) => m[1]);
  return /ACCESS_DENIED|Not enough privileges/i.test(message) ? [...new Set(tables)] : [];
}

export class ObserveService {
  private static instance: ObserveService | null = null;
  private readonly collectors: Collector[] = [];
  private readonly lastStarted = new Map<string, number>();
  private readonly running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  readonly holder = randomUUID();

  static getInstance(): ObserveService {
    if (!ObserveService.instance) ObserveService.instance = new ObserveService();
    return ObserveService.instance;
  }

  register(collector: Collector): void {
    if (this.collectors.some((c) => c.name === collector.name)) return;
    this.collectors.push(collector);
  }

  list(): Collector[] {
    return [...this.collectors];
  }

  start(): void {
    if (this.timer) return;
    logger.info({ module: "Observe", holder: this.holder, collectors: this.collectors.map((c) => c.name) }, "Observability collector starting");
    void this.tick();
    this.timer = setInterval(() => void this.tick(), OBSERVE_TICK_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    let waited = 0;
    while (this.running.size > 0 && waited < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      waited += 100;
    }
    try {
      await releaseAll(this.holder);
    } catch {
      // TTL expiry covers a failed release
    }
    logger.info({ module: "Observe", holder: this.holder }, "Observability collector stopped");
  }

  /** One scheduling pass; exported for tests. */
  async tick(nowMs = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const { connections } = await listConnections({ activeOnly: true });
      const refs: ConnectionRef[] = connections.map((c) => ({ id: c.id, name: c.name }));
      const jobs: Array<() => Promise<void>> = [];
      for (const collector of this.collectors) {
        if (collector.scope === "global") {
          const key = collector.name;
          if (this.isDue(key, collector.intervalMs, nowMs)) jobs.push(() => this.runGlobal(collector, refs, nowMs));
          continue;
        }
        for (const conn of refs) {
          const key = `${collector.name}:${conn.id}`;
          if (this.isDue(key, collector.intervalMs, nowMs)) jobs.push(() => this.runForConnection(collector, conn, nowMs));
        }
      }
      // Bounded parallelism: one slow cluster never stalls the others for long.
      const queue = [...jobs];
      await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, queue.length) }, async () => {
        while (queue.length > 0) await queue.shift()!();
      }));
    } catch (error) {
      logger.error({ module: "Observe", err: error instanceof Error ? error.message : String(error) }, "Observe tick failed");
    } finally {
      this.ticking = false;
    }
  }

  private isDue(key: string, intervalMs: number, nowMs: number): boolean {
    if (this.running.has(key)) return false;
    return nowMs - (this.lastStarted.get(key) ?? 0) >= intervalMs;
  }

  private ttlSeconds(intervalMs: number): number {
    return Math.max(90, Math.ceil((intervalMs * 3) / 1000));
  }

  private async runGlobal(collector: GlobalCollector, refs: ConnectionRef[], nowMs: number): Promise<void> {
    const key = collector.name;
    this.lastStarted.set(key, nowMs);
    if (!(await acquireLease(`observe:${key}`, this.holder, this.ttlSeconds(collector.intervalMs)))) return;
    this.running.add(key);
    try {
      await withTimeout(collector.run(refs, nowMs), RUN_TIMEOUT_MS, key);
    } catch (error) {
      logger.error({ module: "Observe", collector: key, err: error instanceof Error ? error.message : String(error) }, "Collector run failed");
    } finally {
      this.running.delete(key);
    }
  }

  private async runForConnection(collector: ConnectionCollector, conn: ConnectionRef, nowMs: number): Promise<void> {
    const key = `${collector.name}:${conn.id}`;
    this.lastStarted.set(key, nowMs);
    if (!(await acquireLease(`observe:${key}`, this.holder, this.ttlSeconds(collector.intervalMs)))) return;
    this.running.add(key);
    const started = Date.now();
    try {
      const client = await observeClient(conn.id, collector.name);
      const capabilities = await probeCapabilities(conn.id, client);
      await withTimeout(
        collector.run({
          connection: conn,
          client,
          capabilities,
          nowMs,
          getWatermark: () => getWatermark(conn.id, collector.name),
          setWatermark: (value) => setWatermark(conn.id, collector.name, value),
        }),
        RUN_TIMEOUT_MS,
        key,
      );
      await recordStatus(conn.id, collector.name, { ok: true, durationMs: Date.now() - started });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const denied = accessDeniedTables(message);
      await recordStatus(conn.id, collector.name, {
        ok: false,
        error: message,
        missingPrivileges: denied.length > 0 ? denied.map((t) => `GRANT SELECT ON system.${t} TO <connection user>`) : null,
        durationMs: Date.now() - started,
      }).catch(() => undefined);
      logger.warn({ module: "Observe", collector: collector.name, connectionId: conn.id, err: message.slice(0, 300) }, "Collector run failed");
    } finally {
      this.running.delete(key);
    }
  }
}
