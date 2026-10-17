/**
 * Shared panel-result cache (ADR 0021 §4): in memory per pod, keyed by the
 * rendered query, with a short TTL, single-flight (concurrent identical runs
 * share one execution) and LRU eviction within an entry and byte budget, plus
 * a per-connection limit on concurrent panel queries.
 *
 * It is only consulted after the caller's access checks passed for this exact
 * query, so sharing a result between viewers never shows anyone data they may
 * not read. A failed run is not cached.
 */

import { createHash } from "crypto";

export const CACHE_TTL_MS = 30_000;
export const CACHE_MAX_ENTRIES = 500;
export const CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const MAX_CONCURRENT_PER_CONNECTION = 4;

export function cacheKey(connectionId: string, sql: string, params: Record<string, string | number>): string {
  const sorted = Object.keys(params).sort().map((k) => [k, params[k]]);
  return createHash("sha256").update(JSON.stringify([connectionId, sql, sorted])).digest("hex");
}

interface Entry<T> {
  value: T;
  bytes: number;
  expiresAt: number;
}

export interface Cached<T> {
  value: T;
  /** True when the value came from an earlier run, not this call. */
  cached: boolean;
}

export class ResultCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Promise<{ value: T; bytes: number }>>();
  private bytes = 0;

  constructor(
    private readonly ttlMs: number = CACHE_TTL_MS,
    private readonly maxEntries: number = CACHE_MAX_ENTRIES,
    private readonly maxBytes: number = CACHE_MAX_BYTES,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The cached value for `key`, or the result of `run` — shared with any
   * concurrent caller for the same key. `run` reports the value's size.
   */
  async getOrRun(key: string, run: () => Promise<{ value: T; bytes: number }>): Promise<Cached<T>> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) {
      // Re-insert to mark it most recently used.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return { value: hit.value, cached: true };
    }
    if (hit) this.remove(key);
    const pending = this.inflight.get(key);
    if (pending) return { value: (await pending).value, cached: true };
    const promise = run();
    this.inflight.set(key, promise);
    try {
      const result = await promise;
      this.store(key, result.value, result.bytes);
      return { value: result.value, cached: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  private store(key: string, value: T, bytes: number): void {
    // A single result larger than the whole budget is returned but never kept.
    if (bytes > this.maxBytes) return;
    this.remove(key);
    this.entries.set(key, { value, bytes, expiresAt: this.now() + this.ttlMs });
    this.bytes += bytes;
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries && this.bytes <= this.maxBytes) break;
      this.remove(oldest);
    }
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }
}

/** At most `limit` concurrent tasks per key; the rest wait in order. */
export class KeyedSemaphore {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(private readonly limit: number = MAX_CONCURRENT_PER_CONNECTION) {}

  async run<R>(key: string, task: () => Promise<R>): Promise<R> {
    await this.acquire(key);
    try {
      return await task();
    } finally {
      this.release(key);
    }
  }

  private acquire(key: string): Promise<void> {
    const count = this.active.get(key) ?? 0;
    if (count < this.limit) {
      this.active.set(key, count + 1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const queue = this.waiting.get(key) ?? [];
      queue.push(() => {
        this.active.set(key, (this.active.get(key) ?? 0) + 1);
        resolve();
      });
      this.waiting.set(key, queue);
    });
  }

  private release(key: string): void {
    this.active.set(key, (this.active.get(key) ?? 1) - 1);
    const queue = this.waiting.get(key);
    const next = queue?.shift();
    if (queue && queue.length === 0) this.waiting.delete(key);
    if (next) next();
    else if ((this.active.get(key) ?? 0) <= 0) this.active.delete(key);
  }
}
