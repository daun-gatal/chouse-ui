/**
 * Tests for AI Chat API
 */

import { describe, it, expect } from 'vitest';
import {
    getChatStatus,
    listThreads,
    createThread,
    getThread,
    deleteThread,
} from './ai-chat';

describe('AI Chat API', () => {
    describe('getChatStatus', () => {
        it('should fetch chat status', async () => {
            const status = await getChatStatus();
            expect(status).toBeDefined();
            expect(status.enabled).toBe(true);
        });
    });

    describe('listThreads', () => {
        it('should fetch all chat threads', async () => {
            const threads = await listThreads();
            expect(threads).toBeDefined();
            expect(threads).toHaveLength(2);
            expect(threads[0].id).toBe('thread-1');
            expect(threads[1].id).toBe('thread-2');
        });

        it('should filter by connectionId', async () => {
            const threads = await listThreads('conn-1');
            expect(threads).toBeDefined();
            expect(threads).toHaveLength(1);
            expect(threads[0].connectionId).toBe('conn-1');
            expect(threads[0].id).toBe('thread-1');
        });

        it('should handle null/empty connectionId', async () => {
            const threads = await listThreads(null);
            expect(threads).toBeDefined();
            expect(threads).toHaveLength(2);
        });
    });

    describe('createThread', () => {
        it('should create a new thread', async () => {
            const thread = await createThread('New Chat', 'conn-1');
            expect(thread).toBeDefined();
            expect(thread.id).toBe('new-thread-id');
            expect(thread.title).toBe('New Chat');
            expect(thread.connectionId).toBe('conn-1');
        });

        it('should create thread without connectionId', async () => {
            const thread = await createThread();
            expect(thread).toBeDefined();
            expect(thread.connectionId).toBeNull();
        });
    });

    describe('getThread', () => {
        it('should fetch a specific thread with messages', async () => {
            const thread = await getThread('thread-1');
            expect(thread).toBeDefined();
            expect(thread.id).toBe('thread-1');
            expect(thread.messages).toBeDefined();
            expect(thread.messages).toHaveLength(2);
            expect(thread.messages[0].content).toBe('Hello');
        });
    });

    describe('deleteThread', () => {
        it('should delete a thread', async () => {
            await deleteThread('thread-1');
            // Mock returns success if it doesn't throw
        });
    });
});
