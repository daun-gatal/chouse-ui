/**
 * AI Chat Routes
 * 
 * Provides invoked chat with AI assistant and thread/message management.
 * All routes require RBAC authentication with `ai:chat` permission.
 */

import { Hono, type Context, type Next } from "hono";
import { streamSSE } from "hono/streaming";
import { rateLimiter } from "hono-rate-limiter";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { AppError } from "../types";
import { optionalRbacMiddleware } from "../middleware/dataAccess";
import {
  connectionContextMiddleware,
  type ConnectionContextVariables,
} from "../middleware/connectionContext";
import { createAuditLogWithContext, userHasPermission } from "../rbac/services/rbac";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { getConfiguration, isAIEnabled } from "../services/aiConfig";
import { checkBudgets } from "../services/ai/budgets";
import type { InputModality } from "../rbac/constants/aiModelParams";
import type { AgentContentPart, AgentMessage, AgentRunContext } from "../services/ai/types";
import { actionDefinition, parseEditedArgs } from "../services/ai/actions/definitions";
import { decideAction } from "../services/ai/actions/store";
import { mayAct } from "../services/ai/actions/tools";
import {
    activeRunForThread,
    cancelChatRun,
    expireStaleApprovals,
    resumeChatRun,
    getChatRun,
    pruneChatRuns,
    startChatRun,
    subscribeChatRun,
    type ChatRun,
    type ChatRunEvent,
    type StartChatRunInput,
} from "../services/ai/runtime/chatRuns";
import { getRegistrySnapshot } from "../services/ai/registry/cache";
import { chatAgentCandidates } from "../services/ai/registry/chatAgents";
import { extractTokenFromHeader } from "../rbac/services/jwt";
import {
    createThread,
    listThreads,
    getThread,
    updateThreadTitle,
    updateThreadAgent,
    deleteThread,
    addMessage,
    getMessages,
    cleanupOldThreads,
} from "../services/chatHistory";

export { parseToolResult } from "../services/ai/runtime/chatOutput";
import { logger, requestLogger } from "../utils/logger";

// ============================================
// Types
// ============================================

type Variables = ConnectionContextVariables;

const aiChat = new Hono<{ Variables: Variables }>();

// Helper to get cookie value

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

    // Connection resolution is shared and per-request (ADR 0010); the AI chat
    // permission gate above runs first.
    await connectionContextMiddleware(c, next);
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
            // What the composer may attach besides text (ADR 0024).
            inputModalities: cfg.model.params?.inputModalities ?? [],
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

/**
 * GET /ai-chat/agents
 * Chat agents the user may pick (ADR 0019): routers first, then top-level
 * agents. `isDefault` marks the agent bound to the chat feature.
 */
aiChat.get("/agents", async (c) => {
    const snapshot = await getRegistrySnapshot();
    const ctx = { isAdmin: c.get("isRbacAdmin") || false, permissions: c.get("rbacPermissions") || [] };
    const boundId = snapshot.bindings.get("chat")?.agentId;
    const agents = chatAgentCandidates(snapshot, ctx).map((agent) => ({
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
        description: agent.description,
        kind: agent.kind,
        isDefault: agent.id === boundId,
    }));
    return c.json({ success: true, data: agents });
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
export const MAX_ATTACHMENTS = 3;
/** Base64 of a 5 MB file. */
export const MAX_ATTACHMENT_BASE64 = 7_000_000;
/** Text attachments are inlined; longer files are cut with a note. */
export const MAX_TEXT_ATTACHMENT_CHARS = 200_000;

export const TEXT_ATTACHMENT_TYPES = ["text/csv", "text/plain", "text/markdown", "application/json", "application/sql", "text/x-sql", "text/tab-separated-values"] as const;
export const IMAGE_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export const AttachmentSchema = z.object({
    name: z.string().trim().min(1).max(200),
    mimeType: z.string().min(1).max(100),
    /** Base64 file content. */
    data: z.string().min(1).max(MAX_ATTACHMENT_BASE64, "Attachments can be at most 5 MB"),
});

export const InvokeRequestSchema = z.object({
    threadId: z.string().min(1, "Thread ID is required"),
    message: z.string().min(1, "Message is required").max(MAX_MESSAGE_LENGTH, "Message too long"),
    messages: z.array(InvokeMessageSchema).max(MAX_MESSAGES_PAYLOAD).optional(),
    modelId: z.string().optional(),
    /** Chat agent for this turn; null = the chat feature's bound agent. Saved on the thread. */
    agentId: z.string().min(1).nullable().optional(),
    /** Skills named with /skill: (ADR 0024): their instructions reach the model before it answers. */
    skills: z.array(z.string().min(1).max(64)).max(5).optional(),
    attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS, `At most ${MAX_ATTACHMENTS} attachments`).optional(),
});

type InvokeRequest = z.infer<typeof InvokeRequestSchema>;
type Attachment = z.infer<typeof AttachmentSchema>;

/** Per-user rate limit for invoked chat (expensive LLM + tools). */
const invokeRateLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: (c: Context<{ Variables: Variables }>) => c.get("rbacUserId") ?? "unknown",
});

