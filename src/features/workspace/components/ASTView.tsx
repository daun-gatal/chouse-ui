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
  Table2,
  Columns3,
  Filter,
  ArrowUpDown,
  Code2,
  Hash,
  Type,
  Brackets,
  FileCode,
  Star,
  Binary,
  FunctionSquare,
  Copy,
  Check,
  ListTree,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import ExplainInfoHeader from './ExplainInfoHeader';

interface ASTViewProps {
  content: string | null | undefined;
}

interface ASTNode {
  id: string;
  type: string;
  name?: string;
  value?: string;
  children: ASTNode[];
  parentId?: string;
  line: string;
}

type ASTCategory = 'query' | 'table' | 'column' | 'filter' | 'sort' | 'function' | 'literal' | 'string' | 'list' | 'expression' | 'identifier' | 'other';

interface ASTStyle {
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.FC<{ className?: string }>;
  label: string;
}

const AST_STYLES: Record<ASTCategory, ASTStyle> = {
  query: { color: '#3b82f6', bgColor: '#3b82f620', borderColor: '#3b82f650', icon: Database, label: 'Query' },
  table: { color: '#22c55e', bgColor: '#22c55e20', borderColor: '#22c55e50', icon: Table2, label: 'Table' },
  column: { color: '#a855f7', bgColor: '#a855f720', borderColor: '#a855f750', icon: Columns3, label: 'Column' },
  filter: { color: '#eab308', bgColor: '#eab30820', borderColor: '#eab30850', icon: Filter, label: 'Filter' },
  sort: { color: '#f97316', bgColor: '#f9731620', borderColor: '#f9731650', icon: ArrowUpDown, label: 'Sort' },
  function: { color: '#06b6d4', bgColor: '#06b6d420', borderColor: '#06b6d450', icon: FunctionSquare, label: 'Function' },
  literal: { color: '#ec4899', bgColor: '#ec489920', borderColor: '#ec489950', icon: Hash, label: 'Literal' },
  string: { color: '#10b981', bgColor: '#10b98120', borderColor: '#10b98150', icon: Type, label: 'String' },
  list: { color: '#6366f1', bgColor: '#6366f120', borderColor: '#6366f150', icon: Brackets, label: 'List' },
  expression: { color: '#8b5cf6', bgColor: '#8b5cf620', borderColor: '#8b5cf650', icon: Code2, label: 'Expression' },
  identifier: { color: '#14b8a6', bgColor: '#14b8a620', borderColor: '#14b8a650', icon: FileCode, label: 'Identifier' },
  other: { color: '#71717a', bgColor: '#71717a20', borderColor: '#71717a50', icon: Binary, label: 'Other' },
};

// Get category from AST node type
function getASTCategory(type: string): ASTCategory {
  const t = type.toLowerCase();

  if (t.includes('select') || t.includes('query')) return 'query';
  if (t.includes('table') || t.includes('database')) return 'table';
  if (t.includes('column') || t.includes('asterisk')) return 'column';
  if (t.includes('where') || t.includes('filter') || t.includes('prewhere') || t.includes('having')) return 'filter';
  if (t.includes('order') || t.includes('sort')) return 'sort';
  if (t.includes('function') || t.includes('aggregate')) return 'function';
  if (t.includes('literal') || t.includes('number') || t.includes('int') || t.includes('float')) return 'literal';
  if (t.includes('string')) return 'string';
  if (t.includes('list') || t.includes('array') || t.includes('tuple')) return 'list';
  if (t.includes('expression') || t.includes('binary') || t.includes('unary')) return 'expression';
  if (t.includes('identifier')) return 'identifier';

  return 'other';
}

// Parse AST text output into structured nodes
function parseASTContent(content: string): ASTNode[] {
  const lines = content.split('\n').filter(line => line.trim());
  const nodes: ASTNode[] = [];
  const stack: { node: ASTNode; indent: number }[] = [];
  let idCounter = 0;

  for (const line of lines) {
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Parse node type and optional name/value
    const match = trimmed.match(/^(\w+)(?:\s+(.*))?$/);
    const type = match?.[1] || trimmed;
    const rest = match?.[2] || '';

    const node: ASTNode = {
      id: `ast-${idCounter++}`,
      type,
      name: rest.includes('(') ? rest.split('(')[0].trim() : rest || undefined,
      value: rest.includes('(') ? rest.match(/\((.*)\)/)?.[1] : undefined,
      children: [],
      line: trimmed
    };

    // Find parent based on indentation
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length > 0) {
      node.parentId = stack[stack.length - 1].node.id;
      stack[stack.length - 1].node.children.push(node);
    } else {
      nodes.push(node);
    }

    stack.push({ node, indent });
  }

  return nodes;
}

