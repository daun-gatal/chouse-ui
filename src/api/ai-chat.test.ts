/**
 * Tests for AI Chat API
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import {
    getChatAgents,
    getChatStatus,
    listThreads,
    createThread,
    getThread,
    deleteThread,
    updateThreadTitle,
    getAiModels,
    invokeChatMessage,
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

    describe('updateThreadTitle', () => {
        it('should update thread title', async () => {
            await updateThreadTitle('thread-1', 'Updated Title');
            // Mock returns success if it doesn't throw
        });
    });

    describe('getAiModels', () => {
        it('should fetch AI models', async () => {
            const models = await getAiModels();
            expect(models).toBeDefined();
            expect(models.length).toBeGreaterThanOrEqual(0);
            if (models.length > 0) {
                expect(models[0]).toHaveProperty('id');
                expect(models[0]).toHaveProperty('name');
                expect(models[0]).toHaveProperty('provider');
                expect(models[0]).toHaveProperty('isDefault');
            }
        });
    });

    describe('invokeChatMessage', () => {
        it('should return the complete response and activity in one payload', async () => {
            const result = await invokeChatMessage('thread-1', 'Hello', undefined, undefined);
            expect(result.content).toBe('Hello world');
            expect(result.toolCalls).toEqual([
                { name: 'list_databases', args: {}, result: ['default'] },
            ]);
            expect(result.chartSpecs).toEqual([]);
        });

        it('should send the chosen chat agent', async () => {
            const bodies: unknown[] = [];
            server.use(
                http.post('/api/ai-chat/invoke', async ({ request }) => {
                    bodies.push(await request.json());
                    return HttpResponse.json({ success: true, data: { content: 'ok', toolCalls: [], chartSpecs: [], agent: { id: 'a1', slug: 'chouse-admin', name: 'CHouse Admin' } } });
                }),
            );
            const result = await invokeChatMessage('thread-1', 'Who has admin?', undefined, undefined, undefined, 'a1');
            expect(result.agent?.slug).toBe('chouse-admin');
            await invokeChatMessage('thread-1', 'Hi', undefined, undefined, undefined, null);
            expect(bodies).toEqual([
                { threadId: 'thread-1', message: 'Who has admin?', agentId: 'a1' },
                { threadId: 'thread-1', message: 'Hi', agentId: null },
            ]);
        });
    });

    describe('chat agents', () => {
        it('lists the agents a user may pick and creates threads with one', async () => {
            const created: unknown[] = [];
            server.use(
                http.get('/api/ai-chat/agents', () => HttpResponse.json({ success: true, data: [{ id: 'r', slug: 'chouse-assistant', name: 'CHouse Assistant', description: 'd', kind: 'router', isDefault: false }] })),
                http.post('/api/ai-chat/threads', async ({ request }) => {
                    created.push(await request.json());
                    return HttpResponse.json({ success: true, data: { id: 't', agentId: 'r' } });
                }),
            );
            const agents = await getChatAgents();
            expect(agents.map((a) => a.slug)).toEqual(['chouse-assistant']);
            const thread = await createThread(undefined, 'conn-1', 'r');
            expect(thread.agentId).toBe('r');
            expect(created).toEqual([{ connectionId: 'conn-1', agentId: 'r' }]);
        });
    });
});
