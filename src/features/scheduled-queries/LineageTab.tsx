/**
 * Scheduled Queries → Lineage: observed-runtime data lineage for a selected job.
 *
 * Reads `system.query_log` server-side (every run is tagged with its job_id) to
 * show which tables a job actually reads and writes, and chains jobs together
 * when one job's destination table is another job's source. Selecting a table or
 * job node reveals the columns observed flowing through it (column level). The
 * job filter is the shared `JobCombobox` used by the Runs tab. House tokens only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  ControlButton,
  ReactFlowProvider,
  Position,
  Handle,
  MarkerType,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { Database, Workflow, ArrowRightLeft, X, Plus } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import type { LineageGraph, LineageJobNode, LineageTableNode } from "@/api/scheduledQueries";
import { useScheduledQueries, useJobOwners, useScheduledQueryLineage } from "./hooks";
import { JobCombobox } from "./JobCombobox";
import { formatRelative } from "./lib";

const WINDOW_OPTIONS = [7, 14, 30, 90] as const;
const NODE_WIDTH = 220;
const NODE_HEIGHT = 64;

// --- custom nodes -----------------------------------------------------------

type ExpandDir = "up" | "down";

/** Shared by both node kinds: whether more neighbours can be revealed each way. */
interface ExpandData {
  expandUp: boolean;
  expandDown: boolean;
  onExpand: (id: string, dir: ExpandDir) => void;
}

/**
 * `+` affordances on a card's edges: left reveals the next upstream level,
 * right the next downstream level. Shown only when there are hidden neighbours
 * in that direction. `nodrag` keeps the click from starting a node drag.
 */
function ExpandButtons({ id, data }: { id: string; data: ExpandData }) {
  const base =
    "nodrag absolute top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-ink-500 bg-ink-200 text-paper-muted shadow-sm hover:border-brand hover:text-paper";
  return (
    <>
      {data.expandUp && (
        <button
          type="button"
          title="Expand upstream"
          aria-label="Expand upstream"
          onClick={(e) => { e.stopPropagation(); data.onExpand(id, "up"); }}
          className={cn(base, "-left-2.5")}
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {data.expandDown && (
        <button
          type="button"
          title="Expand downstream"
          aria-label="Expand downstream"
          onClick={(e) => { e.stopPropagation(); data.onExpand(id, "down"); }}
          className={cn(base, "-right-2.5")}
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
    </>
  );
}

interface TableNodeData extends ExpandData {
  label: string;
  database: string;
  table: string;
  columnCount: number;
  produced: boolean;
  selected: boolean;
}

function TableNodeComponent({ id, data }: NodeProps<TableNodeData>) {
  return (
    <div
      className={cn(
        "relative flex min-w-[200px] max-w-[240px] items-center gap-2 rounded-xs border bg-ink-100 px-3 py-2 shadow-sm transition-colors",
        data.selected ? "border-brand" : "border-ink-500 hover:border-ink-700",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-ink-600" />
      <div className={cn("rounded-xs p-1.5", data.produced ? "bg-emerald-500/15" : "bg-blue-500/15")}>
        <Database className={cn("h-4 w-4", data.produced ? "text-emerald-400" : "text-blue-400")} />
      </div>
      <div className="min-w-0">
        <div className="truncate font-mono text-[11px] text-paper" title={data.label}>
          {data.table}
        </div>
        <div className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim">
          {data.database} · {data.columnCount} col{data.columnCount === 1 ? "" : "s"}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-ink-600" />
      <ExpandButtons id={id} data={data} />
    </div>
  );
}

interface JobNodeData extends ExpandData {
  label: string;
  outputMode: string;
  runCount: number;
  lastSeen: number | null;
  focus: boolean;
  selected: boolean;
}

function JobNodeComponent({ id, data }: NodeProps<JobNodeData>) {
  return (
    <div
      className={cn(
        "relative flex min-w-[200px] max-w-[240px] items-center gap-2 rounded-xs border-2 bg-ink-200 px-3 py-2 shadow-sm transition-colors",
        data.selected ? "border-brand" : data.focus ? "border-amber-400" : "border-ink-600 hover:border-ink-700",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-ink-600" />
      <div className="rounded-xs bg-amber-500/15 p-1.5">
        <Workflow className="h-4 w-4 text-amber-400" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-semibold text-paper" title={data.label}>
          {data.label}
        </div>
        <div className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim">
          {data.outputMode} · {data.runCount} run{data.runCount === 1 ? "" : "s"}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-ink-600" />
      <ExpandButtons id={id} data={data} />
    </div>
  );
}

const nodeTypes = { tableNode: TableNodeComponent, jobNode: JobNodeComponent };

// --- graph → ReactFlow ------------------------------------------------------

function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 80 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });
}

interface FlowContext {
  visibleIds: Set<string>;
  canExpandUp: (id: string) => boolean;
  canExpandDown: (id: string) => boolean;
  onExpand: (id: string, dir: ExpandDir) => void;
  selectedId: string | null;
}

function toFlow(graph: LineageGraph, ctx: FlowContext): { nodes: Node[]; edges: Edge[] } {
  const expand = (id: string): ExpandData => ({
    expandUp: ctx.canExpandUp(id),
    expandDown: ctx.canExpandDown(id),
    onExpand: ctx.onExpand,
  });

  const nodes: Node[] = graph.nodes
    .filter((node) => ctx.visibleIds.has(node.id))
    .map((node) => {
      if (node.kind === "table") {
        const data: TableNodeData = {
          ...expand(node.id),
          label: node.label,
          database: node.database,
          table: node.table,
          columnCount: node.columns.length,
          produced: node.produced,
          selected: node.id === ctx.selectedId,
        };
        return { id: node.id, type: "tableNode", data, position: { x: 0, y: 0 } };
      }
      const data: JobNodeData = {
        ...expand(node.id),
        label: node.label,
        outputMode: node.outputMode,
        runCount: node.runCount,
        lastSeen: node.lastSeen,
        focus: node.focus,
        selected: node.id === ctx.selectedId,
      };
      return { id: node.id, type: "jobNode", data, position: { x: 0, y: 0 } };
    });

  const edges: Edge[] = graph.edges
    .filter((edge) => ctx.visibleIds.has(edge.from) && ctx.visibleIds.has(edge.to))
    .map((edge) => {
    const isWrite = edge.kind === "write";
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: isWrite ? "#34d399" : "#60a5fa" },
      label: edge.columns.length > 0 ? `${edge.columns.length}` : undefined,
      labelStyle: { fill: "#a1a1aa", fontSize: 9, fontFamily: "monospace" },
      labelBgStyle: { fill: "#18181b" },
      style: { stroke: isWrite ? "#34d399" : "#60a5fa", strokeWidth: 1.5 },
    };
  });

  return { nodes: layout(nodes, edges), edges };
}

// --- detail panel -----------------------------------------------------------

function DetailPanel({ graph, selectedId, onClose }: { graph: LineageGraph; selectedId: string; onClose: () => void }) {
  const node = graph.nodes.find((n) => n.id === selectedId);
  if (!node) return null;

  return (
    <div className="absolute right-3 top-3 z-10 max-h-[calc(100%-1.5rem)] w-64 overflow-y-auto rounded-xs border border-ink-500 bg-ink-100 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {node.kind === "table" ? (
            <Database className="h-3.5 w-3.5 text-blue-400" />
          ) : (
            <Workflow className="h-3.5 w-3.5 text-amber-400" />
          )}
          <span className="font-mono text-[11px] text-paper" title={node.label}>{node.label}</span>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-paper-dim hover:text-paper">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {node.kind === "table" ? (
        <TableDetail node={node} />
      ) : (
        <JobDetail node={node} graph={graph} />
      )}
    </div>
  );
}

