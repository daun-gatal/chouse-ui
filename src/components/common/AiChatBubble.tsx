/**
 * AI Chat Bubble
 *
 * Fixed side-tab that opens into a full AI chat window.
 * Only renders if the user has ai:chat permission and AI is enabled.
 */

import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useWindowSize, type Breakpoint } from '@/hooks/useWindowSize';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import 'highlight.js/styles/github-dark.min.css';
import { useRbacStore, RBAC_PERMISSIONS, useAuthStore } from '@/stores';
import {
    getChatStatus,
    listThreads,
    createThread,
    getThread,
    deleteThread,
    streamChatMessage,
    type ChatThread,
    type ChatMessage,
    type ChartSpec,
} from '@/api/ai-chat';
import { AiChartRenderer } from '@/components/common/AiChartRenderer';
import {
    MessageSquare,
    X,
    Plus,
    Trash2,
    Send,
    Loader2,
    Bot,
    User,
    Sparkles,
    Database,
    Table2,
    Zap,
    Clock,
    PanelLeftClose,
    RefreshCw,
    AlertCircle,
    ChevronDown,
    ChevronRight,
    CheckCircle2,
    Shuffle,
    Search,
    BarChart3,
    Activity,
    HardDrive,
    Settings,
    FileText,
    Server,
    GripVertical,
    Maximize2,
    Minimize2,
    TrendingUp,
    PieChart,
    ScatterChart,
} from 'lucide-react';

// ============================================
// Resize constants
// ============================================

const DEFAULT_DESKTOP_WIDTH = 1340;
const DEFAULT_DESKTOP_HEIGHT = 840;
const MIN_WIDTH = 400;
const MIN_HEIGHT = 360;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.0;

// Register highlight.js languages
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('json', json);

// ============================================
// Types
// ============================================

/** One tool call tracked during a streamed response */
interface ToolCallStep {
    tool: string;
    args: Record<string, unknown>;
    status: 'running' | 'done';
    summary?: string | null;
}

interface UIMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
    isStreaming?: boolean;
    toolStatus?: string;
    isError?: boolean;
    /** snapshot of user message to retry */
    retryPrompt?: string;
    /** ordered list of tool calls made during this assistant turn */
    toolCalls?: ToolCallStep[];
    /** chart specs produced by the render_chart tool, if any */
    chartSpecs?: ChartSpec[];
}

// Suggested prompt chips — only a random subset is shown at a time
const SUGGESTED_PROMPTS = [
    // Discovery
    { icon: Database, label: 'Show my databases', prompt: 'What databases do I have access to?' },
    { icon: Table2, label: 'Explore tables', prompt: 'List all tables with their row counts' },
    { icon: Search, label: 'Find a column', prompt: 'Search for columns named "user" or "email" across all tables' },
    { icon: HardDrive, label: 'Disk usage', prompt: 'Show me the disk usage for each table, sorted by size' },
    // Schema
    { icon: FileText, label: 'Schema overview', prompt: 'Give me an overview of the database schema' },
    { icon: Table2, label: 'Table details', prompt: 'Describe the schema of the largest table' },
    { icon: Database, label: 'Compare databases', prompt: 'Compare the table counts and sizes across all databases' },
    { icon: Settings, label: 'Table engines', prompt: 'What table engines are used and how many tables use each?' },
    // Queries & data
    { icon: BarChart3, label: 'Sample data', prompt: 'Show me a sample of 5 rows from the most populated table' },
    { icon: Search, label: 'Recent data', prompt: 'Find the most recently inserted rows across all tables' },
    { icon: MessageSquare, label: 'Write a query', prompt: 'Help me write a query to count rows grouped by date' },
    { icon: Zap, label: 'Optimize a query', prompt: 'Analyze and optimize this query: SELECT * FROM system.query_log LIMIT 100' },
    // Performance & monitoring
    { icon: Activity, label: 'Running queries', prompt: 'Show me all currently running queries' },
    { icon: Zap, label: 'Performance tips', prompt: 'Show me any slow or heavy queries and suggest optimizations' },
    { icon: Server, label: 'Server info', prompt: 'What ClickHouse version is running and what is the server uptime?' },
    { icon: BarChart3, label: 'Query stats', prompt: 'What are the most common query types hitting the server?' },
    // Charts
    { icon: BarChart3, label: 'Table sizes chart', prompt: 'Show me a bar chart of disk usage by table, sorted by size descending' },
    { icon: PieChart, label: 'Engine pie chart', prompt: 'Pie chart of table engines used across all databases' },
    { icon: TrendingUp, label: 'Query trends', prompt: 'Line chart of query count per hour from system.query_log' },
    { icon: ScatterChart, label: 'Perf scatter', prompt: 'Scatter plot of query_duration_ms vs memory_usage from system.query_log LIMIT 200' },
];
const PROMPTS_VISIBLE = 4;

/** Pick `n` random items from `arr` using a seed-like key for re-randomisation */
function pickRandom<T>(arr: T[], n: number, seed: number): T[] {
    const shuffled = [...arr];
    // Fisher-Yates with seed-derived swaps
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.abs((seed * (i + 1) * 2654435761) | 0) % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, n);
}

// Relative time helper
function timeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
}

// ============================================
// ThinkingPanel: expandable tool call history
// ============================================

