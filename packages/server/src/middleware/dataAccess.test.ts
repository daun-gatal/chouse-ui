
import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
    checkDatabaseAccess,
    checkTableAccess,
    filterDatabases,
    filterTables,
    validateQueryAccess,
    accessDeniedStatus,
} from "./dataAccess";
import { CASES } from "./sqlAccess/fixtures/cases";
import { fixtureParser, linesParser } from "./sqlAccess/fixtures/fakeParser";

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
});

// ADR 0030: the access decision on real ClickHouse printouts. `secret` is the
// database the user's rules deny; everything else is allowed.
describe("validateQueryAccess", () => {
    const userId = "user-123";
    const ALL = [
        "table:select", "table:insert", "table:update", "table:delete", "table:create", "table:alter",
        "table:drop", "table:view", "database:create", "database:drop", "query:execute:misc",
    ];

    beforeEach(() => {
        mockRbacService.checkUserAccess.mockReset();
        mockRbacService.checkUserAccess.mockImplementation(async (_user: string, database: string) => ({ allowed: database !== "secret" }));
    });

    async function check(sql: string, opts: { permissions?: string[]; params?: Record<string, string>; parser?: ReturnType<typeof fixtureParser> } = {}) {
        return validateQueryAccess({
            userId,
            isAdmin: false,
            permissions: opts.permissions ?? ALL,
            sql,
            params: opts.params,
            connectionId: "conn-1",
            parser: opts.parser ?? fixtureParser("26.5"),
        });
    }

    it("lets admins run anything without parsing", async () => {
        const parser = fixtureParser("26.5");
        expect(await validateQueryAccess({ userId, isAdmin: true, permissions: [], sql: "DROP DATABASE secret", connectionId: "c", parser })).toEqual({ allowed: true });
        expect(parser.calls).toBe(0);
    });

    it("refuses without an RBAC user or a connection", async () => {
        expect(await validateQueryAccess({ userId: undefined, isAdmin: false, permissions: ALL, sql: "SELECT 1", connectionId: "c" })).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
        expect(await validateQueryAccess({ userId, isAdmin: false, permissions: ALL, sql: "SELECT 1", connectionId: undefined })).toMatchObject({ allowed: false, code: "CHECK_UNAVAILABLE", status: 503 });
    });

    for (const c of CASES) {
        if (typeof c.expect === "string") continue;
        const refs = [...(c.expect.targets ?? []), ...(c.expect.reads ?? []), ...(c.expect.databases ?? [])];
        const touchesSecret = refs.some((r) => r === "secret" || r.startsWith("secret."));
        it(`${touchesSecret ? "denies" : "allows"} ${c.sql.replace(/\n/g, "⏎").slice(0, 80)}`, async () => {
            const result = await check(c.sql, { params: c.params });
            if (touchesSecret) {
                expect(result).toMatchObject({ allowed: false, code: "TABLE_DENIED", status: 403 });
            } else {
                expect(result).toMatchObject({ allowed: true });
            }
        });
    }

    it("resolves unqualified names against the connection's default database, not comment text", async () => {
        await check("SELECT * FROM t /* FROM public.t */", { parser: fixtureParser("26.5", "analytics") });
        expect(mockRbacService.checkUserAccess).toHaveBeenCalledWith(userId, "analytics", "t", "read", "conn-1");
        expect(mockRbacService.checkUserAccess).not.toHaveBeenCalledWith(userId, "public", "t", expect.anything(), expect.anything());
    });

    it("checks every target and read once", async () => {
        await check("INSERT INTO public.t SELECT * FROM secret.s");
        expect(mockRbacService.checkUserAccess.mock.calls.map((call: unknown[]) => `${call[1]}.${call[2]}`)).toEqual(["public.t", "secret.s"]);
    });

    it("checks databases as a whole for CREATE/DROP DATABASE, SHOW TABLES and USE", async () => {
        await check("SHOW TABLES");
        expect(mockRbacService.checkUserAccess).toHaveBeenCalledWith(userId, "db", null, "misc", "conn-1");
        expect(await check("DROP DATABASE d2")).toEqual({ allowed: true, statementType: "drop" });
        mockRbacService.checkUserAccess.mockImplementation(async () => ({ allowed: false }));
        expect(await check("USE public")).toMatchObject({ allowed: false, code: "TABLE_DENIED", reason: "Access denied to database public" });
    });

    describe("operation permissions", () => {
        const cases: Array<[string, string[], boolean]> = [
            ["SELECT 1", ["table:view"], false],
            ["SELECT 1", ["table:select"], true],
            ["DROP DATABASE d2", ["table:create", "table:drop"], false],
            ["DROP DATABASE d2", ["database:drop"], true],
            ["DROP TABLE IF EXISTS public.t SYNC", ["database:drop"], false],
            ["DROP TABLE IF EXISTS public.t SYNC", ["table:drop"], true],
            ["TRUNCATE TABLE IF EXISTS public.t", ["table:drop"], false],
            ["TRUNCATE TABLE IF EXISTS public.t", ["table:delete"], true],
            ["INSERT INTO t FORMAT CSV", ["table:delete"], false],
            ["INSERT INTO t FORMAT CSV", ["table:insert"], true],
            ["CREATE DATABASE d2 ENGINE = Atomic", ["table:create"], false],
            ["CREATE DATABASE d2 ENGINE = Atomic", ["database:create"], true],
            ["EXPLAIN ESTIMATE SELECT * FROM public.t", ["table:select"], false],
            ["EXPLAIN ESTIMATE SELECT * FROM public.t", ["query:execute:misc"], true],
        ];
        for (const [sql, permissions, allowed] of cases) {
            it(`${allowed ? "allows" : "refuses"} ${sql} with ${permissions.join(", ")}`, async () => {
                const result = await check(sql, { permissions });
                expect(result.allowed).toBe(allowed);
                if (!allowed) expect(result.code).toBe("PERMISSION_DENIED");
            });
        }
    });

    it("maps refusals to HTTP status", async () => {
        expect(await check("SELECT 1; SELECT 2")).toMatchObject({ allowed: false, code: "SQL_SYNTAX", status: 400 });
        expect(await check("SELECT * FROM public.t WHERE x = {p:String}")).toMatchObject({ code: "QUERY_PARAM_UNBOUND", status: 400 });
        expect(await check("SELECT * FROM remote('h', secret.s)")).toMatchObject({ code: "UNSAFE_TABLE_FUNCTION", status: 403 });
        expect(await check("SELECT 1", { parser: { ...linesParser([]), explainAst: async () => ({ ok: false, code: "CHECK_UNAVAILABLE", message: "down" }) } as ReturnType<typeof fixtureParser> })).toMatchObject({ code: "CHECK_UNAVAILABLE", status: 503 });
        expect(accessDeniedStatus("TABLE_DENIED")).toBe(403);
    });

    it("refuses when a rule lookup would see a table only ClickHouse resolves", async () => {
        const result = await check("SELECT * FROM {t:Identifier}", { params: { t: "secret.s" } });
        expect(result).toMatchObject({ allowed: false, code: "TABLE_DENIED", reason: "Access denied to secret.s (requires read permission)" });
    });
});
