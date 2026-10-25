/**
 * Chobi's Chat tab (ADR 0025 §6): threads, the composer and live replies with
 * CHouse Assistant. Chobi owns the panel around it — whether it is open, its
 * size and Escape — and tells the chat how wide it is.
 */

import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useVirtualizer } from '@tanstack/react-virtual';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import 'highlight.js/styles/github-dark.min.css';
import { useRbacStore, RBAC_PERMISSIONS, useAuthStore, useWorkspaceStore, genTabId } from '@/stores';
import {
    getChatStatus,
    listThreads,
    createThread,
    getThread,
    deleteThread,
    updateThreadTitle,
    getAiModels,
    getChatAgents,
    streamChatRun,
    followChatRun,
    getChatRun,
    cancelChatRun,
    getActiveChatRun,
    getChatSkills,
    resumeChatRun,
    type AiModelSimple,
    type ApprovalDecision,
    type ChatThread,
    type ChatAgentOption,
    type ChatMessage,
    type ChartSpec,
    type ChatAttachmentInput,
    type ChatRun,
    type ChatRunAnswer,
    type ChatRunEvent,
    type ChatRunStep,
    type PendingApproval,
    type ChatSkill,
} from '@/api/ai-chat';
import { ApiError } from '@/api/client';
import {
    attachmentAccept,
    attachmentHint,
    attachmentKind,
    attachmentMimeType,
    attachmentProblem,
    insertSkillCommand,
    parseSkillCommands,
    readAsBase64,
    skillQueryAt,
} from '@/lib/chatComposer';
import { ComposerChips, SkillSuggestions, type ComposerAttachment } from '@/components/common/ai-chat/ComposerExtras';
import { ApprovalCard } from '@/components/common/ai-chat/ApprovalCard';
import { MemoryNotes } from '@/components/common/ai-chat/MemoryNotes';
import { ActionReceipts } from '@/components/common/ai-chat/ActionReceipts';
import { useChobiSettings } from '../hooks';
import { MemorySuggestions } from './MemorySuggestions';
import { actionReceipts } from '@/lib/aiActionReceipts';
import { savedMemories, type SavedMemoryNote } from '@/lib/aiMemories';
import { toast } from 'sonner';
import { useChobiStore, type AskContext } from '@/stores/chobi';
import { uiActionFor, UI_TOOL_NAMES } from '@/lib/chobiUi';
import { HandoffDialog } from './HandoffDialog';
import { Mascot } from '../Mascot';
import { log } from '@/lib/log';
import { AiChartRenderer } from '@/components/common/AiChartRenderer';
import { OPEN_CHAT_THREAD_EVENT } from '@/features/agents/usage/lib';
import {
    MessageSquare,
    Plus,
    Trash2,
    Loader2,
    Bot,
    Database,
    Table2,
    Zap,
    Clock,
    PanelLeftClose,
    RefreshCw,
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
    TrendingUp,
    PieChart,
    ScatterChart,
    Copy,
    Pencil,
    Download,
    Share2,
    XCircle,
    Paperclip,
    Square,
    ArrowUp,
    Cpu,
} from 'lucide-react';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    status: 'running' | 'done' | 'failed';
    label?: string;
    category?: string;
    description?: string;
    summary?: string | null;
    /** Subagent path that made the call, e.g. "chouse-admin › access-auditor". */
    agent?: string;
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
    /** The agent that answered this turn. */
    agentName?: string;
    /** The durable run producing this reply (ADR 0024). */
    runId?: string;
    /** Tool calls waiting for the user's approval. */
    pending?: PendingApproval[];
    /** Notes the assistant kept during this reply (ADR 0024 phase 3). */
    memories?: SavedMemoryNote[];
    /** Actions this reply ran, filed or proposed (ADR 0025), shown with their undo. */
    actions?: string[];
    /** Names of files sent with a user message. */
    attachments?: string[];
}

/** The server stores a message's attachments as a trailing `[attached: a.csv, b.png]` line. */
const ATTACHED_SUFFIX = /\n\n\[attached: ([^\]]+)\]$/;

function splitAttachments(content: string): { content: string; attachments?: string[] } {
    const match = ATTACHED_SUFFIX.exec(content);
    if (!match) return { content };
    return { content: content.slice(0, match.index), attachments: match[1].split(', ').filter(Boolean) };
}

const NO_MESSAGES: UIMessage[] = [];

