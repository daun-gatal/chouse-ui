import React, { useCallback, useMemo } from 'react';
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
    GitMerge,
    Code,
    Box
} from 'lucide-react';
import { ExplainPlanNode, ExplainResult, getNodeCategory, getNodeStyle, NodeCategory, NODE_STYLES } from '@/types/explain';
import ExplainInfoHeader from './ExplainInfoHeader';

interface VisualExplainProps {
    plan: ExplainResult | null;
}

/**
 * Icon component based on node category
 */
const NodeIcon: React.FC<{ category: NodeCategory; className?: string }> = ({ category, className }) => {
    const iconProps = { size: 14, className };

    switch (category) {
        case 'read':
            return <Database {...iconProps} />;
        case 'filter':
            return <Filter {...iconProps} />;
        case 'aggregate':
            return <Calculator {...iconProps} />;
        case 'sort':
            return <ArrowUpDown {...iconProps} />;
        case 'join':
            return <GitMerge {...iconProps} />;
        case 'expression':
            return <Code {...iconProps} />;
        default:
            return <Box {...iconProps} />;
    }
};

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Helper to extract a numeric value from various possible field names
 */
function extractMetric(details: ExplainPlanNode, ...fieldNames: string[]): number | undefined {
    for (const name of fieldNames) {
        if (details[name] !== undefined && details[name] !== null) {
            return Number(details[name]);
        }
    }
    return undefined;
}

/**
 * Extract metrics from Indexes array (ClickHouse often stores read stats here)
 */
function extractIndexMetrics(details: ExplainPlanNode): { parts?: number; granules?: number; initialParts?: number; initialGranules?: number } {
    const indexes = details['Indexes'];
    if (!Array.isArray(indexes) || indexes.length === 0) {
        return {};
    }

    // Sum up metrics from all indexes, prefer "Selected" over "Initial"
    let selectedParts: number | undefined;
    let selectedGranules: number | undefined;
    let initialParts: number | undefined;
    let initialGranules: number | undefined;

    for (const idx of indexes) {
        if (idx['Selected Parts'] !== undefined) {
            selectedParts = (selectedParts || 0) + Number(idx['Selected Parts']);
        }
        if (idx['Selected Granules'] !== undefined) {
            selectedGranules = (selectedGranules || 0) + Number(idx['Selected Granules']);
        }
        if (idx['Initial Parts'] !== undefined) {
            initialParts = (initialParts || 0) + Number(idx['Initial Parts']);
        }
        if (idx['Initial Granules'] !== undefined) {
            initialGranules = (initialGranules || 0) + Number(idx['Initial Granules']);
        }
    }

    return {
        parts: selectedParts,
        granules: selectedGranules,
        initialParts,
        initialGranules
    };
}

/**
 * Custom Node for Explain Plan with color-coding
 */
