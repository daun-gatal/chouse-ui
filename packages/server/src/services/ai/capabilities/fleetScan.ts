/**
 * Feature: fleet-scan — the agentic fleet doctor.
 *
 * The heaviest feature: it pre-collects a per-node overview (vitals + top
 * memory queries + recent heavy query shapes + errors), tells the bound agent
 * whether the optimization playbook is needed, lets it investigate read-only
 * across all nodes, then (in finalize) proves each flagged heavy query with a
 * before→after EXPLAIN ESTIMATE and attaches captured vitals + the tool-call
 * evidence trail.
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import type { AgentMessage } from "../types";
import { PERMISSIONS } from "../../../rbac/schema/base";
import { runFleetMetric } from "../../fleetMetrics";
import {
  type FleetNode,
  resolveNodes,
  clampHours,
  explainEstimate,
  recentHeavyQueries,
} from "./fleetShared";
import type { StructuredCapability } from "../types";

/**
 * Only worth inlining the playbook when the scan actually surfaced a heavy
 * query to optimize — otherwise the prompt stays lean.
 */
export function needsPlaybook(overview: Record<string, unknown>[]): boolean {
  return overview.some((o) => {
    const heavy = Array.isArray(o.recentHeavyQueries) ? o.recentHeavyQueries : [];
    const top = Array.isArray(o.topMemoryQueries) ? o.topMemoryQueries : [];
    return heavy.length > 0 || top.length > 0;
  });
}

const StatusEnum = z.enum(["healthy", "warning", "critical"]);

const HeavyQuerySchema = z.object({
  node: z.string(),
  query: z.string(),
  peakMemory: z.string(),
  // `.nullish()`, never a bare `.optional()`: strict structured-output modes
  // reject optional fields that cannot be emitted as null.
  user: z.string().nullish(),
  cause: z.string(),
  tables: z.array(
    z.object({
      name: z.string(),
      engine: z.string().nullish(),
      rows: z.string().nullish(),
      note: z.string(),
    }),
  ),
  suggestions: z.array(z.string()),
  optimizedQuery: z.string().nullish(),
  estimate: z
    .object({
      before: z.object({ rows: z.number(), parts: z.number(), marks: z.number() }).nullish(),
      after: z.object({ rows: z.number(), parts: z.number(), marks: z.number() }).nullish(),
    })
    .nullish(),
});

const DoctorReportSchema = z.object({
  verdict: z.object({ status: StatusEnum, summary: z.string() }),
  nodes: z.array(z.object({ name: z.string(), status: StatusEnum, details: z.array(z.string()) })),
  recommendations: z.array(z.string()),
  heavyQueries: z.array(HeavyQuerySchema).nullish(),
});

export type DoctorAnalysis = z.infer<typeof DoctorReportSchema>;

export interface NodeVitals {
  id: string;
  name: string;
  reachable: boolean;
  memPct: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  cpuPct: number | null;
  activeQueries: number | null;
  longRunningQueries: number | null;
  longRunningMerges: number | null;
  openMutations: number | null;
  sickReplicas: number | null;
  replicaLagSeconds: number | null;
  uptimeSeconds: number | null;
  version: string | null;
}

export interface DoctorReport {
  id: string;
  analysis: DoctorAnalysis | null;
  raw: string;
  steps: { tool: string; input: unknown }[];
  vitals: NodeVitals[];
  model: string;
  scannedAt: number;
  durationMs: number;
  nodes: number;
  hours: number;
}

const REDASH_USER_RE = /Username:\s*([^,]+)/i;
const REDASH_QID_RE = /query_id:\s*(\d+)/i;

function extractRedash(text: string): { redash_user?: string; redash_query_id?: string } {
  const out: { redash_user?: string; redash_query_id?: string } = {};
  const u = REDASH_USER_RE.exec(text);
  if (u?.[1]?.trim()) out.redash_user = u[1].trim();
  const q = REDASH_QID_RE.exec(text);
  if (q?.[1]) out.redash_query_id = q[1];
  return out;
}

function sanitizeQueryRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (typeof out.query_preview === "string") {
    Object.assign(out, extractRedash(out.query_preview));
    out.query_preview = out.query_preview
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  }
  return out;
}

function vitalsFromOverview(o: Record<string, unknown>): NodeVitals {
  const s = (o.summary ?? null) as Record<string, unknown> | null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const total = num(s?.server_memory_total_bytes);
  const used = num(s?.server_memory_used_bytes);
  return {
    id: String(o.id ?? ""),
    name: String(o.name ?? ""),
    reachable: s != null,
    memUsedBytes: used,
    memTotalBytes: total,
    memPct: total && used != null && total > 0 ? Math.round((used / total) * 100) : null,
    cpuPct: num(s?.server_cpu_percent),
    activeQueries: num(s?.active_queries),
    longRunningQueries: num(s?.long_running_queries),
    longRunningMerges: num(s?.long_running_merges),
    openMutations: num(s?.open_mutations),
    sickReplicas: num(s?.sick_replicas),
    replicaLagSeconds: num(s?.max_replica_lag_seconds),
    uptimeSeconds: num(s?.uptime_seconds),
    version: typeof s?.server_version === "string" ? (s.server_version as string) : null,
  };
}

