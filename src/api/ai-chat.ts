/**
 * AI Chat API Module.
 * 
 * Frontend API functions for communicating with the AI chat backend.
 * Handles invoked responses, thread management, and status checks.
 */

import { api } from './client';

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
