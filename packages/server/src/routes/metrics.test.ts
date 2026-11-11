
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
    accessDeniedError: (result: { reason?: string }) => AppError.forbidden(result.reason ?? "Access denied"),
}));

const mockListQueryHistory = mock();
mock.module("../services/queryHistory/store", () => ({
    listQueryHistory: mockListQueryHistory,
}));

import metricsRoutes from "./metrics";
import { errorHandler } from "../middleware/error";
import { AppError } from "../types";

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
        mockGetTopTablesBySize.mockClear();
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
