
import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
    checkDatabaseAccess,
    checkTableAccess,
    filterDatabases,
    filterTables,
    validateQueryAccess,
    extractTablesFromQuery
} from "./dataAccess";

// Mock dependencies
const mockRbacService = {
    checkUserAccess: mock(),
    filterDatabasesForUser: mock(),
    filterTablesForUser: mock()
};

mock.module("../rbac/services/dataAccess", () => mockRbacService);

// Cleanup mocks to prevent leakage to other tests
import { afterAll } from "bun:test";
afterAll(() => {
    mock.restore();
});

// We can use real SQL parser for realistic testing, or mock if we want to force failures.
// Let's use real parser logic for standard cases but we could mock it if needed.
// For now, let's rely on real parser as it's a utility. 
// But we need to mock ../rbac/services/jwt if we used optionalRbacMiddleware, 
// but we are testing exported functions directly so we might not need to mock middleware context yet.

describe("Data Access Middleware", () => {
    const userId = "user-123";

    beforeEach(() => {
        mockRbacService.checkUserAccess.mockClear();
        mockRbacService.filterDatabasesForUser.mockClear();
        mockRbacService.filterTablesForUser.mockClear();
    });

    describe("checkDatabaseAccess", () => {
        it("should allow admin access without checks", async () => {
            const result = await checkDatabaseAccess(userId, true, "db1");
            expect(result).toBe(true);
            expect(mockRbacService.checkUserAccess).not.toHaveBeenCalled();
        });

        it("should check user access if not admin", async () => {
            mockRbacService.checkUserAccess.mockResolvedValue({ allowed: true });
            const result = await checkDatabaseAccess(userId, false, "db1");
            expect(result).toBe(true);
            expect(mockRbacService.checkUserAccess).toHaveBeenCalledWith(userId, "db1", null, "read", undefined);
        });

        it("should throw if no user id", async () => {
            expect(checkDatabaseAccess(undefined, false, "db1")).rejects.toThrow();
        });
    });

    describe("checkTableAccess", () => {
        it("should check user access for tables", async () => {
            mockRbacService.checkUserAccess.mockResolvedValue({ allowed: true });
            const result = await checkTableAccess(userId, false, "db1", "t1");
            expect(result).toBe(true);
            expect(mockRbacService.checkUserAccess).toHaveBeenCalledWith(userId, "db1", "t1", "read", undefined);
        });
    });

    describe("filterDatabases", () => {
        it("should return all databases for admin", async () => {
            const dbs = ["system", "app"];
            const result = await filterDatabases(userId, true, dbs);
            expect(result).toEqual(dbs);
        });

        it("should filter system databases for non-admin", async () => {
            mockRbacService.filterDatabasesForUser.mockResolvedValue(["system", "app", "other"]);
            const result = await filterDatabases(userId, false, ["system", "app", "other"]);

            // System should be removed
            expect(result).not.toContain("system");
            expect(result).toContain("app");
        });
    });

    describe("validateQueryAccess", () => {
        it("should allow admin to run anything", async () => {
            const result = await validateQueryAccess(userId, true, [], "DROP DATABASE foo");
            expect(result.allowed).toBe(true);
        });

        it("should deny if no permissions", async () => {
            const sql = "SELECT * FROM users";
            // User has no permissions
            const result = await validateQueryAccess(userId, false, [], sql);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("No permission for read");
        });

        it("should deny if data access rules fail", async () => {
            const sql = "SELECT * FROM db.secrets";
            // User has permission but data access denies
            mockRbacService.checkUserAccess.mockResolvedValue({ allowed: false });

            const result = await validateQueryAccess(userId, false, ["table:select"], sql);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("Access denied");
        });

        it("should allow if valid", async () => {
            const sql = "SELECT * FROM db.users";
            mockRbacService.checkUserAccess.mockResolvedValue({ allowed: true });

            const result = await validateQueryAccess(userId, false, ["table:select"], sql);

            expect(result.allowed).toBe(true);
        });

        it("should block multi-statement attacks", async () => {
            // SELECT allowed, DROP denied
            const sql = "SELECT * FROM users; DROP TABLE users";

            mockRbacService.checkUserAccess.mockResolvedValue({ allowed: true });

            // User has read permissions but not admin/drop
            const permissions = ["table:select"];

            const result = await validateQueryAccess(userId, false, permissions, sql);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("No permission for admin");
        });
    });

    describe("extractTablesFromQuery", () => {
        it("should extract tables", () => {
            const sql = "SELECT * FROM db.t1 JOIN db.t2";
            const result = extractTablesFromQuery(sql);

            expect(result).toHaveLength(2);
            const tables = result.map(t => t.table);
            expect(tables).toContain("t1");
            expect(tables).toContain("t2");
        });
    });
});
