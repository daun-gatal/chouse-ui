/**
 * AI Chat Routes
 * 
 * Provides streaming chat with AI assistant and thread/message management.
 * All routes require RBAC authentication with `ai:chat` permission.
 */

import { Hono, type Context, type Next } from "hono";
import { rateLimiter } from "hono-rate-limiter";
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
import { streamCapabilityAgent } from "../services/ai/engine";
import { chatCapability } from "../services/ai/capabilities/chat";
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
import { logger, requestLogger } from "../utils/logger";

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
aiChat.get("/status", async (c) => {
    return c.json({
        success: true,
        data: {
            enabled: await isAIEnabled(),
        },
    });
});

/**
 * GET /ai-chat/models
 * Get a list of enabled AI models for the frontend dropdown
 */
aiChat.get("/models", async (c) => {
    try {
        const { listAiConfigs } = await import("../rbac/services/aiModels");
        const initResult = await listAiConfigs({ activeOnly: true, limit: 100 });

        const models = initResult.configs.map((cfg) => ({
            id: cfg.id,
            name: cfg.name,
            provider: cfg.provider.name,
            isDefault: cfg.isDefault,
        }));

        return c.json({
            success: true,
            data: models,
        });
    } catch (e) {
        requestLogger(c.get("requestId")).error(
            { module: "AI Chat", err: e instanceof Error ? e.message : String(e) },
            "Failed to load AI models"
        );
        return c.json({
            success: false,
            error: {
                message: "Failed to load AI models",
            }
        }, 500);
    }
});

// ============================================
// Streaming Chat Endpoint
// ============================================

export const StreamMessageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
});

export const MAX_MESSAGE_LENGTH = 32_000;
export const MAX_MESSAGES_PAYLOAD = 50;

export const StreamRequestSchema = z.object({
    threadId: z.string().min(1, "Thread ID is required"),
    message: z.string().min(1, "Message is required").max(MAX_MESSAGE_LENGTH, "Message too long"),
    messages: z.array(StreamMessageSchema).max(MAX_MESSAGES_PAYLOAD).optional(),
    modelId: z.string().optional(),
});

/** Per-user rate limit for stream (expensive LLM + tools) */
const streamRateLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: (c: Context<{ Variables: Variables }>) => c.get("rbacUserId") ?? "unknown",
});

/**
 * POST /ai-chat/stream
 * Stream a chat response via SSE
 */
