import { describe, expect, it } from "bun:test";

import { buildObservedGraph, type QueryGroup } from "./lineage";

const group = (overrides: Partial<QueryGroup>): QueryGroup => ({
  query_kind: "Insert", target: "db.dest", tables: [], columns: [], table_functions: [],
  src: "", job_id: "", pat_id: "", rbac_user_id: "", user: "default", client: "app", runs: 1, last_ms: 0, ...overrides,
});

describe("buildObservedGraph", () => {
  it("never turns a table function into a table node", () => {
    const graph = buildObservedGraph([group({ tables: ["db.dest", "_table_function.numbers"], table_functions: ["numbers"] })], "default");
    expect([...graph.nodes.keys()].some((id) => id.includes("_table_function"))).toBe(false);
    expect([...graph.edges.values()].some((e) => e.kind === "external_read" && e.target === "table:db.dest")).toBe(true);
  });

  it("links a scheduled job's sources to the job", () => {
    const graph = buildObservedGraph([group({ src: "scheduled_query", job_id: "j1", tables: ["db.dest", "db.src"] })], "default");
    expect([...graph.edges.values()].some((e) => e.kind === "reader_job" && e.source === "table:db.src" && e.target === "job:j1")).toBe(true);
  });
});
