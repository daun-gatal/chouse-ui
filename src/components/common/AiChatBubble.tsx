/**
 * AI Chat Bubble
 *
 * Fixed side-tab that opens into a full AI chat window.
 * Only renders if the user has ai:chat permission and AI is enabled.
 */

import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWindowSize, type Breakpoint } from '@/hooks/useWindowSize';
import { useDeviceType } from '@/hooks/useDeviceType';
import {
    getChatPrefsFromWorkspace,
    mergeChatPrefsIntoWorkspace,
    type DeviceType,
    type WorkspacePreferencesMap,
} from '@/lib/devicePreferences';
import { useVirtualizer } from '@tanstack/react-virtual';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import 'highlight.js/styles/github-dark.min.css';
import { useRbacStore, RBAC_PERMISSIONS, useAuthStore } from '@/stores';
import { rbacUserPreferencesApi } from '@/api/rbac';
import {
    getChatStatus,
    listThreads,
    createThread,
    getThread,
    deleteThread,
    updateThreadTitle,
    invokeChatMessage,
    getAiModels,
    type AiModelSimple,
    type ChatThread,
    type ChatMessage,
    type ChartSpec,
} from '@/api/ai-chat';
import { toast } from 'sonner';
import { log } from '@/lib/log';
import { useOnboardingSurfaceDismissAction } from '@/lib/onboardingSurfaces';
import { useOnboardingGuideActive } from '@/features/onboarding';
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
    Copy,
    Pencil,
    Download,
} from 'lucide-react';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ============================================
// Resize constants
// ============================================

// Right-edge side-sheet widths (cycled by header toggle, resizable from left edge)
const SHEET_WIDTH_COMPACT = 420;
const SHEET_WIDTH_STANDARD = 560;
const SHEET_WIDTH_WIDE = 760;
const MIN_SHEET_WIDTH = 360;
const MAX_SHEET_WIDTH_RATIO = 0.7; // never exceed 70% of viewport width

// Register highlight.js languages
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('json', json);

// ============================================
// Types
// ============================================

/** One tool call tracked during a invoked response */
interface ToolCallStep {
    id?: string;
    parentId?: string;
    tool: string;
    args: Record<string, unknown>;
    status: 'running' | 'done';
    label?: string;
    category?: string;
    description?: string;
    summary?: string | null;
}

interface UIMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
    isInvoking?: boolean;
    toolStatus?: string;
    isError?: boolean;
    /** snapshot of user message to retry */
    retryPrompt?: string;
    /** when false, do not show Retry button (e.g. non-retryable server error) */
    retryable?: boolean;
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

/** Copy text to clipboard and show toast */
async function copyToClipboard(text: string, label: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(`${label} copied to clipboard`);
    } catch {
        toast.error('Failed to copy');
    }
}

/** Build markdown export of messages for the current thread */
function exportThreadAsMarkdown(messages: UIMessage[], threadTitle: string | null): string {
    const lines: string[] = [threadTitle ? `# ${threadTitle}\n` : '# Chat export\n'];
    for (const msg of messages) {
        const role = msg.role === 'user' ? '**You**' : '**Assistant**';
        lines.push(`${role}\n\n${msg.content}\n\n`);
    }
    return lines.join('');
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
// ActivityPanel: expandable assistant activity timeline
// ============================================

function activityLabelFor(step: ToolCallStep): { label: string; category: string; description?: string } {
    if (step.label || step.category || step.description) {
        return {
            label: step.label || step.tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            category: step.category || 'Activity',
            description: step.description,
        };
    }

    const subjectKeys = ['database', 'table', 'tableName', 'queryId', 'nodeId', 'name'];
    const subjectKey = subjectKeys.find((key) => typeof step.args[key] === 'string' && String(step.args[key]).trim());
    const subject = subjectKey ? String(step.args[subjectKey]).slice(0, 80) : undefined;
    const map: Record<string, { label: string; category: string }> = {
        list_databases: { label: 'Checking available databases', category: 'Schema' },
        list_tables: { label: 'Inspecting tables', category: 'Schema' },
        get_database_info: { label: 'Summarizing database', category: 'Schema' },
        get_table_schema: { label: 'Reading table schema', category: 'Schema' },
        get_table_ddl: { label: 'Reading table definition', category: 'Schema' },
        search_columns: { label: 'Searching columns', category: 'Schema' },
        run_select_query: { label: 'Running read-only query', category: 'Query' },
        validate_sql: { label: 'Validating SQL', category: 'Query' },
        analyze_query: { label: 'Estimating query plan', category: 'Optimization' },
        get_slow_queries: { label: 'Reviewing slow queries', category: 'System' },
        get_running_queries: { label: 'Checking running queries', category: 'System' },
        get_system_errors: { label: 'Checking system errors', category: 'System' },
        export_query_result: { label: 'Preparing export', category: 'Export' },
        generate_query: { label: 'Drafting SQL', category: 'Query' },
        optimize_query: { label: 'Analyzing query performance', category: 'Optimization' },
        query_node: { label: 'Checking fleet node', category: 'Fleet' },
        render_chart: { label: 'Building visualization', category: 'Chart' },
    };

    const mapped = map[step.tool] ?? {
        label: step.tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        category: 'Activity',
    };
    return { ...mapped, description: subject };
}

function activityIcon(category: string) {
    const normalized = category.toLowerCase();
    if (normalized.includes('schema')) return Database;
    if (normalized.includes('query')) return Search;
    if (normalized.includes('chart')) return BarChart3;
    if (normalized.includes('optim')) return TrendingUp;
    if (normalized.includes('fleet') || normalized.includes('system')) return Server;
    if (normalized.includes('planning')) return FileText;
    return Activity;
}

function visibleArgs(args: Record<string, unknown>): Array<[string, string]> {
    const priority = ['database', 'table', 'tableName', 'queryId', 'nodeId', 'sql', 'query', 'description', 'subagent'];
    return priority
        .filter((key) => args[key] !== undefined && args[key] !== null && args[key] !== '')
        .slice(0, 2)
        .map((key) => {
            const raw = args[key];
            const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
            return [key, value.length > 120 ? `${value.slice(0, 117)}...` : value];
        });
}

// Reusable component for sidebar thread item
function SidebarThreadButton({
    thread,
    activeId,
    editingId,
    onLoad,
    onDelete,
    onStartEdit,
    onSaveTitle,
    onCancelEdit,
}: {
    thread: ChatThread;
    activeId: string | null;
    editingId: string | null;
    onLoad: (id: string) => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
    onStartEdit: (id: string, e: React.MouseEvent) => void;
    onSaveTitle: (id: string, title: string) => void;
    onCancelEdit: () => void;
}) {
    const [editValue, setEditValue] = useState(thread.title || '');
    const isEditing = editingId === thread.id;

    const handleSave = useCallback(() => {
        const trimmed = editValue.trim();
        if (trimmed) onSaveTitle(thread.id, trimmed);
        else onCancelEdit();
    }, [thread.id, editValue, onSaveTitle, onCancelEdit]);

    return (
        <div
            role="listitem"
            tabIndex={0}
            onClick={() => !isEditing && onLoad(thread.id)}
            onKeyDown={(e) => {
                if (isEditing) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSave();
                    }
                    return;
                }
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onLoad(thread.id);
                }
            }}
            className={`w-full text-left px-3 py-2 rounded-xs text-[13px]
                      flex items-center justify-between group transition-colors duration-200 cursor-pointer border
                      ${activeId === thread.id
                    ? 'border-ink-500 bg-ink-200 text-paper border-l-brand border-l-2'
                    : 'border-transparent text-paper-muted hover:bg-ink-200 hover:text-paper'
                }`}
        >
            <div className="flex-1 min-w-0 mr-2">
                {isEditing ? (
                    <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={(e) => e.key === 'Escape' && onCancelEdit()}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded-xs border border-ink-500 bg-ink-100 px-2 py-1 text-[13px] text-paper focus:border-brand focus:outline-none focus:ring-0"
                        placeholder="Thread title"
                        autoFocus
                        aria-label="Edit thread title"
                    />
                ) : (
                    <>
                        <span className="block truncate">{thread.title || 'New Thread'}</span>
                        <span className="flex items-center gap-1 mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                            <Clock className="w-2.5 h-2.5" />
                            {timeAgo(thread.updatedAt)}
                        </span>
                    </>
                )}
            </div>
            {!isEditing && (
                <>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onStartEdit(thread.id, e);
                            setEditValue(thread.title || '');
                        }}
                        className="p-1 rounded-xs opacity-0 group-hover:opacity-100 hover:bg-ink-300 text-paper-dim hover:text-paper transition-colors"
                        title="Rename"
                        aria-label="Rename thread"
                    >
                        <Pencil className="w-3 h-3" />
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(thread.id, e);
                        }}
                        className="p-1 rounded-xs opacity-0 group-hover:opacity-100
                                 hover:bg-red-950/40 text-paper-dim hover:text-red-300 transition-colors"
                        title="Delete chat"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                </>
            )}
        </div>
    );
}

