/**
 * Gathers evidence for an incident and runs the deterministic RCA and
 * blast-radius walks (ADR 0016 §6), storing the results in `incident_rca` and
 * `incident_blast_radius`. Works for Data Health incidents (promise → table
 * node) and Observe incidents (pipeline / engine subject) alike.
 */

import { all, json, num, numOrNull, one, run, sql, str } from "./db";
import { blastRadius, computeRca, type ChainStep, type GraphEdge, type RcaLayer, type RcaSignal } from "./rca";
import type { IncidentSource } from "./incidents";

const LOOKBACK_MS = 6 * 3600 * 1000;

interface IncidentSubject {
  connectionId: string;
  node: string;
  onsetAt: number;
  summary: string;
}

async function subjectOf(source: IncidentSource, id: string): Promise<IncidentSubject | null> {
  if (source === "data_health") {
    const row = await one(sql`
      SELECT i.opened_at, i.summary, p.connection_id, p.database_name, p.table_name, p.source_type
      FROM data_health_incidents i JOIN data_health_promises p ON p.id = i.promise_id WHERE i.id = ${id}`);
    if (!row || !row.database_name || !row.table_name) return null;
    return { connectionId: str(row.connection_id), node: `table:${str(row.database_name)}.${str(row.table_name)}`, onsetAt: num(row.opened_at), summary: str(row.summary) };
  }
  const row = await one(sql`SELECT * FROM obs_incidents WHERE id = ${id}`);
  if (!row) return null;
  const connectionId = str(row.connection_id);
  if (str(row.kind) === "pipeline") {
    const pipeline = await one(sql`SELECT target_node FROM obs_pipelines WHERE connection_id = ${connectionId} AND pipeline_id = ${str(row.subject_ref)}`);
    return { connectionId, node: pipeline ? str(pipeline.target_node) : str(row.subject_ref), onsetAt: num(row.opened_at), summary: str(row.summary) };
  }
  return { connectionId, node: str(row.subject_ref), onsetAt: num(row.opened_at), summary: str(row.summary) };
}

const INGESTION_KINDS = new Set(["queue_engine", "object_storage_queue", "database_replication", "writer", "async_insert", "external_table"]);

function pipelineLayer(kind: string, errorClass: string | null): RcaLayer {
  if (errorClass === "external") return "external";
  return INGESTION_KINDS.has(kind) ? "ingestion" : "transform";
}

/** Engine-level evidence from the fleet snapshots of the connection. */
async function engineSignals(connectionId: string, from: number): Promise<RcaSignal[]> {
  const rows = await all(sql`
    SELECT captured_at, metric, payload FROM fleet_snapshots
    WHERE connection_id = ${connectionId} AND captured_at >= ${Math.floor(from / 1000)} AND metric IN ('summary', 'longest_query') AND error IS NULL
    ORDER BY captured_at`);
  const signals: RcaSignal[] = [];
  let memoryOnset: number | null = null;
  let peakRatio = 0;
  let heavy: { at: number; detail: string } | null = null;
  for (const row of rows) {
    const payload = json<Array<Record<string, unknown>>>(row.payload, []);
    const first = payload[0];
    if (!first) continue;
    const at = num(row.captured_at) * 1000;
    if (str(row.metric) === "summary") {
      const total = num(first.server_memory_total_bytes);
      const used = num(first.server_memory_used_bytes);
      const ratio = total > 0 ? used / total : 0;
      if (ratio >= 0.9 && memoryOnset === null) memoryOnset = at;
      peakRatio = Math.max(peakRatio, ratio);
      if (num(first.sick_replicas) > 0) {
        signals.push({ nodeId: null, layer: "engine", kind: "replica_unhealthy", onsetAt: at, summary: `${num(first.sick_replicas)} replicas lagging or read-only`, evidence: { source: "system.replicas", detail: `max lag ${num(first.max_replica_lag_seconds)}s on ${str(first.max_lag_replica)}` }, severity: 2 });
      }
    } else if (str(row.metric) === "longest_query" && num(first.memory_usage) > 4 * 1024 ** 3 && heavy === null) {
      heavy = { at, detail: `query ${str(first.query_id)} by ${str(first.user)} using ${(num(first.memory_usage) / 1024 ** 3).toFixed(1)} GiB for ${Math.round(num(first.elapsed_seconds))}s` };
    }
  }
  if (memoryOnset !== null) {
    signals.push({
      nodeId: null,
      layer: "engine",
      kind: "memory_pressure",
      onsetAt: memoryOnset,
      summary: `Server memory at ${Math.round(peakRatio * 100)}%${heavy ? `: ${heavy.detail}` : ""}`,
      evidence: { source: "fleet snapshot (system.asynchronous_metrics, system.processes)", detail: heavy?.detail ?? `peak ${Math.round(peakRatio * 100)}%` },
      severity: 3,
    });
  }
  // Deduplicate replica signals to the earliest.
  const firstReplica = signals.filter((s) => s.kind === "replica_unhealthy").sort((a, b) => a.onsetAt - b.onsetAt)[0];
  return [...signals.filter((s) => s.kind !== "replica_unhealthy"), ...(firstReplica ? [firstReplica] : [])];
}