function isTextAttachment(type: string): boolean {
    return (TEXT_ATTACHMENT_TYPES as readonly string[]).includes(type);
}

/** What kind of input an attachment is, or an error naming what is accepted. */
function attachmentKind(attachment: Attachment): "text" | "image" | "pdf" {
    if (isTextAttachment(attachment.mimeType)) return "text";
    if ((IMAGE_ATTACHMENT_TYPES as readonly string[]).includes(attachment.mimeType)) return "image";
    if (attachment.mimeType === "application/pdf") return "pdf";
    throw AppError.badRequest(`'${attachment.name}' is a ${attachment.mimeType} file. Attach images, PDFs, or CSV, JSON, SQL, Markdown or text files.`);
}

/** The user's new message: their text, then each attachment as a block the model reads. */
export function userContent(message: string, attachments: Attachment[], accepted: readonly InputModality[]): string | AgentContentPart[] {
    if (attachments.length === 0) return message;
    const parts: AgentContentPart[] = [{ type: "text", text: message }];
    for (const attachment of attachments) {
        const kind = attachmentKind(attachment);
        if (kind === "text") {
            let text = Buffer.from(attachment.data, "base64").toString("utf8");
            const cut = text.length > MAX_TEXT_ATTACHMENT_CHARS;
            if (cut) text = text.slice(0, MAX_TEXT_ATTACHMENT_CHARS);
            parts.push({ type: "text", text: `Attached file ${attachment.name}${cut ? ` (first ${MAX_TEXT_ATTACHMENT_CHARS.toLocaleString("en-US")} characters)` : ""}:\n\`\`\`\n${text}\n\`\`\`` });
            continue;
        }
        if (!accepted.includes(kind)) {
            throw AppError.badRequest(`The selected AI model does not accept ${kind === "image" ? "images" : "PDFs"}. Pick another model, or ask an admin to allow ${kind === "image" ? "images" : "PDFs"} for it in Admin › AI models.`);
        }
        parts.push(kind === "image"
            ? { type: "image", mimeType: attachment.mimeType, data: attachment.data }
            : { type: "file", mimeType: attachment.mimeType, data: attachment.data, filename: attachment.name });
    }
    return parts;
}

async function acceptedModalities(modelId: string | undefined, agentModelId: string | null): Promise<readonly InputModality[]> {
    const config = await getConfiguration(modelId ?? agentModelId ?? undefined);
    return config?.model.params?.inputModalities ?? [];
}

/** The run context of a request: who, which connection, and the token management tools act with. */
function runContextOf(c: Context<{ Variables: Variables }>, modelId?: string): AgentRunContext {
    return {
        userId: c.get("rbacUserId")!,
        isAdmin: c.get("isRbacAdmin") || false,
        permissions: c.get("rbacPermissions") || [],
        connectionId: c.get("rbacConnectionId"),
        clickhouseService: c.get("service"),
        defaultDatabase: c.get("session")?.connectionConfig?.database,
        modelId,
        // CHouse management tools call the API in-process as this user.
        bearerToken: extractTokenFromHeader(c.req.header("Authorization")) ?? undefined,
    };
}

