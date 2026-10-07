import { describe, expect, it } from "bun:test";

import { staleIds } from "./orphans";

describe("staleIds", () => {
  const live = new Set(["table:db.kept", "job:j1"]);
  const isLive = (id: string): boolean => live.has(id);

  it("keeps live ids and ids outside the prefix", () => {
    expect(staleIds(["table:db.kept", "job:gone", "client:x"], "table:", isLive)).toEqual([]);
  });

  it("returns each dropped id once, even when several edges name it", () => {
    expect(staleIds(["table:db.dropped", "table:db.kept", "table:db.dropped"], "table:", isLive)).toEqual(["table:db.dropped"]);
  });

  it("flags deleted jobs under the job prefix", () => {
    expect(staleIds(["job:j1", "job:j2"], "job:", isLive)).toEqual(["job:j2"]);
  });
});
