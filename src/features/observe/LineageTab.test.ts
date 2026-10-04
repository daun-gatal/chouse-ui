import { describe, expect, it } from "vitest";

import { layoutGraph, statusTone } from "./LineageTab";

describe("lineage graph helpers", () => {
  it("colours nodes by trust state or pipeline status", () => {
    expect(statusTone("stale")).toBe("bad");
    expect(statusTone("trusted")).toBe("ok");
    expect(statusTone("retrying")).toBe("bad");
    expect(statusTone("lagging")).toBe("warn");
    expect(statusTone("something_else")).toBe("muted");
    expect(statusTone(null)).toBeNull();
  });

  it("lays sources left of their targets", () => {
    const node = (id: string) => ({ id, kind: "table", label: id, database: null, table: null, status: null, statusReason: null });
    const positions = layoutGraph(
      [node("a"), node("b"), node("c")],
      [
        { id: "e1", source: "a", target: "b", kind: "view_target", origin: "metadata", columns: [], observations: 1 },
        { id: "e2", source: "b", target: "c", kind: "insert_select", origin: "query_log", columns: [], observations: 1 },
      ],
    );
    expect(positions.get("a")!.x).toBeLessThan(positions.get("b")!.x);
    expect(positions.get("b")!.x).toBeLessThan(positions.get("c")!.x);
  });
});
