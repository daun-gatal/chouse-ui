/**
 * Chat History Service
 * 
 * CRUD operations for AI chat threads and messages.
 * Persists conversations to the RBAC database with 7-day retention.
 */

import { randomUUID } from 'crypto';
import { eq, and, desc, gte, lt, isNull } from 'drizzle-orm';
import { getDatabase, getSchema } from '../rbac/db';
import { logger } from '../utils/logger';

// Type helper to avoid TypeScript union type issues with RbacDb
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ============================================
// Types
// ============================================

export interface ChatThread {
    id: string;
    userId: string;
    title: string | null;
    connectionId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface ChatMessage {
    id: string;
    threadId: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: unknown }> | null;
    chartSpecs?: Array<Record<string, unknown>> | null;
    createdAt: Date;
}

// ============================================
// Thread Operations
// ============================================

/**
 * Create a new chat thread
 */
export async function createThread(
    userId: string,
    title?: string,
    connectionId?: string
): Promise<ChatThread> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    const id = randomUUID();
    const now = new Date();

    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    await db.insert(schema.aiChatThreads).values({
        id,
        userId,
        title: title || null,
        connectionId: connectionId || null,
        createdAt: now,
        updatedAt: now,
    });

    return {
        id,
        userId,
        title: title || null,
        connectionId: connectionId || null,
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * List threads for a user (last 7 days by default)
 */
export async function listThreads(
    userId: string,
    daysBack: number = 7,
    limit: number = 50,
    connectionId?: string | null
): Promise<ChatThread[]> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    const conditions = [
        eq(schema.aiChatThreads.userId, userId),
        gte(schema.aiChatThreads.updatedAt, cutoff)
    ];

    if (connectionId !== undefined) {
        if (connectionId === null) {
            conditions.push(isNull(schema.aiChatThreads.connectionId));
        } else {
            conditions.push(eq(schema.aiChatThreads.connectionId, connectionId));
        }
    }

    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    const threads = await db.select()
        .from(schema.aiChatThreads)
        .where(and(...conditions))
        .orderBy(desc(schema.aiChatThreads.updatedAt))
        .limit(limit);

    return threads.map((t: any) => ({
        id: t.id,
        userId: t.userId,
        title: t.title,
        connectionId: t.connectionId,
        createdAt: t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt),
        updatedAt: t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt),
    }));
}

/**
 * Get a thread by ID (validates ownership)
 */
export async function getThread(
    threadId: string,
    userId: string
): Promise<ChatThread | null> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    const results = await db.select()
        .from(schema.aiChatThreads)
        .where(and(
            eq(schema.aiChatThreads.id, threadId),
            eq(schema.aiChatThreads.userId, userId)
        ))
        .limit(1);

    if (results.length === 0) return null;

    const t = results[0];
    return {
        id: t.id,
        userId: t.userId,
        title: t.title,
        connectionId: t.connectionId,
        createdAt: t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt),
        updatedAt: t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt),
    };
}

/**
 * Update thread title
 */
export async function updateThreadTitle(
    threadId: string,
    userId: string,
    title: string
): Promise<void> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    await db.update(schema.aiChatThreads)
        .set({ title, updatedAt: new Date() })
        .where(and(
            eq(schema.aiChatThreads.id, threadId),
            eq(schema.aiChatThreads.userId, userId)
        ));
}

/**
 * Delete a thread (cascades to messages)
 */
export async function deleteThread(
    threadId: string,
    userId: string
): Promise<boolean> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    const result = await db.delete(schema.aiChatThreads)
        .where(and(
            eq(schema.aiChatThreads.id, threadId),
            eq(schema.aiChatThreads.userId, userId)
        ));

    return (result?.rowsAffected ?? result?.changes ?? 1) > 0;
}

// ============================================
// Message Operations
// ============================================

/**
 * Add a message to a thread
 */
export async function addMessage(
    threadId: string,
    role: 'user' | 'assistant',
    content: string,
    toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: unknown }>,
    chartSpecs?: Array<Record<string, unknown>>
): Promise<ChatMessage> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    const id = randomUUID();
    const now = new Date();

    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    await db.insert(schema.aiChatMessages).values({
        id,
        threadId,
        role,
        content,
        toolCalls: toolCalls || null,
        chartSpec: chartSpecs || null,
        createdAt: now,
    });

    // Update thread's updatedAt
    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    await db.update(schema.aiChatThreads)
        .set({ updatedAt: now })
        .where(eq(schema.aiChatThreads.id, threadId));

    return {
        id,
        threadId,
        role: role as 'user' | 'assistant',
        content,
        toolCalls: toolCalls || null,
        chartSpecs: chartSpecs || null,
        createdAt: now,
    };
}

/**
 * Get all messages for a thread (ordered by creation time)
 */
export async function getMessages(threadId: string): Promise<ChatMessage[]> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    const messages = await db.select()
        .from(schema.aiChatMessages)
        .where(eq(schema.aiChatMessages.threadId, threadId))
        .orderBy(schema.aiChatMessages.createdAt);

    return messages.map((m: any) => ({
        id: m.id,
        threadId: m.threadId,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        toolCalls: m.toolCalls,
        chartSpecs: m.chartSpec
            ? (Array.isArray(m.chartSpec) ? m.chartSpec : [m.chartSpec])
            : null,
        createdAt: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt),
    }));
}

// ============================================
// Cleanup
// ============================================

/**
 * Delete threads older than N days
 * Returns number of threads deleted
 */
export async function cleanupOldThreads(daysToKeep: number = 7): Promise<number> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    // Messages are cascade-deleted when threads are deleted
    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    const result = await db.delete(schema.aiChatThreads)
        .where(lt(schema.aiChatThreads.updatedAt, cutoff));

    const count = result?.rowsAffected ?? result?.changes ?? 0;
    if (count > 0) {
        logger.info({ module: "ChatHistory", count, daysToKeep }, "Cleaned up old threads");
    }
    return count;
}
