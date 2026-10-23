import { describe, expect, it } from 'vitest';

import { parseSseChunk, readSse } from './sse';

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body);
}

async function collect(response: Response, signal?: AbortSignal): Promise<Array<{ event: string; data: string }>> {
  const out: Array<{ event: string; data: string }> = [];
  for await (const event of readSse(response, signal)) out.push(event);
  return out;
}

describe('parseSseChunk', () => {
  it('splits complete blocks and keeps the unfinished rest', () => {
    const { events, rest } = parseSseChunk('event: step\ndata: {"a":1}\n\nevent: fin');
    expect(events).toEqual([{ event: 'step', data: '{"a":1}' }]);
    expect(rest).toBe('event: fin');
  });

  it('defaults the event name, joins data lines and skips comments and empty blocks', () => {
    const { events } = parseSseChunk(': keep-alive\n\ndata: line 1\ndata: line 2\n\nevent: ping\n\n');
    expect(events).toEqual([{ event: 'message', data: 'line 1\nline 2' }]);
  });

  it('handles CRLF line endings', () => {
    expect(parseSseChunk('event: a\r\ndata: x\r\n\r\n').events).toEqual([{ event: 'a', data: 'x' }]);
  });
});

describe('readSse', () => {
  it('reads events split across network chunks', async () => {
    const events = await collect(streamOf(['event: run\nda', 'ta: {"id":"r1"}\n', '\nevent: final\ndata: {}\n\n']));
    expect(events).toEqual([{ event: 'run', data: '{"id":"r1"}' }, { event: 'final', data: '{}' }]);
  });

  it('emits a last block without its trailing blank line', async () => {
    expect(await collect(streamOf(['event: final\ndata: {}']))).toEqual([{ event: 'final', data: '{}' }]);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await collect(streamOf(['event: a\ndata: 1\n\n']), controller.signal)).toEqual([]);
  });

  it('yields nothing for a response without a body', async () => {
    expect(await collect(new Response(null))).toEqual([]);
  });
});