function isActiveChatConnection(connectionId: string | null): boolean {
    return useAuthStore.getState().activeConnectionId === connectionId;
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
        remember: { label: 'Saving to memory', category: 'Memory' },
        kill_query: { label: 'Stopping a query', category: 'Action' },
        create_saved_query: { label: 'Saving a query', category: 'Action' },
        create_scheduled_query: { label: 'Scheduling a query', category: 'Action' },
        create_health_promise: { label: 'Creating a health promise', category: 'Action' },
        create_dashboard: { label: 'Creating a dashboard', category: 'Action' },
        update_table_context: { label: 'Updating table context', category: 'Action' },
        propose_remediation: { label: 'Proposing a fix', category: 'Action' },
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
    busy,
}: {
    thread: ChatThread;
    activeId: string | null;
    editingId: string | null;
    /** The thread is still generating a reply in the background. */
    busy: boolean;
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
            className={`group flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors
                      ${activeId === thread.id
                    ? 'bg-brand/10 text-paper'
                    : 'text-paper-muted hover:bg-ink-200 hover:text-paper'
                }`}
        >
            <div className="flex-1 min-w-0 mr-2">
                {isEditing ? (
                    <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={(e) => {
                            if (e.key !== 'Escape') return;
                            e.stopPropagation();
                            onCancelEdit();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded-sm border border-ink-500 bg-ink-100 px-2 py-1 text-[12px] text-paper focus:border-brand focus:outline-none focus:ring-0"
                        placeholder="Thread title"
                        autoFocus
                        aria-label="Edit thread title"
                    />
                ) : (
                    <>
                        <span className="block truncate">{thread.title || 'New Thread'}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[10px] text-paper-faint">
                            {busy ? (
                                <>
                                    <Loader2 className="w-2.5 h-2.5 text-brand motion-safe:animate-spin" aria-hidden />
                                    Answering…
                                </>
                            ) : (
                                <>
                                    <Clock className="w-2.5 h-2.5" />
                                    {timeAgo(thread.updatedAt)}
                                </>
                            )}
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
                        className="rounded-sm p-1 text-paper-dim opacity-0 transition-colors hover:bg-ink-300 hover:text-paper focus-visible:opacity-100 group-hover:opacity-100"
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
                        className="rounded-sm p-1 text-paper-dim opacity-0 transition-colors hover:bg-red-950/40 hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
                        title="Delete chat"
                        aria-label="Delete chat"
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
    busyIds,
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
    busyIds: ReadonlySet<string>;
    defaultExpanded?: boolean;
}) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    if (threads.length === 0) return null;

    return (
        <div className="mb-2 last:mb-0">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
                className="sticky top-0 z-10 mb-0.5 flex w-full items-center gap-1 bg-ink-100 px-1.5 py-1.5 text-[11px] font-medium text-paper-faint transition-colors hover:text-paper"
            >
                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {title}
                <span className="ml-auto font-mono text-[10px]">{threads.length}</span>
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
                            busy={busyIds.has(t.id)}
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

function ActivityPanel({ toolCalls, isInvoking, waiting }: { toolCalls: ToolCallStep[]; isInvoking?: boolean; waiting?: boolean }) {
    // Open while the reply is being worked on, so steps show as they happen; the user's own toggle wins.
    const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
    const expanded = userExpanded ?? Boolean(isInvoking);
    const setExpanded = (update: (value: boolean) => boolean): void => setUserExpanded(update(expanded));

    if (!toolCalls || toolCalls.length === 0) return null;

    const failedCount = toolCalls.filter((t) => t.status === 'failed').length;
    // The reply is being worked on even between steps, while the model thinks.
    const isRunning = Boolean(isInvoking);
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
        ? `Working through ${toolCalls.length} step${toolCalls.length !== 1 ? 's' : ''}…`
        : waiting
            ? `${toolCalls.length} step${toolCalls.length !== 1 ? 's' : ''} so far · waiting for your approval`
            : completedLabels.length > 0
            ? `Completed ${completedLabels.join(', ')}${failedCount > 0 ? ` · ${failedCount} failed` : ''}`
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
                            : step.status === 'failed'
                                ? <XCircle className="w-3 h-3 text-red-400/80" />
                                : <CheckCircle2 className="w-3 h-3 text-emerald-400/80" />
                        }
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                            <Icon className="h-3 w-3 shrink-0 text-paper-dim" />
                            <span className="truncate text-[12px] font-medium text-paper">{presentation.label}</span>
                            <span className="shrink-0 text-[10px] text-paper-faint">{presentation.category}</span>
                        </div>
                        {step.agent && (
                            <p className="truncate font-mono text-[10px] text-brand/80" title="Subagent that made this call">via {step.agent}</p>
                        )}
                        {presentation.description && (
                            <p className="truncate text-[11px] text-paper-muted">{presentation.description}</p>
                        )}
                        {args.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {args.map(([key, value]) => (
                                    <span key={key} className="max-w-full truncate rounded-sm border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">
                                        {key}: {value}
                                    </span>
                                ))}
                            </div>
                        )}
                        {step.status === 'done' && step.summary && (
                            <p className="text-[10px] text-emerald-400/80">{step.summary}</p>
                        )}
                        {step.status === 'failed' && (
                            <p className="text-[10px] text-red-400/80">{step.summary ?? 'Failed'}</p>
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
        <div className="mb-1 overflow-hidden rounded-md border border-ink-500 bg-ink-200/40">
            {/* Subtle pulse bar while running */}
            {isRunning && (
                <div className="h-px w-full bg-brand/50 motion-safe:animate-pulse" />
            )}
            <button
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-ink-300/60"
            >
                {isRunning
                    ? <Loader2 className="h-3 w-3 flex-shrink-0 text-brand motion-safe:animate-spin" />
                    : <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-emerald-400/80" />
                }
                <span className="min-w-0 flex-1 text-[11px] text-paper-muted">{label}</span>
                <ChevronDown
                    className={`h-3 w-3 shrink-0 text-paper-dim transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                />
            </button>

            {expanded && (
                <div className="space-y-1 border-t border-ink-500 px-2.5 pb-2.5">
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
        <div className="my-2 overflow-x-auto rounded-md border border-ink-500">
            <table className="min-w-full text-[12px]" {...props}>{children}</table>
        </div>
    ),
    thead: ({ children, ...props }: React.ComponentPropsWithoutRef<'thead'>) => (
        <thead className="bg-ink-200" {...props}>{children}</thead>
    ),
    th: ({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) => (
        <th className="whitespace-nowrap border-b border-ink-500 px-3 py-1.5 text-left text-[11px] font-medium text-paper-dim" {...props}>{children}</th>
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
                        className="absolute top-2 right-2 p-1.5 rounded-sm opacity-0 group-hover/code:opacity-100 hover:bg-ink-300 text-paper-dim hover:text-paper transition-colors"
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
        return <code className="rounded-sm bg-ink-300/60 px-1 font-mono text-[11px] text-paper" {...props}>{children}</code>;
    },
    pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) => (
        <pre className="rounded-md border border-ink-500 bg-ink-200 p-3 overflow-x-auto my-2 font-mono text-[12px] text-paper" {...props}>{children}</pre>
    ),
    p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
        <p className="my-1.5 leading-relaxed text-paper" {...props}>{children}</p>
    ),
    ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) => (
        <ul className="list-disc list-outside ml-5 my-1.5 space-y-0.5 text-paper marker:text-brand" {...props}>{children}</ul>
    ),
    ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) => (
        <ol className="list-decimal list-outside ml-5 my-1.5 space-y-0.5 text-paper marker:text-brand" {...props}>{children}</ol>
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

/** Shown before the first tool call, while the model reads the question. */
const THINKING_STATUS = 'Thinking';

/** Apply `update` to one thread's messages, leaving every other thread untouched. */
type UpdateThreadMessages = (threadId: string, update: (previous: UIMessage[]) => UIMessage[]) => void;

/** Patch the trailing assistant placeholder of a thread, if there is one. */
function patchLastAssistant(messages: UIMessage[], patch: (last: UIMessage) => UIMessage | null): UIMessage[] {
    const last = messages[messages.length - 1];
    if (last?.role !== 'assistant') return messages;
    const next = patch(last);
    if (!next) return messages;
    return [...messages.slice(0, -1), next];
}

function stepToToolCall(step: ChatRunStep): ToolCallStep {
    return {
        id: step.id,
        tool: step.name,
        args: step.args,
        status: step.status,
        summary: step.summary,
        ...(step.agent ? { agent: step.agent } : {}),
    };
}

/** The status line for a run: the step in progress, else "Thinking". */
function statusOf(steps: ToolCallStep[]): string {
    const running = [...steps].reverse().find((s) => s.status === 'running');
    return running ? activityLabelFor(running).label : THINKING_STATUS;
}

/** An answer as the thread shows it (shared by a live run and a reloaded one). */
function answerPatch(result: ChatRunAnswer, steps: ToolCallStep[]): Partial<UIMessage> {
    return {
        content: result.content,
        isInvoking: false,
        toolStatus: undefined,
        pending: undefined,
        // Live steps carry their result summaries; the stored answer only has the calls.
        toolCalls: steps.length > 0 ? steps : result.toolCalls.map((call, index) => ({
            id: `activity_${index + 1}`,
            tool: call.name,
            args: call.args,
            status: 'done' as const,
            agent: call.agent,
        })),
        chartSpecs: result.chartSpecs,
        memories: savedMemories(result.toolCalls),
        actions: actionReceipts(result.toolCalls),
        agentName: result.agent?.name,
    };
}

/** What the thread shows for a run that ended without an answer. */
function failurePatch(message: string, code: string, prompt: string | undefined): Partial<UIMessage> {
    const stopped = code === 'CANCELLED';
    const retryable = !stopped && code !== 'AI_BUDGET_EXHAUSTED';
    return {
        content: stopped ? 'Generation stopped.' : message,
        isInvoking: false,
        isError: !stopped,
        retryPrompt: retryable ? prompt : undefined,
        retryable,
        toolStatus: undefined,
        pending: undefined,
    };
}

interface ThreadRun {
    controller: AbortController;
    runId: string | null;
    /** Stop was pressed before the server named the run: stop it as soon as it does. */
    stopRequested: boolean;
}

interface TurnExtras {
    skills?: string[];
    attachments?: ChatAttachmentInput[];
}

/**
 * Runs chat turns per thread (ADR 0024). Each turn is a server-side run whose
 * steps stream in live; a thread finishing in the background never lands in
 * another. Closing the stream (switching connection, unmounting) does not stop
 * the run — only Stop does — and a reopened thread re-attaches to it.
 */
function useAiChatInvoke({
    updateThreadMessages,
    loadThreads,
    selectedModelId,
    selectedAgentId,
    activeConnectionId,
    page,
    onUiStep,
}: {
    updateThreadMessages: UpdateThreadMessages;
    loadThreads: () => void;
    selectedModelId: string;
    /** Chat agent for this thread; null = the default agent. */
    selectedAgentId: string | null;
    activeConnectionId: string | null;
    /** Where the user is (ADR 0025 §5), sent with every turn. */
    page: string;
    /** A UI tool call finished while the user watched: the browser does its part. */
    onUiStep: (step: ToolCallStep) => void;
}) {
    /** threadId → current status line; a key is present while that thread is generating. */
    const [statusByThread, setStatusByThread] = useState<Record<string, string>>({});
    const runsRef = useRef(new Map<string, ThreadRun>());
    /** Bumped by cancelAll so replies from a previous connection are dropped. */
    const epochRef = useRef(0);

    const setThreadStatus = useCallback((threadId: string, status: string | null) => {
        setStatusByThread((previous) => {
            if (status === null) {
                if (!(threadId in previous)) return previous;
                const rest = { ...previous };
                delete rest[threadId];
                return rest;
            }
            if (previous[threadId] === status) return previous;
            return { ...previous, [threadId]: status };
        });
    }, []);

    /**
     * Drive one run's events into the thread's trailing assistant message.
     * `open` starts or re-attaches the stream; `prompt` lets a failure offer Retry.
     */
    const driveRun = useCallback(async (
        threadId: string,
        open: (onEvent: (event: ChatRunEvent) => void, signal: AbortSignal) => Promise<void>,
        prompt: string | undefined,
        initialSteps: ToolCallStep[] = [],
        /** Handles a request the server refused before the run moved on; true when handled. */
        onRefused?: (error: ApiError) => boolean,
    ): Promise<void> => {
        if (runsRef.current.has(threadId)) return;
        const epoch = epochRef.current;
        const invocationConnectionId = activeConnectionId;
        const isCurrent = (): boolean => epoch === epochRef.current && isActiveChatConnection(invocationConnectionId);
        const controller = new AbortController();
        const entry: ThreadRun = { controller, runId: null, stopRequested: false };
        runsRef.current.set(threadId, entry);
        let steps = [...initialSteps];
        let settled = false;
        const patch = (fields: Partial<UIMessage>): void => {
            updateThreadMessages(threadId, (previous) => patchLastAssistant(previous, (last) => ({ ...last, ...fields })));
        };
        setThreadStatus(threadId, statusOf(steps));

        const onEvent = (event: ChatRunEvent): void => {
            if (!isCurrent()) return;
            switch (event.type) {
                case 'run':
                    entry.runId = event.run.id;
                    if (entry.stopRequested) {
                        cancelChatRun(event.run.id).catch((error: unknown) => log.error('[AiChat] Failed to stop the reply', error));
                    }
                    if (steps.length === 0 && event.run.steps.length > 0) steps = event.run.steps.map(stepToToolCall);
                    patch({ runId: event.run.id, toolCalls: steps, toolStatus: statusOf(steps) });
                    setThreadStatus(threadId, statusOf(steps));
                    // The server titles a new thread when the turn starts: show it in the history now.
                    if (prompt !== undefined) loadThreads();
                    return;
                case 'step': {
                    const next = stepToToolCall(event.step);
                    const index = steps.findIndex((s) => s.id === next.id);
                    // Only a call seen running in this session acts: re-attaching never replays a navigation.
                    if (index >= 0 && steps[index].status === 'running' && next.status === 'done' && UI_TOOL_NAMES.includes(next.tool)) onUiStep(next);
                    steps = index >= 0 ? steps.map((s, i) => (i === index ? next : s)) : [...steps, next];
                    patch({ toolCalls: steps, toolStatus: statusOf(steps) });
                    setThreadStatus(threadId, statusOf(steps));
                    return;
                }
                case 'status':
                    if (event.status === 'awaiting_approval') {
                        settled = true;
                        patch({ isInvoking: false, toolStatus: undefined, pending: event.pending, toolCalls: steps });
                    } else {
                        settled = false;
                        patch({ pending: undefined, isInvoking: true, toolStatus: statusOf(steps) });
                    }
                    return;
                case 'final':
                    settled = true;
                    patch(answerPatch(event.result, steps));
                    return;
                case 'error':
                    settled = true;
                    patch(failurePatch(event.message, event.code, prompt));
                    return;
            }
        };

        try {
            try {
                await open(onEvent, controller.signal);
            } catch (error) {
                // The stream dropped (network, proxy timeout) but the run goes on: follow it.
                const dropped = error instanceof TypeError || (error instanceof Error && /network|fetch/i.test(error.message));
                if (!dropped || !entry.runId || controller.signal.aborted) throw error;
                await followChatRun(entry.runId, onEvent, controller.signal);
            }
            if (!settled && isCurrent() && !controller.signal.aborted && entry.runId) {
                // The stream ended without an outcome: read the stored run.
                const run = await getChatRun(entry.runId);
                if (run.status === 'completed' && run.result) onEvent({ type: 'final', result: run.result });
                else if (run.status === 'awaiting_approval') onEvent({ type: 'status', status: run.status, pending: run.pending });
                else if (run.status === 'failed' || run.status === 'cancelled') onEvent({ type: 'error', message: run.error ?? 'The reply failed.', code: run.status === 'cancelled' ? 'CANCELLED' : 'AI_CHAT_ERROR', status: run.status });
            }
        } catch (error: unknown) {
            if (!isCurrent() || controller.signal.aborted) return;
            const apiError = error instanceof ApiError ? error : null;
            if (apiError && onRefused?.(apiError)) return;
            const isNetwork = !apiError && error instanceof Error && (error.message.includes('fetch') || error.message.includes('network') || error.name === 'TypeError');
            const message = isNetwork
                ? 'Connection failed. You can retry.'
                : error instanceof Error ? error.message : 'Something went wrong. You can retry.';
            patch(failurePatch(message, apiError?.code ?? 'AI_CHAT_ERROR', prompt));
        } finally {
            if (runsRef.current.get(threadId) === entry) {
                runsRef.current.delete(threadId);
                setThreadStatus(threadId, null);
            }
            if (isCurrent()) loadThreads();
        }
    }, [activeConnectionId, loadThreads, onUiStep, setThreadStatus, updateThreadMessages]);

    const runInvoke = useCallback(async (
        threadId: string,
        prompt: string,
        messageHistory: { role: string; content: string }[],
        extras: TurnExtras = {},
    ): Promise<void> => {
        await driveRun(threadId, (onEvent, signal) => streamChatRun({
            threadId,
            message: prompt,
            messages: messageHistory,
            modelId: selectedModelId || undefined,
            agentId: selectedAgentId,
            ...(extras.skills?.length ? { skills: extras.skills } : {}),
            ...(extras.attachments?.length ? { attachments: extras.attachments } : {}),
            page,
        }, onEvent, signal), prompt);
    }, [driveRun, page, selectedAgentId, selectedModelId]);

    /** Re-attach to a run that is still going (after a reload or reopening the thread). */
    const followRun = useCallback(async (threadId: string, run: ChatRun): Promise<void> => {
        await driveRun(threadId, (onEvent, signal) => followChatRun(run.id, onEvent, signal), undefined, run.steps.map(stepToToolCall));
    }, [driveRun]);

    /**
     * Answer a paused reply's approvals and follow the rest of it. A refused
     * answer that can be fixed (an invalid edit, no ai:act) puts the card back.
     */
    const answerApprovals = useCallback(async (threadId: string, runId: string, pending: PendingApproval[], decisions: ApprovalDecision[], steps: ToolCallStep[]): Promise<void> => {
        updateThreadMessages(threadId, (previous) => patchLastAssistant(previous, (last) => ({ ...last, pending: undefined, isInvoking: true, toolStatus: statusOf(steps) })));
        await driveRun(
            threadId,
            (onEvent, signal) => resumeChatRun(runId, decisions, onEvent, { modelId: selectedModelId || undefined, page, signal }),
            undefined,
            steps,
            (error) => {
                if (error.statusCode !== 400 && error.statusCode !== 403) return false;
                toast.error(error.message);
                updateThreadMessages(threadId, (previous) => patchLastAssistant(previous, (last) => ({ ...last, pending, isInvoking: false, toolStatus: undefined })));
                return true;
            },
        );
    }, [driveRun, page, selectedModelId, updateThreadMessages]);

    /** Stop one thread's reply: the server finishes the run as stopped. */
    const stopThread = useCallback((threadId: string) => {
        const entry = runsRef.current.get(threadId);
        if (!entry) return;
        setThreadStatus(threadId, 'Stopping');
        if (entry.runId) {
            cancelChatRun(entry.runId).catch((error: unknown) => log.error('[AiChat] Failed to stop the reply', error));
        } else {
            entry.stopRequested = true;
        }
    }, [setThreadStatus]);

    /** Stop following every reply without stopping the runs (connection switch, unmount). */
    const cancelAll = useCallback(() => {
        epochRef.current += 1;
        for (const run of runsRef.current.values()) run.controller.abort();
        runsRef.current.clear();
        setStatusByThread({});
    }, []);

    useEffect(() => cancelAll, [cancelAll]);

    return { runInvoke, followRun, answerApprovals, statusByThread, stopThread, cancelAll };
}

// ============================================
// Component
// ============================================

export interface ChobiChatProps {
    /** The panel is open: threads load and the agent list refreshes. */
    open: boolean;
    /** The Chat tab is the one showing. */
    visible: boolean;
    /** How wide the chat is, for its own layout (history beside or over the chat). */
    width: number;
    /** Plain mode (an organization setting): the logo instead of the character. */
    plain?: boolean;
    /** AI Activity's "Open in chat" asked for a thread: Chobi shows the Chat tab. */
    onShowChat: () => void;
}

export function ChobiChat({ open: isOpen, visible, width: logicalWidth, plain = false, onShowChat }: ChobiChatProps): React.JSX.Element {
    const hasPermission = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_CHAT));
    const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
    const [aiModels, setAiModels] = useState<AiModelSimple[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<string>('');
    const [chatAgents, setChatAgents] = useState<ChatAgentOption[]>([]);
    /** Agent for the active thread; null = the default (bound) chat agent. */
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [showSidebar, setShowSidebar] = useState(false);

    const { breakpoint } = useWindowSize();
    const isMobile = breakpoint === 'mobile';
    const isTablet = breakpoint === 'tablet';

    // Adaptive internal layout thresholds
    const dockSidebarThreshold = 720;
    // Too narrow to dock the history beside the chat, so it slides over the chat instead.
    const sidebarIsOverlay = isMobile || logicalWidth < dockSidebarThreshold;
    // Narrow panels shorten the agent and model pickers and drop the composer hint.
    const narrowPickers = isMobile || logicalWidth < 600;
    const pickerWidthClass = narrowPickers ? 'max-w-[120px]' : 'max-w-[180px]';

    // Auto-close sidebar on smaller breakpoints
    useEffect(() => {
        if (isMobile || isTablet) setShowSidebar(false);
    }, [isMobile, isTablet]);

    // Thread state
    const [threads, setThreads] = useState<ChatThread[]>([]);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
    /** Messages per thread, so a reply finishing in the background lands in its own thread. */
    const [messagesByThread, setMessagesByThread] = useState<Record<string, UIMessage[]>>({});
    const messages = useMemo(
        () => (activeThreadId ? messagesByThread[activeThreadId] ?? NO_MESSAGES : NO_MESSAGES),
        [activeThreadId, messagesByThread],
    );
    const updateThreadMessages = useCallback<UpdateThreadMessages>((threadId, update) => {
        setMessagesByThread((previous) => {
            const current = previous[threadId] ?? NO_MESSAGES;
            const next = update(current);
            return next === current ? previous : { ...previous, [threadId]: next };
        });
    }, []);
    const [isLoadingThreads, setIsLoadingThreads] = useState(false);

    // Input state
    const [input, setInput] = useState('');
    const inputValueRef = useRef(input);
    useEffect(() => {
        inputValueRef.current = input;
    }, [input]);
    const [shuffleKey, setShuffleKey] = useState(() => Date.now());
    // Files and skills for the next message (ADR 0024).
    const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
    const [chatSkills, setChatSkills] = useState<ChatSkill[]>([]);
    const [skillQuery, setSkillQuery] = useState<{ start: number; query: string } | null>(null);
    const [skillIndex, setSkillIndex] = useState(0);
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    /** What each thread's last turn sent besides text, so Retry sends it again. */
    const lastExtrasRef = useRef(new Map<string, TurnExtras>());
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

    // Fetch AI models
    const fetchModels = useCallback(() => {
        if (hasPermission) {
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
    }, [hasPermission]);

    useEffect(() => {
        fetchModels();
        window.addEventListener('ai-config-updated', fetchModels);
        return () => window.removeEventListener('ai-config-updated', fetchModels);
    }, [fetchModels]);

    // Chat agents the user may pick (AI Governance › Assistant edits fire 'ai-agents-updated').
    const fetchAgents = useCallback(() => {
        if (!hasPermission) return;
        getChatAgents()
            .then((agents) => {
                setChatAgents(agents);
                setSelectedAgentId((current) => (current && !agents.some((a) => a.id === current) ? null : current));
            })
            .catch((e) => log.error('[AiChat] Failed to fetch chat agents', e));
    }, [hasPermission]);

    useEffect(() => {
        if (!isOpen) return;
        fetchAgents();
        window.addEventListener('ai-agents-updated', fetchAgents);
        return () => window.removeEventListener('ai-agents-updated', fetchAgents);
    }, [fetchAgents, isOpen]);


    // Skills of the chosen agent, offered as /skill: commands.
    useEffect(() => {
        if (!isOpen || !hasPermission) return;
        let cancelled = false;
        getChatSkills(selectedAgentId)
            .then((skills) => { if (!cancelled) setChatSkills(skills); })
            .catch((e) => {
                if (!cancelled) setChatSkills([]);
                log.error('[AiChat] Failed to fetch chat skills', e);
            });
        return () => { cancelled = true; };
    }, [isOpen, hasPermission, selectedAgentId]);

    const modelModalities = useMemo(
        () => aiModels.find((m) => m.id === selectedModelId)?.inputModalities ?? [],
        [aiModels, selectedModelId],
    );
    const skillNames = useMemo(() => chatSkills.map((skill) => skill.name), [chatSkills]);
    const pinnedSkills = useMemo(() => parseSkillCommands(input, skillNames).skills, [input, skillNames]);
    const skillMatches = useMemo(() => {
        if (!skillQuery) return [];
        const q = skillQuery.query.toLowerCase();
        return chatSkills.filter((skill) => skill.name.includes(q) || skill.description.toLowerCase().includes(q)).slice(0, 8);
    }, [chatSkills, skillQuery]);
    const skillPickerOpen = skillQuery !== null && chatSkills.length > 0;

    const addFiles = useCallback(async (files: File[]) => {
        let count = attachments.length;
        const added: ComposerAttachment[] = [];
        for (const file of files) {
            const problem = attachmentProblem(file, modelModalities, count);
            if (problem) {
                toast.error(problem);
                continue;
            }
            const kind = attachmentKind(file);
            if (!kind) continue;
            try {
                added.push({ id: `${file.name}-${file.size}-${Date.now()}-${count}`, name: file.name, mimeType: attachmentMimeType(file), size: file.size, kind, data: await readAsBase64(file) });
                count += 1;
            } catch (error) {
                log.error('[AiChat] Failed to read attachment', error);
                toast.error(`Couldn't read ${file.name}`);
            }
        }
        if (added.length > 0) setAttachments((previous) => [...previous, ...added]);
    }, [attachments.length, modelModalities]);

    const pickSkill = useCallback((name: string) => {
        const el = inputRef.current;
        const caret = el?.selectionStart ?? input.length;
        const next = insertSkillCommand(input, caret, name);
        setInput(next.text);
        setSkillQuery(null);
        requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(next.caret, next.caret);
        });
    }, [input]);

    // Auto-scroll to bottom without bubbling up scroll events to parent
    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                top: scrollContainerRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [messages]);

    const threadLoadSequenceRef = useRef(0);
    const loadThreads = useCallback(async () => {
        const loadSequence = ++threadLoadSequenceRef.current;
        const loadConnectionId = activeConnectionId;
        setIsLoadingThreads(true);
        try {
            const result = await listThreads(loadConnectionId);
            if (
                loadSequence !== threadLoadSequenceRef.current ||
                !isActiveChatConnection(loadConnectionId)
            ) return;
            setThreads(result);
        } catch (err) {
            if (
                loadSequence === threadLoadSequenceRef.current &&
                isActiveChatConnection(loadConnectionId)
            ) log.error('[AiChat] Failed to load threads:', err);
        } finally {
            if (
                loadSequence === threadLoadSequenceRef.current &&
                isActiveChatConnection(loadConnectionId)
            ) setIsLoadingThreads(false);
        }
    }, [activeConnectionId]);

    const canAct = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_ACT));
    // CHouse Assistant's UI tools (ADR 0025 §5): the page goes with each turn, and the browser does what a finished UI call asks.
    const location = useLocation();
    const navigate = useNavigate();
    const page = `${location.pathname}${location.search}`;
    const handleUiStep = useCallback((step: ToolCallStep): void => {
        const action = uiActionFor({ name: step.tool, args: step.args });
        if (!action) return;
        if (action.kind === 'fill_sql') {
            useWorkspaceStore.getState().addTab({ id: genTabId(), title: 'From Chobi', type: 'sql', content: action.sql, isSaved: false });
            navigate('/explorer');
            toast.success('Chobi put the SQL in a new editor tab: review it, then run it yourself');
        } else {
            navigate(action.path);
        }
        // A Focus panel covers the page it just opened.
        const chobi = useChobiStore.getState();
        if (chobi.size === 'focus') chobi.setSize('docked');
    }, [navigate]);

    const { runInvoke, followRun, answerApprovals, statusByThread, stopThread, cancelAll } = useAiChatInvoke({
        updateThreadMessages,
        loadThreads,
        selectedModelId,
        selectedAgentId,
        activeConnectionId,
        page,
        onUiStep: handleUiStep,
    });
    const isInvoking = activeThreadId !== null && activeThreadId in statusByThread;
    const chobiSettings = useChobiSettings(true);
    const toolStatus = activeThreadId ? statusByThread[activeThreadId] ?? null : null;
    const busyThreadIds = useMemo(() => new Set(Object.keys(statusByThread)), [statusByThread]);
    const setChobiBusy = useChobiStore((state) => state.setBusy);
    useEffect(() => {
        setChobiBusy(busyThreadIds.size > 0);
    }, [busyThreadIds, setChobiBusy]);
    useEffect(() => () => setChobiBusy(false), [setChobiBusy]);
    const runningThreadIdsRef = useRef(busyThreadIds);
    useEffect(() => {
        runningThreadIdsRef.current = busyThreadIds;
    }, [busyThreadIds]);
    const handleStop = useCallback(() => {
        if (activeThreadId) stopThread(activeThreadId);
    }, [activeThreadId, stopThread]);

    // Each thread keeps its own unsent draft, so switching threads never loses text.
    const draftsRef = useRef(new Map<string | null, string>());
    const draftThreadRef = useRef<string | null>(activeThreadId);
    useEffect(() => {
        if (draftThreadRef.current === activeThreadId) return;
        draftsRef.current.set(draftThreadRef.current, inputValueRef.current);
        draftThreadRef.current = activeThreadId;
        setInput(draftsRef.current.get(activeThreadId) ?? '');
        setAttachments([]);
        setSkillQuery(null);
    }, [activeThreadId]);

    const previousActiveConnectionIdRef = useRef(activeConnectionId);
    useEffect(() => {
        if (previousActiveConnectionIdRef.current === activeConnectionId) return;

        previousActiveConnectionIdRef.current = activeConnectionId;
        threadLoadSequenceRef.current += 1;
        cancelAll();
        setThreads([]);
        setActiveThreadId(null);
        setEditingThreadId(null);
        setMessagesByThread({});
        draftsRef.current.clear();
        setInput('');
        setIsLoadingThreads(false);
    }, [activeConnectionId, cancelAll]);

    // Focus input when thread loads
    useEffect(() => {
        if (activeThreadId && !isInvoking) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [activeThreadId, isInvoking]);

    const lastClosedAtRef = useRef<number | null>(null);
    const lastConnectionIdRef = useRef<string | null>(null);
    const wasOpenRef = useRef(isOpen);

    // Reload threads and reset state when connection or open status changes
    useEffect(() => {
        const wasOpen = wasOpenRef.current;
        wasOpenRef.current = isOpen;

        if (!isOpen) {
            if (wasOpen) lastClosedAtRef.current = Date.now();
            return;
        }

        if (isOpen && hasPermission) {
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
            }

            // This marker owns the retained chat state. Updating it while closed
            // would make an old chat appear to belong to a newly selected connection.
            lastConnectionIdRef.current = activeConnectionId;
        }
    }, [activeConnectionId, isOpen, hasPermission, loadThreads]);

    const loadThread = useCallback(async (threadId: string) => {
        const loadConnectionId = activeConnectionId;
        try {
            // A thread still generating owns newer messages than the server has.
            if (runningThreadIdsRef.current.has(threadId)) {
                setActiveThreadId(threadId);
                return;
            }
            const data = await getThread(threadId);
            if (!isActiveChatConnection(loadConnectionId)) return;
            setActiveThreadId(threadId);
            setSelectedAgentId(data.agentId ?? null);
            if (runningThreadIdsRef.current.has(threadId)) return;
            const active = await getActiveChatRun(threadId).catch((error: unknown) => {
                log.error('[AiChat] Failed to check for a reply in progress:', error);
                return null;
            });
            if (!isActiveChatConnection(loadConnectionId) || runningThreadIdsRef.current.has(threadId)) return;
            updateThreadMessages(threadId, () => [
                ...data.messages.map((m: ChatMessage) => ({
                    id: m.id,
                    role: m.role,
                    ...(m.role === 'user' ? splitAttachments(m.content) : { content: m.content }),
                    memories: m.role === 'assistant' ? savedMemories(m.toolCalls) : undefined,
                    actions: m.role === 'assistant' ? actionReceipts(m.toolCalls) : undefined,
                    toolCalls: m.toolCalls?.map((tc, index) => ({
                        id: `saved_${m.id}_${index}`,
                        tool: tc.name,
                        args: tc.args ?? {},
                        status: 'done' as const,
                        summary: tc.result ? null : undefined,
                        agent: tc.agent,
                    })) || undefined,
                    chartSpecs: m.chartSpecs || undefined,
                    createdAt: m.createdAt,
                })),
                // A reply still being worked on (or waiting for approval) continues where it is.
                ...(active ? [{
                    id: `assistant_${active.id}`,
                    role: 'assistant' as const,
                    content: '',
                    createdAt: new Date(active.createdAt).toISOString(),
                    runId: active.id,
                    isInvoking: active.status === 'running',
                    toolCalls: active.steps.map(stepToToolCall),
                    toolStatus: active.status === 'running' ? statusOf(active.steps.map(stepToToolCall)) : undefined,
                    pending: active.status === 'awaiting_approval' ? active.pending : undefined,
                }] : []),
            ]);
            if (active?.status === 'running') void followRun(threadId, active);
        } catch (err) {
            log.error('[AiChat] Failed to load thread:', err);
        }
    }, [activeConnectionId, followRun, updateThreadMessages]);

    // AI activity's "Open in chat" (ADR 0020): open the bubble on one of the viewer's threads.
    useEffect(() => {
        const handler = (event: Event): void => {
            if (!(event instanceof CustomEvent)) return;
            const detail: unknown = event.detail;
            if (!detail || typeof detail !== 'object' || !('threadId' in detail) || typeof detail.threadId !== 'string') return;
            onShowChat();
            void loadThread(detail.threadId);
        };
        window.addEventListener(OPEN_CHAT_THREAD_EVENT, handler);
        return () => window.removeEventListener(OPEN_CHAT_THREAD_EVENT, handler);
    }, [loadThread, onShowChat]);

    // An overlaid history covers the chat, so close it once the user picks where to go.
    const handleSelectThread = useCallback((threadId: string): void => {
        if (sidebarIsOverlay) setShowSidebar(false);
        void loadThread(threadId);
    }, [sidebarIsOverlay, loadThread]);

    const handleNewThread = useCallback(async () => {
        const createConnectionId = activeConnectionId;
        try {
            const thread = await createThread(undefined, createConnectionId ?? undefined, selectedAgentId);
            if (!isActiveChatConnection(createConnectionId)) return;
            setThreads((prev) => [thread, ...prev]);
            setActiveThreadId(thread.id);
        } catch (err) {
            log.error('[AiChat] Failed to create thread:', err);
        }
    }, [activeConnectionId, selectedAgentId]);

    const handleNewThreadFromHeader = useCallback((): void => {
        if (sidebarIsOverlay) setShowSidebar(false);
        void handleNewThread();
    }, [sidebarIsOverlay, handleNewThread]);

    const handleDeleteThread = useCallback(async (threadId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await deleteThread(threadId);
            stopThread(threadId);
            setThreads((prev) => prev.filter((t) => t.id !== threadId));
            setMessagesByThread((prev) => {
                const rest = { ...prev };
                delete rest[threadId];
                return rest;
            });
            draftsRef.current.delete(threadId);
            if (activeThreadId === threadId) {
                setActiveThreadId(null);
            }
        } catch (err) {
            log.error('[AiChat] Failed to delete thread:', err);
        }
    }, [activeThreadId, stopThread]);

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

    // Hand off: the conversation for whoever picks it up (a notebook, a file, an alert channel).
    const [handoffOpen, setHandoffOpen] = useState(false);
    const handoffMessages = useMemo(
        () => messages.map((m) => ({ role: m.role, content: m.content, attachments: m.attachments })),
        [messages],
    );
    const handoffActionIds = useMemo(() => [...new Set(messages.flatMap((m) => m.actions ?? []))].slice(0, 50), [messages]);
    const handoffTitle = threads.find((t) => t.id === activeThreadId)?.title
        ?? messages.find((m) => m.role === 'user')?.content.slice(0, 80)
        ?? 'Chobi conversation';

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
        if (isInvoking || !activeThreadId) return;
        const parsed = parseSkillCommands(input.trim(), skillNames);
        const trimmed = parsed.message || (attachments.length > 0 ? `Look at the attached file${attachments.length > 1 ? 's' : ''}.` : '');
        if (!trimmed) return;
        // The model may have changed since a file was attached.
        const refused = attachments.map((a) => attachmentProblem({ name: a.name, type: a.mimeType, size: a.size }, modelModalities, 0)).find(Boolean);
        if (refused) {
            toast.error(refused);
            return;
        }
        const extras: TurnExtras = {
            skills: parsed.skills,
            attachments: attachments.map(({ name, mimeType, data }) => ({ name, mimeType, data })),
        };
        lastExtrasRef.current.set(activeThreadId, extras);

        // A new message instead of an answer declines the waiting approval, so the thread is free again.
        const waiting = messages.find((m) => m.role === 'assistant' && m.pending?.length && m.runId);
        if (waiting?.runId) {
            try {
                await cancelChatRun(waiting.runId);
            } catch (error) {
                log.error('[AiChat] Failed to decline the pending approval', error);
                toast.error('Answer the pending approval first.');
                return;
            }
            updateThreadMessages(activeThreadId, (prev) => prev.map((m) => (m.id === waiting.id
                ? { ...m, pending: undefined, content: m.content || 'Not run: you sent a new message instead of approving it.' }
                : m)));
        }

        const userMsg: UIMessage = {
            id: `user_${Date.now()}`,
            role: 'user',
            content: trimmed,
            createdAt: new Date().toISOString(),
            ...(attachments.length > 0 ? { attachments: attachments.map((a) => a.name) } : {}),
        };
        const assistantMsg: UIMessage = {
            id: `assistant_${Date.now()}`,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            isInvoking: true,
        };

        const messageHistory = messages.filter((m) => m !== waiting).map((m) => ({ role: m.role, content: m.content }));
        messageHistory.push({ role: 'user', content: trimmed });

        updateThreadMessages(activeThreadId, (prev) => [...prev, userMsg, assistantMsg]);
        setInput('');
        setAttachments([]);
        setSkillQuery(null);
        // Reset textarea height back to single line
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }

        await runInvoke(activeThreadId, trimmed, messageHistory, extras);
    }, [input, isInvoking, activeThreadId, messages, runInvoke, updateThreadMessages, attachments, skillNames, modelModalities]);

    // A question from elsewhere in CHouse: drag to ask, quick ask, an item's "Ask Chobi".
    const ask = useChobiStore((state) => state.ask);
    const takeAsk = useChobiStore((state) => state.takeAsk);
    /** An ask waiting for its thread; `after` is the thread that was active when a new one was requested. */
    const askRef = useRef<{ text: string; context: AskContext | undefined; send: boolean; after: string | null | undefined } | null>(null);
    const [askSeq, setAskSeq] = useState(0);
    /** An ask that sends: false when none waits, else the attachment it waits for (null for none). */
    const sendAskRef = useRef<string | null | false>(false);
    useEffect(() => {
        if (!ask || !isOpen) return;
        takeAsk(ask.id);
        // A question to send is a new topic; one to finish typing joins the current chat when there is one.
        const newThread = ask.send || !activeThreadId || isInvoking;
        askRef.current = { text: ask.text, context: ask.context, send: ask.send, after: newThread ? activeThreadId : undefined };
        if (newThread) void handleNewThread();
        setAskSeq((n) => n + 1);
    }, [ask, isOpen, takeAsk, activeThreadId, isInvoking, handleNewThread]);
    // Applied once its thread is active: switching threads restores that thread's draft first.
    useEffect(() => {
        const pending = askRef.current;
        if (!pending || !activeThreadId) return undefined;
        if (pending.after !== undefined && activeThreadId === pending.after) return undefined;
        askRef.current = null;
        // Context alone never wipes a draft the user is typing.
        if (pending.text) setInput(pending.text);
        if (pending.context) void addFiles([new File([pending.context.content], pending.context.name, { type: 'text/plain' })]);
        sendAskRef.current = pending.send ? pending.context?.name ?? null : false;
        const timer = setTimeout(() => inputRef.current?.focus(), 0);
        return () => clearTimeout(timer);
    }, [activeThreadId, askSeq, addFiles]);
    useEffect(() => {
        const awaited = sendAskRef.current;
        if (awaited === false || !activeThreadId || isInvoking || !input.trim()) return;
        if (awaited !== null && !attachments.some((a) => a.name === awaited)) return;
        sendAskRef.current = false;
        void handleSend();
    }, [activeThreadId, attachments, handleSend, input, isInvoking]);

    // Showing the Chat tab puts the cursor in the composer.
    useEffect(() => {
        if (!visible || !isOpen) return;
        const timer = setTimeout(() => inputRef.current?.focus(), 0);
        return () => clearTimeout(timer);
    }, [visible, isOpen]);

    const handleRetry = useCallback(async (retryPrompt: string) => {
        if (!retryPrompt || isInvoking || !activeThreadId) return;

        // Replace the failed assistant message with a fresh placeholder, then re-run
        updateThreadMessages(activeThreadId, (prev) => [
            ...(prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev),
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

        await runInvoke(activeThreadId, retryPrompt, messageHistory, lastExtrasRef.current.get(activeThreadId));
    }, [isInvoking, activeThreadId, messages, runInvoke, updateThreadMessages]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (skillPickerOpen) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setSkillIndex((i) => (skillMatches.length === 0 ? 0 : (i + step + skillMatches.length) % skillMatches.length));
                return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && skillMatches[skillIndex]) {
                e.preventDefault();
                pickSkill(skillMatches[skillIndex].name);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setSkillQuery(null);
                return;
            }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend, pickSkill, skillIndex, skillMatches, skillPickerOpen]);

    const handleInputChange = useCallback((value: string, caret: number) => {
        setInput(value);
        const query = skillQueryAt(value, caret);
        setSkillQuery(query);
        if (query?.query !== skillQuery?.query) setSkillIndex(0);
    }, [skillQuery]);

    const activeThreadTitle = threads.find((t) => t.id === activeThreadId)?.title ?? 'New chat';
    const currentAgentName = chatAgents.find((a) => a.id === selectedAgentId)?.name ?? chatAgents.find((a) => a.isDefault)?.name ?? 'Default agent';
    const currentModelName = aiModels.find((m) => m.id === selectedModelId)?.name ?? 'Select model';
    const iconButtonClass = 'grid h-7 w-7 shrink-0 place-items-center rounded-sm text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';
    const pickerClass = `inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] text-paper-muted transition-colors hover:bg-ink-300 hover:text-paper ${pickerWidthClass}`;

    const startFromPrompt = async (prompt: string): Promise<void> => {
        if (!activeThreadId) await handleNewThread();
        setInput(prompt);
        setTimeout(() => inputRef.current?.focus(), 100);
    };

    return (
        <div className="flex h-full w-full flex-col" hidden={!visible} data-testid="chobi-chat">
            {/* Toolbar: history, the thread, export, hand off, new chat */}
            <div className="relative z-10 flex shrink-0 items-center gap-1 border-b border-ink-500 px-2 py-1.5">
                <button
                    type="button"
                    onClick={() => setShowSidebar(!showSidebar)}
                    className={`${iconButtonClass} ${showSidebar ? 'bg-ink-300 text-paper' : ''}`}
                    title={showSidebar ? 'Close sidebar' : 'Thread history'}
                    aria-label={showSidebar ? 'Close sidebar' : 'Thread history'}
                >
                    {showSidebar ? <PanelLeftClose className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                </button>
                <span className="min-w-0 flex-1 truncate px-1 text-[12px] font-medium text-paper" title={activeThreadTitle}>
                    {activeThreadTitle}
                </span>
                <button
                    onClick={handleExportThread}
                    disabled={!activeThreadId || messages.length === 0}
                    className={iconButtonClass}
                    title="Export thread"
                    aria-label="Export thread"
                >
                    <Download className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={() => setHandoffOpen(true)}
                    disabled={!activeThreadId || messages.length === 0}
                    className={iconButtonClass}
                    title="Hand off"
                    aria-label="Hand off"
                >
                    <Share2 className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={handleNewThreadFromHeader}
                    className={iconButtonClass}
                    title="New chat"
                    aria-label="New chat"
                >
                    <Plus className="h-4 w-4" />
                </button>
            </div>

            <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
                {/* Thread history: full-screen on phones, slides over narrow panels, docked on wide ones. */}
                {showSidebar && (
                    <div
                        data-testid="ai-chat-thread-sidebar"
                        data-overlay={sidebarIsOverlay ? 'true' : 'false'}
                        className={`z-20 flex-shrink-0 overflow-y-auto border-r border-ink-500 bg-ink-100 transition-all ${isMobile ? 'absolute inset-0 w-full' : sidebarIsOverlay ? 'absolute inset-y-0 left-0 w-72 max-w-[85%] shadow-2xl shadow-black/40' : 'relative w-64'}`}
                    >
                        <div className="p-2">
                            <div className="mb-1 flex items-center justify-between px-2 pt-1">
                                <h3 className="text-[12px] font-semibold text-paper">Conversations</h3>
                                <span className="font-mono text-[10px] text-paper-faint">{threads.length}</span>
                            </div>
                            {isLoadingThreads ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-4 w-4 text-paper-dim motion-safe:animate-spin" />
                                </div>
                            ) : threads.length === 0 ? (
                                <p className="py-8 text-center text-[12px] text-paper-faint">No conversations yet</p>
                            ) : (
                                <div className="py-1">
                                    <CollapsibleThreadGroup
                                        title="Recent"
                                        threads={groupedThreads.recent}
                                        activeId={activeThreadId}
                                        editingId={editingThreadId}
                                        onLoad={handleSelectThread}
                                        onDelete={handleDeleteThread}
                                        onStartEdit={handleStartEditThread}
                                        onSaveTitle={handleSaveThreadTitle}
                                        onCancelEdit={handleCancelEditThread}
                                        busyIds={busyThreadIds}
                                        defaultExpanded={true}
                                    />
                                    <CollapsibleThreadGroup
                                        title="Last 24 Hours"
                                        threads={groupedThreads.last24Hours}
                                        activeId={activeThreadId}
                                        editingId={editingThreadId}
                                        onLoad={handleSelectThread}
                                        onDelete={handleDeleteThread}
                                        onStartEdit={handleStartEditThread}
                                        onSaveTitle={handleSaveThreadTitle}
                                        onCancelEdit={handleCancelEditThread}
                                        busyIds={busyThreadIds}
                                        defaultExpanded={true}
                                    />
                                    <CollapsibleThreadGroup
                                        title="Previous 7 Days"
                                        threads={groupedThreads.last7Days}
                                        activeId={activeThreadId}
                                        editingId={editingThreadId}
                                        onLoad={handleSelectThread}
                                        onDelete={handleDeleteThread}
                                        onStartEdit={handleStartEditThread}
                                        onSaveTitle={handleSaveThreadTitle}
                                        onCancelEdit={handleCancelEditThread}
                                        busyIds={busyThreadIds}
                                        defaultExpanded={true}
                                    />
                                    {groupedThreads.recent.length === 0 && groupedThreads.last24Hours.length === 0 && groupedThreads.last7Days.length === 0 && (
                                        <p className="py-8 text-center text-[12px] text-paper-faint">No recent conversations</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Conversation */}
                <div className="flex min-w-0 flex-1 flex-col">
                    <div ref={scrollContainerRef} className={`flex-1 overflow-y-auto py-3 ${isMobile ? 'px-3' : 'px-4'}`}>
                        {!activeThreadId || messages.length === 0 ? (
                            /* Welcome: before a thread starts, and in an empty thread */
                            <div className={`flex flex-col items-center px-2 text-center ${activeThreadId ? 'pt-8' : 'h-full justify-center'}`}>
                                <Mascot mood="happy" plain={plain} size={56} />
                                <h3 className="mt-3 text-[15px] font-semibold text-paper">
                                    {activeThreadId ? 'New conversation' : 'Chobi chat'}
                                </h3>
                                <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-paper-muted">
                                    Ask me about a table, a slow query or an error. I read your schema, and I ask before changes that undo can't reverse.
                                </p>
                                <div className="mt-5 flex w-full max-w-md flex-wrap justify-center gap-1.5">
                                    {visiblePrompts.map((sp) => (
                                        <button
                                            key={sp.label}
                                            type="button"
                                            onClick={() => void startFromPrompt(sp.prompt)}
                                            className="group inline-flex items-center gap-1.5 rounded-full border border-ink-500 bg-ink-100 px-3 py-1.5 text-left text-[12px] text-paper-muted transition-colors hover:border-brand/60 hover:text-paper"
                                        >
                                            <sp.icon className="h-3 w-3 shrink-0 text-paper-dim transition-colors group-hover:text-brand" aria-hidden />
                                            <span className="truncate">{sp.label}</span>
                                        </button>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShuffleKey(Date.now())}
                                    className="mt-2 inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] text-paper-faint transition-colors hover:bg-ink-200 hover:text-paper"
                                    title="Show different suggestions"
                                >
                                    <Shuffle className="h-3 w-3" />
                                    More ideas
                                </button>
                                {!activeThreadId && (
                                    <button
                                        type="button"
                                        onClick={handleNewThread}
                                        className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-[12px] font-semibold text-ink-50 transition-colors hover:bg-brand-soft"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Start new chat
                                    </button>
                                )}
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
                                                    paddingBottom: '1rem',
                                                }}
                                            >
                                                {msg.role === 'user' ? (
                                                    <div
                                                        className="group flex flex-col items-end gap-1"
                                                        style={{ animation: `fadeSlideIn 0.3s ease-out ${Math.min(idx * 0.05, 0.3)}s both` }}
                                                    >
                                                        <div className="max-w-[85%] overflow-hidden rounded-lg rounded-br-sm border border-brand/25 bg-brand/10 px-3 py-2 text-[13px] leading-relaxed text-paper">
                                                            <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                                                            {msg.attachments && msg.attachments.length > 0 && (
                                                                <span className="mt-2 flex flex-wrap gap-1.5">
                                                                    {msg.attachments.map((name) => (
                                                                        <span key={name} className="inline-flex max-w-full items-center gap-1 rounded-sm border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">
                                                                            <Paperclip className="h-2.5 w-2.5 shrink-0" aria-hidden />
                                                                            <span className="truncate">{name}</span>
                                                                        </span>
                                                                    ))}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <MessageMeta createdAt={msg.createdAt} content={msg.content} />
                                                    </div>
                                                ) : (
                                                    <div
                                                        className="group flex gap-2.5"
                                                        style={{ animation: `fadeSlideIn 0.3s ease-out ${Math.min(idx * 0.05, 0.3)}s both` }}
                                                    >
                                                        <Mascot
                                                            mood={msg.isError ? 'alert' : msg.pending?.length ? 'waiting' : msg.isInvoking ? 'thinking' : 'idle'}
                                                            plain={plain}
                                                            still={!msg.isInvoking}
                                                            size={26}
                                                            className="mt-0.5 shrink-0"
                                                        />
                                                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                                                            <p className="flex min-w-0 items-baseline gap-1.5 text-[11px]">
                                                                <span className="font-semibold text-paper">Chobi</span>
                                                                {msg.agentName && chatAgents.length > 1 && (
                                                                    <span className="truncate text-paper-faint">· {msg.agentName}</span>
                                                                )}
                                                            </p>
                                                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                                                                <ActivityPanel
                                                                    toolCalls={msg.toolCalls}
                                                                    isInvoking={msg.isInvoking}
                                                                    waiting={Boolean(msg.pending?.length)}
                                                                />
                                                            )}
                                                            {msg.pending && msg.pending.length > 0 && msg.runId && activeThreadId && (
                                                                <ApprovalCard
                                                                    key={msg.runId + msg.pending.map((p) => p.actionId).join()}
                                                                    pending={msg.pending}
                                                                    canAct={canAct}
                                                                    busy={isInvoking}
                                                                    onSubmit={(decisions) => void answerApprovals(activeThreadId, msg.runId!, msg.pending!, decisions, msg.toolCalls ?? [])}
                                                                />
                                                            )}
                                                            {msg.isInvoking && msg.toolStatus && !msg.content && (
                                                                <div className="flex items-center gap-2 py-0.5 text-[12px] text-paper-muted" aria-live="polite">
                                                                    <Loader2 className="h-3 w-3 text-brand motion-safe:animate-spin" />
                                                                    <span>{msg.toolStatus}…</span>
                                                                </div>
                                                            )}
                                                            {msg.isError ? (
                                                                <div className="flex flex-col gap-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2">
                                                                    <p className="text-[13px] text-red-200">{msg.content}</p>
                                                                    {msg.retryPrompt && (msg.retryable !== false) && (
                                                                        <button
                                                                            onClick={() => handleRetry(msg.retryPrompt!)}
                                                                            disabled={isInvoking}
                                                                            className="flex items-center gap-1.5 self-start rounded-sm px-2 py-1 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-950/40 hover:text-red-200 disabled:opacity-40"
                                                                            aria-label="Retry"
                                                                        >
                                                                            <RefreshCw className="h-3 w-3" />
                                                                            Retry
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <div className="min-w-0 text-[13px] leading-relaxed text-paper">
                                                                    {msg.chartSpecs?.map((spec, i) => (
                                                                        <AiChartRenderer key={i} spec={spec} />
                                                                    ))}
                                                                    <div className="max-w-full overflow-x-auto">
                                                                        <ReactMarkdown
                                                                            remarkPlugins={[remarkGfm]}
                                                                            components={markdownComponents}
                                                                        >
                                                                            {preprocessMarkdown(msg.content) + (msg.isInvoking && !msg.toolStatus ? ' ▊' : '')}
                                                                        </ReactMarkdown>
                                                                    </div>
                                                                    {msg.memories && msg.memories.length > 0 && <MemoryNotes notes={msg.memories} />}
                                                                    {msg.actions && msg.actions.length > 0 && <ActionReceipts ids={msg.actions} />}
                                                                </div>
                                                            )}
                                                            <MessageMeta createdAt={msg.createdAt} content={msg.content} />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <div ref={messagesEndRef} />
                            </>
                        )}
                    </div>

                    {/* Composer */}
                    {activeThreadId && (
                        <div className={`relative z-10 flex-shrink-0 border-t border-ink-500 px-3 pt-2 ${isMobile ? 'pb-5' : 'pb-2'}`}>
                            <MemorySuggestions
                                threadId={activeThreadId}
                                messageCount={messages.length}
                                generating={isInvoking}
                                enabled={chobiSettings.data?.memorySuggestions !== false}
                            />
                            <ComposerChips
                                attachments={attachments}
                                skills={pinnedSkills}
                                onRemoveAttachment={(id) => setAttachments((previous) => previous.filter((a) => a.id !== id))}
                            />
                            <form
                                onSubmit={handleSend}
                                className={`relative flex items-end gap-1 rounded-lg border bg-ink-200/60 p-1 transition-colors focus-within:border-brand/70 ${isDraggingFile ? 'border-dashed border-brand' : 'border-ink-500'}`}
                                onDragOver={(e) => {
                                    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
                                    e.preventDefault();
                                    setIsDraggingFile(true);
                                }}
                                onDragLeave={() => setIsDraggingFile(false)}
                                onDrop={(e) => {
                                    if (e.dataTransfer.files.length === 0) return;
                                    e.preventDefault();
                                    setIsDraggingFile(false);
                                    void addFiles(Array.from(e.dataTransfer.files));
                                }}
                            >
                                {skillPickerOpen && (
                                    <SkillSuggestions skills={skillMatches} activeIndex={skillIndex} onPick={pickSkill} onHover={setSkillIndex} />
                                )}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    accept={attachmentAccept(modelModalities)}
                                    className="hidden"
                                    aria-hidden
                                    tabIndex={-1}
                                    onChange={(e) => {
                                        const files = Array.from(e.target.files ?? []);
                                        e.target.value = '';
                                        void addFiles(files);
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isInvoking}
                                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper disabled:opacity-40"
                                    title={attachmentHint(modelModalities)}
                                    aria-label={attachmentHint(modelModalities)}
                                >
                                    <Paperclip className="h-4 w-4" />
                                </button>
                                <textarea
                                    ref={inputRef}
                                    value={input}
                                    onChange={(e) => handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                                    onKeyDown={handleKeyDown}
                                    onBlur={() => setSkillQuery(null)}
                                    onPaste={(e) => {
                                        const files = Array.from(e.clipboardData.files);
                                        if (files.length === 0) return;
                                        e.preventDefault();
                                        void addFiles(files);
                                    }}
                                    placeholder={chatSkills.length > 0 ? 'Ask Chobi… type / for skills' : 'Ask Chobi about your databases…'}
                                    disabled={isInvoking}
                                    rows={1}
                                    aria-autocomplete={chatSkills.length > 0 ? 'list' : undefined}
                                    aria-expanded={skillPickerOpen}
                                    className="max-h-[120px] min-h-[32px] flex-1 resize-none border-0 bg-transparent px-1.5 py-1.5 text-[13px] leading-snug text-paper placeholder:text-paper-faint focus:outline-none focus:ring-0 disabled:opacity-40"
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
                                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-red-50 text-red-700 transition-colors hover:bg-red-100 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/50"
                                        title="Stop generating"
                                        aria-label="Stop generating"
                                    >
                                        <Square className="h-3 w-3 fill-current" />
                                    </button>
                                ) : (
                                    <button
                                        type="submit"
                                        disabled={!input.trim() && attachments.length === 0}
                                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand text-ink-50 transition-colors hover:bg-brand-soft disabled:bg-ink-300 disabled:text-paper-faint"
                                        title="Send message"
                                        aria-label="Send"
                                    >
                                        <ArrowUp className="h-4 w-4" />
                                    </button>
                                )}
                            </form>
                            <div className="mt-1 flex min-h-6 items-center gap-0.5">
                                {chatAgents.length > 1 && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button type="button" aria-label="Chat agent" title="Chat agent" className={pickerClass}>
                                                <Bot className="h-3 w-3 shrink-0" aria-hidden />
                                                <span className="truncate">{currentAgentName}</span>
                                                <ChevronDown className="h-3 w-3 shrink-0 text-paper-faint" aria-hidden />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start" side="top" className="w-[280px] rounded-md border-ink-500 bg-ink-100 p-0">
                                            <div className="border-b border-ink-500 px-3 py-2 text-[11px] font-semibold text-paper-muted">
                                                Chat agent
                                            </div>
                                            <div className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto p-1">
                                                {chatAgents.map((a) => {
                                                    const isCurrent = selectedAgentId === a.id || (selectedAgentId === null && a.isDefault);
                                                    return (
                                                        <DropdownMenuItem
                                                            key={a.id}
                                                            onClick={() => setSelectedAgentId(a.isDefault ? null : a.id)}
                                                            className={`flex cursor-pointer items-start gap-2.5 rounded-sm px-3 py-2 transition-colors hover:bg-ink-200 ${isCurrent ? 'bg-ink-200' : ''}`}
                                                        >
                                                            <PickerDot current={isCurrent} />
                                                            <div className="flex min-w-0 flex-col gap-0.5">
                                                                <span className={`truncate text-[13px] font-medium ${isCurrent ? 'text-paper' : 'text-paper-muted'}`}>
                                                                    {a.kind === 'router' ? `Auto · ${a.name}` : a.name}{a.isDefault ? ' (default)' : ''}
                                                                </span>
                                                                <span className="line-clamp-2 text-[11px] text-paper-faint">{a.description}</span>
                                                            </div>
                                                        </DropdownMenuItem>
                                                    );
                                                })}
                                            </div>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                                {aiModels.length > 0 && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button type="button" aria-label="AI model" title="AI model" className={pickerClass}>
                                                <Cpu className="h-3 w-3 shrink-0" aria-hidden />
                                                <span className="truncate">{currentModelName}</span>
                                                <ChevronDown className="h-3 w-3 shrink-0 text-paper-faint" aria-hidden />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start" side="top" className="w-[240px] rounded-md border-ink-500 bg-ink-100 p-0">
                                            <div className="border-b border-ink-500 px-3 py-2 text-[11px] font-semibold text-paper-muted">
                                                AI model
                                            </div>
                                            <div className="flex max-h-[280px] flex-col gap-0.5 overflow-y-auto p-1">
                                                {aiModels.map((m) => {
                                                    const isCurrent = selectedModelId === m.id;
                                                    return (
                                                        <DropdownMenuItem
                                                            key={m.id}
                                                            onClick={() => setSelectedModelId(m.id)}
                                                            className={`flex cursor-pointer items-start gap-2.5 rounded-sm px-3 py-2 transition-colors hover:bg-ink-200 ${isCurrent ? 'bg-ink-200' : ''}`}
                                                        >
                                                            <PickerDot current={isCurrent} />
                                                            <div className="flex min-w-0 flex-col gap-0.5">
                                                                <span className={`truncate text-[13px] font-medium ${isCurrent ? 'text-paper' : 'text-paper-muted'}`}>
                                                                    {m.name}
                                                                </span>
                                                                <span className="truncate text-[11px] text-paper-faint">
                                                                    {m.provider || 'AI provider'}
                                                                </span>
                                                            </div>
                                                        </DropdownMenuItem>
                                                    );
                                                })}
                                            </div>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                                {isInvoking && toolStatus ? (
                                    <span className="ml-auto flex min-w-0 items-center gap-1.5 truncate pl-2 text-[11px] text-paper-muted" aria-live="polite">
                                        <Loader2 className="h-3 w-3 shrink-0 text-brand motion-safe:animate-spin" />
                                        <span className="truncate">{toolStatus}…</span>
                                    </span>
                                ) : !narrowPickers && (
                                    <span className="ml-auto pl-2 text-[11px] text-paper-faint">Shift+Enter for a new line</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {handoffOpen && <HandoffDialog open onClose={() => setHandoffOpen(false)} title={handoffTitle} messages={handoffMessages} actionIds={handoffActionIds} />}
        </div>
    );
}

/** The radio dot in the agent and model pickers. */
function PickerDot({ current }: { current: boolean }): React.JSX.Element {
    return (
        <div className="mt-0.5 flex-shrink-0">
            <div className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${current ? 'border-brand' : 'border-ink-700'}`}>
                {current && <div className="h-1.5 w-1.5 rounded-full bg-brand" />}
            </div>
        </div>
    );
}

/** When a message was sent, and a copy button that shows on hover. */
function MessageMeta({ createdAt, content }: { createdAt: string; content: string }): React.JSX.Element {
    return (
        <div className="flex items-center gap-1">
            <span className="text-[10px] text-paper-faint">{timeAgo(createdAt)}</span>
            <button
                type="button"
                onClick={() => copyToClipboard(content, 'Message')}
                className="rounded-sm p-1 text-paper-dim opacity-0 transition-colors hover:bg-ink-300 hover:text-paper focus-visible:opacity-100 group-hover:opacity-100"
                title="Copy message"
                aria-label="Copy message"
            >
                <Copy className="h-3 w-3" />
            </button>
        </div>
    );
}
