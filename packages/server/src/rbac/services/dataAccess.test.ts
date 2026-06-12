import { describe, it, expect, mock, beforeEach } from "bun:test";

// Resolved policy rules returned by the (mocked) policy resolver.
let mockResolvedRules: Array<{
  databasePattern: string;
  tablePattern: string;
  isAllowed: boolean;
  priority: number;
  policyId: string;
  policyName: string;
}> = [];

// The user's role assignments returned by the (mocked) DB.
let mockUserRoles: Array<{ roleId: string }> = [{ roleId: "role-1" }];

mock.module("./dataAccessPolicies", () => ({
  getPolicyRulesForRoleIds: async () => mockResolvedRules,
}));

const queryBuilder = {
  select: mock(() => queryBuilder),
  from: mock(() => queryBuilder),
  where: mock(() => queryBuilder),
  then: mock((resolve: (v: unknown) => unknown) => resolve(mockUserRoles)),
};

const mockDb = {
  select: mock(() => queryBuilder),
};

mock.module("../db", () => ({
  getDatabase: () => mockDb,
  getSchema: () => ({ userRoles: { userId: "userId", roleId: "roleId" } }),
}));

const { checkUserAccess, filterDatabasesForUser } = await import("./dataAccess");

function rule(partial: Partial<(typeof mockResolvedRules)[number]>): (typeof mockResolvedRules)[number] {
  return {
    databasePattern: "*",
    tablePattern: "*",
    isAllowed: true,
    priority: 0,
    policyId: "p1",
    policyName: "Policy",
    ...partial,
  };
}

describe("DataAccess Service (RBAC)", () => {
  beforeEach(() => {
    mockResolvedRules = [];
    mockUserRoles = [{ roleId: "role-1" }];
    queryBuilder.then.mockImplementation((resolve: (v: unknown) => unknown) => resolve(mockUserRoles));
  });

  describe("Pattern Matching & Priority", () => {
    it("allows when a matching allow rule exists", async () => {
      mockResolvedRules = [rule({ databasePattern: "db1", priority: 10 })];
      const result = await checkUserAccess("user-1", "db1", "t1", "read");
      expect(result.allowed).toBe(true);
    });

    it("denies when no rule matches", async () => {
      mockResolvedRules = [rule({ databasePattern: "other_db", priority: 10 })];
      const result = await checkUserAccess("user-1", "db1", "t1", "read");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("No matching access rule");
    });

    it("denies when a higher-priority deny rule matches", async () => {
      mockResolvedRules = [
        rule({ databasePattern: "*", priority: 0, isAllowed: true }),
        rule({ databasePattern: "db1", priority: 10, isAllowed: false }),
      ];
      const result = await checkUserAccess("user-1", "db1", "t1", "read");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Denied by rule");
    });

    it("supports wildcard patterns", async () => {
      mockResolvedRules = [rule({ databasePattern: "prod_*", priority: 10 })];
      const result = await checkUserAccess("user-1", "prod_analytics", "events", "read");
      expect(result.allowed).toBe(true);
    });

    it("allows system databases by default", async () => {
      mockResolvedRules = [];
      const result = await checkUserAccess("user-1", "system", "tables", "read");
      expect(result.allowed).toBe(true);
    });
  });

  describe("filterDatabasesForUser", () => {
    it("filters the list based on the resolved rules", async () => {
      mockResolvedRules = [rule({ databasePattern: "visible", priority: 10 })];
      const result = await filterDatabasesForUser("user-1", ["visible", "hidden", "system"]);
      expect(result).toContain("visible");
      expect(result).not.toContain("hidden");
      expect(result).not.toContain("system");
    });
  });
});
