
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock Dependencies
const mockGetSystemStats = mock();
const mockGetRecentQueries = mock();
const mockGetProductionMetrics = mock();
const mockGetQueryLatencyMetrics = mock();
const mockGetDiskMetrics = mock();
const mockGetMergeMetrics = mock();
const mockGetReplicationMetrics = mock();
const mockGetCacheMetrics = mock();
const mockGetResourceMetrics = mock();
const mockGetErrorMetrics = mock();
const mockGetInsertThroughput = mock();
const mockGetTopTablesBySize = mock();
const mockGetPartsPressure = mock();
const mockGetDdlImpact = mock();
const mockExecuteQuery = mock();
const mockClose = mock();
const mockPing = mock();
const mockGetVersion = mock();

class MockClickHouseService {
    getSystemStats = mockGetSystemStats;
    getRecentQueries = mockGetRecentQueries;
    getProductionMetrics = mockGetProductionMetrics;
    getQueryLatencyMetrics = mockGetQueryLatencyMetrics;
    getDiskMetrics = mockGetDiskMetrics;
    getMergeMetrics = mockGetMergeMetrics;
    getReplicationMetrics = mockGetReplicationMetrics;
    getCacheMetrics = mockGetCacheMetrics;
    getResourceMetrics = mockGetResourceMetrics;
    getErrorMetrics = mockGetErrorMetrics;
    getInsertThroughput = mockGetInsertThroughput;
    getTopTablesBySize = mockGetTopTablesBySize;
    getPartsPressure = mockGetPartsPressure;
    getDdlImpact = mockGetDdlImpact;
    defaultDatabase = "default";
    executeQuery = mockExecuteQuery;
    close = mockClose;
    ping = mockPing;
    getVersion = mockGetVersion;
}

mock.module("../services/clickhouse", () => ({
    ClickHouseService: MockClickHouseService,
    getSession: mock((id) => {
        if (id === "valid-session") {
            return {
                session: { id: "valid-session", rbacUserId: "user1", rbacConnectionId: "conn1" },
                service: new MockClickHouseService()
            };
        }
        return null;
    })
}));

const mockGetUserConnections = mock();
const mockGetConnectionWithPassword = mock();

mock.module("../rbac/services/connections", () => ({
    getUserConnections: mockGetUserConnections,
    getConnectionWithPassword: mockGetConnectionWithPassword,
    listConnections: mock()
}));

const mockUserHasPermission = mock();
const mockUserHasAnyPermission = mock();

mock.module("../rbac/services/rbac", () => ({
    userHasPermission: mockUserHasPermission,
    userHasAnyPermission: mockUserHasAnyPermission
}));

// The caller's RBAC identity; tests change it per case.
const identity: { roles: string[]; permissions: string[]; isAdmin: boolean } = {
    roles: ["admin"], permissions: [], isAdmin: true,
};
const mockValidateQueryAccess = mock();
// Tables the non-admin caller's data access rules allow, as "database.table".
const allowedTables = new Set<string>();
const mockFilterTables = mock(async (_userId: string | undefined, _isAdmin: boolean | undefined, database: string, tables: string[]) =>
    tables.filter((table) => allowedTables.has(`${database}.${table}`)));

mock.module("../middleware/dataAccess", () => ({
    optionalRbacMiddleware: mock(async (c, next) => {
        // Simulate RBAC context population
        if (c.req.header("Authorization")) {
            c.set("rbacUserId", "user1");
            c.set("rbacRoles", identity.roles);
            c.set("rbacPermissions", identity.permissions);
            c.set("isRbacAdmin", identity.isAdmin);
        }
        await next();
    }),
    validateQueryAccess: mockValidateQueryAccess,
    filterTables: mockFilterTables,
    accessDeniedError: (result: { reason?: string }) => AppError.forbidden(result.reason ?? "Access denied"),
}));

const mockListQueryHistory = mock();
mock.module("../services/queryHistory/store", () => ({
    listQueryHistory: mockListQueryHistory,
}));

import metricsRoutes from "./metrics";
import { errorHandler } from "../middleware/error";
import { AppError } from "../types";

const AUTH = { "Authorization": "Bearer token" };

function tableRow(database: string, table: string): { database: string; table: string } {
    return { database, table };
}

