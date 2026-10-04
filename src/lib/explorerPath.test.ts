import { describe, expect, it } from "vitest";

import { explorerPath, readExplorerTarget } from "./explorerPath";

describe("explorerPath", () => {
  it("links to a table with the parameters the Explorer reads", () => {
    expect(explorerPath("shop", "orders")).toBe("/explorer?database=shop&table=orders");
  });

  it("links to a database", () => {
    expect(explorerPath("shop")).toBe("/explorer?database=shop");
  });

  it("encodes names", () => {
    expect(explorerPath("my db", "a&b")).toBe("/explorer?database=my+db&table=a%26b");
  });

  it("falls back to the Explorer root", () => {
    expect(explorerPath()).toBe("/explorer");
    expect(explorerPath("", "orders")).toBe("/explorer");
  });

  it("round-trips through readExplorerTarget", () => {
    const url = new URL(explorerPath("my db", "a&b"), "http://x");
    expect(readExplorerTarget(url.searchParams)).toEqual({ database: "my db", table: "a&b" });
  });
});

describe("readExplorerTarget", () => {
  it("accepts the legacy db alias", () => {
    expect(readExplorerTarget(new URLSearchParams("db=shop&table=orders"))).toEqual({ database: "shop", table: "orders" });
  });

  it("prefers database over db", () => {
    expect(readExplorerTarget(new URLSearchParams("database=a&db=b"))).toEqual({ database: "a", table: "" });
  });

  it("ignores a table without a database", () => {
    expect(readExplorerTarget(new URLSearchParams("table=orders"))).toBeNull();
    expect(readExplorerTarget(new URLSearchParams(""))).toBeNull();
  });
});
