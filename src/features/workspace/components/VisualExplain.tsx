import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
    Background,
    Controls,
    ControlButton,
    Edge,
    Node,
    useNodesState,
    useEdgesState,
    Position,
    Handle,
    MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { cn } from '@/lib/utils';

// Types for Explain Plan
interface ExplainNode {
    "Node Type"?: string;
    "Plans"?: ExplainNode[];
    [key: string]: any;
}

interface VisualExplainProps {
    plan: any; // The JSON explain plan from ClickHouse
}

/**
 * Custom Node for Explain Plan
 */
const ExplainNodeComponent = ({ data }: { data: { label: string; type: string; details: any; step: number } }) => {
    // Extract potential SQL parts
    const description = data.details['Description'];
    const filter = data.details['Filter'];
    const expression = data.details['Expression'];

    // Prioritize showing description, then filter, then expression
    const sqlContent = description || filter || expression;

    return (
        <div className={cn(
            "px-4 py-3 rounded-md border min-w-[200px] max-w-[300px] shadow-sm relative",
            "bg-card border-border text-card-foreground",
            "hover:border-primary/50 transition-colors"
        )}>
            <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
            <div className="absolute -top-3 -right-3 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm border border-background">
                #{data.step}
            </div>
            <div className="font-semibold text-xs mb-2 text-primary/90">{data.type}</div>

            {/* Show SQL content if available */}
            {sqlContent ? (
                <div className="bg-muted/30 p-2 rounded text-[10px] font-mono mb-2 overflow-x-auto whitespace-pre-wrap max-h-[150px] overflow-y-auto border border-white/5 text-muted-foreground">
                    {sqlContent}
                </div>
            ) : (
                <div className="text-[10px] text-muted-foreground truncate mb-2" title={data.label}>
                    {data.label}
                </div>
            )}

            {/* Add some key metrics if available */}
            {data.details && (
                <div className="flex gap-3 text-[9px] text-muted-foreground border-t border-white/5 pt-2">
                    {data.details['Read Rows'] && <span className="flex items-center gap-1">Rows: <span className="text-foreground">{data.details['Read Rows']}</span></span>}
                    {data.details['Read Bytes'] && <span className="flex items-center gap-1">Bytes: <span className="text-foreground">{data.details['Read Bytes']}</span></span>}
                </div>
            )}
            <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
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
        nodesep: 60, // Increased to prevent horizontal overlap
        ranksep: 80  // Increased to prevent vertical overlap
    });

    nodes.forEach((node) => {
        // Broad estimate for node size (min-w-[200px] + padding + potential long text)
        dagreGraph.setNode(node.id, { width: 260, height: 160 });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const newNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        const newNode = { ...node }; // Clone node

        newNode.targetPosition = isHorizontal ? Position.Left : Position.Top;
        newNode.sourcePosition = isHorizontal ? Position.Right : Position.Bottom;

        // We are shifting the dagre node position (anchor=center center) to the top left
        // so it matches the React Flow node anchor point (top left).
        newNode.position = {
            x: nodeWithPosition.x - 90,
            y: nodeWithPosition.y - 30,
        };

        return newNode;
    });

    return { nodes: newNodes, edges };
};

/**
 * Transform ClickHouse Explain JSON to Nodes and Edges
 */
const transformPlanToGraph = (plan: any): { nodes: Node[], edges: Edge[] } => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let nodeIdCounter = 0;
    let stepCounter = 1;

    // Helper to process nodes recursively
    // Post-order traversal to mimic execution flow (children first)
    const processNode = (planNode: ExplainNode, parentId?: string): string => {
        const id = `node-${nodeIdCounter++}`;

        // Process children first
        if (planNode.Plans && Array.isArray(planNode.Plans)) {
            planNode.Plans.forEach((child) => {
                const childId = processNode(child, id);
                // Edge from child to parent (data flow) or parent to child (control flow)?
                // Standard explain plans usually show tree structure (Control Flow: Parent calls Child).
                // So Edge is Parent -> Child.
                // But execution order is Child -> Parent.
                // We keep edges as Control Flow (Parent -> Child) for visual tree structure,
                // but number them by Execution Order (Child first).

                // Wait, `processNode` passed `id` as parentId to child.
                // The edge creation should happen here? No, let's keep it simple.
            });
        }

        // Now process current node (Post-order)
        const currentStep = stepCounter++;
        const type = planNode["Node Type"] || "Unknown";

        // Create label from useful properties
        let label = type;
        if (planNode["Description"]) label = planNode["Description"];

        nodes.push({
            id,
            type: 'explainNode',
            data: {
                label,
                type,
                details: planNode,
                step: currentStep
            },
            position: { x: 0, y: 0 }, // Initial position, will be calculated by dagre
        });

        if (parentId) {
            // Data Flow: Child -> Parent
            // This ensures "Time/Execution" flows Top -> Bottom in standard DAGRE layout
            edges.push({
                id: `edge-${id}-${parentId}`,
                source: id,
                target: parentId,
                type: 'default',
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                },
                animated: true, // Animate data flow
                style: { stroke: '#71717a', strokeWidth: 2 }
            });
        }

        return id;
    };

    // Find the root plan object
    // plan might be [{ explain: { Plan: ... } }] or { Plan: ... } or just text
    let rootPlan = plan;

    if (Array.isArray(plan)) {
        if (plan[0]?.explain?.Plan) rootPlan = plan[0].explain.Plan;
        else if (plan[0]?.Plan) rootPlan = plan[0].Plan;
    } else if (plan?.explain?.Plan) {
        rootPlan = plan.explain.Plan;
    } else if (plan?.Plan) {
        rootPlan = plan.Plan;
    }

    if (rootPlan) {
        processNode(rootPlan);
    }

    return { nodes, edges };
};

const VisualExplain: React.FC<VisualExplainProps> = ({ plan }) => {
    const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
        if (!plan) return { nodes: [], edges: [] };
        const { nodes, edges } = transformPlanToGraph(plan);
        return getLayoutedElements(nodes, edges);
    }, [plan]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Use callback for manual re-layout
    const onLayout = useCallback((direction: string) => {
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
            nodes,
            edges,
            direction
        );

        setNodes([...layoutedNodes]);
        setEdges([...layoutedEdges]);
    }, [nodes, edges, setNodes, setEdges]);

    // Initial layout effect
    React.useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    if (!plan) return null;

    return (
        <div className="w-full h-full bg-background/50 backdrop-blur-sm">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                attributionPosition="bottom-right"
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={12} size={1} />
                <Controls
                    className="bg-zinc-900 border-zinc-800 text-zinc-100 fill-zinc-100 [&>button]:!bg-zinc-900 [&>button]:!border-zinc-800 [&>button:hover]:!bg-zinc-800 [&_path]:!fill-zinc-100"
                >
                    <ControlButton onClick={() => onLayout('TB')} title="Auto Layout (Vertical)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-layout-template"><rect width="18" height="7" x="3" y="3" rx="1" /><rect width="9" height="7" x="3" y="14" rx="1" /><rect width="5" height="7" x="16" y="14" rx="1" /></svg>
                    </ControlButton>
                    <ControlButton onClick={() => onLayout('LR')} title="Auto Layout (Horizontal)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(90deg)' }}><rect width="18" height="7" x="3" y="3" rx="1" /><rect width="9" height="7" x="3" y="14" rx="1" /><rect width="5" height="7" x="16" y="14" rx="1" /></svg>
                    </ControlButton>
                </Controls>
            </ReactFlow>
        </div>
    );
};

export default VisualExplain;