const ExplainNodeComponent = ({ data }: { data: { label: string; type: string; details: ExplainPlanNode; step: number } }) => {
    // Extract potential SQL parts
    const description = data.details['Description'];
    const filter = data.details['Filter'];
    const expression = data.details['Expression'];

    // Prioritize showing description, then filter, then expression
    const sqlContent = description || filter || expression;

    // Get node category and style
    const category = getNodeCategory(data.type);
    const style = getNodeStyle(data.type);

    // Extract metrics from Indexes array if available
    const indexMetrics = extractIndexMetrics(data.details);

    // Extract metrics with fallbacks for different ClickHouse field naming conventions
    const readRows = extractMetric(data.details, 'Read Rows', 'Rows', 'Selected Rows', 'rows');
    const readBytes = extractMetric(data.details, 'Read Bytes', 'Bytes', 'Selected Bytes', 'bytes');
    const parts = extractMetric(data.details, 'Selected Parts', 'Parts', 'parts') ?? indexMetrics.parts;
    const marks = extractMetric(data.details, 'Selected Marks', 'Marks', 'marks');
    const granules = extractMetric(data.details, 'Selected Granules', 'Granules', 'granules') ?? indexMetrics.granules;

    // Check if we have any metrics to display
    const hasMetrics = readRows !== undefined || readBytes !== undefined || parts !== undefined || marks !== undefined || granules !== undefined;

    return (
        <div
            className={cn(
                "px-4 py-3 rounded-lg border min-w-[220px] max-w-[320px] shadow-lg relative",
                "transition-all duration-200 hover:shadow-xl"
            )}
            style={{
                backgroundColor: style.bgColor,
                borderColor: style.borderColor,
            }}
        >
            <Handle type="target" position={Position.Top} className="!bg-zinc-500" />

            {/* Step badge */}
            <div
                className="absolute -top-3 -right-3 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md border border-zinc-800"
                style={{ backgroundColor: style.color, color: '#fff' }}
            >
                #{data.step}
            </div>

            {/* Node header with icon */}
            <div className="flex items-center gap-2 mb-2">
                <div
                    className="p-1.5 rounded-md"
                    style={{ backgroundColor: `${style.color}20` }}
                >
                    <NodeIcon category={category} className="text-white" />
                </div>
                <div
                    className="font-semibold text-xs"
                    style={{ color: style.color }}
                >
                    {data.type}
                </div>
            </div>

            {/* Show SQL content if available */}
            {sqlContent ? (
                <div className="bg-black/30 p-2 rounded text-[10px] font-mono mb-2 overflow-x-auto whitespace-pre-wrap max-h-[120px] overflow-y-auto border border-white/10 text-zinc-300">
                    {sqlContent}
                </div>
            ) : (
                <div className="text-[10px] text-zinc-400 truncate mb-2" title={data.label}>
                    {data.label}
                </div>
            )}

            {/* Key metrics */}
            {hasMetrics && (
                <div className="flex flex-wrap gap-2 text-[9px] text-zinc-400 border-t border-white/10 pt-2 mt-1">
                    {readRows !== undefined && (
                        <span className="flex items-center gap-1 bg-black/20 px-1.5 py-0.5 rounded">
                            Rows: <span className="text-blue-400 font-medium">{readRows.toLocaleString()}</span>
                        </span>
                    )}
                    {readBytes !== undefined && (
                        <span className="flex items-center gap-1 bg-black/20 px-1.5 py-0.5 rounded">
                            Bytes: <span className="text-purple-400 font-medium">{formatBytes(readBytes)}</span>
                        </span>
                    )}
                    {parts !== undefined && (
                        <span className="flex items-center gap-1 bg-black/20 px-1.5 py-0.5 rounded">
                            Parts: <span className="text-green-400 font-medium">{parts.toLocaleString()}</span>
                        </span>
                    )}
                    {marks !== undefined && (
                        <span className="flex items-center gap-1 bg-black/20 px-1.5 py-0.5 rounded">
                            Marks: <span className="text-yellow-400 font-medium">{marks.toLocaleString()}</span>
                        </span>
                    )}
                    {granules !== undefined && (
                        <span className="flex items-center gap-1 bg-black/20 px-1.5 py-0.5 rounded">
                            Granules: <span className="text-cyan-400 font-medium">{granules.toLocaleString()}</span>
                        </span>
                    )}
                </div>
            )}
            <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
        </div>
    );
};

const nodeTypes = {
    explainNode: ExplainNodeComponent,
};

/**
 * Layout graph using dagre
 */
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    const isHorizontal = direction === 'LR';
    dagreGraph.setGraph({
        rankdir: direction,
        nodesep: 70,
        ranksep: 90
    });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: 280, height: 180 });
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
            y: nodeWithPosition.y - 40,
        };

        return newNode;
    });

    return { nodes: newNodes, edges };
};

/**
 * Transform ClickHouse Explain JSON to Nodes and Edges
 */
