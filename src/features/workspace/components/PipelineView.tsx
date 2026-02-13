import React, { useMemo, useCallback, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ControlButton,
  Edge,
  Node,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Position,
  Handle,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { cn } from '@/lib/utils';
import {
  Database,
  Filter,
  Calculator,
  ArrowUpDown,
  Combine,
  Merge,
  Split,
  Cpu,
  Layers,
  CircleDot,
  Network,
  HardDrive,
  Zap,
  Workflow,
  Shuffle,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import ExplainInfoHeader from './ExplainInfoHeader';

interface PipelineViewProps {
  content: string | null | undefined;
}

interface PipelineStage {
  id: string;
  name: string;
  fullLine: string;
  parallelism?: number;
  isParallel: boolean;
  children: PipelineStage[];
  parentId?: string;
}

type StageCategory = 'read' | 'filter' | 'aggregate' | 'sort' | 'join' | 'merge' | 'parallel' | 'expression' | 'limit' | 'distinct' | 'network' | 'buffer' | 'other';

interface StageStyle {
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.FC<{ className?: string; style?: React.CSSProperties }>;
  label: string;
}

const STAGE_STYLES: Record<StageCategory, StageStyle> = {
  read: { color: '#3b82f6', bgColor: '#3b82f620', borderColor: '#3b82f650', icon: Database, label: 'Data Source' },
  filter: { color: '#eab308', bgColor: '#eab30820', borderColor: '#eab30850', icon: Filter, label: 'Filter' },
  aggregate: { color: '#a855f7', bgColor: '#a855f720', borderColor: '#a855f750', icon: Calculator, label: 'Aggregation' },
  sort: { color: '#f97316', bgColor: '#f9731620', borderColor: '#f9731650', icon: ArrowUpDown, label: 'Sort' },
  join: { color: '#ec4899', bgColor: '#ec489920', borderColor: '#ec489950', icon: Combine, label: 'Join' },
  merge: { color: '#06b6d4', bgColor: '#06b6d420', borderColor: '#06b6d450', icon: Merge, label: 'Merge' },
  parallel: { color: '#22c55e', bgColor: '#22c55e20', borderColor: '#22c55e50', icon: Split, label: 'Parallel' },
  expression: { color: '#6366f1', bgColor: '#6366f120', borderColor: '#6366f150', icon: Cpu, label: 'Expression' },
  limit: { color: '#14b8a6', bgColor: '#14b8a620', borderColor: '#14b8a650', icon: Layers, label: 'Limit' },
  distinct: { color: '#f43f5e', bgColor: '#f43f5e20', borderColor: '#f43f5e50', icon: CircleDot, label: 'Distinct' },
  network: { color: '#8b5cf6', bgColor: '#8b5cf620', borderColor: '#8b5cf650', icon: Network, label: 'Network' },
  buffer: { color: '#f59e0b', bgColor: '#f59e0b20', borderColor: '#f59e0b50', icon: HardDrive, label: 'Buffer' },
  other: { color: '#71717a', bgColor: '#71717a20', borderColor: '#71717a50', icon: Workflow, label: 'Other' },
};

// Get category from stage name
function getStageCategory(name: string): StageCategory {
  const n = name.toLowerCase();

  if (n.includes('read') || n.includes('source') || n.includes('mergetree') || n.includes('numbers')) return 'read';
  if (n.includes('filter') || n.includes('where') || n.includes('prewhere')) return 'filter';
  if (n.includes('aggregat') || n.includes('group')) return 'aggregate';
  if (n.includes('sort') || n.includes('order') || n.includes('partialsort')) return 'sort';
  if (n.includes('join') || n.includes('hash')) return 'join';
  if (n.includes('union') || n.includes('merge') || n.includes('concat')) return 'merge';
  if (n.includes('resize') || n.includes('parallel') || n.includes('strictresize')) return 'parallel';
  if (n.includes('express') || n.includes('transform') || n.includes('project')) return 'expression';
  if (n.includes('limit') || n.includes('offset')) return 'limit';
  if (n.includes('distinct')) return 'distinct';
  if (n.includes('exchange') || n.includes('remote') || n.includes('cluster')) return 'network';
  if (n.includes('buffer') || n.includes('materialize') || n.includes('lazy')) return 'buffer';

  return 'other';
}

// Parse pipeline text content into structured stages
function parsePipelineContent(content: string): PipelineStage[] {
  const lines = content.split('\n').filter(line => line.trim());
  const stages: PipelineStage[] = [];
  const stack: { stage: PipelineStage; indent: number }[] = [];
  let idCounter = 0;

  for (const line of lines) {
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Extract parallelism marker (e.g., "× 4" or "x 4")
    const parallelMatch = trimmed.match(/[×x]\s*(\d+)/);
    const parallelism = parallelMatch ? parseInt(parallelMatch[1]) : undefined;

    // Clean the stage name
    let name = trimmed
      .replace(/[×x]\s*\d+/, '')
      .replace(/\s+$/, '')
      .replace(/\(.*\)$/, '')
      .trim();

    const stage: PipelineStage = {
      id: `pipeline-${idCounter++}`,
      name,
      fullLine: trimmed,
      parallelism,
      isParallel: parallelism !== undefined && parallelism > 1,
      children: [],
    };

    // Find parent based on indentation
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length > 0) {
      stage.parentId = stack[stack.length - 1].stage.id;
      stack[stack.length - 1].stage.children.push(stage);
    } else {
      stages.push(stage);
    }

    stack.push({ stage, indent });
  }

  return stages;
}

// Custom Pipeline Node Component
const PipelineNodeComponent = ({ data }: { data: { name: string; parallelism?: number; isParallel: boolean; category: StageCategory } }) => {
  const style = STAGE_STYLES[data.category];
  const Icon = style.icon;

  return (
    <div
      className={cn(
        "px-4 py-3 rounded-lg border min-w-[180px] max-w-[260px] shadow-lg relative",
        "transition-all duration-200 hover:shadow-xl"
      )}
      style={{
        backgroundColor: style.bgColor,
        borderColor: data.isParallel ? '#22c55e' : style.borderColor,
        borderWidth: data.isParallel ? 2 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-zinc-500 !w-2 !h-2" />

      {/* Parallel badge */}
      {data.isParallel && data.parallelism && (
        <div className="absolute -top-2.5 -right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500 text-white text-[10px] font-bold shadow-md">
          <Shuffle className="w-2.5 h-2.5" />
          {data.parallelism}×
        </div>
      )}

      {/* Node content */}
      <div className="flex items-center gap-2">
        <div
          className="p-1.5 rounded-md flex-shrink-0"
          style={{ backgroundColor: `${style.color}30` }}
        >
          <Icon className="h-4 w-4" style={{ color: style.color }} />
        </div>
        <div className="min-w-0">
          <div
            className="font-semibold text-xs truncate"
            style={{ color: style.color }}
            title={data.name}
          >
            {data.name || 'Unknown'}
          </div>
          <div className="text-[10px] text-zinc-500">
            {style.label}
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!bg-zinc-500 !w-2 !h-2" />
    </div>
  );
};

const nodeTypes = {
  pipelineNode: PipelineNodeComponent,
};

// Layout graph using dagre with left-to-right direction
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 40,
    ranksep: 60,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 200, height: 70 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const newNode = { ...node };

    newNode.targetPosition = isHorizontal ? Position.Left : Position.Top;
    newNode.sourcePosition = isHorizontal ? Position.Right : Position.Bottom;

    newNode.position = {
      x: nodeWithPosition.x - 100,
      y: nodeWithPosition.y - 35,
    };

    return newNode;
  });

  return { nodes: newNodes, edges };
};

