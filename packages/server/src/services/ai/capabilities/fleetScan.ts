/**
 * Capability: fleet-scan — ChouseD, the agentic fleet SRE.
 *
 * The heaviest capability: it pre-collects a per-node overview (vitals + top
 * memory queries + recent heavy query shapes + errors), conditionally attaches
 * the optimization playbook, runs the read-only investigator across all nodes,
 * then (in finalize) proves each flagged heavy query with a before→after
 * EXPLAIN ESTIMATE and attaches captured vitals + the tool-call evidence trail.
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import type { ModelMessage, ToolSet } from "ai";
import { AppError } from "../../../types";
import { PERMISSIONS } from "../../../rbac/schema/base";
import { CLICKHOUSE_PLAYBOOK, needsPlaybook } from "../../clickhousePlaybook";
import { runFleetMetric } from "../../fleetMetrics";
import {
  SYSTEM_TABLE_REFERENCE,
  type FleetNode,
  queryNodeTool,
  resolveNodes,
  clampHours,
  explainEstimate,
  recentHeavyQueries,
} from "./fleetShared";
import type { StructuredCapability } from "../types";

const StatusEnum = z.enum(["healthy", "warning", "critical"]);

const HeavyQuerySchema = z.object({
  node: z.string(),
  query: z.string(),
  peakMemory: z.string(),
  user: z.string().optional(),
  cause: z.string(),
  tables: z.array(
    z.object({
      name: z.string(),
      engine: z.string().optional(),
      rows: z.string().optional(),
      note: z.string(),
    }),
  ),
  suggestions: z.array(z.string()),
  optimizedQuery: z.string().optional(),
  estimate: z
    .object({
      before: z.object({ rows: z.number(), parts: z.number(), marks: z.number() }).optional(),
      after: z.object({ rows: z.number(), parts: z.number(), marks: z.number() }).optional(),
    })
    .optional(),
});

const DoctorReportSchema = z.object({
  verdict: z.object({ status: StatusEnum, summary: z.string() }),
  nodes: z.array(z.object({ name: z.string(), status: StatusEnum, details: z.array(z.string()) })),
  recommendations: z.array(z.string()),
  heavyQueries: z.array(HeavyQuerySchema).optional(),
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

const SYSTEM_PROMPT = `You are Chouse AI, acting as ClickHouse's fleet doctor — an expert Site Reliability Engineer reviewing a fleet of ClickHouse servers ("nodes").

You are given a JSON overview with one object per node: server memory %, CPU %, active/long-running query counts, blocked merges/mutations, replica lag + sick replicas, uptime, version, the top memory-consuming queries running NOW, the longest-running query, recent exceptions, and \`recentHeavyQueries\` — the heaviest query SHAPES by memory over the selected investigation window (peak_gb, avg_gb, runs, user, sample, last_seen) from system.query_log, so you catch memory-hungry queries even if they already finished. The window length is stated in the user message.

1. Read the overview and spot anything unhealthy — memory pressure, a single runaway query running now, a query shape that repeatedly peaks high memory over the window (from recentHeavyQueries — call out the worst offenders, their peak_gb, user, and how often they run), replication lag, stuck merges/mutations, repeated exceptions, version skew.
2. When you need detail, use the \`query_node\` tool to run a READ-ONLY SELECT against that node's \`system.*\` tables (system.processes, system.replicas, system.merges, system.mutations, system.query_log, system.parts, system.asynchronous_metrics, …). It is read-only — writes/DDL/KILL are rejected — so investigate freely, but you can only observe.
${SYSTEM_TABLE_REFERENCE}

HIGH-MEMORY QUERY DEEP-DIVE — do this whenever a query eats memory beyond the norm (several GB, a large share of server memory, or a top entry in topMemoryQueries / recentHeavyQueries). Don't hand-wave "it's heavy" — gather REAL data, but stay FAST and tight:
 - SPEED RULES (important — busy clusters make query_log scans slow): the heavy queries + their peak memory are ALREADY in the overview (recentHeavyQueries: peak_gb/user/sample/runs; topMemoryQueries: memory_usage). REUSE them — do NOT re-query system.query_log for memory or query text. Inspect only the CHEAP metadata tables (system.tables / system.columns / system.parts — they read almost nothing). Deep-dive only the TOP 1–2 heaviest query shapes, ≤2 tables each. Avoid extra system.query_log queries entirely unless absolutely necessary (and then bound them with an event_time range + LIMIT).
 a. Find the tables it reads by parsing the query text already in the overview (recentHeavyQueries.sample / topMemoryQueries.query_preview).
 b. For each table pull the facts (cheap metadata, instant): system.tables (engine, total_rows, total_bytes, partition_key, sorting_key) → how big + how it's keyed; system.columns (type + data_compressed_bytes) → heaviest / mistyped columns; system.parts grouped by partition → is it scanning every partition? too many parts?
 c. Pin the CAUSE on that data.
 d. Record it in \`heavyQueries\`: the query, its real peak memory, the user, the cause, per-table findings, concrete optimization suggestions grounded in the data, AND \`optimizedQuery\` — the OPTIMIZED version with those fixes applied as concrete, runnable ClickHouse SQL using the REAL table + column names.
    HARD REQUIREMENTS — the optimized query MUST: return the EXACT SAME result as the original; keep the business logic 100% UNCHANGED; aim to run in UNDER 1 MINUTE and peak UNDER 1 GB. Write it COMPLETE and VALID (no "…" / "-- omitted" placeholders). FORMAT it prettily + runnable: multi-line, 2-space indent, one major clause per line; keywords UPPERCASE but PRESERVE the exact case of identifiers/columns/function names (ClickHouse is case-sensitive — e.g. argMax, toStartOfInterval); no markdown fences.

3. Then output ONLY a JSON object (no prose, no markdown, no code fences) matching EXACTLY this schema:
{
  "verdict": { "status": "healthy" | "warning" | "critical", "summary": "one concise line on overall fleet health" },
  "nodes": [ { "name": "<node name>", "status": "healthy" | "warning" | "critical", "details": ["short metric/finding line", "..."] } ],
  "recommendations": ["concrete, actionable recommendation", "..."],
  "heavyQueries": [ { "node": "<node>", "query": "<the original query>", "peakMemory": "<e.g. 12.4 GB>", "user": "<user>", "cause": "<why>", "tables": [ { "name": "db.table", "engine": "<engine>", "rows": "<e.g. 2.3B>", "note": "<the issue>" } ], "suggestions": ["...", "..."], "optimizedQuery": "<the optimized version>" } ]
}

Rules:
- status = severity: "healthy" (fine), "warning" (needs attention soon), "critical" (acting up now).
- details = the key numbers/observations for that node as short lines — cite real values.
- recommendations = prioritised + actionable. For anything destructive (killing a query, changing settings) note a human must run it.
- Base everything on real data from the overview or your tool calls — do NOT invent numbers.
- Redash attribution: when a query object carries \`redash_user\` and/or \`redash_query_id\`, name the specific Redash saved query explicitly rather than the generic "r_redash".
- Be efficient on a healthy fleet. When a query breaches the memory standard, spend the calls needed for the deep-dive. Always leave room to output the JSON.
- heavyQueries: add an entry for EVERY query you flag, grounded in the table data. Put the runnable original in \`query\` and the optimized version in \`optimizedQuery\`. Do NOT fill \`estimate\` — the system computes it. Omit/empty heavyQueries when no query is problematic.
- Output the JSON object and nothing else.`;

export interface FleetScanInput {
  connectionIds?: string[];
  hours?: number;
}

interface Prepared {
  nodes: FleetNode[];
  hours: number;
  overview: Record<string, unknown>[];
  instructions: string;
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
  delivery: "structured",
  permission: PERMISSIONS.DOCTOR_RUN,
  inputSchema: z.object({
    connectionIds: z.array(z.string()).optional(),
    hours: z.number().optional(),
  }),
  outputSchema: DoctorReportSchema,
  tuning: { stopAtSteps: 12, temperature: 0.1, maxOutputTokens: 16000 },

  async prepare(input) {
    const startedAt = Date.now();
    const hours = clampHours(input.hours);
    const nodes = await resolveNodes(input.connectionIds);
    const overview = await buildOverview(nodes, hours);
    const instructions = needsPlaybook(overview)
      ? `${SYSTEM_PROMPT}\n\n${CLICKHOUSE_PLAYBOOK}`
      : SYSTEM_PROMPT;
    return { nodes, hours, overview, instructions, startedAt };
  },

  tools(prepared): ToolSet {
    return queryNodeTool(prepared.nodes) as ToolSet;
  },

  instructions(prepared) {
    return prepared.instructions;
  },

  messages(prepared): ModelMessage[] {
    return [
      {
        role: "user",
        content: `Current ClickHouse fleet overview (one object per node). Investigation window: last ${prepared.hours} hours (the \`recentHeavyQueries\` field covers this window; scope your system.query_log tool queries to it too). Investigate and produce the structured health report.\n\n\`\`\`json\n${JSON.stringify(prepared.overview, null, 2)}\n\`\`\``,
      },
    ];
  },

  fallbackMessages(prepared, _ctx, raw): ModelMessage[] {
    return [
      { role: "system", content: prepared.instructions },
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
