/**
 * Durable chat runs (ADR 0024): streaming, re-attaching, stopping, the active
 * run of a thread and the /skill: list.
 */

import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/mocks/server';
import { ApiError } from './client';
import {
    cancelChatRun,
    followChatRun,
    getActiveChatRun,
    getChatRun,
    getChatSkills,
    resumeChatRun,
    streamChatRun,
    type ChatRunEvent,
} from './ai-chat';

const RUN = { id: 'r1', threadId: 't1', status: 'running', steps: [], pending: [], result: null, error: null, createdAt: 1 };

function sse(blocks: Array<[string, unknown]>): Response {
    const body = blocks.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

describe('streamChatRun', () => {
    it('posts the turn and reports every run event in order, skipping pings', async () => {
        let posted: unknown;
        server.use(http.post('/api/ai-chat/runs', async ({ request }) => {
            posted = await request.json();
            return sse([
                ['run', { type: 'run', run: RUN }],
                ['ping', {}],
                ['step', { type: 'step', step: { id: 's1', name: 'list_databases', args: {}, status: 'running', summary: null, startedAt: 1, endedAt: null } }],
                ['final', { type: 'final', result: { messageId: 'm1', content: 'done', toolCalls: [], chartSpecs: [], agent: { id: 'a', slug: 'a', name: 'A' } } }],
            ]);
        }));
        const events: ChatRunEvent[] = [];
        await streamChatRun({ threadId: 't1', message: 'hi', skills: ['tuning'], attachments: [{ name: 'a.csv', mimeType: 'text/csv', data: 'YQ==' }] }, (e) => events.push(e));
        expect(events.map((e) => e.type)).toEqual(['run', 'step', 'final']);
        expect(posted).toEqual({ threadId: 't1', message: 'hi', skills: ['tuning'], attachments: [{ name: 'a.csv', mimeType: 'text/csv', data: 'YQ==' }] });
    });

    it('throws the server error for a refused turn', async () => {
        server.use(http.post('/api/ai-chat/runs', () => HttpResponse.json(
            { success: false, error: { code: 'AI_BUDGET_EXHAUSTED', message: "The AI budget 'x' is used up for this day.", category: 'validation' } },
            { status: 429 },
        )));
        const error = await streamChatRun({ threadId: 't1', message: 'hi' }, () => undefined).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ statusCode: 429, code: 'AI_BUDGET_EXHAUSTED' });
    });

    it('ignores malformed and unknown events', async () => {
        server.use(http.post('/api/ai-chat/runs', () => new HttpResponse('event: step\ndata: {not json\n\nevent: other\ndata: {}\n\nevent: run\ndata: {"type":"nope"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })));
        const events: ChatRunEvent[] = [];
        await streamChatRun({ threadId: 't1', message: 'hi' }, (e) => events.push(e));
        expect(events).toEqual([]);
    });
});

describe('run follow-ups', () => {
    it('re-attaches to a run, reads it, stops it and finds a thread\'s active run', async () => {
        const calls: string[] = [];
        server.use(
            http.get('/api/ai-chat/runs/r1/events', () => {
                calls.push('events');
                return sse([['error', { type: 'error', message: 'Stopped.', code: 'CANCELLED', status: 'cancelled' }]]);
            }),
            http.get('/api/ai-chat/runs/r1', () => HttpResponse.json({ success: true, data: RUN })),
            http.post('/api/ai-chat/runs/r1/cancel', () => {
                calls.push('cancel');
                return HttpResponse.json({ success: true, data: { ...RUN, status: 'cancelled' } });
            }),
            http.get('/api/ai-chat/threads/t1/active-run', () => HttpResponse.json({ success: true, data: null })),
        );
        const events: ChatRunEvent[] = [];
        await followChatRun('r1', (e) => events.push(e));
        expect(events).toEqual([{ type: 'error', message: 'Stopped.', code: 'CANCELLED', status: 'cancelled' }]);
        expect((await getChatRun('r1')).status).toBe('running');
        expect((await cancelChatRun('r1')).status).toBe('cancelled');
        expect(await getActiveChatRun('t1')).toBeNull();
        expect(calls).toEqual(['events', 'cancel']);
    });

    it('lists the skills of the chosen agent', async () => {
        const seen: Array<string | null> = [];
        server.use(http.get('/api/ai-chat/skills', ({ request }) => {
            seen.push(new URL(request.url).searchParams.get('agentId'));
            return HttpResponse.json({ success: true, data: [{ name: 'tuning', description: 'Tune queries' }] });
        }));
        expect(await getChatSkills('agent-1')).toEqual([{ name: 'tuning', description: 'Tune queries' }]);
        await getChatSkills(null);
        expect(seen).toEqual(['agent-1', null]);
    });
});

describe('resumeChatRun', () => {
    it('posts the decisions (and model) and streams the rest of the run', async () => {
        let posted: unknown;
        server.use(http.post('/api/ai-chat/runs/r1/resume', async ({ request }) => {
            posted = await request.json();
            return sse([
                ['status', { type: 'status', status: 'running', pending: [] }],
                ['final', { type: 'final', result: { messageId: 'm2', content: 'Killed.', toolCalls: [], chartSpecs: [], agent: { id: 'a', slug: 'a', name: 'A' } } }],
            ]);
        }));
        const events: ChatRunEvent[] = [];
        await resumeChatRun('r1', [{ actionId: 'x1', type: 'edit', args: { queryId: 'q2' } }, { actionId: 'x2', type: 'reject', message: 'no' }], (e) => events.push(e), { modelId: 'm' });
        expect(posted).toEqual({ decisions: [{ actionId: 'x1', type: 'edit', args: { queryId: 'q2' } }, { actionId: 'x2', type: 'reject', message: 'no' }], modelId: 'm' });
        expect(events.map((e) => e.type)).toEqual(['status', 'final']);
    });

    it('throws when the approval expired', async () => {
        server.use(http.post('/api/ai-chat/runs/r1/resume', () => HttpResponse.json(
            { success: false, error: { code: 'APPROVAL_EXPIRED', message: 'This approval expired or was already answered.', category: 'validation' } },
            { status: 410 },
        )));
        const error = await resumeChatRun('r1', [{ actionId: 'x1', type: 'approve' }], () => undefined).catch((e: unknown) => e);
        expect(error).toMatchObject({ statusCode: 410, code: 'APPROVAL_EXPIRED' });
    });
});