// Transform pipeline stages to ReactFlow nodes and edges
function transformPipelineToGraph(stages: PipelineStage[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const processStage = (stage: PipelineStage) => {
    const category = getStageCategory(stage.name);
    const style = STAGE_STYLES[category];

    nodes.push({
      id: stage.id,
      type: 'pipelineNode',
      data: {
        name: stage.name,
        parallelism: stage.parallelism,
        isParallel: stage.isParallel,
        category,
      },
      position: { x: 0, y: 0 },
    });

    // Create edge from parent to this node (data flows from parent to child)
    if (stage.parentId) {
      edges.push({
        id: `edge-${stage.parentId}-${stage.id}`,
        source: stage.parentId,
        target: stage.id,
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
        animated: stage.isParallel,
        style: {
          stroke: stage.isParallel ? '#22c55e' : style.color,
          strokeWidth: stage.isParallel ? 2 : 1.5,
        },
      });
    }

    // Process children
    stage.children.forEach(processStage);
  };

  stages.forEach(processStage);

  return { nodes, edges };
}

// Legend component
const Legend: React.FC = () => {
  const categories: StageCategory[] = ['read', 'filter', 'aggregate', 'sort', 'join', 'merge', 'expression', 'parallel'];

  return (
    <div className="absolute top-3 left-3 bg-zinc-900/90 border border-zinc-800 rounded-lg p-2 z-10 backdrop-blur-sm">
      <div className="text-[10px] font-semibold text-zinc-400 mb-2">Stage Types</div>
      <div className="flex flex-wrap gap-2 max-w-[300px]">
        {categories.map((category) => {
          const style = STAGE_STYLES[category];
          return (
            <div key={category} className="flex items-center gap-1.5">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: style.color }}
              />
              <span className="text-[9px] text-zinc-400">{style.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Stats panel
const StatsPanel: React.FC<{ stages: PipelineStage[] }> = ({ stages }) => {
  const stats = useMemo(() => {
    let total = 0;
    let parallel = 0;
    let maxParallelism = 0;

    const countStages = (stageList: PipelineStage[]) => {
      for (const stage of stageList) {
        total++;
        if (stage.isParallel) {
          parallel++;
          if (stage.parallelism && stage.parallelism > maxParallelism) {
            maxParallelism = stage.parallelism;
          }
        }
        countStages(stage.children);
      }
    };

    countStages(stages);

    return { total, parallel, maxParallelism };
  }, [stages]);

  return (
    <div className="absolute top-3 right-3 bg-zinc-900/90 border border-zinc-800 rounded-lg p-3 z-10 backdrop-blur-sm">
      <div className="flex gap-4 text-xs">
        <div className="text-center">
          <div className="text-lg font-bold text-zinc-300">{stats.total}</div>
          <div className="text-[10px] text-zinc-500">Stages</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-green-400">{stats.parallel}</div>
          <div className="text-[10px] text-zinc-500">Parallel</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-blue-400">{stats.maxParallelism}×</div>
          <div className="text-[10px] text-zinc-500">Max</div>
        </div>
      </div>
    </div>
  );
};

// Inner component that uses useReactFlow hook
const PipelineViewInner: React.FC<{ content: string; stages: PipelineStage[] }> = ({ content, stages }) => {
  const [copied, setCopied] = useState(false);
  const { fitView } = useReactFlow();

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (stages.length === 0) return { nodes: [], edges: [] };
    const { nodes, edges } = transformPipelineToGraph(stages);
    return getLayoutedElements(nodes, edges, 'LR');
  }, [stages]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onLayout = useCallback((direction: string) => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      direction
    );
    setNodes([...layoutedNodes]);
    setEdges([...layoutedEdges]);

    // Fit view after layout with a small delay to ensure nodes are positioned
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 300 });
    }, 50);
  }, [nodes, edges, setNodes, setEdges, fitView]);

  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleCopy = async () => {
    if (content) {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <Legend />
      <StatsPanel stages={stages} />

      {/* Copy button */}
      <div className="absolute bottom-3 right-3 z-10">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs bg-zinc-900/90 border-zinc-800 hover:bg-zinc-800"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 mr-1 text-green-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 mr-1" />
              Copy Raw
            </>
          )}
        </Button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={12} size={1} color="#27272a" />
        <Controls
          className="bg-zinc-900 border-zinc-800 text-zinc-100 fill-zinc-100 [&>button]:!bg-zinc-900 [&>button]:!border-zinc-800 [&>button:hover]:!bg-zinc-800 [&_path]:!fill-zinc-100"
        >
          <ControlButton onClick={() => onLayout('LR')} title="Horizontal Layout">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </ControlButton>
          <ControlButton onClick={() => onLayout('TB')} title="Vertical Layout">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
          </ControlButton>
        </Controls>
      </ReactFlow>
    </>
  );
};

const PipelineView: React.FC<PipelineViewProps> = ({ content }) => {
  const stages = useMemo(() => {
    if (!content) return [];
    return parsePipelineContent(content);
  }, [content]);

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No pipeline data available.
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <ExplainInfoHeader type="pipeline" />
      <div className="flex-1 bg-zinc-950/50 backdrop-blur-sm relative">
        <ReactFlowProvider>
          <PipelineViewInner content={content} stages={stages} />
        </ReactFlowProvider>
      </div>
    </div>
  );
};

export default PipelineView;