interface PreparedTurn {
    input: StartChatRunInput;
}

/** Everything a turn needs, shared by /invoke and /runs. Saves the user's message to the thread. */
async function prepareTurn(c: Context<{ Variables: Variables }>, body: InvokeRequest): Promise<PreparedTurn> {
    const rbacUserId = c.get("rbacUserId")!;
    const session = c.get("session");
    const thread = await getThread(body.threadId, rbacUserId);
    if (!thread) throw AppError.notFound("Thread not found or does not belong to you.");

    // A thread keeps its agent; one whose agent was deleted since answers with the bound agent.
    const snapshot = await getRegistrySnapshot();
    let runAgentId = body.agentId === undefined ? thread.agentId : body.agentId;
    if (body.agentId === undefined && runAgentId && !snapshot.agents.has(runAgentId)) runAgentId = null;

    // A used-up budget turns the turn away before anything is saved (ADR 0024).
    await checkBudgets("chat", rbacUserId);

    const attachments = body.attachments ?? [];
    const agentModelId = (runAgentId ? snapshot.agents.get(runAgentId) : boundAgentOrNull(snapshot))?.modelConfigId ?? null;
    const accepted = attachments.some((a) => !isTextAttachment(a.mimeType)) ? await acceptedModalities(body.modelId, agentModelId) : [];
    const content = userContent(body.message, attachments, accepted);

    const names = attachments.map((a) => a.name);
    await addMessage(body.threadId, "user", names.length > 0 ? `${body.message}\n\n[attached: ${names.join(", ")}]` : body.message);
    // Title the thread now, so a reply still running is easy to find in the history.
    if (!thread.title) {
        const autoTitle = body.message.substring(0, 80) + (body.message.length > 80 ? "..." : "");
        await updateThreadTitle(body.threadId, rbacUserId, autoTitle).catch((error: unknown) => {
            logger.error({ module: "AI Chat", threadId: body.threadId, err: error instanceof Error ? error.message : String(error) }, "Failed to auto-title thread");
        });
    }

    let history: AgentMessage[];
    if (body.messages && body.messages.length > 0) {
        history = body.messages.slice(-MAX_MESSAGES_PAYLOAD);
    } else {
        const dbMessages = await getMessages(body.threadId);
        history = dbMessages.slice(-MAX_MESSAGES_PAYLOAD).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    }
    // The newest user message carries the attachments.
    const last = history[history.length - 1];
    if (last && last.role === "user" && last.content === body.message) history = [...history.slice(0, -1), { role: "user", content }];
    else history = [...history, { role: "user", content }];

    const ctx = runContextOf(c, body.modelId);
    return {
        input: {
            userId: rbacUserId,
            threadId: body.threadId,
            ctx,
            messages: history,
            agentId: body.agentId,
            runAgentId,
            // Only skills this agent reads can be pinned; unknown names are dropped.
            pinnedSkills: body.skills?.filter((name) => pinnableSkills(snapshot, runAgentId).some((s) => s.name === name)),
            attachments: attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, data: a.data })),
        },
    };
}

function boundAgentOrNull(snapshot: Awaited<ReturnType<typeof getRegistrySnapshot>>): { modelConfigId: string | null } | null {
    const binding = snapshot.bindings.get("chat");
    return binding ? snapshot.agents.get(binding.agentId) ?? null : null;
}

/**
 * POST /ai-chat/invoke
 * One complete response: a chat run (ADR 0024) the request waits for.
 */