// Collapsible group for thread sections
function CollapsibleThreadGroup({
    title,
    threads,
    activeId,
    editingId,
    onLoad,
    onDelete,
    onStartEdit,
    onSaveTitle,
    onCancelEdit,
    defaultExpanded = true,
}: {
    title: string;
    threads: ChatThread[];
    activeId: string | null;
    editingId: string | null;
    onLoad: (id: string) => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
    onStartEdit: (id: string, e: React.MouseEvent) => void;
    onSaveTitle: (id: string, title: string) => void;
    onCancelEdit: () => void;
    defaultExpanded?: boolean;
}) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    if (threads.length === 0) return null;

    return (
        <div className="mb-4 last:mb-0">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="sticky top-0 z-10 border-b border-ink-500 flex items-center gap-1.5 w-[calc(100%+24px)] -mx-3 px-4 font-mono text-[10px] uppercase tracking-[0.18em] bg-ink-100 py-2.5 mb-2 transition-colors text-paper-dim hover:text-paper"
            >
                <div className="flex items-center justify-center p-0.5 rounded-xs transition-colors hover:bg-ink-200">
                    {isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-paper-dim" />
                    ) : (
                        <ChevronRight className="w-3 h-3 text-paper-dim" />
                    )}
                </div>
                {title}
                <span className="ml-auto font-mono text-[10px] text-paper-faint normal-case">{threads.length}</span>
            </button>

            <div
                className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                role="list"
                aria-label="Chat threads"
            >
                <div className="overflow-hidden flex flex-col gap-0.5">
                    {threads.map((t) => (
                        <SidebarThreadButton
                            key={t.id}
                            thread={t}
                            activeId={activeId}
                            editingId={editingId}
                            onLoad={onLoad}
                            onDelete={onDelete}
                            onStartEdit={onStartEdit}
                            onSaveTitle={onSaveTitle}
                            onCancelEdit={onCancelEdit}
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

function ActivityPanel({ toolCalls, isInvoking }: { toolCalls: ToolCallStep[]; isInvoking?: boolean }) {
    const [expanded, setExpanded] = useState(false);

    if (!toolCalls || toolCalls.length === 0) return null;

    const runningCount = toolCalls.filter((t) => t.status === 'running').length;
    const isRunning = isInvoking && runningCount > 0;
    const roots = toolCalls.filter((step) => !step.parentId);
    const childrenByParent = toolCalls.reduce<Record<string, ToolCallStep[]>>((acc, step) => {
        if (!step.parentId) return acc;
        acc[step.parentId] = [...(acc[step.parentId] ?? []), step];
        return acc;
    }, {});
    const completedLabels = roots
        .filter((step) => step.status === 'done')
        .slice(-3)
        .map((step) => activityLabelFor(step).label.toLowerCase());
    const label = isRunning
        ? `Working through ${toolCalls.length} step${toolCalls.length !== 1 ? 's' : ''}...`
        : completedLabels.length > 0
            ? `Completed ${completedLabels.join(', ')}`
            : `Completed ${toolCalls.length} step${toolCalls.length !== 1 ? 's' : ''}`;

    const renderStep = (step: ToolCallStep, depth = 0) => {
        const presentation = activityLabelFor(step);
        const Icon = activityIcon(presentation.category);
        const args = visibleArgs(step.args);
        const children = step.id ? childrenByParent[step.id] ?? [] : [];

        return (
            <div key={step.id ?? `${step.tool}-${depth}`} className={depth > 0 ? 'ml-5 border-l border-ink-500 pl-3' : ''}>
                <div className="pt-2.5 flex gap-2.5">
                    <div className="flex-shrink-0 pt-0.5">
                        {step.status === 'running'
                            ? <Loader2 className="w-3 h-3 text-brand motion-safe:animate-spin" />
                            : <CheckCircle2 className="w-3 h-3 text-emerald-400/80" />
                        }
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                            <Icon className="h-3 w-3 shrink-0 text-paper-dim" />
                            <span className="truncate text-[12px] font-medium text-paper">{presentation.label}</span>
                            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">{presentation.category}</span>
                        </div>
                        {presentation.description && (
                            <p className="truncate text-[11px] text-paper-muted">{presentation.description}</p>
                        )}
                        {args.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {args.map(([key, value]) => (
                                    <span key={key} className="max-w-full truncate rounded-xs border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">
                                        {key}: {value}
                                    </span>
                                ))}
                            </div>
                        )}
                        {step.status === 'done' && step.summary && (
                            <p className="text-[10px] text-emerald-400/80">{step.summary}</p>
                        )}
                    </div>
                </div>
                {children.length > 0 && (
                    <div className="mt-1 space-y-1">
                        {children.map((child) => renderStep(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="mb-3 rounded-xs border border-ink-500 bg-ink-200 overflow-hidden">
            {/* Subtle pulse bar while running */}
            {isRunning && (
                <div className="h-px w-full bg-brand/50 motion-safe:animate-pulse" />
            )}
            <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-ink-300"
            >
                {isRunning
                    ? <Loader2 className="w-3.5 h-3.5 text-brand motion-safe:animate-spin flex-shrink-0" />
                    : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/80 flex-shrink-0" />
                }
                <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">{label}</span>
                <ChevronDown
                    className={`w-3.5 h-3.5 text-paper-dim transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                />
            </button>

            {expanded && (
                <div className="px-3 pb-3 space-y-1 border-t border-ink-500">
                    {roots.map((step) => renderStep(step))}
                </div>
            )}
        </div>
    );
}

// Custom renderers for ReactMarkdown (typed to avoid `any` per .rules)
type CodeComponentProps = React.ComponentPropsWithoutRef<'code'> & { className?: string; children?: React.ReactNode };

const markdownComponents = {
    table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
        <div className="overflow-x-auto my-2 rounded-xs border border-ink-500">
            <table className="min-w-full text-[12px]" {...props}>{children}</table>
        </div>
    ),
    thead: ({ children, ...props }: React.ComponentPropsWithoutRef<'thead'>) => (
        <thead className="bg-ink-200" {...props}>{children}</thead>
    ),
    th: ({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) => (
        <th className="px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim border-b border-ink-500 whitespace-nowrap" {...props}>{children}</th>
    ),
    td: ({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) => (
        <td className="px-3 py-1.5 text-paper-muted border-b border-ink-500 whitespace-nowrap" {...props}>{children}</td>
    ),
    code: ({ className, children, ...props }: CodeComponentProps) => {
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
            const sanitized = DOMPurify.sanitize(highlighted, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] });
            return (
                <div className="relative group/code">
                    <button
                        type="button"
                        onClick={() => copyToClipboard(codeStr, 'Code')}
                        className="absolute top-2 right-2 p-1.5 rounded-xs opacity-0 group-hover/code:opacity-100 hover:bg-ink-300 text-paper-dim hover:text-paper transition-colors"
                        title="Copy code"
                        aria-label="Copy code"
                    >
                        <Copy className="w-3 h-3" />
                    </button>
                    <code
                        className={`${className || ''} text-[12px] block pr-8`}
                        dangerouslySetInnerHTML={{ __html: sanitized }}
                        {...props}
                    />
                </div>
            );
        }
        // Inline code
        return <code className="rounded-xs border border-ink-500 bg-ink-200 px-1 font-mono text-[11px] text-paper" {...props}>{children}</code>;
    },
    pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) => (
        <pre className="rounded-xs border border-ink-500 bg-ink-200 p-3 overflow-x-auto my-2 font-mono text-[12px] text-paper" {...props}>{children}</pre>
    ),
    p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
        <p className="my-1.5 leading-relaxed text-paper-muted" {...props}>{children}</p>
    ),
    ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) => (
        <ul className="list-disc list-outside ml-5 my-1.5 space-y-0.5 text-paper-muted marker:text-brand" {...props}>{children}</ul>
    ),
    ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) => (
        <ol className="list-decimal list-outside ml-5 my-1.5 space-y-0.5 text-paper-muted marker:text-brand" {...props}>{children}</ol>
    ),
    h1: ({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) => <h1 className="text-[18px] font-semibold tracking-tight text-paper mt-3 mb-1" {...props}>{children}</h1>,
    h2: ({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) => <h2 className="text-[16px] font-semibold tracking-tight text-paper mt-3 mb-1" {...props}>{children}</h2>,
    h3: ({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) => <h3 className="text-[14px] font-semibold tracking-tight text-paper mt-2 mb-1" {...props}>{children}</h3>,
    a: ({ children, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
        <a className="text-brand underline hover:text-brand-soft" target="_blank" rel="noopener" {...props}>{children}</a>
    ),
    blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote className="border-l-2 border-brand pl-3 my-2 text-paper-muted italic" {...props}>{children}</blockquote>
    ),
    // Suppress images — the AI sometimes generates ![chart](...) markdown which renders as broken <img>
    img: () => null,
    br: () => <br />,
};

/**
 * Normalise common AI output quirks before passing to ReactMarkdown.
 * All transformations are applied only outside code fences (content inside ``` blocks is left unchanged).
 *
 * Normalized quirks:
 * - Leading: blank lines and leading spaces on the first line stripped (so first line is not indented)
 * - Line endings: \\r\\n and \\r normalized to \\n
 * - Headings: missing space after # (e.g. ##Heading → ## Heading)
 * - Code fences: opening/closing fence lines trimmed so fence is alone; closing fence with trailing content split
 * - Tables: literal \\n and <br> in table rows collapsed to spaces; malformed ```lang\\nCODE\\n``` in cells → inline `CODE`; row cell count normalized to match header
 * - Paragraphs: literal \\n → real newlines; <br> variants → newlines
 */
export function preprocessMarkdown(text: string): string {
    if (!text) return text;

    // 1. Normalize line endings first
    const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let lines = normalizedText.split('\n');

    // 2. Strip leading blank lines and leading spaces on the first line (fixes AI output like "          Here's the SQL...")
    let firstNonEmpty = 0;
    while (firstNonEmpty < lines.length && lines[firstNonEmpty].trim() === '') firstNonEmpty++;
    if (firstNonEmpty < lines.length) {
        lines[firstNonEmpty] = lines[firstNonEmpty].trimStart();
    }
    if (firstNonEmpty > 0) {
        lines = lines.slice(firstNonEmpty);
    }

    let inCodeFence = false;
    let inTable = false;
    let tableHeaderCellCount = 0;
    const out: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Track code fence boundaries (standalone lines starting with ```)
        const isClosingFence = inCodeFence;
        if (/^\s*```/.test(line)) {
            inCodeFence = !inCodeFence;
            // Normalize fence line: trim and ensure fence is alone; if trailing content, split
            const trimmed = line.trimStart();
            const backtick = '\u0060';
            let fenceEnd = 0;
            while (fenceEnd < trimmed.length && trimmed[fenceEnd] === backtick) fenceEnd++;
            if (fenceEnd >= 3) {
                if (isClosingFence) {
                    // Closing fence: only backticks then optional spaces then rest (no lang)
                    const rest = trimmed.slice(fenceEnd).trimStart();
                    if (rest) {
                        out.push(trimmed.slice(0, fenceEnd));
                        out.push(rest);
                    } else {
                        out.push(trimmed.trimEnd());
                    }
                } else {
                    // Opening fence: backticks, optional lang, optional spaces, then rest
                    while (fenceEnd < trimmed.length && trimmed[fenceEnd] === ' ') fenceEnd++;
                    while (fenceEnd < trimmed.length && /\w/.test(trimmed[fenceEnd])) fenceEnd++;
                    while (fenceEnd < trimmed.length && trimmed[fenceEnd] === ' ') fenceEnd++;
                    const rest = trimmed.slice(fenceEnd);
                    if (rest.trim()) {
                        const fences = trimmed.slice(0, 3);
                        const lang = trimmed.slice(3, fenceEnd).trim();
                        out.push(fences + (lang ? lang : ''));
                        out.push(rest.trim());
                    } else {
                        out.push(trimmed.trimEnd());
                    }
                }
            } else {
                out.push(line);
            }
            continue;
        }

        if (inCodeFence) {
            out.push(line);
            continue;
        }

        // Table row
        if (line.trimStart().startsWith('|')) {
            const cellCount = line.split('|').length - 2;
            if (!inTable) {
                inTable = true;
                tableHeaderCellCount = Math.max(1, cellCount);
            }
            // Normalize cell count to match header: pad with empty cells or trim
            let normalizedRow = line
                .replace(/```\w*\\n([\s\S]*?)(?:\\n)?```/g, (_match, code) =>
                    '`' + code.replace(/\\n/g, ' ').trim() + '`'
                )
                .replace(/\\n/g, ' ')
                .replace(/<br\s*\/?>/gi, ' ');

            const cells = normalizedRow.split('|').map((c) => c.trim());
            const body = cells.slice(1, -1);
            if (body.length !== tableHeaderCellCount) {
                if (body.length > tableHeaderCellCount) {
                    normalizedRow = '| ' + body.slice(0, tableHeaderCellCount).join(' | ') + ' |';
                } else {
                    const isSeparator = body.every((c) => /^[\s\-:]+$/.test(c));
                    const pad = isSeparator ? '---' : '';
                    const padded = [...body, ...Array(tableHeaderCellCount - body.length).fill(pad)];
                    normalizedRow = '| ' + padded.join(' | ') + ' |';
                }
            }
            out.push(normalizedRow);
            continue;
        }

        inTable = false;

        // Heading: ensure space after # (e.g. ##Heading → ## Heading)
        if (/^#{1,6}[^\s#]/.test(line)) {
            line = line.replace(/^(#{1,6})([^\s#])/m, '$1 $2');
        }

        // Regular paragraph lines
        line = line
            .replace(/\\n/g, '\n')
            .replace(/<br\s*\/?>/gi, '  \n');

        out.push(line);
    }

    return out.join('\n');
}

// ============================================
// useAiChatInvoke hook
// ============================================

const INVOKE_STATUS_STEPS = [
    'Understanding your request',
    'Working through ClickHouse context',
    'Checking the evidence',
    'Preparing the response',
];

function useAiChatInvoke({
    setMessages,
    loadThreads,
    selectedModelId,
}: {
    setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
    loadThreads: () => void;
    selectedModelId: string;
}) {
    const [isInvoking, setIsInvoking] = useState(false);
    const [toolStatus, setToolStatus] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const runInvoke = useCallback(async (
        threadId: string,
        prompt: string,
        messageHistory: { role: string; content: string }[],
    ) => {
        const controller = new AbortController();
        abortRef.current = controller;
        setIsInvoking(true);
        setToolStatus(INVOKE_STATUS_STEPS[0]);
        setMessages((previous) => {
            const updated = [...previous];
            const last = updated[updated.length - 1];
            if (last?.role === 'assistant' && last.isInvoking) {
                updated[updated.length - 1] = { ...last, toolStatus: INVOKE_STATUS_STEPS[0] };
            }
            return updated;
        });

        let statusIndex = 0;
        const statusTimer = window.setInterval(() => {
            statusIndex = (statusIndex + 1) % INVOKE_STATUS_STEPS.length;
            const status = INVOKE_STATUS_STEPS[statusIndex];
            setToolStatus(status);
            setMessages((previous) => {
                const updated = [...previous];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant' && last.isInvoking) {
                    updated[updated.length - 1] = { ...last, toolStatus: status };
                }
                return updated;
            });
        }, 2500);

        try {
            const result = await invokeChatMessage(
                threadId,
                prompt,
                messageHistory,
                selectedModelId || undefined,
                controller.signal,
            );

            setMessages((previous) => {
                const updated = [...previous];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                    updated[updated.length - 1] = {
                        ...last,
                        content: result.content,
                        isInvoking: false,
                        toolStatus: undefined,
                        toolCalls: result.toolCalls.map((call, index) => ({
                            id: `activity_${index + 1}`,
                            tool: call.name,
                            args: call.args,
                            status: 'done',
                        })),
                        chartSpecs: result.chartSpecs,
                    };
                }
                return updated;
            });
        } catch (error: unknown) {
            const wasStopped = error instanceof Error && error.name === 'AbortError';
            const isNetwork = error instanceof Error &&
                (error.message.includes('fetch') || error.message.includes('network') || error.name === 'TypeError');
            const errorMessage = wasStopped
                ? 'Generation stopped.'
                : isNetwork
                    ? 'Connection failed. You can retry.'
                    : error instanceof Error
                        ? error.message
                        : 'Something went wrong. You can retry.';

            setMessages((previous) => {
                const updated = [...previous];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                    updated[updated.length - 1] = {
                        ...last,
                        content: errorMessage,
                        isInvoking: false,
                        isError: !wasStopped,
                        retryPrompt: wasStopped ? undefined : prompt,
                        retryable: !wasStopped,
                        toolStatus: undefined,
                    };
                }
                return updated;
            });
        } finally {
            window.clearInterval(statusTimer);
            setToolStatus(null);
            setIsInvoking(false);
            abortRef.current = null;
            loadThreads();
        }
    }, [loadThreads, selectedModelId, setMessages]);

    const handleStop = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    return { runInvoke, isInvoking, toolStatus, handleStop };
}

// ============================================
// Component
// ============================================

interface AiChatUnavailableTriggerProps {
    isLoading: boolean;
    isMobile: boolean;
}

function AiChatUnavailableTrigger({ isLoading, isMobile }: AiChatUnavailableTriggerProps): React.JSX.Element {
    const label = isLoading ? 'AI assistant is loading' : 'AI assistant is unavailable';
    const icon = isLoading
        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        : <Sparkles className="h-4 w-4" aria-hidden />;

    if (isMobile) {
        return (
            <button
                data-onboarding-id="ai-assistant"
                type="button"
                disabled
                aria-label={label}
                title={label}
                className="ai-chat-fab cursor-not-allowed opacity-60"
            >
                {icon}
            </button>
        );
    }

    return (
        <div
            className="fixed right-0 top-1/2 z-50 flex h-[110px] w-10 -translate-y-1/2 items-center justify-center"
        >
            <button
                data-onboarding-id="ai-assistant"
                type="button"
                disabled
                aria-label={label}
                title={label}
                className="flex h-24 w-9 cursor-not-allowed items-center justify-center rounded-l-md border-y border-l border-ink-500 bg-ink-100 text-paper-faint opacity-60"
            >
                {icon}
            </button>
        </div>
    );
}

export default function AiChatBubble() {
    const hasPermission = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_CHAT));
    const guideActive = useOnboardingGuideActive();
    const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
    const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
    const [aiModels, setAiModels] = useState<AiModelSimple[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<string>('');
    const [isOpen, setIsOpen] = useState(false);
    const dismissForOnboarding = useCallback(() => setIsOpen(false), []);
    useOnboardingSurfaceDismissAction(dismissForOnboarding);
    const [showSidebar, setShowSidebar] = useState(false);

    const lastLoadedDeviceRef = useRef<DeviceType | null>(null);
    const deviceType = useDeviceType();

    // Responsive breakpoint
    const { width: viewportWidth, height: viewportHeight, breakpoint } = useWindowSize();
    const isMobile = breakpoint === 'mobile';
    const isTablet = breakpoint === 'tablet';
    const isDesktop = breakpoint === 'desktop';

    // Sheet width state (desktop & tablet only — mobile is always full screen)
    const [sheetWidth, setSheetWidth] = useState(SHEET_WIDTH_STANDARD);
    const sheetWidthRef = useRef(sheetWidth);
    useEffect(() => {
        sheetWidthRef.current = sheetWidth;
    }, [sheetWidth]);

    // Max sheet width based on viewport (prevent the sheet from eating the whole screen)
    const maxSheetWidth = Math.max(MIN_SHEET_WIDTH, Math.floor(viewportWidth * MAX_SHEET_WIDTH_RATIO));
    const effectiveSheetWidth = Math.min(Math.max(sheetWidth, MIN_SHEET_WIDTH), maxSheetWidth);

    // Persistence — debounced
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveChatPrefsDebounced = useCallback((width: number): void => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(async () => {
            try {
                const current = await rbacUserPreferencesApi.getPreferences();
                const workspace = current.workspacePreferences as WorkspacePreferencesMap | undefined;
                // Keep the prefs API shape (position + size) but pin position to {0,0} and
                // store the sheet width in size.width — height fills viewport now.
                const merged = mergeChatPrefsIntoWorkspace(workspace, deviceType, {
                    position: { x: 0, y: 0 },
                    size: { width, height: 0 },
                });
                await rbacUserPreferencesApi.updatePreferences({ workspacePreferences: merged });
            } catch (err) {
                log.error('[AiChatBubble] Failed to save preferences:', err);
            }
        }, 1000);
    }, [deviceType]);

    // Load preferences (per device type)
    useEffect(() => {
        if (!hasPermission || lastLoadedDeviceRef.current === deviceType) return;
        const loadFromDb = async () => {
            try {
                const prefs = await rbacUserPreferencesApi.getPreferences();
                const workspace = prefs.workspacePreferences as WorkspacePreferencesMap | undefined;
                const { size: loadedSize } = getChatPrefsFromWorkspace(workspace, deviceType);
                if (deviceType !== 'mobile' && loadedSize.width >= MIN_SHEET_WIDTH) {
                    setSheetWidth(loadedSize.width);
                }
                lastLoadedDeviceRef.current = deviceType;
            } catch (err) {
                log.error('[AiChatBubble] Failed to load preferences:', err);
            }
        };
        loadFromDb();
    }, [hasPermission, deviceType]);

    // Logical dimensions for internal layout (no zoom — side-sheet renders at 1:1)
    const logicalWidth = isMobile ? viewportWidth : effectiveSheetWidth;
    const logicalHeight = viewportHeight;

    // Adaptive internal layout thresholds
    const hideSidebarThreshold = 720;
    const singleColPromptThreshold = 520;
    const shouldHideSidebar = showSidebar && !isMobile && logicalWidth < hideSidebarThreshold;
    const useSingleColPrompt = isMobile || logicalWidth < singleColPromptThreshold;

    // Width-only resize (drag the left edge of the sheet)
    const [isResizing, setIsResizing] = useState(false);
    const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
    const handleResizeStart = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.pointerType === 'touch') e.preventDefault();
        setIsResizing(true);
        resizeRef.current = { startX: e.clientX, startW: effectiveSheetWidth };
    }, [effectiveSheetWidth]);

    useEffect(() => {
        if (!isResizing) return;
        const handlePointerMove = (e: globalThis.PointerEvent) => {
            if (!resizeRef.current) return;
            if (e.pointerType === 'touch') e.preventDefault();
            const { startX, startW } = resizeRef.current;
            // Dragging left grows the sheet (sheet is anchored to the right edge).
            const next = Math.min(Math.max(startW + (startX - e.clientX), MIN_SHEET_WIDTH), maxSheetWidth);
            setSheetWidth(next);
        };
        const handlePointerUp = () => {
            setIsResizing(false);
            resizeRef.current = null;
        };
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isResizing, maxSheetWidth]);

    // Save width when resize ends
    const prevResizingRef = useRef(false);
    useEffect(() => {
        const wasResizing = prevResizingRef.current;
        prevResizingRef.current = isResizing;
        if (wasResizing && !isResizing) {
            saveChatPrefsDebounced(sheetWidthRef.current);
        }
    }, [isResizing, saveChatPrefsDebounced]);

    // Auto-close sidebar on smaller breakpoints
    useEffect(() => {
        if (isMobile || isTablet) setShowSidebar(false);
    }, [isMobile, isTablet]);

    // Thread state
    const [threads, setThreads] = useState<ChatThread[]>([]);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
    const [messages, setMessages] = useState<UIMessage[]>([]);
    const [isLoadingThreads, setIsLoadingThreads] = useState(false);

    // Input state
    const [input, setInput] = useState('');
    const [shuffleKey, setShuffleKey] = useState(() => Date.now());
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const messageVirtualizer = useVirtualizer({
        count: messages.length,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: () => 180,
        overscan: 5,
    });

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

    // Check AI status
    const checkStatus = useCallback(() => {
        if (!hasPermission) return;
        getChatStatus()
            .then((status) => setAiEnabled(status.enabled))
            .catch(() => setAiEnabled(false));
    }, [hasPermission]);

    useEffect(() => {
        checkStatus();
        window.addEventListener('ai-config-updated', checkStatus);
        return () => window.removeEventListener('ai-config-updated', checkStatus);
    }, [checkStatus]);

    // Fetch AI models
    const fetchModels = useCallback(() => {
        if (hasPermission && aiEnabled) {
            getAiModels().then(models => {
                setAiModels(models);
                const defaultModel = models.find(m => m.isDefault);
                if (defaultModel) {
                    setSelectedModelId(defaultModel.id);
                } else if (models.length > 0) {
                    setSelectedModelId(models[0].id);
                }
            }).catch((e) => log.error('[AiChat] Failed to fetch', e));
        }
    }, [hasPermission, aiEnabled]);

    useEffect(() => {
        fetchModels();
        window.addEventListener('ai-config-updated', fetchModels);
        return () => window.removeEventListener('ai-config-updated', fetchModels);
    }, [fetchModels]);


    // Auto-scroll to bottom without bubbling up scroll events to parent
    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                top: scrollContainerRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [messages]);

    const loadThreads = useCallback(async () => {
        setIsLoadingThreads(true);
        try {
            const result = await listThreads(activeConnectionId);
            setThreads(result);
        } catch (err) {
            log.error('[AiChat] Failed to load threads:', err);
        } finally {
            setIsLoadingThreads(false);
        }
    }, [activeConnectionId]);

    const { runInvoke, isInvoking, toolStatus, handleStop } = useAiChatInvoke({
        setMessages,
        loadThreads,
        selectedModelId,
    });

    // Focus input when thread loads
    useEffect(() => {
        if (activeThreadId && !isInvoking) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [activeThreadId, isInvoking]);

    // Escape key closes the chat window
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen]);

    const lastClosedAtRef = useRef<number | null>(null);
    const lastConnectionIdRef = useRef<string | null>(null);

    // Reload threads and reset state when connection or open status changes
    useEffect(() => {
        if (!isOpen) {
            // Track when the window was closed
            lastClosedAtRef.current = Date.now();
            lastConnectionIdRef.current = activeConnectionId;
            return;
        }

        if (isOpen && hasPermission && aiEnabled) {
            loadThreads();

            const now = Date.now();
            const lastClosed = lastClosedAtRef.current;
            const lastConn = lastConnectionIdRef.current;
            const FiveMinutes = 5 * 60 * 1000;

            const isSameConnection = lastConn === activeConnectionId;
            const isWithinTimeLimit = lastClosed !== null && (now - lastClosed < FiveMinutes);

            // Reset state if this is:
            // 1) The first time opening
            // 2) A different connection
            // 3) Opened after more than 5 minutes
            if (!isSameConnection || !isWithinTimeLimit) {
                setActiveThreadId(null);
                setMessages([]);
            }
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
                    toolCalls: m.toolCalls?.map((tc, index) => ({
                        id: `saved_${m.id}_${index}`,
                        tool: tc.name,
                        args: tc.args ?? {},
                        status: 'done' as const,
                        summary: tc.result ? null : undefined,
                    })) || undefined,
                    chartSpecs: m.chartSpecs || undefined,
                    createdAt: m.createdAt,
                }))
            );
        } catch (err) {
            log.error('[AiChat] Failed to load thread:', err);
        }
    }, []);

    const handleNewThread = useCallback(async () => {
        try {
            const thread = await createThread(undefined, activeConnectionId ?? undefined);
            setThreads((prev) => [thread, ...prev]);
            setActiveThreadId(thread.id);
            setMessages([]);
        } catch (err) {
            log.error('[AiChat] Failed to create thread:', err);
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
            log.error('[AiChat] Failed to delete thread:', err);
        }
    }, [activeThreadId]);

    const handleStartEditThread = useCallback((_threadId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingThreadId(_threadId);
    }, []);

    const handleSaveThreadTitle = useCallback(async (threadId: string, title: string) => {
        setEditingThreadId(null);
        try {
            await updateThreadTitle(threadId, title);
            setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, title } : t)));
        } catch (err) {
            log.error('[AiChat] Failed to update thread title:', err);
            toast.error('Failed to rename thread');
        }
    }, []);

    const handleCancelEditThread = useCallback(() => {
        setEditingThreadId(null);
    }, []);

    const handleExportThread = useCallback(() => {
        if (!activeThreadId || messages.length === 0) return;
        const thread = threads.find((t) => t.id === activeThreadId);
        const md = exportThreadAsMarkdown(messages, thread?.title ?? null);
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat-${(thread?.title || activeThreadId.slice(0, 8)).replace(/[^a-zA-Z0-9-_]/g, '-')}.md`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Thread exported');
    }, [activeThreadId, messages, threads]);

    const handleSend = useCallback(async (e?: FormEvent) => {
        e?.preventDefault();
        const trimmed = input.trim();
        if (!trimmed || isInvoking || !activeThreadId) return;

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
            isInvoking: true,
        };

        const messageHistory = messages.map((m) => ({ role: m.role, content: m.content }));
        messageHistory.push({ role: 'user', content: trimmed });

        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        setInput('');
        // Reset textarea height back to single line
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }

        await runInvoke(activeThreadId, trimmed, messageHistory);
    }, [input, isInvoking, activeThreadId, messages, runInvoke, selectedModelId]);

    const handleRetry = useCallback(async (retryPrompt: string) => {
        if (!retryPrompt || isInvoking || !activeThreadId) return;

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
                isInvoking: true,
            },
        ]);

        const messageHistory = messages
            .filter((m) => !m.isError)
            .map((m) => ({ role: m.role, content: m.content }));
        messageHistory.push({ role: 'user', content: retryPrompt });

        await runInvoke(activeThreadId, retryPrompt, messageHistory);
    }, [isInvoking, activeThreadId, messages, runInvoke, selectedModelId]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    // Helper to send a suggested prompt — shares runInvoke for consistent error handling
    const handleSuggestedPrompt = useCallback(async (prompt: string) => {
        if (isInvoking) return;
        let threadId = activeThreadId;
        if (!threadId) {
            try {
                const thread = await createThread(undefined, activeConnectionId ?? undefined);
                setThreads((prev) => [thread, ...prev]);
                setActiveThreadId(thread.id);
                threadId = thread.id;
                setMessages([]);
            } catch (err) {
                log.error('[AiChat] Failed to create thread:', err);
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
            isInvoking: true,
        };

        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        setInput('');

        await runInvoke(threadId, prompt, [{ role: 'user', content: prompt }]);
    }, [isInvoking, activeThreadId, runInvoke, activeConnectionId, selectedModelId]);

    if (!hasPermission) return null;
    if (aiEnabled !== true) {
        // While a guide chapter runs, keep a disabled shell so the AI step never
        // points at an element that appears late or does not exist on a fresh
        // installation. Outside guides, an unavailable assistant renders nothing.
        return guideActive
            ? <AiChatUnavailableTrigger isLoading={aiEnabled === null} isMobile={isMobile} />
            : null;
    }

    return (
        <>
            {/* Chat Trigger (FAB on mobile, Side Pill on tablet/desktop) */}
            {!isOpen && (
                isMobile ? (
                    <button
                        data-onboarding-id="ai-assistant"
                        onClick={() => setIsOpen(true)}
                        aria-label="Open AI Chat"
                        className="ai-chat-fab group"
                        title="Open AI Chat"
                    >
                        <Sparkles className="w-5 h-5 transition-colors" aria-hidden />
                        <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-ink-100" aria-hidden />
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
                            width: 40,
                            height: 110,
                        }}
                    >
                        <button
                            data-onboarding-id="ai-assistant"
                            type="button"
                            onClick={() => setIsOpen(true)}
                            aria-label="Open AI chat"
                            className="group flex items-center justify-center
                                       w-9 h-24 rounded-l-md cursor-pointer
                                       bg-ink-100 border-y border-l border-ink-500
                                       text-paper-dim
                                       transition-[border-color,background-color,color,transform] duration-200
                                       hover:bg-ink-200 hover:border-brand hover:text-brand
                                       hover:-translate-x-px"
                            title="Open AI chat"
                        >
                            <div className="flex flex-col items-center gap-1.5 py-3">
                                <Sparkles className="w-3.5 h-3.5" aria-hidden />
                                <span
                                    className="font-mono text-[10px] uppercase tracking-[0.18em]"
                                    style={{ writingMode: 'vertical-lr' }}
                                >
                                    Ask AI
                                </span>
                            </div>
                        </button>
                    </div>
                )
            )}

            {/* Chat Window Container — side-sheet docked to the right edge on desktop/tablet, full-screen on mobile */}
            {isOpen && (
                <div
                    className="fixed z-50 pointer-events-none"
                    style={isMobile ? {
                        inset: 0,
                    } : {
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: `${logicalWidth}px`,
                    }}
                >
                    <motion.div
                        data-onboarding-id="ai-assistant"
                        data-onboarding-surface="ai-chat"
                        initial={isMobile ? { opacity: 0 } : { x: '100%' }}
                        animate={isMobile ? { opacity: 1 } : { x: 0 }}
                        exit={isMobile ? { opacity: 0 } : { x: '100%' }}
                        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                        role="dialog"
                        aria-modal="false"
                        aria-label="AI chat assistant"
                        className={`pointer-events-auto flex flex-col overflow-hidden bg-ink-100 shadow-2xl shadow-black/40 w-full h-full
                                    ${isMobile ? 'border-0 rounded-none motion-safe:animate-[slideUpFull_0.3s_ease-out]' : 'border-l border-ink-500'}`}
                    >
                        {/* Main content wrapper */}
                        <div className="flex flex-col flex-1 relative w-full h-full">
                            {/* Left-edge width resize handle (desktop & tablet only) */}
                            {!isMobile && (
                                <div
                                    className={`absolute left-0 top-0 z-30 h-full w-1.5 -translate-x-1/2 cursor-ew-resize ${isResizing ? 'bg-brand/40' : 'hover:bg-brand/30'}`}
                                    style={{ touchAction: 'none' }}
                                    onPointerDown={(e) => {
                                        if (e.pointerType === 'touch') e.preventDefault();
                                        handleResizeStart(e);
                                    }}
                                    aria-label="Resize sheet width"
                                />
                            )}
                            {/* Full-screen overlay to keep pointer events smooth during resize */}
                            {isResizing && (
                                <div className="fixed inset-0 z-[100] cursor-ew-resize" />
                            )}

                            {/* Header — never shrinks (sheet is anchored; no longer draggable) */}
                            <div className="relative z-10 flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-ink-200 border-b border-ink-500">
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowSidebar(!showSidebar)}
                                        className="grid h-7 w-7 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper"
                                        title={showSidebar ? 'Close sidebar' : 'Thread history'}
                                        aria-label={showSidebar ? 'Close sidebar' : 'Thread history'}
                                    >
                                        {showSidebar ? <PanelLeftClose className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                                    </button>
                                    <div className="flex items-center gap-2.5">
                                        <div className="relative">
                                            <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
                                                <Bot className="h-3.5 w-3.5" aria-hidden />
                                            </span>
                                            <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-ink-200" aria-hidden />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[13px] font-semibold text-paper">CHouse AI</span>
                                            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Online</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-0.5">
                                    {aiModels.length > 0 && (
                                        <div className="mr-2 hidden sm:block">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button type="button" className="inline-flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-100 px-2 py-1 font-mono text-[11px] text-paper hover:border-ink-700 hover:bg-ink-300 transition-colors max-w-[180px]">
                                                        <span className="truncate">{aiModels.find(m => m.id === selectedModelId)?.name || 'Select model'}</span>
                                                        <ChevronDown className="h-3 w-3 text-paper-dim shrink-0" aria-hidden />
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-[240px] rounded-md border-ink-500 bg-ink-100 p-0">
                                                    <div className="border-b border-ink-500 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                                                        AI Models
                                                    </div>
                                                    <div className="flex max-h-[280px] flex-col gap-0.5 overflow-y-auto p-1">
                                                        {aiModels.map(m => {
                                                            const isCurrent = selectedModelId === m.id;
                                                            return (
                                                                <DropdownMenuItem
                                                                    key={m.id}
                                                                    onClick={() => setSelectedModelId(m.id)}
                                                                    className={`flex items-start gap-2.5 rounded-xs px-3 py-2 cursor-pointer transition-colors hover:bg-ink-200 ${isCurrent ? "bg-ink-200" : ""}`}
                                                                >
                                                                    <div className="mt-0.5 flex-shrink-0">
                                                                        <div className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${isCurrent ? "border-brand" : "border-ink-700"}`}>
                                                                            {isCurrent && <div className="h-1.5 w-1.5 rounded-full bg-brand" />}
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex min-w-0 flex-col gap-0.5">
                                                                        <span className={`truncate text-[13px] font-medium ${isCurrent ? "text-paper" : "text-paper-muted"}`}>
                                                                            {m.name}
                                                                        </span>
                                                                        <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                                                                            {m.provider || 'AI provider'}
                                                                        </span>
                                                                    </div>
                                                                </DropdownMenuItem>
                                                            );
                                                        })}
                                                    </div>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    )}
                                    {!isMobile && (
                                        <button
                                            onClick={() => {
                                                // Cycle: compact → standard → wide → compact
                                                const next = sheetWidth >= SHEET_WIDTH_WIDE
                                                    ? SHEET_WIDTH_COMPACT
                                                    : sheetWidth >= SHEET_WIDTH_STANDARD
                                                        ? SHEET_WIDTH_WIDE
                                                        : SHEET_WIDTH_STANDARD;
                                                const clamped = Math.min(next, maxSheetWidth);
                                                setSheetWidth(clamped);
                                                saveChatPrefsDebounced(clamped);
                                            }}
                                            className="grid h-7 w-7 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper mr-1"
                                            title={sheetWidth >= SHEET_WIDTH_WIDE ? 'Compact sheet' : sheetWidth >= SHEET_WIDTH_STANDARD ? 'Wide sheet' : 'Standard sheet'}
                                            aria-label="Cycle sheet width"
                                        >
                                            {sheetWidth >= SHEET_WIDTH_WIDE ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                                        </button>
                                    )}
                                    <button
                                        onClick={handleExportThread}
                                        disabled={!activeThreadId || messages.length === 0}
                                        className="grid h-7 w-7 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Export thread"
                                        aria-label="Export thread"
                                    >
                                        <Download className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={handleNewThread}
                                        className="grid h-7 w-7 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper"
                                        title="New chat"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => setIsOpen(false)}
                                        className="grid h-7 w-7 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper"
                                        title="Close (Esc)"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="relative z-10 flex flex-1 min-h-0 overflow-hidden">
                                {/* Thread Sidebar — on mobile it acts as an overlay/slideover. Auto-hide on small desktop logical widths. */}
                                {showSidebar && !shouldHideSidebar && (
                                    <div className={`flex-shrink-0 bg-ink-100 border-r border-ink-500 overflow-y-auto z-20 transition-all ${isMobile ? 'absolute inset-0 w-full' : 'absolute left-0 top-0 bottom-0 w-72 md:relative md:w-72'}`}>
                                        <div className="p-3">
                                            <div className="mb-3 flex items-center justify-between px-1">
                                                <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                                                    Conversations
                                                </h3>
                                                <span className="font-mono text-[10px] text-paper-faint">{threads.length}</span>
                                            </div>
                                            {isLoadingThreads ? (
                                                <div className="flex items-center justify-center py-8">
                                                    <Loader2 className="w-4 h-4 text-paper-dim motion-safe:animate-spin" />
                                                </div>
                                            ) : threads.length === 0 ? (
                                                <p className="text-[12px] text-paper-faint text-center py-8">No conversations yet</p>
                                            ) : (
                                                <div className="py-2">
                                                    <CollapsibleThreadGroup
                                                        title="Recent"
                                                        threads={groupedThreads.recent}
                                                        activeId={activeThreadId}
                                                        editingId={editingThreadId}
                                                        onLoad={loadThread}
                                                        onDelete={handleDeleteThread}
                                                        onStartEdit={handleStartEditThread}
                                                        onSaveTitle={handleSaveThreadTitle}
                                                        onCancelEdit={handleCancelEditThread}
                                                        defaultExpanded={true}
                                                    />
                                                    <CollapsibleThreadGroup
                                                        title="Last 24 Hours"
                                                        threads={groupedThreads.last24Hours}
                                                        activeId={activeThreadId}
                                                        editingId={editingThreadId}
                                                        onLoad={loadThread}
                                                        onDelete={handleDeleteThread}
                                                        onStartEdit={handleStartEditThread}
                                                        onSaveTitle={handleSaveThreadTitle}
                                                        onCancelEdit={handleCancelEditThread}
                                                        defaultExpanded={true}
                                                    />
                                                    <CollapsibleThreadGroup
                                                        title="Previous 7 Days"
                                                        threads={groupedThreads.last7Days}
                                                        activeId={activeThreadId}
                                                        editingId={editingThreadId}
                                                        onLoad={loadThread}
                                                        onDelete={handleDeleteThread}
                                                        onStartEdit={handleStartEditThread}
                                                        onSaveTitle={handleSaveThreadTitle}
                                                        onCancelEdit={handleCancelEditThread}
                                                        defaultExpanded={true}
                                                    />
                                                    {groupedThreads.recent.length === 0 && groupedThreads.last24Hours.length === 0 && groupedThreads.last7Days.length === 0 && (
                                                        <p className="text-[12px] text-paper-faint text-center py-8">No recent conversations</p>
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
                                            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                                                <div className="relative mb-6 grid h-14 w-14 place-items-center rounded-md border border-ink-500 bg-ink-200">
                                                    <Sparkles className="h-6 w-6 text-paper-muted" aria-hidden />
                                                    <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-ink-100" aria-hidden />
                                                </div>
                                                <span className="mb-2 inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                                                    <span className="h-px w-6 bg-ink-700" aria-hidden />
                                                    CHouse AI
                                                </span>
                                                <h3 className="mb-2 text-xl font-semibold tracking-tight text-paper">
                                                    What do you want to{" "}
                                                    <span className="text-paper-dim">know?</span>
                                                </h3>
                                                <p className="mb-8 max-w-md text-[13px] leading-relaxed text-paper-muted">
                                                    Ask about a table, draft a query, debug an error — the assistant has read access to your schema.
                                                </p>
                                                {/* Suggested prompts */}
                                                <div className="mb-6 w-full max-w-lg">
                                                    <div className={`grid gap-2 ${useSingleColPrompt ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                                        {visiblePrompts.map((sp) => (
                                                            <button
                                                                key={sp.label}
                                                                type="button"
                                                                onClick={async () => { if (!activeThreadId) { await handleNewThread(); } setInput(sp.prompt); setTimeout(() => inputRef.current?.focus(), 100); }}
                                                                className="group flex items-center gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5 text-left transition-colors hover:border-ink-700 hover:bg-ink-300"
                                                            >
                                                                <sp.icon className="h-3.5 w-3.5 shrink-0 text-paper-dim transition-colors group-hover:text-brand" aria-hidden />
                                                                <span className="text-[12px] text-paper-muted transition-colors group-hover:text-paper">{sp.label}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShuffleKey(Date.now())}
                                                        className="mx-auto mt-3 flex items-center gap-1.5 rounded-xs px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint transition-colors hover:bg-ink-200 hover:text-paper"
                                                        title="Show different suggestions"
                                                    >
                                                        <Shuffle className="h-3 w-3" />
                                                        More suggestions
                                                    </button>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleNewThread}
                                                    className="inline-flex h-10 items-center gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 transition-[transform,background-color] duration-200 hover:bg-brand-soft hover:-translate-y-px"
                                                >
                                                    <Plus className="h-4 w-4" />
                                                    Start new chat
                                                </button>
                                            </div>
                                        ) : messages.length === 0 ? (
                                            /* Thread selected but empty — compact top-aligned, leaves space for input below */
                                            <div className="flex flex-col items-start gap-5 px-6 pt-10">
                                                <span className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                                                    <span className="h-px w-6 bg-ink-700" aria-hidden />
                                                    New conversation
                                                </span>
                                                <h3 className="text-[15px] font-medium leading-snug text-paper">
                                                    Ask anything about your ClickHouse databases.
                                                </h3>
                                                <div className="w-full">
                                                    <div className={`grid gap-2 ${useSingleColPrompt ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                                        {visiblePrompts.map((sp) => (
                                                            <button
                                                                key={sp.label}
                                                                type="button"
                                                                onClick={async () => { if (!activeThreadId) { await handleNewThread(); } setInput(sp.prompt); setTimeout(() => inputRef.current?.focus(), 100); }}
                                                                className="group flex items-center gap-2.5 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5 text-left transition-colors hover:border-ink-700 hover:bg-ink-300"
                                                            >
                                                                <sp.icon className="h-3 w-3 shrink-0 text-paper-dim transition-colors group-hover:text-brand" aria-hidden />
                                                                <span className="text-[12px] text-paper-muted transition-colors group-hover:text-paper">{sp.label}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShuffleKey(Date.now())}
                                                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-xs px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint transition-colors hover:bg-ink-200 hover:text-paper"
                                                        title="Show different suggestions"
                                                    >
                                                        <Shuffle className="h-3 w-3" />
                                                        More suggestions
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            /* Message list (virtualized for long threads) */
                                            <>
                                                <div
                                                    style={{
                                                        height: `${messageVirtualizer.getTotalSize()}px`,
                                                        width: '100%',
                                                        position: 'relative',
                                                    }}
                                                >
                                                    {messageVirtualizer.getVirtualItems().map((virtualRow) => {
                                                        const msg = messages[virtualRow.index];
                                                        const idx = virtualRow.index;
                                                        return (
                                                            <div
                                                                key={msg.id}
                                                                data-index={idx}
                                                                ref={messageVirtualizer.measureElement}
                                                                style={{
                                                                    position: 'absolute',
                                                                    top: 0,
                                                                    left: 0,
                                                                    width: '100%',
                                                                    transform: `translateY(${virtualRow.start}px)`,
                                                                    paddingBottom: '1.25rem',
                                                                }}
                                                            >
                                                                <div
                                                                    className={`group flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
                                                                    style={{ animation: `fadeSlideIn 0.3s ease-out ${Math.min(idx * 0.05, 0.3)}s both` }}
                                                                >
                                                        {msg.role === 'assistant' && (
                                                            <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xs border
                                                              ${msg.isError
                                                                    ? 'border-red-900/60 bg-red-950/40'
                                                                    : 'border-brand/40 bg-brand/5'}`}>
                                                                {msg.isError
                                                                    ? <AlertCircle className="w-3.5 h-3.5 text-red-300" />
                                                                    : <Bot className="w-3.5 h-3.5 text-brand" />}
                                                            </div>
                                                        )}
                                                        <div className={`flex flex-col gap-1 min-w-0 ${msg.role === 'assistant' && msg.chartSpecs?.length ? 'flex-1' : ''}`} style={{ maxWidth: msg.role === 'user' ? '75%' : '85%' }}>
                                                            <div
                                                                className={`rounded-xs px-3 py-2.5 text-[13px] leading-relaxed overflow-hidden border
                                                              ${msg.role === 'user'
                                                                        ? 'border-ink-500 bg-ink-200 text-paper'
                                                                        : msg.isError
                                                                            ? 'border-red-900/60 bg-red-950/40 text-red-200'
                                                                            : 'border-ink-500 bg-ink-100 text-paper'
                                                                    }`}
                                                            >
                                                                {msg.role === 'assistant' ? (
                                                                    <>
                                                                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                                                                            <ActivityPanel
                                                                                toolCalls={msg.toolCalls}
                                                                                isInvoking={msg.isInvoking}
                                                                            />
                                                                        )}
                                                                        {msg.isInvoking && msg.toolStatus && !msg.content && !msg.toolCalls?.length && (
                                                                            <div className="flex items-center gap-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                                                                                <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
                                                                                <span>{msg.toolStatus}</span>
                                                                            </div>
                                                                        )}
                                                                        {msg.isError ? (
                                                                            <div className="flex flex-col gap-2">
                                                                                <p className="text-[13px] text-red-200">{msg.content}</p>
                                                                                {msg.retryPrompt && (msg.retryable !== false) && (
                                                                                    <button
                                                                                        onClick={() => handleRetry(msg.retryPrompt!)}
                                                                                        disabled={isInvoking}
                                                                                        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300 hover:text-red-200
                                                                                     disabled:opacity-40 transition-colors self-start
                                                                                     px-2 py-1 rounded-xs hover:bg-red-950/40"
                                                                                        aria-label="Retry"
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
                                                                                        {preprocessMarkdown(msg.content) + (msg.isInvoking && !msg.toolStatus ? ' ▊' : '')}
                                                                                    </ReactMarkdown>
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                    </>
                                                                ) : (
                                                                    <span className="whitespace-pre-wrap">{msg.content}</span>
                                                                )}
                                                            </div>
                                                            <div className={`flex items-center gap-1 px-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{timeAgo(msg.createdAt)}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => copyToClipboard(msg.content, 'Message')}
                                                                    className="p-1 rounded-xs opacity-0 group-hover:opacity-100 hover:bg-ink-300 text-paper-dim hover:text-paper transition-colors"
                                                                    title="Copy message"
                                                                    aria-label="Copy message"
                                                                >
                                                                    <Copy className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        {
                                                            msg.role === 'user' && (
                                                                <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-200">
                                                                    <User className="h-3.5 w-3.5 text-paper-muted" aria-hidden />
                                                                </div>
                                                            )
                                                        }
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <div ref={messagesEndRef} />
                                            </>
                                        )}
                                    </div>

                                    {/* Input area */}
                                    {activeThreadId && (
                                        <div className={`relative z-10 flex-shrink-0 border-t border-ink-500 bg-ink-200 px-4 ${isMobile ? 'pt-3 pb-6' : 'py-3'}`}>
                                            <form onSubmit={handleSend} className="flex items-end gap-2">
                                                <textarea
                                                    ref={inputRef}
                                                    value={input}
                                                    onChange={(e) => setInput(e.target.value)}
                                                    onKeyDown={handleKeyDown}
                                                    placeholder="Ask about your databases, schemas, queries…"
                                                    disabled={isInvoking}
                                                    rows={1}
                                                    className="flex-1 resize-none rounded-xs border border-ink-500 bg-ink-100 px-3 py-2.5
                                                               font-mono text-[12.5px] text-paper placeholder:text-paper-faint
                                                               focus:border-brand focus:outline-none focus:ring-0
                                                               disabled:opacity-40 transition-colors
                                                               max-h-[120px] min-h-[44px]"
                                                    style={{ height: 'auto' }}
                                                    onInput={(e) => {
                                                        const target = e.target as HTMLTextAreaElement;
                                                        target.style.height = 'auto';
                                                        target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                                                    }}
                                                />
                                                {isInvoking ? (
                                                    <button
                                                        type="button"
                                                        onClick={handleStop}
                                                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xs border border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 transition-colors hover:border-red-700 hover:bg-red-900/50"
                                                        title="Stop generating"
                                                        aria-label="Stop generating"
                                                    >
                                                        <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="submit"
                                                        disabled={!input.trim()}
                                                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xs bg-brand text-ink-50 transition-[transform,background-color] duration-200 hover:bg-brand-soft hover:-translate-y-px disabled:bg-ink-300 disabled:text-paper-faint disabled:translate-y-0"
                                                        title="Send message"
                                                        aria-label="Send"
                                                    >
                                                        <Send className="h-4 w-4" />
                                                    </button>
                                                )}
                                            </form>
                                            <div className="mt-2 flex items-center justify-between px-1">
                                                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                                                    Shift+Enter newline · Esc close
                                                </span>
                                                {isInvoking && toolStatus && (
                                                    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                                                        <Loader2 className="h-2.5 w-2.5 motion-safe:animate-spin" />
                                                        {toolStatus}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </>
    );
}