async function pipelineSignals(connectionId: string): Promise<RcaSignal[]> {
  const rows = await all(sql`SELECT * FROM obs_pipelines WHERE connection_id = ${connectionId} AND status NOT IN ('healthy', 'unsupported_on_version', 'inefficient')`);
  const signals: RcaSignal[] = [];
  for (const p of rows) {
    const latest = await one(sql`SELECT error_class, error_sample FROM obs_pipeline_samples WHERE connection_id = ${connectionId} AND pipeline_id = ${str(p.pipeline_id)} ORDER BY sampled_at DESC LIMIT 1`);
    const errorClass = latest ? (str(latest.error_class) || null) : null;
    const node = str(p.target_node) || str(p.source_node);
    if (!node) continue;
    signals.push({
      nodeId: node,
      layer: pipelineLayer(str(p.kind), errorClass),
      kind: str(p.status),
      onsetAt: num(p.status_since),
      summary: `${str(p.name)}: ${str(p.status_reason)}`,
      evidence: { source: `${str(p.kind)} (${str(p.engine)})`, detail: latest ? str(latest.error_sample).slice(0, 500) : str(p.status_reason) },
      severity: ["retrying", "stalled"].includes(str(p.status)) ? 3 : 2,
    });
    // An engine-class error inside a pipeline is also an engine signal.
    if (errorClass === "engine") {
      signals.push({ nodeId: null, layer: "engine", kind: "engine_error", onsetAt: num(p.status_since), summary: str(latest?.error_sample).slice(0, 200), evidence: { source: str(p.kind), detail: str(latest?.error_sample).slice(0, 500) }, severity: 2 });
    }
  }
  return signals;
}

async function tableSignals(connectionId: string): Promise<RcaSignal[]> {
  const rows = await all(sql`SELECT database_name, table_name, state, state_reason, updated_at FROM obs_table_baselines WHERE connection_id = ${connectionId} AND state IN ('stale', 'degraded')`);
  return rows.map((r) => ({
    nodeId: `table:${str(r.database_name)}.${str(r.table_name)}`,
    layer: "data" as const,
    kind: str(r.state),
    onsetAt: num(r.updated_at),
    summary: `${str(r.database_name)}.${str(r.table_name)}: ${str(r.state_reason)}`,
    evidence: { source: "learned baseline (system.parts, system.part_log)", detail: str(r.state_reason) },
    severity: str(r.state) === "stale" ? 2 : 1,
  }));
}

export interface BlastRadiusEntry {
  nodeId: string;
  label: string;
  kind: string;
  depth: number;
  detail?: string;
}