aiChat.post("/invoke", invokeRateLimiter, zValidator("json", InvokeRequestSchema), async (c) => {
    const { input } = await prepareTurn(c, c.req.valid("json"));
    const { done } = await startChatRun(input);
    const finished = await done;
    if (finished.status === "completed" && finished.result) {
        const { content, toolCalls, chartSpecs, agent } = finished.result;
        return c.json({ success: true, data: { content, toolCalls, chartSpecs, agent, runId: finished.id } });
    }
    if (finished.status === "awaiting_approval") {
        return c.json({ success: true, data: { content: "", toolCalls: [], chartSpecs: [], runId: finished.id, pending: finished.pending } });
    }
    const failure = finished.failure ?? { code: "AI_CHAT_ERROR", status: 500 };
    throw new AppError(finished.error ?? "The chat run failed", failure.code, "unknown", failure.status);
});

/** Stream a run's events as server-sent events until it finishes or pauses. */
function streamRun(c: Context<{ Variables: Variables }>, runId: string, initial: ChatRun) {
    // Steps must reach the browser as they happen: ask nginx-style proxies not to buffer the stream.
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
        const send = (event: ChatRunEvent): Promise<void> => stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        const ends = (event: ChatRunEvent): boolean => event.type === "final" || event.type === "error" || (event.type === "status" && event.status === "awaiting_approval");
        let finished = false;
        let wake: (() => void) | null = null;
        const queue: ChatRunEvent[] = [];
        const subscription = subscribeChatRun(runId, (event) => {
            queue.push(event);
            wake?.();
        });
        stream.onAbort(() => {
            finished = true;
            wake?.();
        });
        try {
            if (subscription) {
                for (const event of subscription.replay) {
                    await send(event);
                    // A pause followed by "running" again was answered: only the latest outcome ends the stream.
                    if (ends(event)) finished = true;
                    else if (event.type === "status") finished = false;
                }
                while (!finished) {
                    if (queue.length === 0) await new Promise<void>((resolve) => { wake = resolve; setTimeout(resolve, 15_000); });
                    wake = null;
                    if (queue.length === 0 && !finished) {
                        await stream.writeSSE({ event: "ping", data: "{}" });
                        continue;
                    }
                    while (queue.length > 0) {
                        const event = queue.shift()!;
                        await send(event);
                        if (ends(event)) finished = true;
                    }
                }
                return;
            }
            // Another replica runs it: follow the stored row.
            await send({ type: "run", run: initial });
            let seen = initial.steps.length;
            let current = initial;
            while (!finished) {
                if (current.status === "completed" && current.result) { await send({ type: "final", result: current.result }); break; }
                if (current.status === "awaiting_approval") { await send({ type: "status", status: current.status, pending: current.pending }); break; }
                if (current.status === "failed" || current.status === "cancelled") {
                    await send({ type: "error", message: current.error ?? "The chat run failed", code: current.status === "cancelled" ? "CANCELLED" : "AI_CHAT_ERROR", status: current.status });
                    break;
                }
                await stream.sleep(1_000);
                const next = await getChatRun(runId);
                if (!next) break;
                for (const step of next.steps.slice(seen)) await send({ type: "step", step });
                // Finished steps change in place: resend the ones that were running.
                for (const step of next.steps.slice(0, seen)) {
                    const before = current.steps.find((s) => s.id === step.id);
                    if (before && before.status !== step.status) await send({ type: "step", step });
                }
                seen = next.steps.length;
                current = next;
            }
        } finally {
            subscription?.unsubscribe();
        }
    });
}

/**
 * POST /ai-chat/runs
 * Start a turn and stream it (ADR 0024). The run keeps going if the stream closes.
 */
aiChat.post("/runs", invokeRateLimiter, zValidator("json", InvokeRequestSchema), async (c) => {
    const { input } = await prepareTurn(c, c.req.valid("json"));
    const { run } = await startChatRun(input);
    return streamRun(c, run.id, run);
});

