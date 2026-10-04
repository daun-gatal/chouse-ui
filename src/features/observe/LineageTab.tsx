/**
 * Data › Lineage: one graph built from ClickHouse metadata (views, queue and
 * object-storage engines, replication, Distributed, dictionaries), INSERT …
 * SELECT in query_log, scheduled jobs, saved queries and agents. Focus a table
 * to walk upstream, downstream, or both; status colours show what is broken.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router";
import ReactFlow, { Background, Controls, Handle, MarkerType, Position, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { Bot, Database, ExternalLink, FileCode2, Globe, Layers, Search, User, Workflow, X } from "lucide-react";

import { parseTableNode, type LineageEdge, type LineageGraph, type LineageNode, type PipelineStatus, type TrustState } from "@/api/observe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDatasets, useLineage } from "./hooks";
import { humanize, nodeKind, PIPELINE_STATUS, TONE_CLASS, TRUST_TONE, type Tone } from "./lib";
import { dataPaths } from "./paths";
import { EmptyState, ErrorState, OBS_LABEL, StatusPill } from "./ui";

const NODE_W = 230;
const NODE_H = 58;

const KIND_ICON: Record<string, typeof Database> = {
  table: Database,
  job: Workflow,
  agent: Bot,
  person: User,
  client: User,
  saved_query: FileCode2,
  external: Globe,
  dictionary: Layers,
};

function isTrustState(status: string): status is TrustState {
  return Object.prototype.hasOwnProperty.call(TRUST_TONE, status);
}

function isPipelineStatus(status: string): status is PipelineStatus {
  return Object.prototype.hasOwnProperty.call(PIPELINE_STATUS, status);
}

/** Node status is a trust state (tables) or a pipeline status (sources). */
export function statusTone(status: string | null): Tone | null {
  if (!status) return null;
  if (isTrustState(status)) return TRUST_TONE[status];
  if (isPipelineStatus(status)) return PIPELINE_STATUS[status].tone;
  return "muted";
}

interface FlowNodeData {
  node: LineageNode;
  focused: boolean;
  selected: boolean;
}

function FlowNode({ data }: NodeProps<FlowNodeData>): ReactElement {
  const { node } = data;
  const tone = statusTone(node.status);
  const Icon = KIND_ICON[node.kind] ?? Layers;
  const broken = tone === "bad" || tone === "warn";
  return (
    <div
      className={cn(
        "relative flex w-[230px] items-center gap-2 rounded-xs border bg-ink-100 px-3 py-2 shadow-sm",
        data.selected ? "border-brand" : data.focused ? "border-brand/60" : broken ? (tone === "bad" ? "border-red-500/60" : "border-amber-500/60") : "border-ink-500",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-ink-600" />
      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-xs border", tone ? TONE_CLASS[tone] : "border-ink-500 bg-ink-200 text-paper-muted")}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">{humanize(node.kind)}{node.status ? ` · ${node.status}` : ""}</div>
        <div className="truncate font-mono text-[11px] text-paper" title={node.label}>{node.label}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-ink-600" />
    </div>
  );
}

const nodeTypes = { obsNode: FlowNode };

/** Left-to-right dagre layout. */
export function layoutGraph(nodes: LineageNode[], edges: LineageEdge[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 90 });
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    out.set(n.id, { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 });
  }
  return out;
}

function toFlow(graph: LineageGraph, focus: string | null, selected: string | null): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const positions = layoutGraph(graph.nodes, graph.edges);
  const broken = new Set(graph.nodes.filter((n) => {
    const t = statusTone(n.status);
    return t === "bad" || t === "warn";
  }).map((n) => n.id));
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: "obsNode",
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      data: { node: n, focused: n.id === focus, selected: n.id === selected },
    })),
    edges: graph.edges.map((e) => {
      const hot = broken.has(e.source);
      const color = hot ? "#f87171" : "#71717a";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        animated: hot,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: 1.4 },
        label: e.columns.length > 0 ? `${e.columns.length} col` : undefined,
        labelStyle: { fill: "#a1a1aa", fontSize: 9, fontFamily: "Geist Mono, monospace" },
        labelBgStyle: { fill: "transparent" },
      };
    }),
  };
}

