/**
 * AI Chat Routes
 * 
 * Provides streaming chat with AI assistant and thread/message management.
 * All routes require RBAC authentication with `ai:chat` permission.
 */

import { Hono, type Context, type Next } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { AppError, type Session } from "../types";
import { optionalRbacMiddleware } from "../middleware/dataAccess";
import { getSession } from "../services/clickhouse";
import { getUserConnections, getConnectionWithPassword } from "../rbac/services/connections";
import { ClickHouseService } from "../services/clickhouse";
import { userHasPermission } from "../rbac/services/rbac";
import { PERMISSIONS } from "../rbac/schema/base";
import { isAIEnabled } from "../services/aiConfig";
import { streamChat, type ChatContext } from "../services/aiChat";
import {
    createThread,
    listThreads,
    getThread,
    updateThreadTitle,
    deleteThread,
    addMessage,
    getMessages,
    cleanupOldThreads,
} from "../services/chatHistory";

// ============================================
// Types
// ============================================

type Variables = {
    sessionId?: string;
    service: ClickHouseService;
    session?: Session;
    rbacUserId?: string;
    rbacRoles?: string[];
    rbacPermissions?: string[];
    isRbacAdmin?: boolean;
    rbacConnectionId?: string;
};

const aiChat = new Hono<{ Variables: Variables }>();

// ============================================
// Scratchpad Stripping
// ============================================

/**
 * Strip chain-of-thought / scratchpad reasoning that some models leak
 * into the text response.
 * 
 * Pattern observed: "analysis<reasoning>assistantfinal<actual answer>"
 * Strategy: find the LAST known end-marker and extract only what follows.
 */
