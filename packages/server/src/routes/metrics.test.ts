
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
const mockCheckIsAdmin = mock();
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
    checkIsAdmin = mockCheckIsAdmin;
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

mock.module("../middleware/dataAccess", () => ({
    optionalRbacMiddleware: mock(async (c, next) => {
        // Simulate RBAC context population
        if (c.req.header("Authorization")) {
            c.set("rbacUserId", "user1");
            c.set("rbacRoles", ["admin"]); // Admin bypasses permission checks
            c.set("rbacPermissions", []);
            c.set("isRbacAdmin", true);
        }
        await next();
    })
}));

import metricsRoutes from "./metrics";
import { errorHandler } from "../middleware/error";

describe("Metrics Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/metrics", metricsRoutes);

        mockGetSystemStats.mockClear();
        mockGetRecentQueries.mockClear();
        mockGetTopTablesBySize.mockClear();
        mockExecuteQuery.mockClear();
        mockClose.mockClear();

        mockPing.mockResolvedValue(true);
        mockClose.mockResolvedValue(undefined);
        mockCheckIsAdmin.mockResolvedValue({ isAdmin: false, permissions: [] });
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
        it("should return recent queries", async () => {
            mockGetRecentQueries.mockResolvedValue([]);

            const res = await app.request("/metrics/recent-queries", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockGetRecentQueries).toHaveBeenCalled();
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

        it("should reject non-SELECT queries", async () => {
            const res = await app.request("/metrics/custom?query=DROP TABLE t1", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(400);
        });
    });
});