/** Make the caller a non-admin holding these permissions. */
function asViewer(permissions: string[] = ["metrics:view"]): void {
    identity.roles = ["viewer"];
    identity.permissions = permissions;
    identity.isAdmin = false;
}

describe("Metrics Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/metrics", metricsRoutes);

        mockGetSystemStats.mockClear();
        mockGetRecentQueries.mockClear();
        mockListQueryHistory.mockReset();
        mockValidateQueryAccess.mockReset();
        mockValidateQueryAccess.mockResolvedValue({ allowed: true, statementType: "select" });
        identity.roles = ["admin"];
        identity.permissions = [];
        identity.isAdmin = true;
        mockGetTopTablesBySize.mockReset();
        mockGetPartsPressure.mockReset();
        mockGetDdlImpact.mockReset();
        mockGetReplicationMetrics.mockReset();
        mockGetErrorMetrics.mockReset();
        mockGetProductionMetrics.mockReset();
        mockFilterTables.mockClear();
        allowedTables.clear();
        mockExecuteQuery.mockClear();
        mockClose.mockClear();

        mockPing.mockResolvedValue(true);
        mockClose.mockResolvedValue(undefined);
        mockGetVersion.mockResolvedValue("24.1");
        mockGetUserConnections.mockResolvedValue([{ id: "conn1", isActive: true, isDefault: true }]);
        mockGetConnectionWithPassword.mockResolvedValue({
            id: "conn1", host: "localhost", port: 8123, username: "default", password: "", sslEnabled: false
        });
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /metrics/stats", () => {
        it("should return system stats", async () => {
            mockGetSystemStats.mockResolvedValue({ uptime: 100 });

            const res = await app.request("/metrics/stats", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.uptime).toBe(100);
            expect(mockGetSystemStats).toHaveBeenCalled();
        });
    });

    describe("GET /metrics/recent-queries", () => {
        const asUser = (permissions: string[]): void => {
            identity.roles = ["analyst"];
            identity.permissions = permissions;
            identity.isAdmin = false;
        };
        const historyItem = (over: Record<string, unknown>) => ({
            id: "h1", query: "SELECT 1", connectionId: "conn1", connectionName: "c",
            executedAt: Date.UTC(2026, 10, 11, 9, 0, 0), durationMs: 12, rows: 1, status: "success", ...over,
        });
        const get = (qs = "") => app.request(`/metrics/recent-queries${qs}`, { headers: { "Authorization": "Bearer token" } });

        it("gives admins everyone's queries from query_log", async () => {
            mockGetRecentQueries.mockResolvedValue([{ query: "SELECT 2", duration: 1, status: "Success", time: "2026-11-11 09:00:00" }]);

            const res = await get();

            expect(res.status).toBe(200);
            expect(mockGetRecentQueries).toHaveBeenCalledWith(10, undefined);
            expect(mockListQueryHistory).not.toHaveBeenCalled();
            expect((await res.json()).data).toHaveLength(1);
        });

        it("gives query:history:view:all holders everyone's queries and keeps username as a narrowing filter", async () => {
            asUser(["metrics:view", "query:history:view", "query:history:view:all"]);
            mockGetRecentQueries.mockResolvedValue([]);

            const res = await get("?limit=5&username=etl");

            expect(res.status).toBe(200);
            expect(mockGetRecentQueries).toHaveBeenCalledWith(5, "etl");
        });

        it("gives other users only their own CHouse queries on this connection, never query_log", async () => {
            asUser(["metrics:view", "query:history:view"]);
            mockListQueryHistory.mockResolvedValue([
                historyItem({ id: "a", query: "SELECT a", status: "success" }),
                historyItem({ id: "b", query: "SELECT b", connectionId: "other-conn" }),
                historyItem({ id: "c", query: "SELECT c", status: "error" }),
                historyItem({ id: "d", query: "SELECT d", status: "cancelled" }),
                historyItem({ id: "e", query: "SELECT e", connectionId: null }),
            ]);

            const res = await get();
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(mockGetRecentQueries).not.toHaveBeenCalled();
            expect(mockListQueryHistory).toHaveBeenCalledWith("user1", 100);
            expect(body.data).toEqual([
                { query: "SELECT a", duration: 12, status: "Success", time: "2026-11-11T09:00:00.000Z" },
                { query: "SELECT c", duration: 12, status: "Error", time: "2026-11-11T09:00:00.000Z" },
                { query: "SELECT d", duration: 12, status: "Error", time: "2026-11-11T09:00:00.000Z" },
            ]);
        });

        it("applies the limit after keeping only this connection's queries", async () => {
            asUser(["metrics:view", "query:history:view"]);
            mockListQueryHistory.mockResolvedValue([
                historyItem({ id: "x", connectionId: "other-conn" }),
                historyItem({ id: "a", query: "SELECT a" }),
                historyItem({ id: "b", query: "SELECT b" }),
            ]);

            const body = await (await get("?limit=1")).json();

            expect(body.data.map((q: { query: string }) => q.query)).toEqual(["SELECT a"]);
        });

        it("cannot be widened with username: a different ClickHouse user matches nothing", async () => {
            asUser(["metrics:view", "query:history:view"]);
            mockListQueryHistory.mockResolvedValue([historyItem({})]);

            const other = await (await get("?username=etl")).json();
            const same = await (await get("?username=default")).json();

            expect(other.data).toEqual([]);
            expect(same.data).toHaveLength(1);
            expect(mockGetRecentQueries).not.toHaveBeenCalled();
        });

        it("returns an empty list without query:history:view", async () => {
            asUser(["metrics:view"]);
            mockListQueryHistory.mockResolvedValue([historyItem({})]);

            const res = await get();

            expect(res.status).toBe(200);
            expect((await res.json()).data).toEqual([]);
            expect(mockListQueryHistory).not.toHaveBeenCalled();
            expect(mockGetRecentQueries).not.toHaveBeenCalled();
        });

        it("bounds limit to 1..100 and falls back to 10 for junk", async () => {
            mockGetRecentQueries.mockResolvedValue([]);

            await get("?limit=abc");
            await get("?limit=-4");
            await get("?limit=5000");

            expect(mockGetRecentQueries.mock.calls.map((call) => call[0])).toEqual([10, 1, 100]);
        });
    });

    describe("GET /metrics/top-tables", () => {
        it("should return top tables by size (non-system only)", async () => {
            mockGetTopTablesBySize.mockResolvedValue([
                { database: "default", table: "viz_test", rows: 1000, bytes_on_disk: 4096, compressed_size: "4.00 KiB", parts_count: 0 }
            ]);

            const res = await app.request("/metrics/top-tables?limit=5", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data).toHaveLength(1);
            expect(body.data[0].database).toBe("default");
            expect(body.data[0].table).toBe("viz_test");
            expect(body.data[0].parts_count).toBe(0);
            expect(mockGetTopTablesBySize).toHaveBeenCalledWith(5);
        });

        it("gives a non-admin only the tables their data access rules allow", async () => {
            asViewer();
            allowedTables.add("pub.events");
            mockGetTopTablesBySize.mockResolvedValue([tableRow("finance", "salaries"), tableRow("pub", "events"), tableRow("hr", "people")]);

            const res = await app.request("/metrics/top-tables?limit=5", { headers: AUTH });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.map((t: { database: string; table: string }) => `${t.database}.${t.table}`)).toEqual(["pub.events"]);
            expect(JSON.stringify(body)).not.toContain("salaries");
        });

        it("applies the limit after filtering, from a scan wider than the page", async () => {
            asViewer();
            for (let i = 0; i < 6; i++) allowedTables.add(`pub.t${i}`);
            mockGetTopTablesBySize.mockResolvedValue([
                tableRow("finance", "a"), tableRow("finance", "b"), tableRow("finance", "c"),
                ...Array.from({ length: 6 }, (_v, i) => tableRow("pub", `t${i}`)),
            ]);

            const res = await app.request("/metrics/top-tables?limit=2", { headers: AUTH });

            const body = await res.json();
            expect(body.data.map((t: { table: string }) => t.table)).toEqual(["t0", "t1"]);
            expect(mockGetTopTablesBySize).toHaveBeenCalledWith(1000);
        });

        it("falls back to 10 for a junk limit", async () => {
            mockGetTopTablesBySize.mockResolvedValue([]);
            for (const limit of ["abc", "0", "-3"]) {
                await app.request(`/metrics/top-tables?limit=${limit}`, { headers: AUTH });
            }
            expect(mockGetTopTablesBySize.mock.calls.map((call) => call[0])).toEqual([10, 10, 10]);
        });
    });

    describe("table names on other monitoring routes", () => {
        it("filters /metrics/replication for a non-admin and not for an admin", async () => {
            mockGetReplicationMetrics.mockResolvedValue([tableRow("finance", "salaries"), tableRow("pub", "events")]);

            const admin = await (await app.request("/metrics/replication", { headers: AUTH })).json();
            expect(admin.data).toHaveLength(2);

            asViewer();
            allowedTables.add("pub.events");
            const viewer = await (await app.request("/metrics/replication", { headers: AUTH })).json();
            expect(viewer.data).toEqual([tableRow("pub", "events")]);
        });

        it("filters /metrics/parts-pressure for a non-admin", async () => {
            asViewer();
            allowedTables.add("pub.events");
            mockGetPartsPressure.mockResolvedValue([tableRow("finance", "salaries"), tableRow("pub", "events")]);

            const body = await (await app.request("/metrics/parts-pressure", { headers: AUTH })).json();

            expect(body.data).toEqual([tableRow("pub", "events")]);
        });

        it("filters the table lists inside /metrics/production for a non-admin", async () => {
            asViewer();
            allowedTables.add("pub.events");
            mockGetProductionMetrics.mockResolvedValue({
                replication: [tableRow("finance", "salaries"), tableRow("pub", "events")],
                topTables: [tableRow("finance", "salaries")],
                errors: [{ exception_code: 60, exception_name: "UNKNOWN_TABLE", count: 1, sample_error: "Table finance.salaries does not exist", last_occurred: "" }],
                latency: { p50: 1 },
            });
            mockGetTopTablesBySize.mockResolvedValue([tableRow("finance", "salaries"), tableRow("pub", "events")]);

            const body = await (await app.request("/metrics/production", { headers: AUTH })).json();

            expect(body.data.replication).toEqual([tableRow("pub", "events")]);
            expect(body.data.topTables).toEqual([tableRow("pub", "events")]);
            expect(body.data.errors[0].sample_error).toBe("");
            expect(body.data.latency).toEqual({ p50: 1 });
            expect(JSON.stringify(body)).not.toContain("salaries");
        });

        it("returns /metrics/production untouched to an admin", async () => {
            const metrics = { replication: [tableRow("finance", "salaries")], topTables: [tableRow("finance", "salaries")], errors: [] };
            mockGetProductionMetrics.mockResolvedValue(metrics);

            const body = await (await app.request("/metrics/production", { headers: AUTH })).json();

            expect(body.data).toEqual(metrics);
            expect(mockFilterTables).not.toHaveBeenCalled();
        });
    });

    describe("GET /metrics/errors", () => {
        const errors = [{ exception_code: 60, exception_name: "UNKNOWN_TABLE", count: 3, sample_error: "Table finance.salaries does not exist", last_occurred: "" }];

        it("keeps the sample error text for admins and query:history:view:all holders", async () => {
            mockGetErrorMetrics.mockResolvedValue(errors);
            expect((await (await app.request("/metrics/errors", { headers: AUTH })).json()).data).toEqual(errors);

            asViewer(["metrics:view", "query:history:view:all"]);
            expect((await (await app.request("/metrics/errors", { headers: AUTH })).json()).data).toEqual(errors);
        });

        it("blanks the sample error text for everyone else and keeps the counts", async () => {
            asViewer();
            mockGetErrorMetrics.mockResolvedValue(errors);

            const body = await (await app.request("/metrics/errors", { headers: AUTH })).json();

            expect(body.data).toEqual([{ ...errors[0], sample_error: "" }]);
        });
    });

    describe("POST /metrics/ddl/simulate", () => {
        const simulate = (statement: string): Promise<Response> => app.request("/metrics/ddl/simulate", {
            method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, body: JSON.stringify({ statement }),
        });

        it("checks the exact count it will run against the caller's data access rules", async () => {
            asViewer();
            mockGetDdlImpact.mockResolvedValue({ affected_rows: 1 });

            const res = await simulate("ALTER TABLE finance.salaries DELETE WHERE amount > 10");

            expect(res.status).toBe(200);
            expect(mockValidateQueryAccess).toHaveBeenCalledWith({
                userId: "user1", isAdmin: false, permissions: ["metrics:view"],
                sql: "SELECT count() AS c FROM `finance`.`salaries` WHERE amount > 10 SETTINGS max_execution_time = 15",
                connectionId: "conn1",
            });
        });

        it("refuses a table the rules deny, without counting anything", async () => {
            asViewer();
            mockValidateQueryAccess.mockResolvedValue({ allowed: false, code: "TABLE_DENIED", reason: "Access denied to finance.salaries", status: 403 });

            const res = await simulate("ALTER TABLE finance.salaries DELETE WHERE amount > 10");

            expect(res.status).toBe(403);
            expect(mockGetDdlImpact).not.toHaveBeenCalled();
        });

        it("checks a predicate that reads another table as part of the same statement", async () => {
            asViewer();
            mockValidateQueryAccess.mockResolvedValue({ allowed: false, code: "TABLE_DENIED", reason: "Access denied to finance.salaries", status: 403 });

            const res = await simulate("ALTER TABLE pub.events DELETE WHERE id IN (SELECT id FROM finance.salaries)");

            expect(res.status).toBe(403);
            expect(mockValidateQueryAccess.mock.calls[0][0].sql).toContain("FROM `pub`.`events` WHERE id IN (SELECT id FROM finance.salaries)");
            expect(mockGetDdlImpact).not.toHaveBeenCalled();
        });

        it("resolves an unqualified table against the connection's default database before checking", async () => {
            asViewer();
            mockGetDdlImpact.mockResolvedValue({ affected_rows: 0 });

            await simulate("ALTER TABLE events UPDATE a = 1 WHERE 1");

            expect(mockValidateQueryAccess.mock.calls[0][0].sql).toBe("SELECT count() AS c FROM `default`.`events` WHERE 1 SETTINGS max_execution_time = 15");
        });

        it("refuses a predicate that ClickHouse parses as something other than a SELECT", async () => {
            mockValidateQueryAccess.mockResolvedValue({ allowed: true, statementType: "insert" });

            const res = await simulate("ALTER TABLE pub.events DELETE WHERE 1");

            expect(res.status).toBe(400);
            expect(mockGetDdlImpact).not.toHaveBeenCalled();
        });

        it("still rejects anything that is not an UPDATE or DELETE mutation", async () => {
            const res = await simulate("DROP TABLE pub.events");

            expect(res.status).toBe(400);
            expect(mockValidateQueryAccess).not.toHaveBeenCalled();
        });
    });

    describe("GET /metrics/custom", () => {
        it("should execute custom query", async () => {
            mockExecuteQuery.mockResolvedValue({ data: [] });

            const res = await app.request("/metrics/custom?query=SELECT 1", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockExecuteQuery).toHaveBeenCalledWith("SELECT 1");
        });

        it("checks the exact SQL against the caller's data access rules", async () => {
            identity.roles = ["viewer"];
            identity.permissions = ["metrics:view"];
            identity.isAdmin = false;
            mockExecuteQuery.mockResolvedValue({ data: [] });

            const res = await app.request("/metrics/custom?query=" + encodeURIComponent("SELECT * FROM finance.salaries"), {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockValidateQueryAccess).toHaveBeenCalledWith({
                userId: "user1", isAdmin: false, permissions: ["metrics:view"],
                sql: "SELECT * FROM finance.salaries", connectionId: "conn1",
            });
        });

        it("refuses a SELECT the data access rules deny, without running it", async () => {
            identity.roles = ["viewer"];
            identity.permissions = ["metrics:view"];
            identity.isAdmin = false;
            mockValidateQueryAccess.mockResolvedValue({ allowed: false, code: "TABLE_DENIED", reason: "Access denied to finance.salaries", status: 403 });

            const res = await app.request("/metrics/custom?query=" + encodeURIComponent("SELECT * FROM finance.salaries"), {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(403);
            expect(mockExecuteQuery).not.toHaveBeenCalled();
        });

        it("refuses a statement ClickHouse parses as something other than SELECT", async () => {
            mockValidateQueryAccess.mockResolvedValue({ allowed: true, statementType: "insert" });

            const res = await app.request("/metrics/custom?query=" + encodeURIComponent("SELECT 1 INTO x"), {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(400);
            expect(mockExecuteQuery).not.toHaveBeenCalled();
        });

        it("should reject non-SELECT queries", async () => {
            const res = await app.request("/metrics/custom?query=DROP TABLE t1", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(400);
            expect(mockValidateQueryAccess).not.toHaveBeenCalled();
        });
    });
});