/** The skills a chat agent reads progressively — the ones /skill: can pin. */
export function pinnableSkills(snapshot: Awaited<ReturnType<typeof getRegistrySnapshot>>, agentId: string | null): Array<{ name: string; description: string }> {
    const agent = agentId ? snapshot.agents.get(agentId) : (() => {
        const binding = snapshot.bindings.get("chat");
        return binding ? snapshot.agents.get(binding.agentId) : undefined;
    })();
    if (!agent) return [];
    const out: Array<{ name: string; description: string }> = [];
    for (const link of agent.skills) {
        if (link.mode !== "progressive") continue;
        const skill = snapshot.skills.get(link.skillId);
        if (skill?.enabled && !out.some((s) => s.name === skill.name)) out.push({ name: skill.name, description: skill.description });
    }
    return out;
}

/** GET /ai-chat/skills?agentId= — skills the chat composer offers as /skill: commands for that agent (default: the bound one). */
aiChat.get("/skills", async (c) => {
    const snapshot = await getRegistrySnapshot();
    const ctx = { isAdmin: c.get("isRbacAdmin") || false, permissions: c.get("rbacPermissions") || [] };
    const requested = c.req.query("agentId") || null;
    if (requested && !chatAgentCandidates(snapshot, ctx).some((a) => a.id === requested)) throw AppError.notFound("Chat agent not found");
    return c.json({ success: true, data: pinnableSkills(snapshot, requested) });
});

export const DecisionSchema = z.object({
    actionId: z.string().min(1),
    type: z.enum(["approve", "edit", "reject"]),
    /** The edited arguments (edit only); validated like the tool's own input. */
    args: z.record(z.string(), z.unknown()).optional(),
    /** Why it was rejected, for the agent (reject only). */
    message: z.string().trim().max(1000).optional(),
});

export const ResumeRequestSchema = z.object({
    decisions: z.array(DecisionSchema).min(1).max(20),
    modelId: z.string().optional(),
});

/**
 * POST /ai-chat/runs/:id/resume — answer a paused run's approvals (ADR 0024
 * §Phase 2) and stream the rest of it. Every pending action needs a decision.
 * Approving or editing needs ai:act; anyone may reject their own run's action.
 */
aiChat.post("/runs/:id/resume", zValidator("json", ResumeRequestSchema), async (c) => {
    const body = c.req.valid("json");
    const userId = c.get("rbacUserId")!;
    const ctx = runContextOf(c, body.modelId);
    const paused = await getChatRun(c.req.param("id"));
    if (!paused || paused.userId !== userId) throw AppError.notFound("Chat run not found");
    if (paused.status !== "awaiting_approval") throw AppError.conflict("This reply is not waiting for an approval.");
    const byAction = new Map(body.decisions.map((d) => [d.actionId, d]));
    const missing = paused.pending.filter((p) => !byAction.has(p.actionId));
    if (missing.length > 0) throw AppError.badRequest(`Decide every pending action first: ${missing.map((p) => p.title).join(", ")}.`);
    if (body.decisions.some((d) => d.type !== "reject") && !mayAct(ctx)) {
        throw AppError.forbidden("You need the ai:act permission to approve AI actions. You can still reject them.");
    }

    // Validate every edit before recording any decision, so one bad edit leaves all of them open to retry.
    const answers = paused.pending.map((pending) => {
        const decision = byAction.get(pending.actionId);
        if (!decision) throw AppError.badRequest("Decide every pending action first.");
        const definition = actionDefinition(pending.name);
        let args: Record<string, unknown> | undefined;
        if (decision.type === "edit") {
            if (!definition) throw AppError.badRequest(`'${pending.name}' cannot be edited.`);
            const parsed = parseEditedArgs(definition, decision.args);
            if (!parsed.ok) throw AppError.badRequest(parsed.message);
            args = parsed.args;
        }
        return { pending, decision, definition, args };
    });

    const resume: Record<string, unknown> = {};
    for (const { pending, decision, definition, args } of answers) {
        const decided = await decideAction(pending.actionId, decision.type === "reject" ? "rejected" : "approved", userId, args);
        if (!decided) {
            await expireStaleApprovals();
            throw new AppError("This approval expired or was already answered. Ask the assistant again.", "APPROVAL_EXPIRED", "validation", 410);
        }
        await createAuditLogWithContext(c, decision.type === "reject" ? AUDIT_ACTIONS.AI_ACTION_REJECT : AUDIT_ACTIONS.AI_ACTION_APPROVE, userId, {
            resourceType: "ai_action",
            resourceId: decided.id,
            details: { origin: "ai", tool: decided.tool, description: definition && args ? definition.describe(args) : decided.description, edited: decision.type === "edit", runId: paused.id },
        });
        resume[pending.id] = decision.type === "approve"
            ? { type: "approve" }
            : decision.type === "edit"
                ? { type: "edit", edited_action: { name: pending.name, args } }
                : { type: "reject", message: decision.message || "The user rejected this action. Don't retry it unless they ask." };
    }
    const { run } = await resumeChatRun(paused.id, userId, ctx, resume, async (stored) => ({
        userId,
        threadId: stored.threadId,
        ctx,
        messages: [],
        agentId: undefined,
        runAgentId: stored.agentId,
    }));
    return streamRun(c, run.id, run);
});

