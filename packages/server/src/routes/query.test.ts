
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock Dependencies
const mockExecuteQuery = mock();
const mockGetIntellisenseData = mock();
const mockClose = mock();
const mockPing = mock();
const mockCheckIsAdmin = mock();
const mockGetVersion = mock();

class MockClickHouseService {
    executeQuery = mockExecuteQuery;
    getIntellisenseData = mockGetIntellisenseData;
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
                session: {
                    id: "valid-session",
                    rbacUserId: "user1",
                    rbacConnectionId: "conn1",
                    connectionConfig: { database: "default" }
                },
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
const mockCreateAuditLog = mock();

mock.module("../rbac/services/rbac", () => ({
    userHasPermission: mockUserHasPermission,
    createAuditLog: mockCreateAuditLog
}));

const mockValidateQueryAccess = mock();

mock.module("../middleware/dataAccess", () => ({
    optionalRbacMiddleware: mock(async (c, next) => {
        // Simulate RBAC context population
        if (c.req.header("Authorization")) {
            c.set("rbacUserId", "user1");
            c.set("rbacRoles", ["admin"]); // Admin bypasses some checks
            c.set("rbacPermissions", ["query:execute", "table:select"]);
            c.set("isRbacAdmin", true);
        }
        await next();
    }),
    validateQueryAccess: mockValidateQueryAccess
}));

import queryRoutes from "./query";
import { errorHandler } from "../middleware/error";

describe("Query Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/query", queryRoutes);

        mockExecuteQuery.mockClear();
        mockGetIntellisenseData.mockClear();
        mockClose.mockClear();
        mockPing.mockClear();
        mockCreateAuditLog.mockClear();
        mockValidateQueryAccess.mockClear();

        mockPing.mockResolvedValue(true);
        mockClose.mockResolvedValue(undefined);
        mockCheckIsAdmin.mockResolvedValue({ isAdmin: false, permissions: [] });
        mockGetVersion.mockResolvedValue("24.1");
        mockGetUserConnections.mockResolvedValue([{ id: "conn1", isActive: true, isDefault: true }]);
        mockGetConnectionWithPassword.mockResolvedValue({
            id: "conn1", host: "localhost", port: 8123, username: "default", password: "", sslEnabled: false
        });

        // Default allow access
        mockValidateQueryAccess.mockResolvedValue({ allowed: true });
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /query/intellisense", () => {
        it("should return intellisense data", async () => {
            mockGetIntellisenseData.mockResolvedValue({ columns: [] });

            const res = await app.request("/query/intellisense", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockGetIntellisenseData).toHaveBeenCalled();
        });
    });

    describe("POST /query/table/select", () => {
        it("should execute SELECT query", async () => {
            mockExecuteQuery.mockResolvedValue({ data: [] });

            const res = await app.request("/query/table/select", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ query: "SELECT * FROM t1 WHERE id = 1" })
            });

            expect(res.status).toBe(200);
            expect(mockExecuteQuery).toHaveBeenCalledWith("SELECT * FROM t1 WHERE id = 1", "JSON", undefined);
            expect(mockCreateAuditLog).toHaveBeenCalled();
        });

        it("should reject invalid query types", async () => {
            const res = await app.request("/query/table/select", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ query: "DROP TABLE t1" })
            });

            expect(res.status).toBe(400);
        });

        it("should forbid if access validation fails", async () => {
            mockValidateQueryAccess.mockResolvedValue({ allowed: false, reason: "Restricted table" });

            const res = await app.request("/query/table/select", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ query: "SELECT * FROM output" })
            });

            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error.message).toBe("Restricted table");
        });
    });

    describe("POST /query/table/create", () => {
        it("should execute CREATE TABLE query", async () => {
            mockExecuteQuery.mockResolvedValue({});

            const res = await app.request("/query/table/create", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ query: "CREATE TABLE t1 (id Int) ENGINE=Log" })
            });

            expect(res.status).toBe(200);
            expect(mockExecuteQuery).toHaveBeenCalled();
            expect(mockCreateAuditLog).toHaveBeenCalled();
        });

        it("should reject CREATE DATABASE queries", async () => {
            const res = await app.request("/query/table/create", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ query: "CREATE DATABASE db1" })
            });

            expect(res.status).toBe(400);
        });
    });
});
