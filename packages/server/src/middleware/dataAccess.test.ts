
import { afterEach, describe, it, expect, mock, beforeEach } from "bun:test";
import {
    checkDatabaseAccess,
    checkTableAccess,
    filterDatabases,
    filterTables,
    validateQueryAccess,
    accessDeniedStatus,
    checkedOf,
    setAccessOverrideForTests,
} from "./dataAccess";
import { CheckedStatement } from "../services/chExecutor/checked";
import { CASES } from "./sqlAccess/fixtures/cases";
import { fakeExplainPrintout, fixtureParser, linesParser } from "./sqlAccess/fixtures/fakeParser";

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
        "live_queries:kill_all",
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
        expect(await check("DROP DATABASE d2")).toMatchObject({ allowed: true, statementType: "drop" });
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
            // A typed KILL can target anyone's query, so it needs the kill-all permission.
            ["KILL QUERY WHERE query_id = 'x'", ["query:execute:misc"], false],
            ["KILL QUERY WHERE query_id = 'x'", ["query:execute:misc", "live_queries:kill"], false],
            ["KILL QUERY WHERE query_id = 'x'", ["live_queries:kill_all"], true],
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

    describe("admins (ADR 0033 §3)", () => {
        const asAdmin = (sql: string, parser = fixtureParser("26.5")) => validateQueryAccess({ userId, isAdmin: true, permissions: [], sql, connectionId: "c", parser });

        it("refuses EXECUTE AS as the root, behind a comment and under PARALLEL WITH", async () => {
            for (const sql of ["EXECUTE AS default SELECT 1", "/* x */ -- y\nEXECUTE AS default SELECT 1", "SELECT 1 PARALLEL WITH EXECUTE AS default SELECT 2"]) {
                expect(await asAdmin(sql)).toMatchObject({ allowed: false, code: "IMPERSONATION", status: 403 });
            }
        });

        it("refuses EXECUTE AS for everyone else with the same code", async () => {
            expect(await check("EXECUTE AS default SELECT 1", { parser: fixtureParser("26.5") })).toMatchObject({ allowed: false, code: "IMPERSONATION" });
        });

        it("does not mistake a string or an alias that spells the node name", async () => {
            expect(await asAdmin("SELECT 'ExecuteAsQuery' AS ExecuteAsQuery")).toMatchObject({ allowed: true });
        });

        it("keeps the bypass of permissions and data access rules for every other statement", async () => {
            for (const sql of ["DROP DATABASE d2", "SELECT * FROM public.t, secret.s SETTINGS max_threads=1", "KILL QUERY WHERE query_id = 'x'"]) {
                expect(await asAdmin(sql)).toMatchObject({ allowed: true });
            }
        });

        it("reads the statement's kind from the same parse, so an admin's read is sent read-only", async () => {
            const read = await asAdmin("SELECT * FROM public.t, secret.s SETTINGS max_threads=1");
            expect(read.statement).toMatchObject({ isRead: true, mayWrite: true, accountId: userId, connectionId: "c" });
            expect((await asAdmin("DROP DATABASE d2")).statement).toMatchObject({ isRead: false, mayWrite: true });
            // A shape the policy does not know is not a refusal for an admin; it is sent as a possible write.
            const unknown = await asAdmin("CREATE MATERIALIZED VIEW public.mv TO secret.s AS SELECT * FROM public.t");
            expect(unknown).toMatchObject({ allowed: true });
            expect(unknown.statement?.isRead).toBe(false);
        });

        it("refuses an admin with no account, since a statement is sent for an account", async () => {
            expect(await validateQueryAccess({ userId: undefined, isAdmin: true, permissions: [], sql: "SELECT 1", connectionId: "c", parser: fixtureParser("26.5") })).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
        });

        it("asks ClickHouse once per statement", async () => {
            const parser = fixtureParser("26.5");
            await asAdmin("DROP DATABASE d2", parser);
            expect(parser.calls).toBe(1);
        });

        it("is refused when the parse cannot run, and when ClickHouse cannot parse the text", async () => {
            const down = { ...linesParser([]), explainAst: async () => ({ ok: false, code: "CHECK_UNAVAILABLE", message: "down" }) } as ReturnType<typeof fixtureParser>;
            expect(await asAdmin("SELECT 1", down)).toMatchObject({ allowed: false, code: "CHECK_UNAVAILABLE", status: 503 });
            expect(await asAdmin("EXECUTE AS default SELECT 1", fixtureParser("23.8"))).toMatchObject({ allowed: false, code: "SQL_SYNTAX", status: 400 });
            expect(await validateQueryAccess({ userId, isAdmin: true, permissions: [], sql: "SELECT 1", connectionId: undefined })).toMatchObject({ allowed: false, code: "CHECK_UNAVAILABLE" });
        });

        it("has nothing to check in an empty statement", async () => {
            expect(await asAdmin("  ")).toMatchObject({ allowed: true });
        });
    });

    describe("the checked statement (ADR 0033 §2)", () => {
        it("holds exactly what was checked", async () => {
            mockRbacService.checkUserAccess.mockImplementation(async () => ({ allowed: true }));
            const result = await check("SELECT * FROM {t:Identifier}", { params: { t: "secret.s" } });
            expect(result.allowed).toBe(true);
            const statement = checkedOf(result);
            expect(statement).toBeInstanceOf(CheckedStatement);
            expect(statement).toMatchObject({ sql: "SELECT * FROM {t:Identifier}", params: { t: "secret.s" }, connectionId: "conn-1", accountId: userId, isRead: true });
            expect(Object.isFrozen(statement)).toBe(true);
        });

        it("is absent from a refusal, and asking for it throws", async () => {
            const result = await check("SELECT 1 WHERE 1 IN secret.s");
            expect(result.statement).toBeUndefined();
            expect(() => checkedOf(result)).toThrow();
        });

        it("marks a write as a write, and a person who may write nothing as read-only whatever the statement", async () => {
            expect(checkedOf(await check("INSERT INTO public.t (a, b) VALUES (1, 'x'), (2, now())"))).toMatchObject({ isRead: false, mayWrite: true });
            expect(checkedOf(await check("SELECT 1", { permissions: ["table:select"] }))).toMatchObject({ isRead: true, mayWrite: false });
            expect(checkedOf(await check("SELECT 1", { permissions: ["table:select", "table:insert"] })).mayWrite).toBe(true);
        });

    });

    describe("system tables that show other people's work (ADR 0033 §4)", () => {
        const system = (sql: string, permissions: string[]) => check(sql, { permissions, parser: { calls: 0, explainAst: async (text: string) => ({ ok: true as const, lines: fakeExplainPrintout(text) }), defaultDatabase: async () => "db" } });

        it("needs query:history:view:all for the statement logs, including a rotated log table", async () => {
            for (const table of ["query_log", "processes", "text_log", "query_log_3", "QUERY_LOG"]) {
                expect(await system(`SELECT * FROM system.${table}`, ["table:select"])).toMatchObject({ allowed: false, code: "TABLE_DENIED", status: 403 });
                expect(await system(`SELECT * FROM system.${table}`, ["table:select", "query:history:view:all"])).toMatchObject({ allowed: true });
            }
            const refused = await system("SELECT * FROM system.query_log", ["table:select"]);
            expect(refused.reason).toContain("query:history:view:all");
        });

        it("needs clickhouse:users:view for the access tables", async () => {
            expect(await system("SELECT * FROM system.users", ["table:select", "query:history:view:all"])).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
            expect(await system("SELECT * FROM system.grants", ["table:select", "clickhouse:users:view"])).toMatchObject({ allowed: true });
        });

        it("finds the table behind a join, and leaves every other system table open", async () => {
            expect(await system("SELECT * FROM system.parts JOIN system.query_log ON 1", ["table:select"])).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
            expect(await system("SELECT * FROM system.parts", ["table:select"])).toMatchObject({ allowed: true });
            expect(await system("SELECT * FROM system.tables", ["table:select"])).toMatchObject({ allowed: true });
        });
    });

    describe("the forced-allow hook for real-server tests", () => {
        afterEach(() => setAccessOverrideForTests(null));

        it("skips only the stage it names", async () => {
            setAccessOverrideForTests((stage) => stage === "permission");
            expect(await check("INSERT INTO public.t (a, b) VALUES (1, 'x'), (2, now())", { permissions: ["table:select"] })).toMatchObject({ allowed: true });
            expect(await check("SELECT 1 WHERE 1 IN secret.s", { permissions: ["table:select"] })).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
            setAccessOverrideForTests((stage) => stage === "table");
            expect(await check("SELECT 1 WHERE 1 IN secret.s", { permissions: ["table:select"] })).toMatchObject({ allowed: true });
            expect(await check("INSERT INTO public.t (a, b) VALUES (1, 'x'), (2, now())", { permissions: ["table:select"] })).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
        });

        it("never skips the parse or the EXECUTE AS refusal, and a forced write from a read-only person is still sent read-only", async () => {
            setAccessOverrideForTests(() => true);
            expect(await check("EXECUTE AS default SELECT 1")).toMatchObject({ allowed: false, code: "IMPERSONATION" });
            expect(await check("SELECT 1; SELECT 2")).toMatchObject({ allowed: false, code: "SQL_SYNTAX" });
            expect(checkedOf(await check("INSERT INTO public.t (a, b) VALUES (1, 'x'), (2, now())", { permissions: ["table:select"] }))).toMatchObject({ isRead: false, mayWrite: false });
        });

        it("refuses to be set outside a test run", () => {
            const previous = process.env.NODE_ENV;
            process.env.NODE_ENV = "production";
            try {
                expect(() => setAccessOverrideForTests(() => true)).toThrow();
            } finally {
                process.env.NODE_ENV = previous;
            }
        });
    });

    it("refuses when a rule lookup would see a table only ClickHouse resolves", async () => {
        const result = await check("SELECT * FROM {t:Identifier}", { params: { t: "secret.s" } });
        expect(result).toMatchObject({ allowed: false, code: "TABLE_DENIED", reason: "Access denied to secret.s (requires read permission)" });
    });
});
