import { describe, expect, it } from "vitest";

import type { DashboardSummary } from "@/api/dashboards";

import { PAGE_SIZE, listPage, matchesSearch, parseListParams, tabCounts, writeListParams } from "./listView";

const ACCESS = { owner: true, view: true, edit: true, delete: true, share: true };
function summary(id: string, over: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    id, title: id, description: "", ownerId: "u1", timeRange: "1h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: [],
    version: 1, createdAt: 0, updatedAt: 0, panelCount: 1, ownerName: null, shares: [], access: ACCESS, pinned: false, scope: { kind: "any" }, ...over,
  };
}

describe("list params", () => {
  it("reads defaults from an empty or unusable URL", () => {
    expect(parseListParams(new URLSearchParams("tab=nope&sort=x&page=-2"))).toEqual({ tab: "all", q: "", sort: "updated", page: 1 });
    expect(parseListParams(new URLSearchParams("page=1.5")).page).toBe(1);
  });

  it("round-trips and leaves defaults out", () => {
    const params = { tab: "shared" as const, q: "kafka lag", sort: "title" as const, page: 3 };
    expect(parseListParams(writeListParams(params))).toEqual(params);
    expect(writeListParams({ tab: "all", q: "  ", sort: "updated", page: 1 }).toString()).toBe("");
  });
});

describe("matchesSearch", () => {
  it("needs every word, in the title, description or another owner's name", () => {
    const d = summary("d1", { title: "Kafka ingestion", description: "Consumer lag", ownerName: "Ada", access: { ...ACCESS, owner: false } });
    expect(matchesSearch(d, "kafka LAG")).toBe(true);
    expect(matchesSearch(d, "ada")).toBe(true);
    expect(matchesSearch(d, "kafka merges")).toBe(false);
    expect(matchesSearch(d, "   ")).toBe(true);
  });
});

describe("listPage", () => {
  const list = [
    summary("b", { title: "Beta", updatedAt: 5, panelCount: 2 }),
    summary("a", { title: "alpha", updatedAt: 1, panelCount: 9, access: { ...ACCESS, owner: false } }),
    summary("c", { title: "Gamma", updatedAt: 9, panelCount: 2, pinned: true }),
  ];

  it("puts pinned first, then sorts", () => {
    expect(listPage(list, { tab: "all", q: "", sort: "updated", page: 1 }).rows.map((d) => d.id)).toEqual(["c", "b", "a"]);
    expect(listPage(list, { tab: "all", q: "", sort: "title", page: 1 }).rows.map((d) => d.id)).toEqual(["c", "a", "b"]);
    expect(listPage(list, { tab: "all", q: "", sort: "panels", page: 1 }).rows.map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("filters by tab and counts each", () => {
    expect(listPage(list, { tab: "shared", q: "", sort: "updated", page: 1 }).rows.map((d) => d.id)).toEqual(["a"]);
    expect(listPage(list, { tab: "pinned", q: "", sort: "updated", page: 1 }).rows.map((d) => d.id)).toEqual(["c"]);
    expect(tabCounts(list)).toEqual({ all: 3, mine: 2, shared: 1, pinned: 1 });
  });

  it("pages, and clamps a page past the end", () => {
    const many = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, i) => summary(`d${String(i).padStart(3, "0")}`));
    const last = listPage(many, { tab: "all", q: "", sort: "title", page: 99 });
    expect(last).toMatchObject({ total: PAGE_SIZE * 2 + 3, page: 3, pages: 3 });
    expect(last.rows).toHaveLength(3);
    expect(listPage([], { tab: "all", q: "", sort: "title", page: 2 })).toEqual({ rows: [], total: 0, page: 1, pages: 1 });
  });
});
