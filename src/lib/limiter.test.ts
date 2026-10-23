import { describe, expect, it } from "vitest";

import { createLimiter } from "./limiter";

function deferred(): { promise: Promise<string>; resolve: (v: string) => void; reject: (e: Error) => void } {
  let resolve!: (v: string) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("createLimiter", () => {
  it("runs at most the given number of tasks at once, the rest in order as slots free up", async () => {
    const limit = createLimiter(2);
    const started: string[] = [];
    const tasks = ["a", "b", "c", "d"].map((name) => ({ name, d: deferred() }));
    const results = tasks.map(({ name, d }) => limit(() => {
      started.push(name);
      return d.promise;
    }));
    await tick();
    expect(started).toEqual(["a", "b"]);
    tasks[1].d.resolve("B");
    await tick();
    expect(started).toEqual(["a", "b", "c"]);
    const failed = expect(results[0]).rejects.toThrow("A failed");
    tasks[0].d.reject(new Error("A failed"));
    await tick();
    expect(started).toEqual(["a", "b", "c", "d"]);
    tasks[2].d.resolve("C");
    tasks[3].d.resolve("D");
    await failed;
    expect(await Promise.all(results.slice(1))).toEqual(["B", "C", "D"]);
  });

  it("never starts a waiting task whose signal aborts, and gives its turn to the next", async () => {
    const limit = createLimiter(1);
    const first = deferred();
    const started: string[] = [];
    const controller = new AbortController();
    void limit(() => first.promise);
    const skipped = limit(() => {
      started.push("skipped");
      return Promise.resolve("x");
    }, controller.signal);
    const next = limit(() => {
      started.push("next");
      return Promise.resolve("n");
    });
    controller.abort();
    await expect(skipped).rejects.toBeTruthy();
    first.resolve("1");
    expect(await next).toBe("n");
    expect(started).toEqual(["next"]);
  });

  it("rejects a task whose signal is already aborted without running it", async () => {
    const limit = createLimiter(1);
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    await expect(limit(() => {
      ran = true;
      return Promise.resolve(1);
    }, controller.signal)).rejects.toBeTruthy();
    expect(ran).toBe(false);
  });

  it("frees the slot of a task that throws before returning a promise", async () => {
    const limit = createLimiter(1);
    await expect(limit(() => {
      throw new Error("bad request body");
    })).rejects.toThrow("bad request body");
    expect(await limit(() => Promise.resolve("next"))).toBe("next");
  });

  it("needs a size of at least one", () => {
    expect(() => createLimiter(0)).toThrow();
  });
});