// Custom AST Node Component
const ASTNodeComponent = ({ data }: { data: { type: string; name?: string; value?: string; category: ASTCategory } }) => {
  const style = AST_STYLES[data.category];
  const Icon = style.icon;

  return (
    <div
      className={cn(
        "px-3 py-2 rounded-lg border min-w-[120px] max-w-[200px] shadow-lg relative",
        "transition-all duration-200 hover:shadow-xl"
      )}
      style={{
        backgroundColor: style.bgColor,
        borderColor: style.borderColor,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-500 !w-2 !h-2" />

      {/* Node content */}
      <div className="flex items-center gap-2">
        <div
          className="p-1 rounded-md flex-shrink-0"
          style={{ backgroundColor: `${style.color}30` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: style.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="font-semibold text-[11px] truncate"
            style={{ color: style.color }}
            title={data.type}
          >
            {data.type}
          </div>
          {(data.name || data.value) && (
            <div className="text-[9px] text-zinc-400 truncate" title={data.name || data.value}>
              {data.name || data.value}
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500 !w-2 !h-2" />
    </div>
  );
};

const nodeTypes = {
  astNode: ASTNodeComponent,
};

// Layout graph using dagre with top-to-bottom direction (tree layout)
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 30,
    ranksep: 50,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 150, height: 55 });
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
      x: nodeWithPosition.x - 75,
      y: nodeWithPosition.y - 27,
    };

    return newNode;
  });

  return { nodes: newNodes, edges };
};

// Transform AST nodes to ReactFlow nodes and edges
function transformASTToGraph(astNodes: ASTNode[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const processNode = (astNode: ASTNode) => {
    const category = getASTCategory(astNode.type);
    const style = AST_STYLES[category];

    nodes.push({
      id: astNode.id,
      type: 'astNode',
      data: {
        type: astNode.type,
        name: astNode.name,
        value: astNode.value,
        category,
      },
      position: { x: 0, y: 0 },
    });

    // Create edge from parent to this node
    if (astNode.parentId) {
      edges.push({
        id: `edge-${astNode.parentId}-${astNode.id}`,
        source: astNode.parentId,
        target: astNode.id,
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
        style: {
          stroke: style.color,
          strokeWidth: 1.5,
        },
      });
    }

    // Process children
    astNode.children.forEach(processNode);
  };

  astNodes.forEach(processNode);

  return { nodes, edges };
}

// Legend component
const Legend: React.FC = () => {
  const categories: ASTCategory[] = ['query', 'table', 'column', 'filter', 'function', 'expression', 'literal', 'identifier'];

  return (
    <div className="absolute top-3 left-3 bg-zinc-900/90 border border-zinc-800 rounded-lg p-2 z-10 backdrop-blur-sm">
      <div className="text-[10px] font-semibold text-zinc-400 mb-2">Node Types</div>
      <div className="flex flex-wrap gap-2 max-w-[280px]">
        {categories.map((category) => {
          const style = AST_STYLES[category];
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
const StatsPanel: React.FC<{ astNodes: ASTNode[] }> = ({ astNodes }) => {
  const stats = useMemo(() => {
    let total = 0;
    let depth = 0;

    const countNodes = (nodes: ASTNode[], currentDepth: number) => {
      for (const node of nodes) {
        total++;
        if (currentDepth > depth) depth = currentDepth;
        countNodes(node.children, currentDepth + 1);
      }
    };

    countNodes(astNodes, 1);

    return { total, depth };
  }, [astNodes]);

  return (
    <div className="absolute top-3 right-3 bg-zinc-900/90 border border-zinc-800 rounded-lg p-3 z-10 backdrop-blur-sm">
      <div className="flex gap-4 text-xs">
        <div className="text-center">
          <div className="text-lg font-bold text-zinc-300">{stats.total}</div>
          <div className="text-[10px] text-zinc-500">Nodes</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-blue-400">{stats.depth}</div>
          <div className="text-[10px] text-zinc-500">Depth</div>
        </div>
      </div>
    </div>
  );
};

// Inner component that uses useReactFlow hook
const ASTViewInner: React.FC<{ content: string; astNodes: ASTNode[] }> = ({ content, astNodes }) => {
  const [copied, setCopied] = useState(false);
  const { fitView } = useReactFlow();

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (astNodes.length === 0) return { nodes: [], edges: [] };
    const { nodes, edges } = transformASTToGraph(astNodes);
    return getLayoutedElements(nodes, edges, 'TB');
  }, [astNodes]);

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
      <StatsPanel astNodes={astNodes} />

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
          <ControlButton onClick={() => onLayout('TB')} title="Vertical Layout (Tree)">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
          </ControlButton>
          <ControlButton onClick={() => onLayout('LR')} title="Horizontal Layout">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </ControlButton>
        </Controls>
      </ReactFlow>
    </>
  );
};

const ASTView: React.FC<ASTViewProps> = ({ content }) => {
  const astNodes = useMemo(() => {
    if (!content) return [];
    return parseASTContent(content);
  }, [content]);

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No AST data available.
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <ExplainInfoHeader type="ast" />
      <div className="flex-1 bg-zinc-950/50 backdrop-blur-sm relative">
        <ReactFlowProvider>
          <ASTViewInner content={content} astNodes={astNodes} />
        </ReactFlowProvider>
      </div>
    </div>
  );
};

export default ASTView;
