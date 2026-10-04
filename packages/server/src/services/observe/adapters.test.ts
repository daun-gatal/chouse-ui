import { describe, expect, it } from "bun:test";

import { viewProgress } from "./adapters";

describe("viewProgress", () => {
  it("counts a run that wrote rows as progress", () => {
    expect(viewProgress([{ ok: 3, wrote: 1, failed: 2 }])).toBe(true);
  });

  it("accepts successful runs that wrote nothing when nothing failed", () => {
    expect(viewProgress([{ ok: 5, wrote: 0, failed: 0 }])).toBe(true);
  });

  it("does not mistake a queue's empty polls for progress while batches fail", () => {
    expect(viewProgress([{ ok: 4461, wrote: 0, failed: 1 }])).toBe(false);
  });

  it("is false without any successful run", () => {
    expect(viewProgress([{ ok: 0, wrote: 0, failed: 0 }])).toBe(false);
    expect(viewProgress([])).toBe(false);
  });
});