/** GET /ai-chat/runs/:id — a run's stored state (steps, pending approvals, answer). */
aiChat.get("/runs/:id", async (c) => {
    const found = await getChatRun(c.req.param("id"));
    if (!found || found.userId !== c.get("rbacUserId")) throw AppError.notFound("Chat run not found");
    return c.json({ success: true, data: found });
});

/** GET /ai-chat/runs/:id/events — re-attach to a run (after a refresh) and stream the rest of it. */
aiChat.get("/runs/:id/events", async (c) => {
    const found = await getChatRun(c.req.param("id"));
    if (!found || found.userId !== c.get("rbacUserId")) throw AppError.notFound("Chat run not found");
    return streamRun(c, found.id, found);
});

/** POST /ai-chat/runs/:id/cancel — stop a run. */
aiChat.post("/runs/:id/cancel", async (c) => {
    const stopped = await cancelChatRun(c.req.param("id"), c.get("rbacUserId")!);
    return c.json({ success: true, data: stopped });
});

/** GET /ai-chat/threads/:id/active-run — the thread's run that is still going or waiting, if any. */
aiChat.get("/threads/:id/active-run", async (c) => {
    const thread = await getThread(c.req.param("id"), c.get("rbacUserId")!);
    if (!thread) throw AppError.notFound("Thread not found or does not belong to you.");
    return c.json({ success: true, data: await activeRunForThread(thread.id) });
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

    // Trigger async cleanup of old threads, then of their runs and checkpoints (ADR 0024)
    cleanupOldThreads(7).then(() => pruneChatRuns()).catch(err => {
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
    agentId: z.string().min(1).nullable().optional(),
});

/**
 * POST /ai-chat/threads
 * Create a new chat thread
 */
aiChat.post("/threads", zValidator("json", CreateThreadSchema), async (c) => {
    const rbacUserId = c.get("rbacUserId")!;
    const { title, connectionId, agentId } = c.req.valid("json");

    if (agentId) {
        const snapshot = await getRegistrySnapshot();
        const ctx = { isAdmin: c.get("isRbacAdmin") || false, permissions: c.get("rbacPermissions") || [] };
        if (!chatAgentCandidates(snapshot, ctx).some((agent) => agent.id === agentId)) {
            throw AppError.badRequest("That chat agent is not available to you. Pick another agent.");
        }
    }
    const connId = connectionId || c.get("rbacConnectionId");
    const thread = await createThread(rbacUserId, title, connId, agentId ?? null);

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

    const active = await activeRunForThread(threadId);
    if (active) await cancelChatRun(active.id, rbacUserId);
    const deleted = await deleteThread(threadId, rbacUserId);
    if (!deleted) {
        throw AppError.notFound("Thread not found.");
    }
    await pruneChatRuns();

    return c.json({ success: true });
});

export default aiChat;
