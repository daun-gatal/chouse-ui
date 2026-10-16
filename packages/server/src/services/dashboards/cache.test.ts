import { describe, expect, it } from "bun:test";

import { cacheKey, KeyedSemaphore, ResultCache } from "./cache";

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe("cacheKey", () => {
  it("is stable across parameter order and changes with any input", () => {
    expect(cacheKey("c", "SELECT 1", { a: 1, b: "x" })).toBe(cacheKey("c", "SELECT 1", { b: "x", a: 1 }));
    expect(cacheKey("c", "SELECT 1", { a: 1 })).not.toBe(cacheKey("c2", "SELECT 1", { a: 1 }));
    expect(cacheKey("c", "SELECT 1", { a: 1 })).not.toBe(cacheKey("c", "SELECT 2", { a: 1 }));
    expect(cacheKey("c", "SELECT 1", { a: 1 })).not.toBe(cacheKey("c", "SELECT 1", { a: 2 }));
  });
});

describe("ResultCache", () => {
  it("runs once per TTL and reports cached hits", async () => {
    const t = clock();
    const cache = new ResultCache<number>(1_000, 10, 1_000, t.now);
    let runs = 0;
    const run = async (): Promise<{ value: number; bytes: number }> => ({ value: ++runs, bytes: 1 });
    expect(await cache.getOrRun("k", run)).toEqual({ value: 1, cached: false });
    expect(await cache.getOrRun("k", run)).toEqual({ value: 1, cached: true });
    t.advance(1_000);
    expect(await cache.getOrRun("k", run)).toEqual({ value: 2, cached: false });
  });

  it("shares one in-flight run between concurrent callers", async () => {
    const cache = new ResultCache<string>();
    let runs = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = async (): Promise<{ value: string; bytes: number }> => {
      runs += 1;
      await gate;
      return { value: "rows", bytes: 4 };
    };
    const first = cache.getOrRun("k", run);
    const second = cache.getOrRun("k", run);
    release();
    expect(await first).toEqual({ value: "rows", cached: false });
    expect(await second).toEqual({ value: "rows", cached: true });
    expect(runs).toBe(1);
  });

  it("does not cache a failure, and shares it with concurrent callers", async () => {
    const cache = new ResultCache<string>();
    let runs = 0;
    const failing = async (): Promise<{ value: string; bytes: number }> => {
      runs += 1;
      throw new Error("boom");
    };
    const [a, b] = await Promise.allSettled([cache.getOrRun("k", failing), cache.getOrRun("k", failing)]);
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("rejected");
    expect(runs).toBe(1);
    expect(cache.size).toBe(0);
    expect(await cache.getOrRun("k", async () => ({ value: "ok", bytes: 2 }))).toEqual({ value: "ok", cached: false });
  });

  it("evicts the least recently used entry past the entry limit", async () => {
    const cache = new ResultCache<string>(60_000, 2, 1_000);
    const value = (v: string) => async (): Promise<{ value: string; bytes: number }> => ({ value: v, bytes: 1 });
    await cache.getOrRun("a", value("a"));
    await cache.getOrRun("b", value("b"));
    await cache.getOrRun("a", value("a2"));
    await cache.getOrRun("c", value("c"));
    expect(cache.size).toBe(2);
    expect(await cache.getOrRun("a", value("a3"))).toEqual({ value: "a", cached: true });
    expect(await cache.getOrRun("b", value("b2"))).toEqual({ value: "b2", cached: false });
  });

  it("keeps the byte budget and never stores a value larger than it", async () => {
    const cache = new ResultCache<string>(60_000, 100, 10);
    await cache.getOrRun("a", async () => ({ value: "a", bytes: 6 }));
    await cache.getOrRun("b", async () => ({ value: "b", bytes: 6 }));
    expect(cache.size).toBe(1);
    expect(cache.totalBytes).toBe(6);
    expect(await cache.getOrRun("huge", async () => ({ value: "h", bytes: 11 }))).toEqual({ value: "h", cached: false });
    expect(cache.size).toBe(1);
    expect(await cache.getOrRun("huge", async () => ({ value: "h2", bytes: 11 }))).toEqual({ value: "h2", cached: false });
  });
});

describe("KeyedSemaphore", () => {
  it("limits concurrency per key and runs waiters in order", async () => {
    const semaphore = new KeyedSemaphore(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const task = (n: number) => async (): Promise<number> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(n);
      active -= 1;
      return n;
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => semaphore.run("conn", task(n))));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    expect(order.slice(2)).toEqual([3, 4, 5]);
  });

  it("does not limit different keys together, and releases on failure", async () => {
    const semaphore = new KeyedSemaphore(1);
    await expect(semaphore.run("a", async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await Promise.all([semaphore.run("a", async () => 1), semaphore.run("b", async () => 2)])).toEqual([1, 2]);
  });
});