export async function computeAndStoreRca(source: IncidentSource, id: string): Promise<{ chain: ChainStep[]; blast: BlastRadiusEntry[] } | null> {
  const subject = await subjectOf(source, id);
  if (!subject) return null;
  const edgeRows = await all(sql`SELECT source_id, target_id, kind FROM obs_lineage_edges WHERE connection_id = ${subject.connectionId}`);
  const nodeRows = await all(sql`SELECT node_id, label, kind FROM obs_lineage_nodes WHERE connection_id = ${subject.connectionId}`);
  const edges: GraphEdge[] = edgeRows.map((r) => ({ source: str(r.source_id), target: str(r.target_id), kind: str(r.kind) }));
  const labels = new Map(nodeRows.map((r) => [str(r.node_id), str(r.label)]));
  const kinds = new Map(nodeRows.map((r) => [str(r.node_id), str(r.kind)]));
  const from = subject.onsetAt - LOOKBACK_MS;

  const signals: RcaSignal[] = [
    { nodeId: subject.node, layer: "data", kind: source === "data_health" ? "promise_breached" : "symptom", onsetAt: subject.onsetAt, summary: subject.summary, evidence: { source: source === "data_health" ? "Data Health promise" : "pipeline status", detail: subject.summary }, severity: 2 },
    ...(await tableSignals(subject.connectionId)).filter((s) => s.nodeId !== subject.node),
    ...(await pipelineSignals(subject.connectionId)),
    ...(await engineSignals(subject.connectionId, from)),
  ];
  const result = computeRca({ incidentNode: subject.node, incidentOnsetAt: subject.onsetAt, edges, labels, signals });

  // Related: other active incidents sharing the root node or chain signature.
  const related: Array<{ source: string; id: string; reason: string }> = [];
  if (result.signature) {
    const same = await all(sql`SELECT incident_source, incident_id FROM incident_rca WHERE signature = ${result.signature} AND NOT (incident_source = ${source} AND incident_id = ${id}) ORDER BY computed_at DESC LIMIT 10`);
    for (const r of same) related.push({ source: str(r.incident_source), id: str(r.incident_id), reason: "same root-cause chain" });
  }
  const now = Date.now();
  await run(sql`
    INSERT INTO incident_rca (incident_source, incident_id, computed_at, signature, chain, root_cause, related)
    VALUES (${source}, ${id}, ${now}, ${result.signature}, ${JSON.stringify(result.chain)}, ${result.rootCause ? JSON.stringify(result.rootCause) : null}, ${JSON.stringify(related)})
    ON CONFLICT (incident_source, incident_id) DO UPDATE SET computed_at = ${now}, signature = ${result.signature}, chain = ${JSON.stringify(result.chain)},
      root_cause = ${result.rootCause ? JSON.stringify(result.rootCause) : null}, related = ${JSON.stringify(related)}
  `);

  // Blast radius from the root cause's node when known (it is upstream of the symptom), else the symptom.
  const origin = result.rootCause?.nodeId ?? subject.node;
  const blast: BlastRadiusEntry[] = blastRadius(origin, edges, labels, kinds).map((b) => ({ ...b }));
  // Promises on affected tables and scheduled runs due soon make the radius actionable.
  const affectedTables = [subject.node, ...blast.map((b) => b.nodeId)].filter((n) => n.startsWith("table:")).map((n) => n.slice(6));
  for (const fq of affectedTables) {
    const dot = fq.indexOf(".");
    const promises = await all(sql`SELECT id, name, criticality FROM data_health_promises WHERE connection_id = ${subject.connectionId} AND database_name = ${fq.slice(0, dot)} AND table_name = ${fq.slice(dot + 1)}`);
    for (const p of promises) blast.push({ nodeId: `promise:${str(p.id)}`, label: str(p.name), kind: "promise", depth: 0, detail: `${str(p.criticality)} promise on ${fq}` });
  }
  await run(sql`
    INSERT INTO incident_blast_radius (incident_source, incident_id, computed_at, items) VALUES (${source}, ${id}, ${now}, ${JSON.stringify(blast)})
    ON CONFLICT (incident_source, incident_id) DO UPDATE SET computed_at = ${now}, items = ${JSON.stringify(blast)}
  `);
  return { chain: result.chain, blast };
}

export interface StoredRca {
  computedAt: number;
  signature: string | null;
  chain: ChainStep[];
  rootCause: ChainStep | null;
  related: Array<{ source: string; id: string; reason: string }>;
  blastRadius: BlastRadiusEntry[];
}

export async function getStoredRca(source: IncidentSource, id: string): Promise<StoredRca | null> {
  const row = await one(sql`SELECT * FROM incident_rca WHERE incident_source = ${source} AND incident_id = ${id}`);
  if (!row) return null;
  const blast = await one(sql`SELECT items FROM incident_blast_radius WHERE incident_source = ${source} AND incident_id = ${id}`);
  return {
    computedAt: num(row.computed_at),
    signature: str(row.signature) || null,
    chain: json<ChainStep[]>(row.chain, []),
    rootCause: json<ChainStep | null>(row.root_cause, null),
    related: json(row.related, []),
    blastRadius: blast ? json<BlastRadiusEntry[]>(blast.items, []) : [],
  };
}

export { numOrNull };