function NodePanel({ graph, nodeId, onClose, onFocus }: { graph: LineageGraph; nodeId: string; onClose: () => void; onFocus: (id: string) => void }): ReactElement | null {
  const navigate = useNavigate();
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const table = parseTableNode(node.id);
  const incoming = graph.edges.filter((e) => e.target === node.id);
  const outgoing = graph.edges.filter((e) => e.source === node.id);
  const tone = statusTone(node.status);
  return (
    <aside className="absolute right-3 top-3 z-10 max-h-[calc(100%-1.5rem)] w-72 overflow-y-auto rounded-xs border border-ink-500 bg-ink-100 p-3" aria-label="Node details">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={OBS_LABEL}>{humanize(node.kind)}</p>
          <p className="break-all font-mono text-[12px] text-paper">{node.label}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close details" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
      </div>
      {node.status && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusPill tone={tone ?? "muted"}>{node.status}</StatusPill>
          {node.statusReason && <span className="text-[11px] text-paper-muted">{node.statusReason}</span>}
        </div>
      )}
      <dl className="mt-3 space-y-2 text-[11px]">
        <div><dt className={OBS_LABEL}>Upstream · {incoming.length}</dt><dd className="mt-1 space-y-0.5">{incoming.slice(0, 8).map((e) => <p key={e.id} className="truncate font-mono text-paper-muted">{humanize(e.kind)} ← {graph.nodes.find((n) => n.id === e.source)?.label ?? e.source}</p>)}</dd></div>
        <div><dt className={OBS_LABEL}>Downstream · {outgoing.length}</dt><dd className="mt-1 space-y-0.5">{outgoing.slice(0, 8).map((e) => <p key={e.id} className="truncate font-mono text-paper-muted">{humanize(e.kind)} → {graph.nodes.find((n) => n.id === e.target)?.label ?? e.target}</p>)}</dd></div>
        {[...incoming, ...outgoing].some((e) => e.columns.length > 0) && (
          <div>
            <dt className={OBS_LABEL}>Columns</dt>
            <dd className="mt-1 flex flex-wrap gap-1">{[...new Set([...incoming, ...outgoing].flatMap((e) => e.columns))].slice(0, 24).map((c) => <span key={c} className="rounded-xs border border-ink-500 px-1.5 py-px font-mono text-[10px] text-paper-muted">{c}</span>)}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => onFocus(node.id)}>Focus here</Button>
        {table && <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => navigate(dataPaths.dataset(table.database, table.table))}><ExternalLink className="mr-1 h-3 w-3" /> Dataset</Button>}
      </div>
    </aside>
  );
}

function Graph({ graph, focus, onFocus }: { graph: LineageGraph; focus: string | null; onFocus: (id: string) => void }): ReactElement {
  const [selected, setSelected] = useState<string | null>(focus);
  const { fitView } = useReactFlow();
  useEffect(() => setSelected(focus), [focus]);
  const flow = useMemo(() => toFlow(graph, focus, selected), [graph, focus, selected]);
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 200 }), 30);
    return () => clearTimeout(t);
  }, [graph, fitView]);
  const onNodeClick = useCallback((_: unknown, node: Node) => setSelected(node.id), []);
  return (
    <div className="relative h-full min-h-[460px] w-full">
      <ReactFlow nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} onPaneClick={() => setSelected(null)} fitView minZoom={0.1} proOptions={{ hideAttribution: true }} nodesConnectable={false}>
        <Background color="var(--chart-grid)" gap={18} />
        <Controls showInteractive={false} className="!rounded-xs !border !border-ink-500 !bg-ink-100 [&_button]:!border-ink-500 [&_button]:!bg-ink-100 [&_button]:!fill-paper-muted" />
      </ReactFlow>
      {selected && <NodePanel graph={graph} nodeId={selected} onClose={() => setSelected(null)} onFocus={onFocus} />}
    </div>
  );
}