aiChat.post("/stream", streamRateLimiter, zValidator("json", StreamRequestSchema), async (c) => {
    const { threadId, message, messages: frontendMessages, modelId } = c.req.valid("json");
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
    type CoreMessage = { role: "user" | "assistant"; content: string };
    let coreMessages: CoreMessage[];

    if (frontendMessages && Array.isArray(frontendMessages) && frontendMessages.length > 0) {
        // Use frontend-provided message history (validated by schema)
        coreMessages = frontendMessages.slice(-MAX_MESSAGES_PAYLOAD).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        }));
    } else {
        // Fall back to DB messages
        const dbMessages = await getMessages(threadId);
        coreMessages = dbMessages.slice(-MAX_MESSAGES_PAYLOAD).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        }));
    }

    // Build the agent run context for the chat capability.
    const runContext = {
        userId: rbacUserId,
        isAdmin: isRbacAdmin,
        permissions: rbacPermissions,
        connectionId,
        clickhouseService: service,
        defaultDatabase: session?.connectionConfig?.database,
        modelId,
    };

    try {
        const result = await streamCapabilityAgent(
            chatCapability,
            { threadId },
            runContext,
            coreMessages,
        );

        // Set up SSE response
        c.header('Content-Type', 'text/event-stream');
        c.header('Cache-Control', 'no-cache');
        c.header('Connection', 'keep-alive');

        const encoder = new TextEncoder();
        let fullResponse = '';
        const collectedToolCalls: Array<{ name: string; args: Record<string, unknown>; result?: unknown }> = [];
        let activitySeq = 0;

        const readable = new ReadableStream({
            async start(controller) {
                const send = (payload: Record<string, unknown>) => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload, (_, v) =>
                        typeof v === 'bigint' ? (v <= Number.MAX_SAFE_INTEGER ? Number(v) : v.toString()) : v
                    )}\n\n`));
                };

                const resultSummary = (resultData: unknown): string | null => {
                    if (Array.isArray(resultData)) {
                        return `${resultData.length} row${resultData.length !== 1 ? 's' : ''} returned`;
                    }
                    if (resultData && typeof resultData === 'object') {
                        const keys = Object.keys(resultData);
                        if (keys.length > 0) {
                            const first = (resultData as Record<string, unknown>)[keys[0]];
                            return typeof first === 'string' || typeof first === 'number'
                                ? String(first).substring(0, 60)
                                : `${keys.length} field${keys.length !== 1 ? 's' : ''}`;
                        }
                    }
                    if (typeof resultData === 'string') return resultData.substring(0, 60);
                    return null;
                };

                const nextActivityId = () => `activity_${++activitySeq}`;

                const activityFor = (toolName: string, args: Record<string, unknown> = {}) => {
                    const has = (key: string) => typeof args[key] === 'string' && String(args[key]).trim().length > 0;
                    const firstString = (...keys: string[]) => keys.find(has);
                    const subjectKey = firstString('database', 'table', 'tableName', 'queryId', 'nodeId', 'name');
                    const subject = subjectKey ? String(args[subjectKey]).slice(0, 80) : undefined;

                    const map: Record<string, { label: string; category: string; description?: string }> = {
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
                        write_todos: { label: 'Planning work', category: 'Planning' },
                        task: { label: 'Delegating deeper investigation', category: 'Analysis' },
                    };

                    const mapped = map[toolName] ?? {
                        label: toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
                        category: 'Activity',
                    };

                    return {
                        ...mapped,
                        description: mapped.description ?? (subject ? subject : undefined),
                    };
                };

                try {
                    const messageTask = (async () => {
                        for await (const msg of result.run.messages) {
                            for await (const token of msg.text) {
                                if (!token) continue;
                                fullResponse += token;
                                send({ type: 'text-delta', text: token });
                            }
                        }
                    })();

                    const toolTask = (async () => {
                        for await (const call of result.run.toolCalls) {
                            const toolName = String(call.name);
                            const rawInput = call.input ?? {};
                            const parsedArgs: Record<string, unknown> =
                                rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
                                    ? rawInput as Record<string, unknown>
                                    : {};
                            const persisted = { name: toolName, args: parsedArgs, result: undefined as unknown };
                            collectedToolCalls.push(persisted);
                            const id = nextActivityId();
                            send({
                                type: 'tool-call',
                                id,
                                tool: toolName,
                                args: parsedArgs,
                                ...activityFor(toolName, parsedArgs),
                            });

                            const status = await call.status;
                            const output = status === 'finished' ? await call.output : await call.error;
                            persisted.result = output;

                            if (toolName === 'render_chart' && output && !(output as Record<string, unknown>).error) {
                                send({ type: 'chart-data', chartSpec: output });
                            }

                            send({
                                type: 'tool-complete',
                                id,
                                tool: toolName,
                                summary: resultSummary(output),
                            });
                        }
                    })();

                    const subagentTask = (async () => {
                        for await (const subagent of result.run.subagents) {
                            const subagentName = String((subagent as { name?: unknown }).name ?? 'subagent');
                            const id = nextActivityId();
                            const label = subagentName
                                .replace(/-/g, ' ')
                                .replace(/\b\w/g, (c) => c.toUpperCase());

                            send({
                                type: 'tool-call',
                                id,
                                tool: 'task',
                                args: { subagent: subagentName },
                                label,
                                category: 'Deep analysis',
                                description: 'Running a focused specialist pass',
                            });

                            const nestedTools = (async () => {
                                for await (const call of subagent.toolCalls) {
                                    const toolName = String(call.name);
                                    const rawInput = call.input ?? {};
                                    const parsedArgs: Record<string, unknown> =
                                        rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
                                            ? rawInput as Record<string, unknown>
                                            : {};
                                    const childId = nextActivityId();
                                    send({
                                        type: 'tool-call',
                                        id: childId,
                                        parentId: id,
                                        tool: toolName,
                                        args: parsedArgs,
                                        ...activityFor(toolName, parsedArgs),
                                    });

                                    const status = await call.status;
                                    const output = status === 'finished' ? await call.output : await call.error;
                                    send({
                                        type: 'tool-complete',
                                        id: childId,
                                        parentId: id,
                                        tool: toolName,
                                        summary: resultSummary(output),
                                    });
                                }
                            })();

                            await subagent.output;
                            await nestedTools.catch(() => undefined);
                            send({
                                type: 'tool-complete',
                                id,
                                tool: 'task',
                                summary: 'Specialist pass complete',
                            });
                        }
                    })();

                    await result.run.output;
                    await Promise.allSettled([messageTask, toolTask, subagentTask]);

                    // Send done event
                    fullResponse = stripScratchpad(fullResponse);
                    send({ type: 'done' });
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
                            logger.error(
                                { module: "AI Chat", threadId, err: err instanceof Error ? err.message : String(err) },
                                "Failed to save assistant message"
                            );
                        });

                        // Auto-generate title for new threads
                        if (!thread.title) {
                            const autoTitle = message.substring(0, 80) + (message.length > 80 ? '...' : '');
                            await updateThreadTitle(threadId, rbacUserId, autoTitle).catch(err => {
                                logger.error(
                                    { module: "AI Chat", threadId, err: err instanceof Error ? err.message : String(err) },
                                    "Failed to auto-title thread"
                                );
                            });
                        }
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    const sseError = `data: ${JSON.stringify({ type: 'error', error: errorMsg, retryable: true })}\n\n`;
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
        logger.error(
            { module: "AI Chat", err: err instanceof Error ? err.message : String(err) },
            "Cleanup failed"
        );
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