/** Build a compact, sanitized per-node overview from the live fleet metrics. */
async function buildOverview(connections: FleetNode[], hours: number): Promise<Record<string, unknown>[]> {
  return Promise.all(
    connections.map(async (c) => {
      try {
        const [summary, topMem, longest, errors, heavy] = await Promise.all([
          runFleetMetric(c.id, "summary").then((r) => r.data?.[0] ?? null).catch(() => null),
          runFleetMetric(c.id, "top_memory_query")
            .then((r) => (r.data ?? []).slice(0, 3).map(sanitizeQueryRow))
            .catch(() => []),
          runFleetMetric(c.id, "longest_query")
            .then((r) => (r.data?.[0] ? sanitizeQueryRow(r.data[0]) : null))
            .catch(() => null),
          runFleetMetric(c.id, "last_exception").then((r) => (r.data ?? []).slice(0, 3)).catch(() => []),
          recentHeavyQueries(c.id, hours),
        ]);
        return {
          id: c.id,
          name: c.name,
          summary,
          topMemoryQueries: topMem,
          longestQuery: longest,
          recentErrors: errors,
          recentHeavyQueries: heavy,
        };
      } catch (e) {
        return { id: c.id, name: c.name, error: e instanceof Error ? e.message.slice(0, 160) : "unreachable" };
      }
    }),
  );
}

export interface FleetScanInput {
  connectionIds?: string[];
  hours?: number;
}

interface Prepared {
  nodes: FleetNode[];
  hours: number;
  overview: Record<string, unknown>[];
  startedAt: number;
}

/** Assemble the final DoctorReport envelope shared by finalize + parse-failure. */
function buildReport(
  prepared: Prepared,
  analysis: DoctorAnalysis | null,
  meta: { raw: string; steps: { tool: string; input: unknown }[]; modelLabel: string },
): DoctorReport {
  return {
    id: randomUUID(),
    analysis,
    raw: meta.raw,
    steps: meta.steps,
    vitals: prepared.overview.map(vitalsFromOverview),
    model: meta.modelLabel,
    scannedAt: Date.now(),
    durationMs: Date.now() - prepared.startedAt,
    nodes: prepared.nodes.length,
    hours: prepared.hours,
  };
}

export const fleetScanCapability: StructuredCapability<
  FleetScanInput,
  Prepared,
  DoctorAnalysis,
  DoctorReport
> = {
  id: "fleet-scan",
  title: "Fleet Doctor scan",
  description: "Doctor › Scan (manual, scheduled or alert-triggered): reviews every node and deep-dives heavy queries into a health report.",
  surface: "doctor",
  delivery: "structured",
  permission: PERMISSIONS.DOCTOR_RUN,
  contexts: ["fleet"],
  background: true,
  variables: {
    hours: { type: "number", description: "Investigation window in hours." },
    nodeCount: { type: "number", description: "Number of nodes scanned." },
    overview: { type: "json", description: "Per-node overview (pretty-printed JSON)." },
    needsPlaybook: { type: "boolean", description: "True when the scan found a heavy or top-memory query worth optimizing." },
  },
  inputSchema: z.object({
    connectionIds: z.array(z.string()).optional(),
    hours: z.number().optional(),
  }),
  outputSchema: DoctorReportSchema,

  async prepare(input) {
    const startedAt = Date.now();
    const hours = clampHours(input.hours);
    const nodes = await resolveNodes(input.connectionIds);
    const overview = await buildOverview(nodes, hours);
    return { nodes, hours, overview, startedAt };
  },

  fleetNodes: (prepared) => prepared.nodes,

  templateVariables(prepared) {
    return {
      hours: prepared.hours,
      nodeCount: prepared.nodes.length,
      overview: JSON.stringify(prepared.overview, null, 2),
      needsPlaybook: needsPlaybook(prepared.overview),
    };
  },

  fallbackMessages(prepared, _ctx, raw, prompts): AgentMessage[] {
    return [
      { role: "system", content: prompts.system },
      {
        role: "user",
        content: `Fleet overview:\n\`\`\`json\n${JSON.stringify(prepared.overview)}\n\`\`\`\n\nInvestigation notes (may be empty):\n${raw || "(none)"}\n\nProduce the structured health report now.`,
      },
    ];
  },

  async finalize(analysis, prepared, _ctx, meta) {
    // before → after EXPLAIN ESTIMATE proof for each heavy query (backend-computed).
    if (analysis?.heavyQueries?.length) {
      const idByName = new Map(prepared.nodes.map((n) => [n.name, n.id]));
      await Promise.all(
        analysis.heavyQueries.map(async (hq) => {
          const connId = idByName.get(hq.node);
          if (!connId) {
            delete hq.estimate;
            return;
          }
          const [before, after] = await Promise.all([
            explainEstimate(connId, hq.query),
            hq.optimizedQuery ? explainEstimate(connId, hq.optimizedQuery) : Promise.resolve(null),
          ]);
          if (before || after) hq.estimate = { before: before ?? undefined, after: after ?? undefined };
          else delete hq.estimate;
        }),
      );
    }

    return buildReport(prepared, analysis, meta);
  },

  // The agent didn't emit parseable JSON even after the structured fallback —
  // still return a report (raw text + null analysis) so the UI is never empty.
  onParseFailure(prepared, _ctx, meta) {
    return buildReport(prepared, null, meta);
  },
};