export function LineageTab(): ReactElement {
  const [params, setParams] = useSearchParams();
  const focus = params.get("node");
  const [depth, setDepth] = useState(3);
  const [direction, setDirection] = useState<"up" | "down" | "both">("both");
  const [search, setSearch] = useState("");
  const datasets = useDatasets(search);
  const lineage = useLineage(focus, depth, direction);

  const setFocus = (node: string | null): void => {
    const next = new URLSearchParams(params);
    if (node) next.set("node", node);
    else next.delete("node");
    setParams(next, { replace: false });
  };

  const options = (datasets.data ?? []).slice(0, 8);

  return (
    <div className="flex h-full min-h-[560px] flex-col gap-3" data-onboarding-id="data-lineage">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-64 flex-1">
          <label htmlFor="lineage-search" className={OBS_LABEL}>Focus table</label>
          <Search className="absolute bottom-2.5 left-2.5 h-3.5 w-3.5 text-paper-faint" aria-hidden />
          <Input id="lineage-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={focus ? nodeKind(focus) === "table" ? focus.slice(6) : focus : "Search tables…"} className="mt-1 h-9 rounded-xs pl-8 font-mono" />
          {search && options.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-xs border border-ink-500 bg-ink-100 py-1 shadow-lg" role="listbox" aria-label="Tables">
              {options.map((d) => (
                <li key={`${d.database}.${d.table}`} role="option" aria-selected={false}>
                  <button type="button" className="w-full px-3 py-1.5 text-left font-mono text-[11px] text-paper hover:bg-ink-200" onClick={() => { setFocus(`table:${d.database}.${d.table}`); setSearch(""); }}>{d.database}.{d.table}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <span className={OBS_LABEL}>Direction</span>
          <Select value={direction} onValueChange={(v) => setDirection(v === "up" || v === "down" ? v : "both")}>
            <SelectTrigger className="mt-1 h-9 w-40 rounded-xs" aria-label="Direction"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="both">Up and downstream</SelectItem><SelectItem value="up">Upstream (sources)</SelectItem><SelectItem value="down">Downstream (blast radius)</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <span className={OBS_LABEL}>Depth</span>
          <Select value={String(depth)} onValueChange={(v) => setDepth(Number(v))}>
            <SelectTrigger className="mt-1 h-9 w-24 rounded-xs" aria-label="Depth"><SelectValue /></SelectTrigger>
            <SelectContent>{[1, 2, 3, 4, 5, 6, 8].map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {focus && <Button variant="ghost" className="h-9 rounded-xs text-[11px]" onClick={() => setFocus(null)}>Clear focus</Button>}
      </div>
      {lineage.data && (
        <p className="text-[11px] text-paper-muted">
          {lineage.data.totalNodes} nodes known · showing {lineage.data.nodes.length}{focus ? ` around ${focus.startsWith("table:") ? focus.slice(6) : focus}` : ""}{lineage.data.truncated ? " (truncated — focus a table to see all of it)" : ""}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-hidden rounded-xs border border-ink-500 bg-ink-50">
        {lineage.isLoading ? (
          <p className="p-4 text-[11px] text-paper-muted">Loading lineage…</p>
        ) : lineage.isError || !lineage.data ? (
          <div className="p-4"><ErrorState title="Lineage could not be loaded." error={lineage.error} /></div>
        ) : lineage.data.nodes.length === 0 ? (
          <EmptyState title="No lineage yet" body="Edges appear after the collector reads system.tables and query_log. Focus another table or wait for the next pass." />
        ) : (
          <ReactFlowProvider>
            <Graph graph={lineage.data} focus={focus} onFocus={setFocus} />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}