function formatToolName(name: string): string {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Reusable component for sidebar thread item
function SidebarThreadButton({
    thread,
    activeId,
    onLoad,
    onDelete
}: {
    thread: ChatThread;
    activeId: string | null;
    onLoad: (id: string) => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onLoad(thread.id)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onLoad(thread.id);
                }
            }}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-[14px]
                      flex items-center justify-between group transition-all duration-200 cursor-pointer
                      ${activeId === thread.id
                    ? 'bg-violet-500/10 text-zinc-100 border-l-2 border-l-violet-400 border border-violet-500/10'
                    : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200 border border-transparent'
                }`}
        >
            <div className="flex-1 min-w-0 mr-2">
                <span className="block truncate">{thread.title || 'New Thread'}</span>
                <span className="flex items-center gap-1 text-xs text-zinc-600 mt-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {timeAgo(thread.updatedAt)}
                </span>
            </div>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete(thread.id, e);
                }}
                className="p-1 rounded-lg opacity-0 group-hover:opacity-100
                         hover:bg-red-500/15 text-zinc-600 hover:text-red-400 transition-all"
                title="Delete chat"
            >
                <Trash2 className="w-3 h-3" />
            </button>
        </div>
    );
}

// Collapsible group for thread sections
function CollapsibleThreadGroup({
    title,
    threads,
    activeId,
    onLoad,
    onDelete,
    defaultExpanded = true,
}: {
    title: string;
    threads: ChatThread[];
    activeId: string | null;
    onLoad: (id: string) => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
    defaultExpanded?: boolean;
}) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    if (threads.length === 0) return null;

    return (
        <div className="mb-4 last:mb-0">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="sticky top-0 z-10 border-b border-white/[0.06] flex items-center gap-1.5 w-[calc(100%+24px)] -mx-3 px-4 text-xs font-semibold uppercase tracking-wider bg-black/95 backdrop-blur-2xl py-2.5 mb-2 transition-colors text-violet-300/80 hover:text-violet-200"
            >
                <div className="flex items-center justify-center p-0.5 rounded transition-colors hover:bg-white/10">
                    {isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-zinc-400" />
                    ) : (
                        <ChevronRight className="w-3 h-3 text-zinc-400" />
                    )}
                </div>
                {title}
                <span className="ml-auto text-zinc-600 font-normal normal-case">{threads.length}</span>
            </button>

            <div
                className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
                <div className="overflow-hidden flex flex-col gap-0.5">
                    {threads.map((t) => (
                        <SidebarThreadButton
                            key={t.id}
                            thread={t}
                            activeId={activeId}
                            onLoad={onLoad}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

// ============================================
// Component
// ============================================

function ThinkingPanel({ toolCalls, isStreaming }: { toolCalls: ToolCallStep[]; isStreaming?: boolean }) {
    const [expanded, setExpanded] = useState(false);

    if (!toolCalls || toolCalls.length === 0) return null;

    const runningCount = toolCalls.filter((t) => t.status === 'running').length;
    const isRunning = isStreaming && runningCount > 0;
    const label = isRunning
        ? `Thinking… (${toolCalls.length} action${toolCalls.length !== 1 ? 's' : ''})`
        : `Used ${toolCalls.length} tool${toolCalls.length !== 1 ? 's' : ''}`;

    return (
        <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm overflow-hidden">
            {/* Animated shimmer bar while running */}
            {isRunning && (
                <div className="h-0.5 w-full bg-gradient-to-r from-violet-500/0 via-violet-400/60 to-violet-500/0 animate-pulse" />
            )}
            <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-white/[0.04] transition-colors"
            >
                {isRunning
                    ? <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin flex-shrink-0" />
                    : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70 flex-shrink-0" />
                }
                <span className="text-[11px] text-zinc-400 font-medium flex-1">{label}</span>
                <ChevronDown
                    className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                />
            </button>

            {expanded && (
                <div className="px-3.5 pb-3 space-y-2.5 border-t border-white/[0.06]">
                    {toolCalls.map((step, i) => (
                        <div key={i} className="pt-2.5 flex gap-2.5">
                            <div className="flex-shrink-0 pt-0.5">
                                {step.status === 'running'
                                    ? <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />
                                    : <CheckCircle2 className="w-3 h-3 text-emerald-400/70" />
                                }
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                                <span className="text-[11px] font-semibold text-zinc-300">{formatToolName(step.tool)}</span>
                                {Object.entries(step.args)
                                    .filter(([, v]) => v !== undefined && v !== null && v !== '')
                                    .map(([k, v]) => {
                                        const strVal = typeof v === 'string' ? v
                                            : typeof v === 'number' || typeof v === 'boolean' ? String(v)
                                                : JSON.stringify(v, null, 2);
                                        const isMultiLine = strVal.includes('\n') || strVal.length > 80;
                                        return (
                                            <div key={k} className={`text-[10px] ${isMultiLine ? '' : 'flex items-baseline gap-1.5'}`}>
                                                <span className="text-zinc-500 font-medium shrink-0">{k}:</span>
                                                {isMultiLine ? (
                                                    <pre className="mt-0.5 bg-black/40 rounded-lg px-2.5 py-1.5 text-zinc-400 font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[120px] overflow-y-auto border border-white/[0.04]">{strVal.trim()}</pre>
                                                ) : (
                                                    <span className="text-zinc-400 font-mono ml-1.5">{strVal}</span>
                                                )}
                                            </div>
                                        );
                                    })
                                }
                                {step.status === 'done' && step.summary && (
                                    <p className="text-[10px] text-emerald-400/70">↳ {step.summary}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// Custom renderers for ReactMarkdown
const markdownComponents = {
    // Tables: wrap in scrollable container
    table: ({ children, ...props }: any) => (
        <div className="overflow-x-auto my-2 rounded-lg border border-white/10">
            <table className="min-w-full text-xs" {...props}>{children}</table>
        </div>
    ),
    thead: ({ children, ...props }: any) => (
        <thead className="bg-white/5" {...props}>{children}</thead>
    ),
    th: ({ children, ...props }: any) => (
        <th className="px-3 py-1.5 text-left font-medium text-white/80 border-b border-white/10 whitespace-nowrap" {...props}>{children}</th>
    ),
    td: ({ children, ...props }: any) => (
        <td className="px-3 py-1.5 text-white/70 border-b border-white/5 whitespace-nowrap" {...props}>{children}</td>
    ),
    // Code blocks with syntax highlighting
    code: ({ className, children, ...props }: any) => {
        const match = /language-(\w+)/.exec(className || '');
        const lang = match?.[1];
        const codeStr = String(children).replace(/\n$/, '');
        if (lang || codeStr.includes('\n')) {
            let highlighted = codeStr;
            try {
                if (lang && hljs.getLanguage(lang)) {
                    highlighted = hljs.highlight(codeStr, { language: lang }).value;
                }
            } catch { /* fallback to plain */ }
            return (
                <code
                    className={`${className || ''} text-xs`}
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                    {...props}
                />
            );
        }
        // Inline code
        return <code className="bg-white/10 px-1.5 py-0.5 rounded text-violet-300 text-xs" {...props}>{children}</code>;
    },
    pre: ({ children, ...props }: any) => (
        <pre className="bg-black/40 rounded-lg p-3 overflow-x-auto my-2 text-xs" {...props}>{children}</pre>
    ),
    p: ({ children, ...props }: any) => (
        <p className="my-1.5 leading-relaxed" {...props}>{children}</p>
    ),
    ul: ({ children, ...props }: any) => (
        <ul className="list-disc list-inside my-1.5 space-y-0.5" {...props}>{children}</ul>
    ),
    ol: ({ children, ...props }: any) => (
        <ol className="list-decimal list-inside my-1.5 space-y-0.5" {...props}>{children}</ol>
    ),
    h1: ({ children, ...props }: any) => <h1 className="text-base font-bold text-white/90 mt-3 mb-1" {...props}>{children}</h1>,
    h2: ({ children, ...props }: any) => <h2 className="text-sm font-bold text-white/90 mt-3 mb-1" {...props}>{children}</h2>,
    h3: ({ children, ...props }: any) => <h3 className="text-sm font-semibold text-white/90 mt-2 mb-1" {...props}>{children}</h3>,
    a: ({ children, ...props }: any) => (
        <a className="text-violet-400 hover:text-violet-300 underline" target="_blank" rel="noopener" {...props}>{children}</a>
    ),
    blockquote: ({ children, ...props }: any) => (
        <blockquote className="border-l-2 border-violet-500/40 pl-3 my-2 text-white/60 italic" {...props}>{children}</blockquote>
    ),
    // Suppress images — the AI sometimes generates ![chart](...) markdown which renders as broken <img>
    img: () => null,
    br: () => <br />,
};

/**
 * Normalise common AI output quirks before passing to ReactMarkdown:
 * - Replace literal \n escape sequences with real newlines
 *   (AI sometimes escapes newlines inside table cells)
 * - Normalise <br> variants to real newlines
 *   (AI sometimes uses <br> for line breaks in table cells)
 */
function preprocessMarkdown(text: string): string {
    const lines = text.split('\n');
    let inCodeFence = false;

    const out = lines.map(line => {
        // Track real triple-backtick fences (standalone lines starting with ```)
        if (/^\s*```/.test(line)) {
            inCodeFence = !inCodeFence;
            return line;
        }
        // Inside a real code fence block — never touch the content
        if (inCodeFence) return line;

        // Table rows: collapse ```lang\nCODE\n``` inside cells to inline `CODE`,
        // then replace any remaining literal \n with a space to keep the row single-line.
        if (line.trimStart().startsWith('|')) {
            return line
                // ```lang\nCODE\n``` → `CODE` (newlines become spaces so the cell stays on one line)
                .replace(/```\w*\\n([\s\S]*?)(?:\\n)?```/g, (_match, code) =>
                    '`' + code.replace(/\\n/g, ' ').trim() + '`'
                )
                // any remaining literal \n → space
                .replace(/\\n/g, ' ')
                // <br> → space
                .replace(/<br\s*\/?>/gi, ' ');
        }

        // Regular paragraph lines: convert literal \n to real newlines
        return line
            .replace(/\\n/g, '\n')
            .replace(/<br\s*\/?>/gi, '  \n');
    });

    return out.join('\n');
}

// ============================================
// Component
// ============================================

export default function AiChatBubble() {
    const hasPermission = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_CHAT));
    const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
    const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [showSidebar, setShowSidebar] = useState(false);

    // Responsive breakpoint
    const { width: viewportWidth, height: viewportHeight, breakpoint } = useWindowSize();
    const isMobile = breakpoint === 'mobile';
    const isTablet = breakpoint === 'tablet';
    const isDesktop = breakpoint === 'desktop';

    // Resize state (desktop only)
    const [windowSize, setWindowSize] = useState({ width: DEFAULT_DESKTOP_WIDTH, height: DEFAULT_DESKTOP_HEIGHT });
    const [isResizing, setIsResizing] = useState(false);
    const resizeRef = useRef<{ axis: 'both' | 'x' | 'y'; startX: number; startY: number; startW: number; startH: number } | null>(null);

    // Compute max constraints based on viewport
    const maxWidth = Math.min(DEFAULT_DESKTOP_WIDTH, viewportWidth - 40);
    const maxHeight = Math.min(900, Math.round(viewportHeight * 0.96));

    // Effective window dimensions for desktop
    const effectiveWidth = Math.min(Math.max(windowSize.width, MIN_WIDTH), maxWidth);
    const effectiveHeight = Math.min(Math.max(windowSize.height, MIN_HEIGHT), maxHeight);

    // Compute zoom factor for proportional scaling (desktop resize only)
    const zoomFactor = isDesktop
        ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(effectiveWidth / DEFAULT_DESKTOP_WIDTH, effectiveHeight / DEFAULT_DESKTOP_HEIGHT)))
        : 1;

    // Logical dimensions for internal layout
    const logicalWidth = isDesktop ? effectiveWidth / zoomFactor : (isTablet ? 680 : viewportWidth);
    const logicalHeight = isDesktop ? effectiveHeight / zoomFactor : (isTablet ? 840 : viewportHeight);

    // Adaptive internal layout thresholds
    const hideSidebarThreshold = 900;
    const singleColPromptThreshold = 600;

    const shouldHideSidebar = showSidebar && isDesktop && logicalWidth < hideSidebarThreshold;
    const useSingleColPrompt = isMobile || (isDesktop && logicalWidth < singleColPromptThreshold);

    // Resize handlers (desktop only)
    const handleResizeStart = useCallback((axis: 'both' | 'x' | 'y', e: ReactMouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        resizeRef.current = {
            axis,
            startX: e.clientX,
            startY: e.clientY,
            startW: effectiveWidth,
            startH: effectiveHeight,
        };
    }, [effectiveWidth, effectiveHeight]);

    useEffect(() => {
        if (!isResizing) return;
        const handleMouseMove = (e: globalThis.MouseEvent) => {
            if (!resizeRef.current) return;
            const { axis, startX, startY, startW, startH } = resizeRef.current;
            // Coordinate mapping: divide client delta by zoomFactor to get logical delta
            const dx = axis !== 'y' ? (startX - e.clientX) / zoomFactor : 0;
            const dy = axis !== 'x' ? (e.clientY - startY) / zoomFactor : 0;
            setWindowSize({
                width: Math.min(Math.max(startW + dx * zoomFactor, MIN_WIDTH), maxWidth),
                height: Math.min(Math.max(startH + dy * zoomFactor, MIN_HEIGHT), maxHeight),
            });
        };
        const handleMouseUp = () => {
            setIsResizing(false);
            resizeRef.current = null;
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, maxWidth, maxHeight]);

    // Auto-close sidebar on smaller breakpoints
    useEffect(() => {
        if (isMobile || isTablet) setShowSidebar(false);
    }, [isMobile, isTablet]);

    // Thread state
    const [threads, setThreads] = useState<ChatThread[]>([]);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [messages, setMessages] = useState<UIMessage[]>([]);
    const [isLoadingThreads, setIsLoadingThreads] = useState(false);

    // Input state
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [toolStatus, setToolStatus] = useState<string | null>(null);
    const [shuffleKey, setShuffleKey] = useState(() => Date.now());
    const abortRef = useRef<AbortController | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Random subset of prompts — changes when shuffleKey changes
    const visiblePrompts = useMemo(
        () => pickRandom(SUGGESTED_PROMPTS, PROMPTS_VISIBLE, shuffleKey),
        [shuffleKey]
    );

    // Group threads by time
    const groupedThreads = useMemo(() => {
        const now = Date.now();
        const HourMs = 60 * 60 * 1000;
        const DayMs = 24 * 60 * 60 * 1000;

        const recent: ChatThread[] = [];
        const last24Hours: ChatThread[] = [];
        const last7Days: ChatThread[] = [];

        for (const thread of threads) {
            const then = new Date(thread.updatedAt).getTime();
            const diffHours = (now - then) / HourMs;
            const diffDays = (now - then) / DayMs;

            if (diffHours <= 4) recent.push(thread);
            else if (diffDays <= 1) last24Hours.push(thread);
            else if (diffDays <= 7) last7Days.push(thread);
            // > 7 days are filtered out
        }

        return { recent, last24Hours, last7Days };
    }, [threads]);

    // Check AI status on mount
    useEffect(() => {
        if (!hasPermission) return;
        getChatStatus()
            .then((status) => setAiEnabled(status.enabled))
            .catch(() => setAiEnabled(false));
    }, [hasPermission]);


    // Auto-scroll to bottom without bubbling up scroll events to parent
    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                top: scrollContainerRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [messages]);

    // Focus input when thread loads
    useEffect(() => {
        if (activeThreadId && !isStreaming) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [activeThreadId, isStreaming]);

    // Escape key closes the chat window
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen]);

    const loadThreads = useCallback(async () => {
        setIsLoadingThreads(true);
        try {
            const result = await listThreads(activeConnectionId);
            setThreads(result);
        } catch (err) {
            console.error('[AiChat] Failed to load threads:', err);
        } finally {
            setIsLoadingThreads(false);
        }
    }, [activeConnectionId]);

    // Reload threads and reset state when connection or open status changes
    useEffect(() => {
        if (isOpen && hasPermission && aiEnabled) {
            loadThreads();
            // Only reset if connection actually changed to avoid losing state when just toggling window
            // But for now, simple implementation to ensure history matches connection
            setActiveThreadId(null);
            setMessages([]);
        }
    }, [activeConnectionId, isOpen, hasPermission, aiEnabled, loadThreads]);

    const loadThread = useCallback(async (threadId: string) => {
        try {
            const data = await getThread(threadId);
            setActiveThreadId(threadId);
            setMessages(
                data.messages.map((m: ChatMessage) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    chartSpecs: m.chartSpecs || undefined,
                    createdAt: m.createdAt,
                }))
            );
        } catch (err) {
            console.error('[AiChat] Failed to load thread:', err);
        }
    }, []);

    const handleNewThread = useCallback(async () => {
        try {
            const thread = await createThread(undefined, activeConnectionId ?? undefined);
            setThreads((prev) => [thread, ...prev]);
            setActiveThreadId(thread.id);
            setMessages([]);
        } catch (err) {
            console.error('[AiChat] Failed to create thread:', err);
        }
    }, []);

    const handleDeleteThread = useCallback(async (threadId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await deleteThread(threadId);
            setThreads((prev) => prev.filter((t) => t.id !== threadId));
            if (activeThreadId === threadId) {
                setActiveThreadId(null);
                setMessages([]);
            }
        } catch (err) {
            console.error('[AiChat] Failed to delete thread:', err);
        }
    }, [activeThreadId]);

    /**
     * Core streaming executor — shared by both handleSend and handleSuggestedPrompt.
     * Streams the AI response and updates the last assistant message in state.
     * On error, marks the message with isError=true and stores retryPrompt.
     */
    const runStream = useCallback(async (
        threadId: string,
        prompt: string,
        messageHistory: { role: string; content: string }[],
    ) => {
        const controller = new AbortController();
        abortRef.current = controller;
        setIsStreaming(true);
        setToolStatus(null);

        try {
            const stream = streamChatMessage(
                threadId,
                prompt,
                messageHistory,
                controller.signal
            );

            for await (const delta of stream) {
                if (delta.type === 'text-delta' && delta.text) {
                    setToolStatus(null);
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === 'assistant') {
                            updated[updated.length - 1] = {
                                ...last,
                                content: last.content + delta.text!,
                                toolStatus: undefined,
                            };
                        }
                        return updated;
                    });
                } else if (delta.type === 'tool-call' && delta.tool) {
                    // New tool call started — add to toolCalls on the last assistant message
                    const label = delta.tool.replace(/_/g, ' ');
                    setToolStatus(`Querying ${label}...`);
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === 'assistant') {
                            const newStep: ToolCallStep = {
                                tool: delta.tool!,
                                args: delta.args ?? {},
                                status: 'running',
                            };
                            updated[updated.length - 1] = {
                                ...last,
                                toolStatus: `Querying ${label}...`,
                                toolCalls: [...(last.toolCalls ?? []), newStep],
                            };
                        }
                        return updated;
                    });
                } else if (delta.type === 'chart-data' && delta.chartSpec) {
                    // Attach chart spec to the current assistant message
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === 'assistant') {
                            updated[updated.length - 1] = {
                                ...last,
                                chartSpecs: [...(last.chartSpecs || []), delta.chartSpec!]
                            };
                        }
                        return updated;
                    });
                } else if (delta.type === 'tool-complete' && delta.tool) {
                    // Tool finished — mark its step as done and attach the summary
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === 'assistant' && last.toolCalls) {
                            // Find the last running step for this tool
                            const steps = [...last.toolCalls];
                            for (let i = steps.length - 1; i >= 0; i--) {
                                if (steps[i].tool === delta.tool && steps[i].status === 'running') {
                                    steps[i] = { ...steps[i], status: 'done', summary: delta.summary ?? null };
                                    break;
                                }
                            }
                            updated[updated.length - 1] = { ...last, toolCalls: steps };
                        }
                        return updated;
                    });
                } else if (delta.type === 'status' && delta.tool) {
                    // Legacy status event fallback
                    const label = delta.tool.replace(/_/g, ' ');
                    setToolStatus(`Querying ${label}...`);
                } else if (delta.type === 'error') {
                    setToolStatus(null);
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === 'assistant') {
                            updated[updated.length - 1] = {
                                ...last,
                                content: delta.error || 'An unexpected error occurred.',
                                isStreaming: false,
                                isError: true,
                                retryPrompt: prompt,
                                toolStatus: undefined,
                            };
                        }
                        return updated;
                    });
                }
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.name !== 'AbortError') {
                const errMsg = err.message || 'Connection failed';
                setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                        updated[updated.length - 1] = {
                            ...last,
                            content: errMsg,
                            isStreaming: false,
                            isError: true,
                            retryPrompt: prompt,
                        };
                    }
                    return updated;
                });
            }
        } finally {
            setToolStatus(null);
            setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.isStreaming) {
                    // Guard: if content is empty and not already an error, show fallback
                    const isEmpty = !last.content.trim();
                    updated[updated.length - 1] = {
                        ...last,
                        isStreaming: false,
                        toolStatus: undefined,
                        ...(isEmpty && !last.isError
                            ? { content: 'I wasn\'t able to generate a response. Please try again.', isError: true, retryPrompt: prompt }
                            : {}
                        ),
                    };
                }
                return updated;
            });
            setIsStreaming(false);
            abortRef.current = null;
            loadThreads();
        }
    }, [loadThreads]);

    const handleSend = useCallback(async (e?: FormEvent) => {
        e?.preventDefault();
        const trimmed = input.trim();
        if (!trimmed || isStreaming || !activeThreadId) return;

        const userMsg: UIMessage = {
            id: `user_${Date.now()}`,
            role: 'user',
            content: trimmed,
            createdAt: new Date().toISOString(),
        };
        const assistantMsg: UIMessage = {
            id: `assistant_${Date.now()}`,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            isStreaming: true,
        };

        const messageHistory = messages.map((m) => ({ role: m.role, content: m.content }));
        messageHistory.push({ role: 'user', content: trimmed });

        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        setInput('');
        // Reset textarea height back to single line
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }

        await runStream(activeThreadId, trimmed, messageHistory);
    }, [input, isStreaming, activeThreadId, messages, runStream]);

    const handleRetry = useCallback(async (retryPrompt: string) => {
        if (!retryPrompt || isStreaming || !activeThreadId) return;

        // Remove the last error assistant message, then re-run
        setMessages((prev) => {
            const updated = [...prev];
            if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                updated.pop();
            }
            return updated;
        });

        // Add a fresh placeholder
        setMessages((prev) => [
            ...prev,
            {
                id: `assistant_${Date.now()}`,
                role: 'assistant',
                content: '',
                createdAt: new Date().toISOString(),
                isStreaming: true,
            },
        ]);

        const messageHistory = messages
            .filter((m) => !m.isError)
            .map((m) => ({ role: m.role, content: m.content }));
        messageHistory.push({ role: 'user', content: retryPrompt });

        await runStream(activeThreadId, retryPrompt, messageHistory);
    }, [isStreaming, activeThreadId, messages, runStream]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    const handleStop = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    // Helper to send a suggested prompt — shares runStream for consistent error handling
    const handleSuggestedPrompt = useCallback(async (prompt: string) => {
        if (isStreaming) return;
        let threadId = activeThreadId;
        if (!threadId) {
            try {
                const thread = await createThread(undefined, activeConnectionId ?? undefined);
                setThreads((prev) => [thread, ...prev]);
                setActiveThreadId(thread.id);
                threadId = thread.id;
                setMessages([]);
            } catch (err) {
                console.error('[AiChat] Failed to create thread:', err);
                return;
            }
        }

        const userMsg: UIMessage = {
            id: `user_${Date.now()}`,
            role: 'user',
            content: prompt,
            createdAt: new Date().toISOString(),
        };
        const assistantMsg: UIMessage = {
            id: `assistant_${Date.now()}`,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            isStreaming: true,
        };

        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        setInput('');

        await runStream(threadId, prompt, [{ role: 'user', content: prompt }]);
    }, [isStreaming, activeThreadId, runStream]);

    // Don't render if no permission or AI is not enabled
    if (!hasPermission || aiEnabled === false) return null;
    if (aiEnabled === null) return null;

    return (
        <>
            {/* Chat Trigger (FAB on mobile, Side Pill on tablet/desktop) */}
            {!isOpen && (
                isMobile ? (
                    <button
                        onClick={() => setIsOpen(true)}
                        aria-label="Open AI Chat"
                        className="ai-chat-fab group"
                        title="Open AI Chat"
                    >
                        <Sparkles className="w-6 h-6 text-white group-hover:scale-110 transition-transform" />
                        <div className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-violet-500 animate-pulse" />
                    </button>
                ) : (
                    <div
                        className="fixed z-50"
                        style={{
                            top: '50%',
                            right: 0,
                            transform: 'translateY(-50%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 48,
                            height: 120,
                        }}
                    >
                        <button
                            onClick={() => setIsOpen(true)}
                            aria-label="Open AI Chat"
                            className="flex items-center justify-center
                                       transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] transform-gpu
                                       w-10 h-24 rounded-l-xl
                                       shadow-xl shadow-violet-500/10 cursor-pointer
                                       bg-black/60 backdrop-blur-xl hover:bg-black/80
                                       border-y border-l border-white/10 hover:border-violet-500/30
                                       opacity-70 hover:opacity-100 hover:-translate-x-1
                                       group"
                            title="Open AI Chat"
                        >
                            <div className="flex flex-col items-center gap-1.5 py-3">
                                <div className="relative">
                                    <Sparkles className="w-4 h-4 text-violet-400 group-hover:text-violet-300 transition-colors" />
                                    <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                </div>
                                <span
                                    className="text-xs font-semibold text-zinc-300 group-hover:text-white tracking-wide transition-colors"
                                    style={{ writingMode: 'vertical-lr' }}
                                >
                                    Ask AI
                                </span>
                            </div>
                        </button>
                    </div>
                )
            )}

            {/* Chat Window Container */}
            {isOpen && (
                <div
                    className={`fixed z-50 flex flex-col overflow-hidden bg-black/70 backdrop-blur-2xl border-white/10 shadow-black/60 shadow-2xl
                                ${isMobile
                            ? 'inset-0 border-0 rounded-none animate-[slideUpFull_0.3s_ease-out]'
                            : 'border rounded-2xl animate-in zoom-in-95 duration-200'}`}
                    style={isMobile ? {
                        // Fullscreen mobile — native scaling
                    } : isTablet ? {
                        // Fixed size tablet — native scaling
                        top: '50%',
                        right: '12px',
                        transform: 'translateY(-50%)',
                        transformOrigin: '100% 50%',
                        width: 'min(680px, calc(100vw - 24px))',
                        height: 'min(840px, 94vh)',
                    } : {
                        // Desktop — resizable with transform: scale()
                        top: '50%',
                        right: '20px',
                        transform: `translateY(-50%) scale(${zoomFactor})`,
                        transformOrigin: '100% 50%',
                        width: `${logicalWidth}px`,
                        height: `${logicalHeight}px`,
                    }}
                >
                    {/* Main content wrapper */}
                    <div className="flex flex-col flex-1 relative w-full h-full">
                        {/* Desktop Resize Handles */}
                        {isDesktop && !isResizing && (
                            <>
                                <div
                                    className="ai-chat-resize-corner"
                                    onMouseDown={(e) => handleResizeStart('both', e)}
                                />
                                <div
                                    className="ai-chat-resize-left"
                                    onMouseDown={(e) => handleResizeStart('x', e)}
                                />
                                <div
                                    className="ai-chat-resize-bottom"
                                    onMouseDown={(e) => handleResizeStart('y', e)}
                                />
                            </>
                        )}
                        {/* Full-screen opaque drag overlay to prevent iframe/selection issues during drag */}
                        {isResizing && (
                            <div className="fixed inset-0 z-[100] cursor-grabbing" style={{ left: '-100vw', right: '-100vw', top: '-100vh', bottom: '-100vh' }} />
                        )}

                        {/* Glow orbs behind window */}
                        <div className="absolute -top-32 -right-32 w-64 h-64 bg-violet-500/15 rounded-full blur-3xl pointer-events-none" />
                        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

                        {/* Header — never shrinks */}
                        <div className="relative z-10 flex-shrink-0 flex items-center justify-between px-5 py-3
                                      bg-white/[0.03] backdrop-blur-sm
                                      border-b border-white/[0.06]">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setShowSidebar(!showSidebar)}
                                    className="p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors text-zinc-500 hover:text-zinc-200"
                                    title={showSidebar ? 'Close sidebar' : 'Thread history'}
                                >
                                    {showSidebar ? <PanelLeftClose className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                                </button>
                                <div className="flex items-center gap-2.5">
                                    <div className="relative">
                                        <div className="p-1.5 rounded-lg bg-gradient-to-br from-violet-500/20 to-indigo-500/20">
                                            <Bot className="w-4 h-4 text-violet-400" />
                                        </div>
                                        <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-black/70 animate-pulse" />
                                    </div>
                                    <div>
                                        <span className="text-sm font-semibold text-zinc-100">CHouse AI</span>
                                        <span className="text-[10px] text-emerald-400/60 ml-2 font-medium">Online</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-0.5">
                                {isDesktop && (
                                    <button
                                        onClick={() => setWindowSize(
                                            windowSize.width >= DEFAULT_DESKTOP_WIDTH * 0.9
                                                ? { width: 500, height: 700 }
                                                : { width: DEFAULT_DESKTOP_WIDTH, height: DEFAULT_DESKTOP_HEIGHT }
                                        )}
                                        className="p-2 rounded-lg hover:bg-white/[0.08] transition-colors text-zinc-500 hover:text-zinc-200 mr-1"
                                        title={windowSize.width >= DEFAULT_DESKTOP_WIDTH * 0.9 ? "Compact mode" : "Default size"}
                                    >
                                        {windowSize.width >= DEFAULT_DESKTOP_WIDTH * 0.9 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                                    </button>
                                )}
                                <button
                                    onClick={handleNewThread}
                                    className="p-2 rounded-lg hover:bg-white/[0.08] transition-colors text-zinc-500 hover:text-zinc-200"
                                    title="New chat"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="p-2 rounded-lg hover:bg-white/[0.08] transition-colors text-zinc-500 hover:text-zinc-200"
                                    title="Close (Esc)"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="relative z-10 flex flex-1 min-h-0 overflow-hidden">
                            {/* Thread Sidebar — on mobile it acts as an overlay/slideover. Auto-hide on small desktop logical widths. */}
                            {showSidebar && !shouldHideSidebar && (
                                <div className={`flex-shrink-0 bg-black/80 backdrop-blur-xl border-r border-white/[0.06] overflow-y-auto z-20 transition-all ${isMobile ? 'absolute inset-0 w-full' : 'absolute left-0 top-0 bottom-0 w-72 md:relative md:w-72'}`}>
                                    <div className="p-3">
                                        <div className="flex items-center justify-between mb-3 px-1">
                                            <h3 className="text-[13px] font-semibold text-zinc-500 uppercase tracking-wider">
                                                Conversations
                                            </h3>
                                            <span className="text-[11px] text-zinc-600">{threads.length}</span>
                                        </div>
                                        {isLoadingThreads ? (
                                            <div className="flex items-center justify-center py-8">
                                                <Loader2 className="w-4 h-4 text-zinc-600 animate-spin" />
                                            </div>
                                        ) : threads.length === 0 ? (
                                            <p className="text-sm text-zinc-600 text-center py-8">No conversations yet</p>
                                        ) : (
                                            <div className="py-2">
                                                <CollapsibleThreadGroup
                                                    title="Recent"
                                                    threads={groupedThreads.recent}
                                                    activeId={activeThreadId}
                                                    onLoad={loadThread}
                                                    onDelete={handleDeleteThread}
                                                    defaultExpanded={true}
                                                />
                                                <CollapsibleThreadGroup
                                                    title="Last 24 Hours"
                                                    threads={groupedThreads.last24Hours}
                                                    activeId={activeThreadId}
                                                    onLoad={loadThread}
                                                    onDelete={handleDeleteThread}
                                                    defaultExpanded={true}
                                                />
                                                <CollapsibleThreadGroup
                                                    title="Previous 7 Days"
                                                    threads={groupedThreads.last7Days}
                                                    activeId={activeThreadId}
                                                    onLoad={loadThread}
                                                    onDelete={handleDeleteThread}
                                                    defaultExpanded={true}
                                                />
                                                {groupedThreads.recent.length === 0 && groupedThreads.last24Hours.length === 0 && groupedThreads.last7Days.length === 0 && (
                                                    <p className="text-sm text-zinc-600 text-center py-8">No recent conversations</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Main Chat Pane */}
                            <div className="flex flex-col flex-1 min-w-0">
                                {/* Messages Area */}
                                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                                    {!activeThreadId ? (
                                        /* Welcome screen */
                                        <div className="flex flex-col items-center justify-center h-full text-center px-8">
                                            <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20
                                                  flex items-center justify-center mb-6 ring-1 ring-white/10">
                                                <Sparkles className="w-9 h-9 text-violet-400" />
                                                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-black/50 animate-pulse" />
                                            </div>
                                            <h3 className="text-2xl font-bold bg-gradient-to-r from-violet-300 via-indigo-300 to-violet-400 bg-clip-text text-transparent mb-2">
                                                CHouse AI
                                            </h3>
                                            <p className="text-sm text-zinc-500 mb-8 leading-relaxed max-w-md">
                                                Your intelligent ClickHouse assistant. Explore schemas, write queries,
                                                analyze performance, and get instant insights from your data.
                                            </p>
                                            {/* Suggested prompts — random subset with shuffle */}
                                            <div className="w-full max-w-lg mb-6">
                                                <div className={`grid gap-3 ${useSingleColPrompt ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                                    {visiblePrompts.map((sp) => (
                                                        <button
                                                            key={sp.label}
                                                            onClick={async () => { if (!activeThreadId) { await handleNewThread(); } setInput(sp.prompt); setTimeout(() => inputRef.current?.focus(), 100); }}
                                                            className="flex items-center gap-3 px-4 py-3.5 rounded-xl
                                                             bg-white/[0.04] border border-white/[0.07]
                                                             hover:bg-violet-500/10 hover:border-violet-500/20
                                                             hover:shadow-lg hover:shadow-violet-500/5
                                                             text-left transition-all duration-300 group"
                                                        >
                                                            <div className="p-1.5 rounded-lg bg-violet-500/10 group-hover:bg-violet-500/20 transition-colors">
                                                                <sp.icon className="w-3.5 h-3.5 text-violet-400/70 group-hover:text-violet-300 transition-colors" />
                                                            </div>
                                                            <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">{sp.label}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                                <button
                                                    onClick={() => setShuffleKey(Date.now())}
                                                    className="flex items-center gap-1.5 mx-auto mt-3 px-3 py-1.5 rounded-lg
                                                     text-[11px] text-zinc-600 hover:text-zinc-300
                                                     hover:bg-white/[0.04] transition-all duration-200"
                                                    title="Show different suggestions"
                                                >
                                                    <Shuffle className="w-3 h-3" />
                                                    More suggestions
                                                </button>
                                            </div>
                                            <button
                                                onClick={handleNewThread}
                                                className="px-6 py-2.5 rounded-xl
                                                 bg-gradient-to-r from-violet-500 to-indigo-600
                                                 hover:from-violet-400 hover:to-indigo-500
                                                 text-white text-sm font-medium transition-all duration-300
                                                 flex items-center gap-2
                                                 shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40"
                                            >
                                                <Plus className="w-4 h-4" />
                                                Start New Chat
                                            </button>
                                        </div>
                                    ) : messages.length === 0 ? (
                                        /* Thread selected but empty */
                                        <div className="flex flex-col items-center justify-center h-full text-center px-8">
                                            <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500/15 to-indigo-500/15 ring-1 ring-white/[0.06] mb-4">
                                                <Bot className="w-8 h-8 text-violet-400/60" />
                                            </div>
                                            <p className="text-sm text-zinc-500 mb-6">
                                                Ask me anything about your ClickHouse databases
                                            </p>
                                            <div className="w-full max-w-md">
                                                <div className={`grid gap-2 ${useSingleColPrompt ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                                    {visiblePrompts.map((sp) => (
                                                        <button
                                                            key={sp.label}
                                                            onClick={async () => { if (!activeThreadId) { await handleNewThread(); } setInput(sp.prompt); setTimeout(() => inputRef.current?.focus(), 100); }}
                                                            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl
                                                             bg-white/[0.04] border border-white/[0.07]
                                                             hover:bg-violet-500/10 hover:border-violet-500/20
                                                             text-left transition-all duration-300 group"
                                                        >
                                                            <div className="p-1 rounded-md bg-violet-500/10 group-hover:bg-violet-500/20 transition-colors">
                                                                <sp.icon className="w-3 h-3 text-violet-400/60 group-hover:text-violet-300 transition-colors" />
                                                            </div>
                                                            <span className="text-xs text-zinc-500 group-hover:text-zinc-200 transition-colors">{sp.label}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                                <button
                                                    onClick={() => setShuffleKey(Date.now())}
                                                    className="flex items-center gap-1.5 mx-auto mt-2.5 px-3 py-1.5 rounded-lg
                                                     text-[11px] text-zinc-600 hover:text-zinc-300
                                                     hover:bg-white/[0.04] transition-all duration-200"
                                                    title="Show different suggestions"
                                                >
                                                    <Shuffle className="w-3 h-3" />
                                                    More suggestions
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Message list */
                                        <>
                                            {messages.map((msg, idx) => (
                                                <div
                                                    key={msg.id}
                                                    className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
                                                    style={{ animation: `fadeSlideIn 0.3s ease-out ${Math.min(idx * 0.05, 0.3)}s both` }}
                                                >
                                                    {msg.role === 'assistant' && (
                                                        <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5
                                                              ${msg.isError
                                                                ? 'bg-red-500/15 ring-1 ring-red-500/20'
                                                                : 'bg-gradient-to-br from-violet-500/20 to-indigo-500/20 ring-1 ring-white/[0.06]'}`}>
                                                            {msg.isError
                                                                ? <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                                                                : <Bot className="w-3.5 h-3.5 text-violet-400" />}
                                                        </div>
                                                    )}
                                                    <div className={`flex flex-col gap-0.5 min-w-0 ${msg.role === 'assistant' && msg.chartSpecs?.length ? 'flex-1' : ''}`} style={{ maxWidth: msg.role === 'user' ? '75%' : '85%' }}>
                                                        <div
                                                            className={`rounded-2xl px-4 py-3 text-sm leading-relaxed overflow-hidden
                                                              ${msg.role === 'user'
                                                                    ? 'bg-violet-500/15 text-zinc-100 border border-violet-500/15'
                                                                    : msg.isError
                                                                        ? 'bg-red-500/10 text-red-300 border border-red-500/15'
                                                                        : 'bg-white/[0.04] text-zinc-200 border border-white/[0.06]'
                                                                }`}
                                                        >
                                                            {msg.role === 'assistant' ? (
                                                                <>
                                                                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                                                                        <ThinkingPanel
                                                                            toolCalls={msg.toolCalls}
                                                                            isStreaming={msg.isStreaming}
                                                                        />
                                                                    )}
                                                                    {msg.isStreaming && msg.toolStatus && !msg.content && !msg.toolCalls?.length && (
                                                                        <div className="flex items-center gap-2 text-violet-400/80 text-xs py-1">
                                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                                            <span>{msg.toolStatus}</span>
                                                                        </div>
                                                                    )}
                                                                    {msg.isError ? (
                                                                        <div className="flex flex-col gap-2">
                                                                            <p className="text-sm text-red-300/90">{msg.content}</p>
                                                                            {msg.retryPrompt && (
                                                                                <button
                                                                                    onClick={() => handleRetry(msg.retryPrompt!)}
                                                                                    disabled={isStreaming}
                                                                                    className="flex items-center gap-1.5 text-xs text-red-400/80 hover:text-red-300
                                                                                     disabled:opacity-40 transition-colors self-start
                                                                                     px-2 py-1 rounded-lg hover:bg-red-500/10"
                                                                                >
                                                                                    <RefreshCw className="w-3 h-3" />
                                                                                    Retry
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            {msg.chartSpecs?.map((spec, i) => (
                                                                                <AiChartRenderer key={i} spec={spec} />
                                                                            ))}
                                                                            <div className="overflow-x-auto max-w-full">
                                                                                <ReactMarkdown
                                                                                    remarkPlugins={[remarkGfm]}
                                                                                    components={markdownComponents}
                                                                                >
                                                                                    {preprocessMarkdown(msg.content) + (msg.isStreaming && !msg.toolStatus ? ' ▊' : '')}
                                                                                </ReactMarkdown>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </>
                                                            ) : (
                                                                <span className="whitespace-pre-wrap">{msg.content}</span>
                                                            )}
                                                        </div>
                                                        <span className={`text-[10px] text-zinc-600 px-1 ${msg.role === 'user' ? 'text-right' : ''}`}>
                                                            {timeAgo(msg.createdAt)}
                                                        </span>
                                                    </div>
                                                    {
                                                        msg.role === 'user' && (
                                                            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5 ring-1 ring-white/[0.06]">
                                                                <User className="w-3.5 h-3.5 text-indigo-400" />
                                                            </div>
                                                        )
                                                    }
                                                </div>
                                            ))}
                                            <div ref={messagesEndRef} />
                                        </>
                                    )}
                                </div>

                                {/* Input Area */}
                                {activeThreadId && (
                                    <div className={`relative z-10 flex-shrink-0 px-5 border-t border-white/[0.06] bg-black/40 backdrop-blur-sm ${isMobile ? 'pt-3 pb-6' : 'py-3'}`}>
                                        <form onSubmit={handleSend} className="flex items-end gap-3">
                                            <textarea
                                                ref={inputRef}
                                                value={input}
                                                onChange={(e) => setInput(e.target.value)}
                                                onKeyDown={handleKeyDown}
                                                placeholder="Ask about your databases, schemas, queries…"
                                                disabled={isStreaming}
                                                rows={1}
                                                className="flex-1 resize-none rounded-xl px-4 py-3 text-sm
                                             bg-white/[0.05] border border-white/[0.08] text-zinc-100
                                             placeholder:text-zinc-600
                                             focus:outline-none focus:border-violet-500/30 focus:ring-2 focus:ring-violet-500/10
                                             disabled:opacity-40 transition-all duration-200
                                             max-h-[120px] min-h-[44px]"
                                                style={{ height: 'auto' }}
                                                onInput={(e) => {
                                                    const target = e.target as HTMLTextAreaElement;
                                                    target.style.height = 'auto';
                                                    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                                                }}
                                            />
                                            {isStreaming ? (
                                                <button
                                                    type="button"
                                                    onClick={handleStop}
                                                    className="p-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/15
                                                 text-red-400 transition-all duration-200 flex-shrink-0"
                                                    title="Stop generating"
                                                >
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                </button>
                                            ) : (
                                                <button
                                                    type="submit"
                                                    disabled={!input.trim()}
                                                    className="p-3 rounded-xl
                                                 bg-gradient-to-r from-violet-500 to-indigo-600
                                                 hover:from-violet-400 hover:to-indigo-500
                                                 disabled:from-white/[0.04] disabled:to-white/[0.04] disabled:text-zinc-600
                                                 text-white transition-all duration-300 flex-shrink-0
                                                 shadow-lg shadow-violet-500/20 disabled:shadow-none"
                                                    title="Send message"
                                                >
                                                    <Send className="w-4 h-4" />
                                                </button>
                                            )}
                                        </form>
                                        <div className="flex items-center justify-between mt-1.5 px-1">
                                            <span className="text-[10px] text-zinc-700">Shift+Enter for new line · Esc to close</span>
                                            {isStreaming && toolStatus && (
                                                <span className="text-[10px] text-violet-400/60 flex items-center gap-1">
                                                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                                    {toolStatus}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
