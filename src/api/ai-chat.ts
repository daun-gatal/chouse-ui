/**
 * AI Chat API Module.
 * 
 * Frontend API functions for communicating with the AI chat backend.
 * Handles invoked responses, thread management, and status checks.
 */

import { api } from './client';
import { readSse } from '@/lib/sse';

// ============================================
// Types
// ============================================

export interface ChatThread {
    id: string;
    userId: string;
    title: string | null;
    connectionId: string | null;
    /** Chat agent chosen for the thread; null = the default (bound) chat agent. */
    agentId?: string | null;
    createdAt: string;
    updatedAt: string;
}

/** One tool call of a chat answer; `agent` is the subagent path when a subagent made it. */
export interface ChatToolCall {
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    agent?: string;
}

/** A chat agent the user may pick (ADR 0019). */
export interface ChatAgentOption {
    id: string;
    slug: string;
    name: string;
    description: string;
    kind: 'router' | 'agent';
    /** The agent bound to the chat feature — used when a thread picks none. */
    isDefault: boolean;
}

export interface ChatMessage {
    id: string;
    threadId: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: ChatToolCall[] | null;
    chartSpecs?: ChartSpec[] | null;
    createdAt: string;
}

export interface ChatStatus {
    enabled: boolean;
}

/**
 * Chart specification sent from server via a chart-data SSE event.
 * Used by AiChartRenderer to render an interactive chart inline in the chat.
 */
export interface ChartSpec {
    /** Chart type identifier */
    chartType: string;
    /** Optional display title */
    title?: string;
    /** Column metadata from the query result */
    columns: { name: string; type: string }[];
    /** Row data (max 500 rows) */
    rows: Record<string, unknown>[];
    /** Column name for the X axis */
    xAxis: string;
    /** Column name(s) for the Y axis */
    yAxis: string | string[];
    /** Color palette key: 'violet' | 'blue' | 'green' | 'orange' | 'rainbow' */
    colorScheme: string;
}

export interface AiModelSimple {
    id: string;
    name: string;
    provider: string;
    isDefault: boolean;
    /** Attachments the model accepts besides text (ADR 0024). */
    inputModalities?: Array<'image' | 'pdf'>;
}

// ============================================
// Status & Models
// ============================================

/**
 * Check if AI chat is enabled
 */
export async function getChatStatus(): Promise<ChatStatus> {
    return api.get<ChatStatus>('/ai-chat/status');
}

/**
 * Get available AI models
 */
export async function getAiModels(): Promise<AiModelSimple[]> {
    return api.get<AiModelSimple[]>('/ai-chat/models');
}

// ============================================
// Thread CRUD
// ============================================

/**
 * List chat threads (last 7 days)
 */
export async function listThreads(connectionId?: string | null): Promise<ChatThread[]> {
    const params = connectionId ? { connectionId } : undefined;
    return api.get<ChatThread[]>('/ai-chat/threads', { params });
}

/**
 * Create a new chat thread
 */
export async function createThread(title?: string, connectionId?: string, agentId?: string | null): Promise<ChatThread> {
    return api.post<ChatThread>('/ai-chat/threads', { title, connectionId, agentId });
}

/**
 * Get a thread with its messages
 */
export async function getThread(threadId: string): Promise<ChatThread & { messages: ChatMessage[] }> {
    return api.get<ChatThread & { messages: ChatMessage[] }>(`/ai-chat/threads/${threadId}`);
}

/**
 * Update thread title
 */
export async function updateThreadTitle(threadId: string, title: string): Promise<void> {
    await api.patch('/ai-chat/threads/' + threadId, { title });
}

/**
 * Delete a thread
 */
export async function deleteThread(threadId: string): Promise<void> {
    await api.delete('/ai-chat/threads/' + threadId);
}

// ============================================
// Invoked Chat
// ============================================

export interface ChatInvokeResult {
    content: string;
    toolCalls: ChatToolCall[];
    chartSpecs: ChartSpec[];
    /** The agent that answered. */
    agent?: { id: string; slug: string; name: string };
}

/**
 * Chat agents the user may pick, routers first.
 */
export async function getChatAgents(): Promise<ChatAgentOption[]> {
    return api.get<ChatAgentOption[]>('/ai-chat/agents');
}

/**
 * Invoke a chat turn and resolve when the complete agent response is ready.
 * The caller owns optimistic loading state and may cancel with AbortSignal.
 */
