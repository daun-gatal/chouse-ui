/**
 * `capacity` collector (ADR 0016 §9): disk samples per node, a robust forecast
 * of days until the threshold, and a capacity incident when a disk will cross
 * it within two weeks.
 */

import { sql, type SQL } from "drizzle-orm";

import { selectRows } from "../clickhouse";
import type { CollectorContext, ConnectionCollector } from "../collector";
import { all, num, runBatch } from "../db";
import { forecastDisk } from "../forecast";
import { openOrUpdateIncident, recoverIncident } from "../incidents";

const DAY = 24 * 3600 * 1000;
export const CAPACITY_THRESHOLD = Number(process.env.OBSERVE_CAPACITY_THRESHOLD ?? 0.85);
const ALERT_WITHIN_DAYS = 14;

export const capacityCollector: ConnectionCollector = {
  name: "capacity",
  scope: "connection",
  intervalMs: 15 * 60 * 1000,
  requires: ["disks"],
  async run(ctx: CollectorContext): Promise<void> {
    const connectionId = ctx.connection.id;
    const now = ctx.nowMs;
    const disks = await selectRows<{ node: string; name: string; total: number; free: number }>(ctx.client, `
      SELECT hostName() AS node, name, total_space AS total, free_space AS free FROM system.disks WHERE total_space > 0`);
    const statements: SQL[] = [];
    for (const d of disks) {
      statements.push(sql`
        INSERT INTO obs_capacity_samples (connection_id, node, disk_name, sampled_at, total_bytes, free_bytes)
        VALUES (${connectionId}, ${d.node}, ${d.name}, ${now}, ${d.total}, ${d.free})
        ON CONFLICT (connection_id, node, disk_name, sampled_at) DO NOTHING
      `);
    }
    statements.push(sql`DELETE FROM obs_capacity_samples WHERE connection_id = ${connectionId} AND sampled_at < ${now - 90 * DAY}`);
    await runBatch(statements);

    const forecasts: SQL[] = [];
    for (const d of disks) {
      const history = await all(sql`
        SELECT sampled_at, total_bytes, free_bytes FROM obs_capacity_samples
        WHERE connection_id = ${connectionId} AND node = ${d.node} AND disk_name = ${d.name} AND sampled_at >= ${now - 30 * DAY} ORDER BY sampled_at`);
      const f = forecastDisk(history.map((h) => ({ sampledAt: num(h.sampled_at), totalBytes: num(h.total_bytes), freeBytes: num(h.free_bytes) })), CAPACITY_THRESHOLD);
      if (!f) continue;
      forecasts.push(sql`
        INSERT INTO obs_capacity_forecasts (connection_id, node, disk_name, computed_at, used_ratio, growth_bytes_per_day, days_to_threshold, threshold)
        VALUES (${connectionId}, ${d.node}, ${d.name}, ${now}, ${f.usedRatio}, ${f.growthBytesPerDay}, ${f.daysToThreshold}, ${f.threshold})
        ON CONFLICT (connection_id, node, disk_name) DO UPDATE SET computed_at = ${now}, used_ratio = ${f.usedRatio},
          growth_bytes_per_day = ${f.growthBytesPerDay}, days_to_threshold = ${f.daysToThreshold}, threshold = ${f.threshold}
      `);
      const subject = `${d.node}:${d.name}`;
      if (f.daysToThreshold !== null && f.daysToThreshold <= ALERT_WITHIN_DAYS) {
        await openOrUpdateIncident({
          connectionId,
          kind: "capacity",
          subjectRef: subject,
          subjectNode: null,
          severity: f.daysToThreshold <= 3 ? "critical" : "warning",
          summary: `Disk ${d.name} on ${d.node} reaches ${Math.round(f.threshold * 100)}% in ${f.daysToThreshold} days (now ${Math.round(f.usedRatio * 100)}%)`,
          onsetAt: now,
          force: true,
        });
      } else {
        await recoverIncident(connectionId, "capacity", subject);
      }
    }
    await runBatch(forecasts);
  },
};