const transformPlanToGraph = (plan: ExplainResult): { nodes: Node[], edges: Edge[] } => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let nodeIdCounter = 0;
    let stepCounter = 1;

    const processNode = (planNode: ExplainPlanNode, parentId?: string): string => {
        const id = `node-${nodeIdCounter++}`;

        // Process children first (post-order)
        if (planNode.Plans && Array.isArray(planNode.Plans)) {
            planNode.Plans.forEach((child) => {
                processNode(child as ExplainPlanNode, id);
            });
        }

        const currentStep = stepCounter++;
        const type = planNode["Node Type"] || "Unknown";
        const style = getNodeStyle(type);

        let label = type;
        if (planNode["Description"]) label = String(planNode["Description"]);

        nodes.push({
            id,
            type: 'explainNode',
            data: {
                label,
                type,
                details: planNode,
                step: currentStep
            },
            position: { x: 0, y: 0 },
        });

        if (parentId) {
            edges.push({
                id: `edge-${id}-${parentId}`,
                source: id,
                target: parentId,
                type: 'default',
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                },
                animated: true,
                style: {
                    stroke: style.color,
                    strokeWidth: 2,
                }
            });
        }

        return id;
    };

    // Get the root plan node from ExplainResult
    // Handle different ClickHouse EXPLAIN JSON formats:
    // 1. Direct plan node: { "Node Type": "...", "Plans": [...] }
    // 2. Wrapped in Plan: { "Plan": { "Node Type": "...", "Plans": [...] } }
    // 3. Array format: [{ "Plan": {...} }] or [{ "Node Type": "..." }]
    let rootPlan = plan.plan;

    if (rootPlan) {
        // If rootPlan is an array, get the first element
        if (Array.isArray(rootPlan)) {
            rootPlan = rootPlan[0] as ExplainPlanNode;
        }

        // If the plan is wrapped in a "Plan" property, unwrap it
        if (rootPlan && typeof rootPlan === 'object' && 'Plan' in rootPlan && !('Node Type' in rootPlan)) {
            rootPlan = (rootPlan as unknown as { Plan: ExplainPlanNode }).Plan;
        }

        // Now process the node if it has a Node Type
        if (rootPlan && rootPlan["Node Type"]) {
            processNode(rootPlan);
        }
    }

    return { nodes, edges };
};

/**
 * Legend component showing node type colors
 */
const Legend: React.FC = () => {
    const categories: { category: NodeCategory; label: string }[] = [
        { category: 'read', label: 'Read' },
        { category: 'filter', label: 'Filter' },
        { category: 'aggregate', label: 'Aggregate' },
        { category: 'sort', label: 'Sort' },
        { category: 'join', label: 'Join' },
        { category: 'expression', label: 'Expression' },
    ];

    return (
        <div className="absolute top-3 left-3 bg-zinc-900/90 border border-zinc-800 rounded-lg p-2 z-10 backdrop-blur-sm">
            <div className="text-[10px] font-semibold text-zinc-400 mb-2">Node Types</div>
            <div className="flex flex-wrap gap-2">
                {categories.map(({ category, label }) => (
                    <div key={category} className="flex items-center gap-1.5">
                        <div
                            className="w-3 h-3 rounded-sm"
                            style={{ backgroundColor: NODE_STYLES[category].color }}
                        />
                        <span className="text-[9px] text-zinc-400">{label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Inner component that uses useReactFlow hook
const VisualExplainInner: React.FC<{ plan: ExplainResult }> = ({ plan }) => {
    const { fitView } = useReactFlow();

    const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
        if (!plan) return { nodes: [], edges: [] };
        const { nodes, edges } = transformPlanToGraph(plan);
        return getLayoutedElements(nodes, edges);
    }, [plan]);

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

    return (
        <>
            <Legend />
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                attributionPosition="bottom-right"
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={12} size={1} color="#27272a" />
                <Controls
                    className="bg-zinc-900 border-zinc-800 text-zinc-100 fill-zinc-100 [&>button]:!bg-zinc-900 [&>button]:!border-zinc-800 [&>button:hover]:!bg-zinc-800 [&_path]:!fill-zinc-100"
                >
                    <ControlButton onClick={() => onLayout('TB')} title="Vertical Layout">
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

const VisualExplain: React.FC<VisualExplainProps> = ({ plan }) => {
    if (!plan) return null;

    return (
        <div className="w-full h-full flex flex-col">
            <ExplainInfoHeader type="plan" />
            <div className="flex-1 bg-zinc-950/50 backdrop-blur-sm relative">
                <ReactFlowProvider>
                    <VisualExplainInner plan={plan} />
                </ReactFlowProvider>
            </div>
        </div>
    );
};

export default VisualExplain;