export async function invokeChatMessage(
    threadId: string,
    message: string,
    messages?: Array<{ role: string; content: string }>,
    modelId?: string,
    signal?: AbortSignal,
    agentId?: string | null
): Promise<ChatInvokeResult> {
    return api.post<ChatInvokeResult>(
        '/ai-chat/invoke',
        { threadId, message, messages, modelId, agentId },
        { signal },
    );
}

// ============================================
// Durable chat runs (ADR 0024)
// ============================================

export type ChatRunStatus = 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';

/** One tool call of a run, as it happens. */
export interface ChatRunStep {
    id: string;
    name: string;
    args: Record<string, unknown>;
    agent?: string;
    status: 'running' | 'done' | 'failed';
    summary: string | null;
    startedAt: number;
    endedAt: number | null;
}

/** A tool call waiting for the user's approval. */
export interface PendingApproval {
    id: string;
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    description: string;
    expiresAt: number;
}

export interface ChatRunAnswer {
    messageId: string | null;
    content: string;
    toolCalls: ChatToolCall[];
    chartSpecs: ChartSpec[];
    agent: { id: string; slug: string; name: string };
}

export interface ChatRun {
    id: string;
    threadId: string;
    status: ChatRunStatus;
    steps: ChatRunStep[];
    pending: PendingApproval[];
    result: ChatRunAnswer | null;
    error: string | null;
    createdAt: number;
}

export type ChatRunEvent =
    | { type: 'run'; run: ChatRun }
    | { type: 'step'; step: ChatRunStep }
    | { type: 'status'; status: ChatRunStatus; pending: PendingApproval[] }
    | { type: 'final'; result: ChatRunAnswer }
    | { type: 'error'; message: string; code: string; status: ChatRunStatus };

/** A file sent with a chat message (base64). */
export interface ChatAttachmentInput {
    name: string;
    mimeType: string;
    data: string;
}

export interface ChatRunRequest {
    threadId: string;
    message: string;
    messages?: Array<{ role: string; content: string }>;
    modelId?: string;
    agentId?: string | null;
    skills?: string[];
    attachments?: ChatAttachmentInput[];
}

const RUN_EVENT_TYPES = new Set(['run', 'step', 'status', 'final', 'error']);

function isRunEvent(value: unknown): value is ChatRunEvent {
    return Boolean(value) && typeof value === 'object' && RUN_EVENT_TYPES.has(String((value as { type?: unknown }).type));
}

async function consume(response: Response, onEvent: (event: ChatRunEvent) => void, signal?: AbortSignal): Promise<void> {
    for await (const raw of readSse(response, signal)) {
        if (!RUN_EVENT_TYPES.has(raw.event)) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw.data);
        } catch {
            continue;
        }
        if (isRunEvent(parsed)) onEvent(parsed);
    }
}

/**
 * Start a chat turn and stream it. Resolves when the stream ends (the run
 * finished, paused for approval, failed or was stopped) or `signal` aborts —
 * aborting only closes the stream; the run keeps going on the server.
 */
export async function streamChatRun(request: ChatRunRequest, onEvent: (event: ChatRunEvent) => void, signal?: AbortSignal): Promise<void> {
    const response = await api.stream('POST', '/ai-chat/runs', request, signal);
    await consume(response, onEvent, signal);
}

/** Re-attach to a run (after a refresh) and stream the rest of it. */
export async function followChatRun(runId: string, onEvent: (event: ChatRunEvent) => void, signal?: AbortSignal): Promise<void> {
    const response = await api.stream('GET', `/ai-chat/runs/${runId}/events`, undefined, signal);
    await consume(response, onEvent, signal);
}

export async function getChatRun(runId: string): Promise<ChatRun> {
    return api.get<ChatRun>(`/ai-chat/runs/${runId}`);
}

/** Stop a run; the server finishes it as cancelled. */
export async function cancelChatRun(runId: string): Promise<ChatRun> {
    return api.post<ChatRun>(`/ai-chat/runs/${runId}/cancel`);
}

/** The thread's run that is still going or waiting for approval, or null. */
export async function getActiveChatRun(threadId: string): Promise<ChatRun | null> {
    return api.get<ChatRun | null>(`/ai-chat/threads/${threadId}/active-run`);
}

export interface ChatSkill {
    name: string;
    description: string;
}

/** Skills the agent reads — what the composer offers as /skill: commands. */
export async function getChatSkills(agentId: string | null): Promise<ChatSkill[]> {
    return api.get<ChatSkill[]>('/ai-chat/skills', { params: agentId ? { agentId } : undefined });
}
