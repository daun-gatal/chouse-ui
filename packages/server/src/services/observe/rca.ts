/**
 * Deterministic cross-layer RCA and blast radius (ADR 0016 §6).
 *
 * Walk the lineage graph upstream from the incident node, rank the signals
 * found on the way by layer, onset precedence and depth, and return an ordered
 * chain from the symptom down to the root cause. AI never chooses the root
 * cause; it only narrates the stored chain.
 */

export type RcaLayer = "data" | "transform" | "ingestion" | "external" | "engine";

export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

export interface RcaSignal {
  /** Lineage node the signal belongs to; null = connection-wide (engine). */
  nodeId: string | null;
  layer: RcaLayer;
  kind: string;
  onsetAt: number;
  summary: string;
  evidence: { source: string; detail: string };
  /** 1 (minor) .. 3 (severe). */
  severity: number;
}

export interface ChainStep {
  layer: RcaLayer;
  nodeId: string | null;
  label: string;
  kind: string;
  summary: string;
  evidence: { source: string; detail: string };
  onsetAt: number;
  isRoot: boolean;
}

export interface RcaResult {
  chain: ChainStep[];
  rootCause: ChainStep | null;
  signature: string | null;
}

export const RCA_MAX_DEPTH = 6;

const LAYER_WEIGHT: Record<RcaLayer, number> = { data: 0, transform: 2, ingestion: 3, external: 4, engine: 4 };

interface Visit {
  depth: number;
  /** Next hop toward the incident node, for reconstructing the path. */
  via: string | null;
}

function walk(start: string, next: (node: string) => string[], maxDepth: number): Map<string, Visit> {
  const visited = new Map<string, Visit>([[start, { depth: 0, via: null }]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const depth = visited.get(current)!.depth;
    if (depth >= maxDepth) continue;
    for (const neighbour of next(current)) {
      if (visited.has(neighbour)) continue;
      visited.set(neighbour, { depth: depth + 1, via: current });
      queue.push(neighbour);
    }
  }
  return visited;
}

export function upstreamOf(edges: GraphEdge[]): (node: string) => string[] {
  const incoming = new Map<string, string[]>();
  for (const e of edges) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
  return (node) => incoming.get(node) ?? [];
}

export function downstreamOf(edges: GraphEdge[]): (node: string) => string[] {
  const outgoing = new Map<string, string[]>();
  for (const e of edges) outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
  return (node) => outgoing.get(node) ?? [];
}

function step(signal: RcaSignal, labels: Map<string, string>, isRoot: boolean): ChainStep {
  return {
    layer: signal.layer,
    nodeId: signal.nodeId,
    label: signal.nodeId ? labels.get(signal.nodeId) ?? signal.nodeId : "connection",
    kind: signal.kind,
    summary: signal.summary,
    evidence: signal.evidence,
    onsetAt: signal.onsetAt,
    isRoot,
  };
}

export interface RcaInput {
  incidentNode: string;
  incidentOnsetAt: number;
  edges: GraphEdge[];
  labels: Map<string, string>;
  signals: RcaSignal[];
  /** Signals starting more than this long after the incident are effects, not causes. */
  graceMs?: number;
}

export function computeRca(input: RcaInput): RcaResult {
  const grace = input.graceMs ?? 5 * 60 * 1000;
  const visits = walk(input.incidentNode, upstreamOf(input.edges), RCA_MAX_DEPTH);
  const candidates = input.signals.filter((s) => (s.nodeId === null || visits.has(s.nodeId)) && s.onsetAt <= input.incidentOnsetAt + grace);
  if (candidates.length === 0) return { chain: [], rootCause: null, signature: null };

  const maxDepth = Math.max(...[...visits.values()].map((v) => v.depth));
  const score = (s: RcaSignal): number => {
    const depth = s.nodeId === null ? maxDepth + 1 : visits.get(s.nodeId)!.depth;
    const precedence = Math.max(0, input.incidentOnsetAt - s.onsetAt) / 60_000; // minutes earlier
    return LAYER_WEIGHT[s.layer] * 10 + depth * 4 + Math.min(precedence, 120) / 12 + s.severity * 2;
  };
  const ranked = [...candidates].sort((a, b) => score(b) - score(a) || a.onsetAt - b.onsetAt);
  const root = ranked[0];

  // Best signal per node, to describe each hop on the path.
  const bestByNode = new Map<string, RcaSignal>();
  for (const s of ranked) {
    if (s.nodeId !== null && !bestByNode.has(s.nodeId)) bestByNode.set(s.nodeId, s);
  }

  // Path from the incident node down to the root's node (or the deepest signal node for an engine root).
  let anchor: string | null = root.nodeId;
  if (anchor === null) {
    let deepest: string | null = null;
    for (const nodeId of bestByNode.keys()) {
      if (deepest === null || visits.get(nodeId)!.depth > visits.get(deepest)!.depth) deepest = nodeId;
    }
    anchor = deepest;
  }
  // Unshifting along the via-chain yields incident → … → anchor.
  const path: string[] = [];
  for (let cursor: string | null = anchor; cursor !== null; cursor = visits.get(cursor)?.via ?? null) path.unshift(cursor);

  const chain: ChainStep[] = [];
  for (const nodeId of path) {
    const signal = bestByNode.get(nodeId);
    if (!signal || signal === root) continue;
    chain.push(step(signal, input.labels, false));
  }
  chain.push(step(root, input.labels, true));
  const signature = chain.map((c) => `${c.layer}:${c.kind}`).join(">");
  return { chain, rootCause: chain[chain.length - 1], signature };
}

export interface BlastItem {
  nodeId: string;
  label: string;
  kind: string;
  depth: number;
}

/** Everything downstream of `node`, nearest first (depth ≤ 6). */
export function blastRadius(node: string, edges: GraphEdge[], labels: Map<string, string>, kinds: Map<string, string>): BlastItem[] {
  const visits = walk(node, downstreamOf(edges), RCA_MAX_DEPTH);
  return [...visits.entries()]
    .filter(([id]) => id !== node)
    .map(([id, v]) => ({ nodeId: id, label: labels.get(id) ?? id, kind: kinds.get(id) ?? "table", depth: v.depth }))
    .sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label));
}
