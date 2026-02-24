/**
 * AI Chat API Module
 * 
 * Frontend API functions for communicating with the AI chat backend.
 * Handles SSE streaming, thread management, and status checks.
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
    createdAt: string;
    updatedAt: string;
}

export interface ChatMessage {
    id: string;
    threadId: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: unknown }> | null;
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

export interface StreamDelta {
    type: 'text-delta' | 'done' | 'error' | 'status' | 'tool-call' | 'tool-complete' | 'chart-data';
    text?: string;
    error?: string;
    status?: string;
    tool?: string;
    /** Args passed to the tool (present on tool-call events) */
    args?: Record<string, unknown>;
    /** Human-readable result summary (present on tool-complete events) */
    summary?: string | null;
    /** Chart specification (present on chart-data events) */
    chartSpec?: ChartSpec;
}

// ============================================
// Status
// ============================================

/**
 * Check if AI chat is enabled
 */
export async function getChatStatus(): Promise<ChatStatus> {
    return api.get<ChatStatus>('/ai-chat/status');
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
export async function createThread(title?: string, connectionId?: string): Promise<ChatThread> {
    return api.post<ChatThread>('/ai-chat/threads', { title, connectionId });
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
// Streaming Chat
// ============================================

/**
 * Stream a chat message via SSE.
 * Returns an async generator that yields text deltas.
 * Uses raw fetch (not api client) for streaming support.
 */
export async function* streamChatMessage(
    threadId: string,
    message: string,
    messages?: Array<{ role: string; content: string }>,
    signal?: AbortSignal
): AsyncGenerator<StreamDelta> {
    // Build auth headers manually for streaming
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
    };

    // Add session ID
    const sessionId = sessionStorage.getItem('ch_session_id');
    if (sessionId) {
        headers['X-Session-ID'] = sessionId;
    }

    // Add RBAC token
    const rbacToken = localStorage.getItem('rbac_access_token');
    if (rbacToken) {
        headers['Authorization'] = `Bearer ${rbacToken}`;
    }

    const response = await fetch('/api/ai-chat/stream', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            threadId,
            message,
            messages,
        }),
        credentials: 'include',
        signal,
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(
            (errorBody as { error?: { message?: string } })?.error?.message ||
            `Chat request failed: ${response.status}`
        );
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE events are separated by double newlines (\n\n).
            // We must split on \n\n — NOT \n — because large payloads like
            // chart-data contain embedded newlines inside the JSON, and
            // splitting by \n would break JSON.parse on any multi-line event.
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? ''; // Keep the last incomplete event in the buffer

            for (const event of events) {
                // An SSE event may have multiple "data: ..." lines — join them.
                const dataLines = event
                    .split('\n')
                    .filter((l) => l.startsWith('data: '))
                    .map((l) => l.slice(6));

                if (dataLines.length === 0) continue;

                // Re-join multi-line data values (rare but possible)
                const rawJson = dataLines.join('');

                try {
                    const data = JSON.parse(rawJson) as StreamDelta;
                    yield data;

                    if (data.type === 'done' || data.type === 'error') {
                        return;
                    }
                } catch {
                    // Skip malformed SSE events
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}