function TableDetail({ node }: { node: LineageTableNode }) {
  return (
    <>
      <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">
        {node.produced ? "Produced by a job" : "Source table"} · {node.columns.length} columns observed
      </p>
      {node.columns.length === 0 ? (
        <p className="text-[11px] text-paper-muted">No column detail observed.</p>
      ) : (
        <ul className="space-y-0.5">
          {node.columns.map((col) => (
            <li key={col} className="truncate font-mono text-[11px] text-paper-muted" title={col}>{col}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function JobDetail({ node, graph }: { node: LineageJobNode; graph: LineageGraph }) {
  const reads = graph.edges.filter((e) => e.to === node.id && e.kind === "read");
  const writes = graph.edges.filter((e) => e.from === node.id && e.kind === "write");
  const labelOf = (id: string): string => graph.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <>
      <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">
        {node.outputMode} · {node.runCount} run{node.runCount === 1 ? "" : "s"} · last {formatRelative(node.lastSeen)}
      </p>
      {reads.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-blue-400">Reads</p>
          <ul className="space-y-0.5">
            {reads.map((e) => (
              <li key={e.id} className="truncate font-mono text-[11px] text-paper-muted" title={labelOf(e.from)}>
                {labelOf(e.from)} <span className="text-paper-faint">({e.columns.length})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {writes.length > 0 && (
        <div>
          <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-400">Writes</p>
          <ul className="space-y-0.5">
            {writes.map((e) => (
              <li key={e.id} className="truncate font-mono text-[11px] text-paper-muted" title={labelOf(e.to)}>
                {labelOf(e.to)} <span className="text-paper-faint">({e.columns.length})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// --- graph canvas -----------------------------------------------------------

function LineageCanvas({ graph }: { graph: LineageGraph }) {
  const focusId = `job:${graph.focusJobId}`;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Per-direction expansion frontier. The focus starts expanded both ways, so
  // its immediate upstream + downstream neighbours show by default.
  const [expandedUp, setExpandedUp] = useState<Set<string>>(() => new Set([focusId]));
  const [expandedDown, setExpandedDown] = useState<Set<string>>(() => new Set([focusId]));
  const { fitView } = useReactFlow();

  // Directed adjacency: down = edge from→to, up = its reverse.
  const { upstream, downstream } = useMemo(() => {
    const up = new Map<string, Set<string>>();
    const down = new Map<string, Set<string>>();
    for (const node of graph.nodes) {
      up.set(node.id, new Set());
      down.set(node.id, new Set());
    }
    for (const edge of graph.edges) {
      down.get(edge.from)?.add(edge.to);
      up.get(edge.to)?.add(edge.from);
    }
    return { upstream: up, downstream: down };
  }, [graph]);

  // Reset the frontier whenever a new graph (job/window) loads.
  useEffect(() => {
    setExpandedUp(new Set([focusId]));
    setExpandedDown(new Set([focusId]));
    setSelectedId(null);
  }, [graph, focusId]);

  // Visible set = closure from the focus, following only expanded directions.
  const visibleIds = useMemo(() => {
    const visible = new Set<string>([focusId]);
    const queue = [focusId];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (expandedUp.has(node)) {
        for (const u of upstream.get(node) ?? []) if (!visible.has(u)) { visible.add(u); queue.push(u); }
      }
      if (expandedDown.has(node)) {
        for (const d of downstream.get(node) ?? []) if (!visible.has(d)) { visible.add(d); queue.push(d); }
      }
    }
    return visible;
  }, [focusId, expandedUp, expandedDown, upstream, downstream]);

  const onExpand = useCallback((id: string, dir: ExpandDir) => {
    const setter = dir === "up" ? setExpandedUp : setExpandedDown;
    setter((prev) => new Set(prev).add(id));
  }, []);

  const canExpandUp = useCallback(
    (id: string) => [...(upstream.get(id) ?? [])].some((u) => !visibleIds.has(u)),
    [upstream, visibleIds],
  );
  const canExpandDown = useCallback(
    (id: string) => [...(downstream.get(id) ?? [])].some((d) => !visibleIds.has(d)),
    [downstream, visibleIds],
  );

  const { nodes, edges } = useMemo(
    () => toFlow(graph, { visibleIds, canExpandUp, canExpandDown, onExpand, selectedId }),
    [graph, visibleIds, canExpandUp, canExpandDown, onExpand, selectedId],
  );

  // Re-fit on first render and after each expansion (when the visible set grows).
  useEffect(() => {
    const id = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
    return () => clearTimeout(id);
  }, [visibleIds, fitView]);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => setSelectedId((prev) => (prev === node.id ? null : node.id))}
        onPaneClick={() => setSelectedId(null)}
        nodesConnectable={false}
        nodesDraggable
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
      >
        <Background gap={12} size={1} color="#27272a" />
        <Controls
          className="rounded-xs border-ink-500 bg-ink-100 text-paper fill-paper [&>button]:!border-ink-500 [&>button]:!bg-ink-100 [&>button:hover]:!bg-ink-200 [&_path]:!fill-paper"
          showInteractive={false}
        >
          <ControlButton onClick={() => fitView({ padding: 0.2, duration: 300 })} title="Fit view">
            <ArrowRightLeft />
          </ControlButton>
        </Controls>
      </ReactFlow>
      {selectedId && <DetailPanel graph={graph} selectedId={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  );
}

// --- tab --------------------------------------------------------------------

export function LineageTab({ selectedJobId }: { selectedJobId?: string }) {
  const { data: jobs } = useScheduledQueries();
  const { hasPermission } = useRbacStore();
  const canViewAll = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_VIEW_ALL);
  const { options: ownerOptions } = useJobOwners(jobs, canViewAll);

  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [jobId, setJobId] = useState<string>("");
  const [windowDays, setWindowDays] = useState<number>(14);

  const jobOptions = (jobs ?? []).filter((j) => ownerFilter === "all" || j.createdBy === ownerFilter);

  useEffect(() => {
    if (selectedJobId) {
      setJobId(selectedJobId);
      return;
    }
    if (jobOptions.length === 0) return;
    if (!jobId || !jobOptions.some((j) => j.id === jobId)) setJobId(jobOptions[0].id);
  }, [selectedJobId, jobOptions, jobId]);

  const { data: graph, isLoading, isError } = useScheduledQueryLineage(jobId, windowDays, Boolean(jobId));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {canViewAll && (
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="h-9 w-[170px] rounded-xs"><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {ownerOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <JobCombobox jobs={jobOptions} value={jobId} onChange={setJobId} />
        <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
          <SelectTrigger className="h-9 w-36 rounded-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WINDOW_OPTIONS.map((d) => <SelectItem key={d} value={String(d)}>Last {d} days</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xs border border-ink-500 bg-ink-50">
        {!jobId ? (
          <Centered>Select a job to view its lineage.</Centered>
        ) : isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xs" />)}</div>
        ) : isError ? (
          <Centered>Failed to load lineage.</Centered>
        ) : !graph || graph.nodes.length === 0 ? (
          <Centered>{graph?.note ?? "No lineage observed for this job yet."}</Centered>
        ) : (
          <ReactFlowProvider>
            <LineageCanvas graph={graph} />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-paper-muted">
      {children}
    </div>
  );
}
