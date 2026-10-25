import { describe, it, expect, mock, beforeEach } from "bun:test";

const queries: string[] = [];
const mockClose = mock(async () => {});
let queryImpl: (query: string) => Promise<unknown[]> = async () => [];

mock.module("@clickhouse/client", () => ({
  createClient: mock(() => ({
    query: async ({ query }: { query: string }) => {
      queries.push(query);
      const rows = await queryImpl(query);
      return { json: async () => rows };
    },
    ping: mock(async () => ({ success: false })),
    close: mockClose,
  })),
}));

const mockCheck = mock();
mock.module("../../services/connectionPrivileges", () => ({
  checkConnectionPrivileges: mockCheck,
}));

mock.module("../db", () => ({
  getDatabase: () => ({}),
  getSchema: () => ({}),
}));

import { testConnection } from "./connections";

const INPUT = { name: "t", host: "ch.internal", port: 8123, username: "reader", password: "pw", database: "analytics" };
const REPORT = { ok: true, username: "reader", database: "analytics", missingCount: 0, features: [], grantScript: "" };

describe("testConnection", () => {
  beforeEach(() => {
    queries.length = 0;
    mockClose.mockClear();
    mockCheck.mockReset();
    mockCheck.mockResolvedValue(REPORT);
    queryImpl = async (query) => (query.startsWith("SELECT version()") ? [{ version: "26.5.7" }] : [{ name: "analytics" }]);
  });

  it("returns the version, databases and privilege report, and closes the client", async () => {
    const result = await testConnection(INPUT);

    expect(result.success).toBe(true);
    expect(result.version).toBe("26.5.7");
    expect(result.databases).toEqual(["analytics"]);
    expect(result.privileges).toEqual(REPORT);
    expect(mockCheck).toHaveBeenCalledWith(expect.anything(), { username: "reader", database: "analytics" });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("fails, and still closes the client, when the login fails", async () => {
    queryImpl = async () => {
      throw new Error("reader: Authentication failed");
    };

    const result = await testConnection(INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toBe("reader: Authentication failed");
    expect(result.privileges).toBeUndefined();
    expect(mockCheck).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("fails when the privileges can't be checked", async () => {
    mockCheck.mockRejectedValue(new Error("SHOW GRANTS timed out"));

    const result = await testConnection(INPUT);

    expect(result.success).toBe(false);
    expect(result.version).toBe("26.5.7");
    expect(result.error).toBe("Connected, but couldn't check this user's privileges: SHOW GRANTS timed out");
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
