/**
 * AI Chat Routes
 * 
 * Provides invoked chat with AI assistant and thread/message management.
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
import { invokeCapabilityAgent } from "../services/ai/engine";
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
// Invoked Chat Endpoint
// ============================================

export const InvokeMessageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
});

export const MAX_MESSAGE_LENGTH = 32_000;
export const MAX_MESSAGES_PAYLOAD = 50;

export const InvokeRequestSchema = z.object({
    threadId: z.string().min(1, "Thread ID is required"),
    message: z.string().min(1, "Message is required").max(MAX_MESSAGE_LENGTH, "Message too long"),
    messages: z.array(InvokeMessageSchema).max(MAX_MESSAGES_PAYLOAD).optional(),
    modelId: z.string().optional(),
});

/** Per-user rate limit for invoked chat (expensive LLM + tools). */
const invokeRateLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: (c: Context<{ Variables: Variables }>) => c.get("rbacUserId") ?? "unknown",
});

function jsonSafe(value: unknown): unknown {
    if (typeof value === "bigint") {
        return value <= Number.MAX_SAFE_INTEGER ? Number(value) : value.toString();
    }
    if (Array.isArray(value)) return value.map(jsonSafe);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [key, jsonSafe(nested)]),
        );
    }
    return value;
}

/** Unwrap LangChain tool-message content and JSON-serialized tool results. */
export function parseToolResult(value: unknown, depth = 0): unknown {
    if (depth > 3) return value;
    if (typeof value === "string") {
        try {
            return parseToolResult(JSON.parse(value), depth + 1);
        } catch {
            return value;
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;

    const record = value as Record<string, unknown>;
    if ("chartType" in record || "rows" in record || "error" in record) return record;
    if ("artifact" in record && record.artifact !== undefined) {
        return parseToolResult(record.artifact, depth + 1);
    }
    if (typeof record.content === "string") {
        return parseToolResult(record.content, depth + 1);
    }
    if (Array.isArray(record.content)) {
        const text = record.content
            .filter((part): part is { text: string } =>
                !!part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string")
            .map((part) => part.text)
            .join("");
        if (text) return parseToolResult(text, depth + 1);
    }
    return record;
}

/**
 * POST /ai-chat/invoke
 * Run the DeepAgent asynchronously and return one complete response.
 */
aiChat.post("/invoke", invokeRateLimiter, zValidator("json", InvokeRequestSchema), async (c) => {
    const { threadId, message, messages: frontendMessages, modelId } = c.req.valid("json");
    const rbacUserId = c.get("rbacUserId")!;
    const isRbacAdmin = c.get("isRbacAdmin") || false;
    const rbacPermissions = c.get("rbacPermissions") || [];
    const connectionId = c.get("rbacConnectionId");
    const service = c.get("service");
    const session = c.get("session");

    const thread = await getThread(threadId, rbacUserId);
    if (!thread) {
        throw AppError.notFound("Thread not found or does not belong to you.");
    }

    await addMessage(threadId, "user", message);

    type CoreMessage = { role: "user" | "assistant"; content: string };
    let coreMessages: CoreMessage[];
    if (frontendMessages && frontendMessages.length > 0) {
        coreMessages = frontendMessages.slice(-MAX_MESSAGES_PAYLOAD);
    } else {
        const dbMessages = await getMessages(threadId);
        coreMessages = dbMessages.slice(-MAX_MESSAGES_PAYLOAD).map((dbMessage) => ({
            role: dbMessage.role === "assistant" ? "assistant" : "user",
            content: dbMessage.content,
        }));
    }

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
        const result = await invokeCapabilityAgent(
            chatCapability,
            { threadId },
            runContext,
            coreMessages,
            c.req.raw.signal,
        );
        const content = stripScratchpad(result.content);
        if (!content.trim()) {
            throw AppError.internal("Chouse AI returned an empty response. Please try again.");
        }

        const toolCalls = result.toolCalls.map((call) => ({
            name: call.name,
            args: call.args,
            result: jsonSafe(parseToolResult(call.result)),
        }));
        const chartSpecs = toolCalls
            .filter((call) =>
                call.name === "render_chart" &&
                call.result &&
                typeof call.result === "object" &&
                !("error" in call.result),
            )
            .map((call) => call.result as Record<string, unknown>);

        await addMessage(
            threadId,
            "assistant",
            content,
            toolCalls.length > 0 ? toolCalls : undefined,
            chartSpecs.length > 0 ? chartSpecs : undefined,
        );

        if (!thread.title) {
            const autoTitle = message.substring(0, 80) + (message.length > 80 ? "..." : "");
            await updateThreadTitle(threadId, rbacUserId, autoTitle).catch((error) => {
                logger.error(
                    { module: "AI Chat", threadId, err: error instanceof Error ? error.message : String(error) },
                    "Failed to auto-title thread",
                );
            });
        }

        return c.json({
            success: true,
            data: {
                content,
                toolCalls,
                chartSpecs,
            },
        });
    } catch (error) {
        if (error instanceof AppError) throw error;
        const messageText = error instanceof Error ? error.message : String(error);
        throw new AppError(messageText, "AI_CHAT_ERROR", "unknown", 500);
    }
});

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