function stripScratchpad(text: string): string {
    if (!text) return text;

    const lowerText = text.toLowerCase();

    // Find the last occurrence of any known scratchpad end-marker.
    // Everything before + including the marker is reasoning — discard it.
    const endMarkers = [
        'assistantfinal',       // Most common: "analysisXXXassistantfinalYYY"
        'assistant\nfinal',     // "assistant\nfinal" with newline
        'assistant final',      // "assistant final" with space
        '\nfinal\n',            // "final" on its own line
        '\nfinal',              // "final" followed immediately by text (no trailing newline)
    ];

    let bestCut = -1;
    for (const marker of endMarkers) {
        const idx = lowerText.lastIndexOf(marker);
        if (idx !== -1) {
            const cutAt = idx + marker.length;
            if (cutAt > bestCut) bestCut = cutAt;
        }
    }

    if (bestCut > 0 && bestCut < text.length) {
        return text.substring(bestCut).trim();
    }

    // Fallback: handle leading CoT markers that appear at the very start of the
    // buffer without a preceding newline (e.g. "finalBelow is..." or "analysisHere")
    const trimmed = text.trimStart();

    // Strip a bare "final" CoT marker at the start.
    // Preserve real words like "finally", "finalize" (lowercase continuation).
    // Catches: "finalBelow...", "final**text**", "final## ...", "final\n..."
    if (trimmed.length >= 5 && trimmed.slice(0, 5).toLowerCase() === 'final') {
        if (trimmed.length === 5 || !/[a-z]/.test(trimmed[5])) {
            return trimmed.slice(5).trim();
        }
    }

    // Strip leading "analysis..." blocks — look for first markdown element
    if (/^(analysis|thinking)/i.test(trimmed)) {
        const mdMatch = trimmed.match(/\n\s*(?=[|#\-*>\d])/);
        if (mdMatch && mdMatch.index && mdMatch.index > 0) {
            return trimmed.substring(mdMatch.index).trim();
        }
    }

    return text;
}

// Helper to get cookie value
function getCookie(c: Context, name: string): string | undefined {
    const cookies = c.req.header("Cookie") || "";
    const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : undefined;
}

// ============================================
// Auth Middleware (reuses same pattern as query routes)
// ============================================

async function chatAuthMiddleware(c: Context<{ Variables: Variables }>, next: Next) {
    // Extract RBAC context
    await optionalRbacMiddleware(c, async () => { });

    const rbacUserId = c.get("rbacUserId");
    const rbacPermissions = c.get("rbacPermissions");
    const isRbacAdmin = c.get("isRbacAdmin");

    if (!rbacUserId) {
        throw AppError.unauthorized("RBAC authentication required. Please login.");
    }

    // Check ai:chat permission
    if (!isRbacAdmin) {
        const hasPermission = rbacPermissions?.includes(PERMISSIONS.AI_CHAT) || false;
        if (!hasPermission) {
            const hasPerm = await userHasPermission(rbacUserId, PERMISSIONS.AI_CHAT as any);
            if (!hasPerm) {
                throw AppError.forbidden("Permission 'ai:chat' required for AI chat.");
            }
        }
    }

    // Try session-based ClickHouse connection first
    const sessionId = c.req.header("X-Session-ID") || getCookie(c, "ch_session");
    if (sessionId) {
        const sessionData = getSession(sessionId);
        if (sessionData) {
            // Validate session ownership
            if (sessionData.session.rbacUserId && sessionData.session.rbacUserId !== rbacUserId) {
                throw AppError.forbidden("Session does not belong to current user.");
            }
            c.set("sessionId", sessionId);
            c.set("service", sessionData.service);
            c.set("session", sessionData.session);
            c.set("rbacConnectionId", sessionData.session.rbacConnectionId);
            await next();
            return;
        }
    }

    // RBAC-based connection (same logic as query route)
    const rbacRoles = c.get("rbacRoles");
    const isSuperAdmin = rbacRoles?.includes('super_admin') || false;

    let connections: Awaited<ReturnType<typeof getUserConnections>>;
    if (isSuperAdmin) {
        const { listConnections } = await import("../rbac/services/connections");
        const result = await listConnections({ activeOnly: true });
        connections = result.connections;
    } else {
        connections = await getUserConnections(rbacUserId);
    }

    if (connections.length === 0) {
        throw AppError.unauthorized("No ClickHouse connection available.");
    }

    const defaultConnection = connections.find((conn) => conn.isDefault && conn.isActive);
    const activeConnection = defaultConnection || connections.find((conn) => conn.isActive);

    if (!activeConnection) {
        throw AppError.unauthorized("No active ClickHouse connection found.");
    }

    const connection = await getConnectionWithPassword(activeConnection.id);
    if (!connection) {
        throw AppError.unauthorized("Connection not found.");
    }

    const protocol = connection.sslEnabled ? 'https' : 'http';
    const url = `${protocol}://${connection.host}:${connection.port}`;

    const service = new ClickHouseService({
        url,
        username: connection.username,
        password: connection.password || "",
        database: connection.database || undefined,
    }, { rbacUserId });

    c.set("service", service);
    c.set("rbacConnectionId", connection.id);

    // Create minimal session
    const session: Session = {
        id: `ai_chat_${rbacUserId}_${Date.now()}`,
        connectionConfig: {
            url,
            username: connection.username,
            password: connection.password || "",
            database: connection.database || undefined,
        },
        createdAt: new Date(),
        lastUsedAt: new Date(),
        isAdmin: false,
        permissions: [],
        version: "unknown",
        rbacConnectionId: connection.id,
    };
    c.set("session", session);

    await next();
}

// Apply auth middleware
aiChat.use("*", chatAuthMiddleware);

// ============================================
// Status Endpoint
// ============================================

/**
 * GET /ai-chat/status
 * Check if AI chat is enabled and available
 */
aiChat.get("/status", (c) => {
    return c.json({
        success: true,
        data: {
            enabled: isAIEnabled(),
        },
    });
});

// ============================================
// Streaming Chat Endpoint
// ============================================

const StreamRequestSchema = z.object({
    threadId: z.string().min(1, "Thread ID is required"),
    message: z.string().min(1, "Message is required"),
    messages: z.array(z.any()).optional(), // Optional full message history from frontend
});

/**
 * POST /ai-chat/stream
 * Stream a chat response via SSE
 */
aiChat.post("/stream", zValidator("json", StreamRequestSchema), async (c) => {
    const { threadId, message, messages: frontendMessages } = c.req.valid("json");
    const rbacUserId = c.get("rbacUserId")!;
    const isRbacAdmin = c.get("isRbacAdmin") || false;
    const rbacPermissions = c.get("rbacPermissions") || [];
    const connectionId = c.get("rbacConnectionId");
    const service = c.get("service");
    const session = c.get("session");

    // Verify thread belongs to user
    const thread = await getThread(threadId, rbacUserId);
    if (!thread) {
        throw AppError.notFound("Thread not found or does not belong to you.");
    }

    // Save user message
    await addMessage(threadId, 'user', message);

    // Build messages array (limit to newest 50 to avoid token overflow)
    const MAX_MESSAGES = 50;
    let coreMessages: any[];

    if (frontendMessages && Array.isArray(frontendMessages) && frontendMessages.length > 0) {
        // Use frontend-provided message history (includes tool calls)
        coreMessages = frontendMessages.slice(-MAX_MESSAGES);
    } else {
        // Fall back to DB messages
        const dbMessages = await getMessages(threadId);
        coreMessages = dbMessages.slice(-MAX_MESSAGES).map(m => ({
            role: m.role,
            content: m.content,
        }));
    }

    // Build chat context
    const chatContext: ChatContext = {
        userId: rbacUserId,
        isAdmin: isRbacAdmin,
        permissions: rbacPermissions,
        connectionId,
        clickhouseService: service,
        defaultDatabase: session?.connectionConfig?.database,
    };

    try {
        const result = await streamChat(coreMessages, chatContext);

        // Set up SSE response
        c.header('Content-Type', 'text/event-stream');
        c.header('Cache-Control', 'no-cache');
        c.header('Connection', 'keep-alive');

        // Use fullStream for step-aware text suppression.
        // Text from tool-using steps is hallucinated filler — discard it.
        // Only text from the final step (finishReason='stop') is real.
        const stream = result.fullStream;

        const encoder = new TextEncoder();
        let fullResponse = '';

        // Step tracking state
        let currentStepBuffer = '';
        let currentStepHasToolCalls = false;
        let isFinalStep = false; // Once we know a step is final, stream in real-time
        const collectedToolCalls: Array<{ name: string; args: Record<string, unknown>; result?: unknown }> = [];

        const readable = new ReadableStream({
            async start(controller) {
                try {
                    for await (const part of stream) {
                        switch (part.type) {
                            case 'start-step':
                                // New step — reset buffer
                                currentStepBuffer = '';
                                currentStepHasToolCalls = false;
                                break;

                            case 'text-delta': {
                                const text = part.text;
                                if (isFinalStep) {
                                    // Final step confirmed — stream in real-time
                                    // Don't apply scratchpad stripping per-chunk
                                    // (it's designed for full buffers)
                                    fullResponse += text;
                                    const sseData = `data: ${JSON.stringify({ type: 'text-delta', text })}\n\n`;
                                    controller.enqueue(encoder.encode(sseData));
                                } else {
                                    // Not yet confirmed as final — buffer text
                                    currentStepBuffer += text;
                                }
                                break;
                            }

                            case 'tool-call': {
                                // This step uses tools — its text is hallucination
                                currentStepHasToolCalls = true;
                                // AI SDK v6 uses `input` for tool arguments (not `args`).
                                // Fall back through: input → args → {} for backwards compat.
                                const rawInput = (part as any).input ?? (part as any).args ?? {};
                                const parsedArgs: Record<string, unknown> = typeof rawInput === 'string'
                                    ? (() => { try { return JSON.parse(rawInput); } catch { return {}; } })()
                                    : (rawInput && typeof rawInput === 'object' ? rawInput : {});
                                // Collect tool call info for persistence
                                collectedToolCalls.push({
                                    name: (part as any).toolName,
                                    args: parsedArgs,
                                });
                                // Notify frontend: tool is being called, include args for display
                                controller.enqueue(encoder.encode(
                                    `data: ${JSON.stringify({
                                        type: 'tool-call',
                                        tool: (part as any).toolName,
                                        args: parsedArgs,
                                    })}\n\n`
                                ));
                                break;
                            }

                            case 'tool-result': {
                                // Match result back to the last tool call with the same name
                                const toolName = (part as any).toolName;
                                // AI SDK v6 uses 'output' for tool result, but fall back to 'result' or 'data'.
                                const resultData = (part as any).output ?? (part as any).result ?? (part as any).data;
                                const matchIdx = (() => {
                                    for (let i = collectedToolCalls.length - 1; i >= 0; i--) {
                                        if (collectedToolCalls[i].name === toolName && collectedToolCalls[i].result === undefined) return i;
                                    }
                                    return -1;
                                })();
                                if (matchIdx !== -1) {
                                    collectedToolCalls[matchIdx].result = resultData;
                                }

                                // Emit a dedicated chart-data event when render_chart succeeds
                                if (toolName === 'render_chart' && resultData && !(resultData as Record<string, unknown>).error) {
                                    // Handle BigInt serialization for ClickHouse results
                                    try {
                                        const json = JSON.stringify({ type: 'chart-data', chartSpec: resultData }, (_, v) =>
                                            typeof v === 'bigint' ? (v <= Number.MAX_SAFE_INTEGER ? Number(v) : v.toString()) : v
                                        );
                                        controller.enqueue(encoder.encode(`data: ${json}\n\n`));
                                    } catch (e) {
                                        console.error('[AI-CHAT] Failed to serialize chart-data:', e);
                                    }
                                }

                                // Send completion event with a lightweight result summary
                                let resultSummary: string | null = null;
                                if (Array.isArray(resultData)) {
                                    resultSummary = `${resultData.length} row${resultData.length !== 1 ? 's' : ''} returned`;
                                } else if (resultData && typeof resultData === 'object') {
                                    const keys = Object.keys(resultData);
                                    if (keys.length > 0) {
                                        const first = (resultData as any)[keys[0]];
                                        resultSummary = typeof first === 'string' || typeof first === 'number'
                                            ? String(first).substring(0, 60)
                                            : `${keys.length} field${keys.length !== 1 ? 's' : ''}`;
                                    }
                                } else if (typeof resultData === 'string') {
                                    resultSummary = resultData.substring(0, 60);
                                }
                                controller.enqueue(encoder.encode(
                                    `data: ${JSON.stringify({
                                        type: 'tool-complete',
                                        tool: toolName,
                                        summary: resultSummary,
                                    })}\n\n`
                                ));
                                break;
                            }

                            case 'finish-step': {
                                if (part.finishReason === 'stop' && !currentStepHasToolCalls) {
                                    // Final answer step — flush buffer with scratchpad stripping
                                    isFinalStep = true;
                                    const cleaned = stripScratchpad(currentStepBuffer);
                                    if (cleaned) {
                                        fullResponse += cleaned;
                                        const sseData = `data: ${JSON.stringify({ type: 'text-delta', text: cleaned })}\n\n`;
                                        controller.enqueue(encoder.encode(sseData));
                                    }
                                }
                                // Discard buffer for tool-using steps (hallucination)
                                currentStepBuffer = '';
                                break;
                            }

                            case 'error': {
                                const errorMsg = part.error instanceof Error ? part.error.message : String(part.error);
                                console.error('[AI Chat] Stream error:', errorMsg);
                                const sseError = `data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`;
                                controller.enqueue(encoder.encode(sseError));
                                break;
                            }

                            // Ignore reasoning-delta, tool-input-delta, tool-result, etc.
                            default:
                                break;
                        }
                    }

                    // Send done event
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
                    controller.close();

                    // Save assistant response to DB (best-effort)
                    if (fullResponse.trim()) {
                        const chartToolCalls = collectedToolCalls.filter(tc => tc.name === 'render_chart' && tc.result && !(tc.result as Record<string, unknown>).error);
                        const chartSpecs = chartToolCalls.length > 0
                            ? chartToolCalls.map(tc => tc.result as Record<string, unknown>)
                            : undefined;

                        await addMessage(
                            threadId,
                            'assistant',
                            fullResponse,
                            collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
                            chartSpecs

                        ).catch(err => {
                            console.error('[AI Chat] Failed to save assistant message:', err);
                        });

                        // Auto-generate title for new threads
                        if (!thread.title) {
                            const autoTitle = message.substring(0, 80) + (message.length > 80 ? '...' : '');
                            await updateThreadTitle(threadId, rbacUserId, autoTitle).catch(err => {
                                console.error('[AI Chat] Failed to auto-title thread:', err);
                            });
                        }
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    const sseError = `data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`;
                    controller.enqueue(encoder.encode(sseError));
                    controller.close();
                }
            },
        });

        return new Response(readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error) {
        if (error instanceof AppError) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        throw new AppError(msg, "AI_CHAT_ERROR", "unknown", 500);
    }
});

// ============================================
// Thread CRUD Endpoints
// ============================================

/**
 * GET /ai-chat/threads
 * List chat threads for the current user
 */
aiChat.get("/threads", async (c) => {
    const rbacUserId = c.get("rbacUserId")!;
    const connectionId = c.req.query("connectionId");

    const threads = await listThreads(rbacUserId, 7, 50, connectionId);

    // Trigger async cleanup of old threads
    cleanupOldThreads(7).catch(err => {
        console.error('[AI Chat] Cleanup failed:', err);
    });

    return c.json({
        success: true,
        data: threads,
    });
});

const CreateThreadSchema = z.object({
    title: z.string().optional(),
    connectionId: z.string().optional(),
});

/**
 * POST /ai-chat/threads
 * Create a new chat thread
 */
aiChat.post("/threads", zValidator("json", CreateThreadSchema), async (c) => {
    const rbacUserId = c.get("rbacUserId")!;
    const { title, connectionId } = c.req.valid("json");

    const connId = connectionId || c.get("rbacConnectionId");
    const thread = await createThread(rbacUserId, title, connId);

    return c.json({
        success: true,
        data: thread,
    }, 201);
});

/**
 * GET /ai-chat/threads/:id
 * Get a thread with its messages
 */
aiChat.get("/threads/:id", async (c) => {
    const rbacUserId = c.get("rbacUserId")!;
    const threadId = c.req.param("id");

    const thread = await getThread(threadId, rbacUserId);
    if (!thread) {
        throw AppError.notFound("Thread not found.");
    }

    const messages = await getMessages(threadId);

    return c.json({
        success: true,
        data: {
            ...thread,
            messages,
        },
    });
});

const UpdateThreadSchema = z.object({
    title: z.string().min(1, "Title is required"),
});

/**
 * PATCH /ai-chat/threads/:id
 * Update thread title
 */
aiChat.patch("/threads/:id", zValidator("json", UpdateThreadSchema), async (c) => {
    const rbacUserId = c.get("rbacUserId")!;
    const threadId = c.req.param("id");
    const { title } = c.req.valid("json");

    await updateThreadTitle(threadId, rbacUserId, title);

    return c.json({ success: true });
});

/**
 * DELETE /ai-chat/threads/:id
 * Delete a thread and all its messages
 */
aiChat.delete("/threads/:id", async (c) => {
    const rbacUserId = c.get("rbacUserId")!;
    const threadId = c.req.param("id");

    const deleted = await deleteThread(threadId, rbacUserId);
    if (!deleted) {
        throw AppError.notFound("Thread not found.");
    }

    return c.json({ success: true });
});

export default aiChat;
