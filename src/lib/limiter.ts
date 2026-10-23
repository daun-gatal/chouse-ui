/**
 * Run at most `size` tasks at once; the rest wait their turn in order. A task
 * whose signal aborts while it waits never starts and rejects with the
 * signal's reason, so a caller that went away does not hold a slot.
 */
export type Limiter = <T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

export function createLimiter(size: number): Limiter {
  if (!Number.isInteger(size) || size < 1) throw new Error("A limiter runs at least one task at a time");
  let running = 0;
  const waiting: Array<() => void> = [];

  const release = (): void => {
    running -= 1;
    waiting.shift()?.();
  };

  return <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const aborted = (): void => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      function start(): void {
        signal?.removeEventListener("abort", aborted);
        running += 1;
        // Through a promise, so a task that throws before returning one still frees its slot.
        Promise.resolve().then(task).then(resolve, reject).finally(release);
      }
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      if (running < size) {
        start();
        return;
      }
      signal?.addEventListener("abort", aborted, { once: true });
      waiting.push(start);
    });
}
