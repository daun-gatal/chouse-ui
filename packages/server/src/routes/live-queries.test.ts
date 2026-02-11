/**
 * Tests for Live Queries routes
 */

import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

const mockExecuteQuery = mock();
const mockClose = mock();
const mockPing = mock();

class MockClickHouseService {
    executeQuery = mockExecuteQuery;
    close = mockClose;
    ping = mockPing;
}

mock.module("../services/clickhouse", () => ({
    ClickHouseService: MockClickHouseService,
    getSession: mock((id: string) => {
        if (id === "valid-session") {
            return {
                session: { id: "valid-session", rbacUserId: "user1", rbacConnectionId: "conn1" },
                service: new MockClickHouseService(),
            };
        }
        return null;
    }),
}));

const mockGetUserConnections = mock();
const mockGetConnectionWithPassword = mock();

mock.module("../rbac/services/connections", () => ({
    getUserConnections: mockGetUserConnections,
    getConnectionWithPassword: mockGetConnectionWithPassword,
    listConnections: mock(() => Promise.resolve({ connections: [] })),
}));

const mockUserHasPermission = mock();

mock.module("../rbac/services/rbac", () => ({
    userHasPermission: mockUserHasPermission,
    createAuditLog: mock(() => Promise.resolve()),
    getUserById: mock((id: string) => {
        if (id === "user1") return Promise.resolve({ username: "alice" });
        return Promise.resolve(null);
    }),
}));

mock.module("../middleware/dataAccess", () => ({
    optionalRbacMiddleware: mock(async (c: any, next: () => Promise<void>) => {
        if (c.req.header("Authorization")) {
            c.set("rbacUserId", "user1");
            c.set("rbacRoles", ["admin"]);
            c.set("rbacPermissions", ["live_queries:view", "live_queries:kill"]);
            c.set("isRbacAdmin", false);
        }
        await next();
    }),
}));

mock.module("../rbac/middleware/rbacAuth", () => ({
    getClientIp: mock(() => "127.0.0.1"),
}));

import liveQueriesRoutes from "./live-queries";
import { errorHandler } from "../middleware/error";

describe("Live Queries Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/live-queries", liveQueriesRoutes);

        mockExecuteQuery.mockReset();
        mockClose.mockClear();
        mockPing.mockResolvedValue(true);
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /live-queries", () => {
        it("should return running queries from system.processes", async () => {
            mockExecuteQuery.mockResolvedValueOnce({
                data: [
                    {
                        query_id: "query-123",
                        user: "default",
                        query: "SELECT 1",
                        elapsed_seconds: 5,
                        read_rows: 100,
                        read_bytes: 1024,
                        memory_usage: 4096,
                        is_initial_query: 1,
                        client_name: "client",
                        log_comment_json: JSON.stringify({ rbac_user_id: "user1" }),
                    },
                ],
                meta: [],
                statistics: {},
                rows: 1,
            });

            const res = await app.request("/live-queries", {
                method: "GET",
                headers: {
                    Authorization: "Bearer token",
                    "X-Session-ID": "valid-session",
                    "X-Requested-With": "XMLHttpRequest",
                },
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data).toHaveProperty("queries");
            expect(body.data).toHaveProperty("total");
            expect(body.data.queries).toHaveLength(1);
            expect(body.data.queries[0].query_id).toBe("query-123");
            expect(body.data.queries[0].query).toBe("SELECT 1");
            expect(body.data.queries[0].rbac_user).toBe("alice");
            expect(body.data.total).toBe(1);
        });

        it("should return empty list when no running queries", async () => {
            mockExecuteQuery.mockResolvedValueOnce({ data: [], meta: [], statistics: {}, rows: 0 });

            const res = await app.request("/live-queries", {
                method: "GET",
                headers: {
                    Authorization: "Bearer token",
                    "X-Session-ID": "valid-session",
                    "X-Requested-With": "XMLHttpRequest",
                },
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.queries).toEqual([]);
            expect(body.data.total).toBe(0);
        });
    });

    describe("POST /live-queries/kill", () => {
        it("should kill query and return success", async () => {
            mockExecuteQuery
                .mockResolvedValueOnce({
                    data: [
                        {
                            query_id: "query-456",
                            user: "default",
                            query: "SELECT sleep(10)",
                            elapsed_seconds: 2,
                        },
                    ],
                    meta: [],
                    statistics: {},
                    rows: 1,
                })
                .mockResolvedValueOnce({ data: [], meta: [], statistics: {}, rows: 0 });

            const res = await app.request("/live-queries/kill", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer token",
                    "X-Session-ID": "valid-session",
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: JSON.stringify({ queryId: "query-456" }),
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.message).toContain("killed");
            expect(body.data.queryId).toBe("query-456");
            expect(mockExecuteQuery).toHaveBeenCalledTimes(2); // check + KILL QUERY
        });

        it("should reject when queryId is missing", async () => {
            const res = await app.request("/live-queries/kill", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer token",
                    "X-Session-ID": "valid-session",
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });
    });
});
