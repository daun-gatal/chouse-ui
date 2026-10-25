/**
 * The alerting read tool's arguments, shared by the assistant's list_alerting
 * and the MCP list_alerts (ADR 0026 §8): the same kinds and history filters
 * as Admin › Alerting.
 */

import { z } from "zod";

export const ALERTING_KINDS = ["channels", "rules", "sources", "overview", "events"] as const;
export const ALERTING_SCHEMA = z.object({
  kind: z.enum(ALERTING_KINDS).describe("channels, rules, sources, overview or events"),
  q: z.string().max(200).optional().describe("events: words in the alert"),
  source: z.string().max(50).optional().describe("events: fleet_alert, fleet_rca, dashboard_alert, dashboard_report, scheduled_query, data_health, triage"),
  severity: z.enum(["info", "warning", "critical"]).optional().describe("events: severity"),
  channelId: z.string().max(100).optional().describe("events: reached this channel"),
  failed: z.boolean().optional().describe("events: true for ones some channel failed to get"),
  from: z.number().int().nonnegative().optional().describe("events: fired at or after (epoch ms)"),
  to: z.number().int().positive().optional().describe("events: fired before (epoch ms)"),
  cursor: z.string().max(200).optional().describe("events: nextCursor from the previous page"),
  limit: z.number().int().min(1).max(200).optional().describe("events: page size (default 50)"),
});

export function alertingRequest(a: Record<string, unknown>): { path: string; query?: Record<string, string | undefined> } {
  const kind = (ALERTING_KINDS as readonly string[]).includes(String(a.kind)) ? String(a.kind) : "channels";
  if (kind !== "events") return { path: `/api/alerting/${kind}` };
  const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const number = (v: unknown): string | undefined => (typeof v === "number" && Number.isFinite(v) ? String(Math.round(v)) : undefined);
  return {
    path: "/api/alerting/events/search",
    query: {
      q: text(a.q), source: text(a.source), severity: text(a.severity), channelId: text(a.channelId),
      failed: typeof a.failed === "boolean" ? String(a.failed) : undefined,
      from: number(a.from), to: number(a.to), cursor: text(a.cursor), limit: number(a.limit),
    },
  };
}
