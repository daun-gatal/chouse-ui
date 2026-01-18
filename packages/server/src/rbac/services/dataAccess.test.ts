
import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
    createDataAccessRule,
    checkUserAccess,
    filterDatabasesForUser,
    type DataAccessRuleResponse
} from "./dataAccess";

// Mock Data
const mockRules: any[] = [];
const mockUserRoles = [{ userId: "user-1", roleId: "role-1" }];

// Mock Drizzle
const queryBuilder = {
    insert: mock(() => queryBuilder),
    values: mock((v: any) => {
        mockRules.push({ ...v, id: "new-rule-id" });
        return queryBuilder;
    }),
    select: mock(() => queryBuilder),
    from: mock(() => queryBuilder),
    where: mock(() => queryBuilder),
    orderBy: mock(() => queryBuilder),
    limit: mock(() => queryBuilder),
    delete: mock(() => queryBuilder),
    update: mock(() => queryBuilder),
    set: mock(() => queryBuilder),
    then: mock((resolve: any) => resolve(mockRules)),
};

const mockDb = {
    insert: mock(() => queryBuilder),
    select: mock(() => queryBuilder),
    delete: mock(() => queryBuilder),
    update: mock(() => queryBuilder),
};

const mockSchema = {
    dataAccessRules: {
        id: "id", roleId: "roleId", userId: "userId",
        databasePattern: "databasePattern", tablePattern: "tablePattern",
        priority: "priority", isAllowed: "isAllowed", createdAt: "createdAt"
    },
    userRoles: { userId: "userId", roleId: "roleId" }
};

mock.module("../db", () => ({
    getDatabase: () => mockDb,
    getSchema: () => mockSchema,
}));

describe("DataAccess Service (RBAC)", () => {
    beforeEach(() => {
        // Reset mocks and data
        mockRules.length = 0;
        mockDb.select.mockClear();
        queryBuilder.then.mockImplementation((resolve: any) => resolve(mockRules));
    });

    describe("Pattern Matching & Priority", () => {
        it("should allow if matching allow rule exists", async () => {
            // Setup rules: Allow 'db1.*'
            mockRules.push({
                id: "r1", userId: "user-1",
                databasePattern: "db1", tablePattern: "*",
                accessType: "read", isAllowed: true, priority: 10
            });

            // Mock getting rules
            queryBuilder.then.mockImplementation((resolve: any) => resolve([...mockRules]));

            const result = await checkUserAccess("user-1", "db1", "t1", "read");
            expect(result.allowed).toBe(true);
        });

        it("should deny if no matching rule", async () => {
            // Add a rule that doesn't match so we bypass "no rules defined" check
            mockRules.push({
                id: "r1", userId: "user-1",
                databasePattern: "other_db", tablePattern: "*",
                accessType: "read", isAllowed: true, priority: 10
            });
            queryBuilder.then.mockImplementation((resolve: any) => resolve([...mockRules]));

            const result = await checkUserAccess("user-1", "db1", "t1", "read");
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("No matching access rule");
        });

        it("should deny if deny rule matches (higher priority)", async () => {
            // Rule 1: Allow *.* (priority 0)
            // Rule 2: Deny db1.* (priority 10)
            mockRules.push({
                id: "r1", userId: "user-1", databasePattern: "*", tablePattern: "*",
                accessType: "read", isAllowed: true, priority: 0
            });
            mockRules.push({
                id: "r2", userId: "user-1", databasePattern: "db1", tablePattern: "*",
                accessType: "read", isAllowed: false, priority: 10
            });

            queryBuilder.then.mockImplementation((resolve: any) => resolve([...mockRules]));

            const result = await checkUserAccess("user-1", "db1", "t1", "read");
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("Denied by rule");
        });

        it("should allow if partial match (wildcard)", async () => {
            mockRules.push({
                id: "r1", userId: "user-1", databasePattern: "prod_*", tablePattern: "*",
                accessType: "read", isAllowed: true, priority: 10
            });
            queryBuilder.then.mockImplementation((resolve: any) => resolve([...mockRules]));

            const result = await checkUserAccess("user-1", "prod_analytics", "events", "read");
            expect(result.allowed).toBe(true);
        });
    });

    describe("filterDatabasesForUser", () => {
        it("should filter list based on rules", async () => {
            mockRules.push({
                id: "r1", userId: "user-1", databasePattern: "visible", tablePattern: "*",
                accessType: "read", isAllowed: true, priority: 10
            });
            queryBuilder.then.mockImplementation((resolve: any) => resolve([...mockRules]));

            const inputs = ["visible", "hidden", "system"];
            const result = await filterDatabasesForUser("user-1", inputs);

            expect(result).toContain("visible");
            expect(result).not.toContain("hidden");
            expect(result).not.toContain("system");
        });
    });

    describe("createDataAccessRule", () => {
        it("should insert rule", async () => {
            queryBuilder.then.mockImplementation((resolve: any) => resolve([{ id: "new-rule-id" }]));

            const result = await createDataAccessRule({
                userId: "user-1",
                databasePattern: "db1",
                tablePattern: "*",
                accessType: "read"
            });

            expect(mockDb.insert).toHaveBeenCalled();
            expect(result).not.toBeNull();
        });
    });
});
