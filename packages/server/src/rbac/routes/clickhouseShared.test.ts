import { describe, expect, it } from "bun:test";

import { handleError } from "./clickhouseShared";

describe("handleError", () => {
  it("answers a ClickHouse access denial with 403 and points at Test connection", () => {
    const error = new Error(
      "reader: Not enough privileges. To execute this query, it's necessary to have the grant SHOW USERS ON *.*. (ACCESS_DENIED) (version 26.5.1.1)\nstack trace…",
    );
    const info = handleError(error, "LIST_FAILED", "Failed to list ClickHouse users");
    expect(info.code).toBe("CLICKHOUSE_ACCESS_DENIED");
    expect(info.statusCode).toBe(403);
    expect(info.message).toStartWith("This connection's ClickHouse user isn't allowed to do this: reader: Not enough privileges.");
    expect(info.message).toEndWith("Test the connection in Admin › Connections to see the grants it needs.");
    expect(info.message).not.toContain("stack trace");
  });

  it("keeps the other mappings", () => {
    expect(handleError(new Error("Role r is still assigned to u"), "X", "x").code).toBe("ROLE_IN_USE");
    expect(handleError(new Error("storage is readonly"), "X", "x").code).toBe("READONLY_STORAGE");
    expect(handleError(new Error("No active session"), "X", "x")).toEqual({ code: "NO_SESSION", message: "No active session", statusCode: 400 });
    expect(handleError(new Error("boom"), "LIST_FAILED", "x")).toEqual({ code: "LIST_FAILED", message: "boom", statusCode: 500 });
  });
});
