/**
 * Minimal server-sent events reader for fetch responses (EventSource cannot
 * send our auth headers or a POST body). Yields one event per blank-line
 * separated block; `data:` lines are joined with newlines, comments ignored.
 */

export interface SseEvent {
  event: string;
  data: string;
}

/** Parse complete SSE blocks out of `buffer`; returns the events and the unfinished rest. */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

/** Read every event of a streaming response until it ends or `signal` aborts. */
export async function* readSse(response: Response, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const abort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort);
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;
      for (const event of events) yield event;
    }
    const tail = parseSseChunk(`${buffer}\n\n`);
    for (const event of tail.events) yield event;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
