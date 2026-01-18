
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock Services
const mockListConnections = mock();
const mockGetConnectionById = mock();
const mockCreateConnection = mock();
const mockUpdateConnection = mock();
const mockDeleteConnection = mock();
const mockGetUserConnections = mock();
const mockGetConnectionWithPassword = mock();
const mockCreateAuditLog = mock(async () => { });
const mockSetDefaultConnection = mock();
const mockGetDefaultConnection = mock();
const mockTestConnection = mock(); // used by /test
const mockTestSavedConnection = mock(); // used by /:id/test

mock.module("../services/connections", () => ({
    listConnections: mockListConnections,
    getConnectionById: mockGetConnectionById,
    createConnection: mockCreateConnection,
    updateConnection: mockUpdateConnection,
    deleteConnection: mockDeleteConnection,
    getUserConnections: mockGetUserConnections,
    getConnectionWithPassword: mockGetConnectionWithPassword,
    setDefaultConnection: mockSetDefaultConnection,
    getDefaultConnection: mockGetDefaultConnection,
    testConnection: mockTestConnection,
    testSavedConnection: mockTestSavedConnection,
    // Add missing ones if needed
    grantConnectionAccess: mock(),
    revokeConnectionAccess: mock(),
    getConnectionUsers: mock(),
}));

mock.module("../services/rbac", () => ({
    createAuditLog: mockCreateAuditLog,
}));

// Mock ClickHouse Service
const mockCHInstance = {
    ping: mock(),
    close: mock(),
    getVersion: mock(),
    checkIsAdmin: mock()
};
const mockClickHouseService = mock().mockImplementation(() => mockCHInstance);
const mockCreateSession = mock();
const mockDestroySession = mock();
const mockGetSession = mock();

mock.module("../../services/clickhouse", () => ({
    ClickHouseService: mockClickHouseService,
    createSession: mockCreateSession,
    destroySession: mockDestroySession,
    getSession: mockGetSession
}));

// Mock JWT Service
let mockTokenPayload = {
    sub: 'admin-id',
    roles: ['super_admin'],
    permissions: ['settings:view'],
    sessionId: 'sess-1'
};

mock.module("../services/jwt", () => ({
    verifyAccessToken: mock(async () => mockTokenPayload),
    extractTokenFromHeader: mock((h) => h ? "valid_token" : null),
    verifyRefreshToken: mock(async () => mockTokenPayload)
}));

import connectionsRoutes from "./connections";

describe("RBAC Connections Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        // We don't necessarily need errorHandler here if the routes return JSON explicitly on catch, 
        // but looking at connections.ts, it uses try-catch calling c.json(...) mostly.
        // It does not seem to throw AppError often, but returns JSON with error codes.
        // Except checking getUserConnections...
        // Let's assume standard behavior.
        app.route("/connections", connectionsRoutes);

        // Reset mocks & state
        mockListConnections.mockClear();
        mockGetConnectionById.mockClear();
        mockCreateConnection.mockClear();
        mockUpdateConnection.mockClear();
        mockDeleteConnection.mockClear();
        mockGetUserConnections.mockClear();
        mockGetConnectionWithPassword.mockClear();
        mockCreateAuditLog.mockClear();
        mockCHInstance.ping.mockClear();
        mockCHInstance.close.mockClear();
        mockCreateSession.mockClear();
        mockClickHouseService.mockClear();

        // Default: Super Admin
        mockTokenPayload = {
            sub: 'admin-id',
            roles: ['super_admin'],
            permissions: ['settings:view'],
            sessionId: 'sess-1'
        };
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /connections", () => {
        it("should list connections for super admin", async () => {
            mockListConnections.mockResolvedValue({ connections: [], total: 0 });

            const res = await app.request("/connections", { headers: { "Authorization": "Bearer token" } });
            expect(res.status).toBe(200);
            expect(mockListConnections).toHaveBeenCalled();
        });

        it("should deny list for non-super admin", async () => {
            mockTokenPayload.roles = ['user'];

            const res = await app.request("/connections", { headers: { "Authorization": "Bearer token" } });
            expect(res.status).toBe(403);
            expect(mockListConnections).not.toHaveBeenCalled();
        });
    });

    describe("GET /connections/my", () => {
        it("should return my connections", async () => {
            mockTokenPayload.roles = ['user'];
            mockGetUserConnections.mockResolvedValue([]);

            const res = await app.request("/connections/my", { headers: { "Authorization": "Bearer token" } });
            expect(res.status).toBe(200);
            expect(mockGetUserConnections).toHaveBeenCalledWith("admin-id");
        });
    });

    describe("POST /connections", () => {
        it("should create connection", async () => { // Super admin
            mockCreateConnection.mockResolvedValue({ id: "c1", name: "test", host: "localhost" });

            const res = await app.request("/connections", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ name: "test", host: "localhost", username: "default" })
            });

            expect(res.status).toBe(201);
            expect(mockCreateConnection).toHaveBeenCalled();
        });

        it("should deny create for non-super admin", async () => {
            mockTokenPayload.roles = ['user'];

            const res = await app.request("/connections", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ name: "test", host: "localhost", username: "default" })
            });

            expect(res.status).toBe(403);
            expect(mockCreateConnection).not.toHaveBeenCalled();
        });
    });

    describe("POST /connections/:id/connect", () => {
        it("should connect and create session", async () => {
            // Setup access
            // Super admin has access by default
            mockGetConnectionWithPassword.mockResolvedValue({
                id: "c1", isActive: true, host: "localhost", port: 8123, username: "default"
            });

            // Mock CH behavior
            mockCHInstance.ping.mockResolvedValue(true);
            mockCHInstance.getVersion.mockResolvedValue("23.8");
            mockCHInstance.checkIsAdmin.mockResolvedValue({ isAdmin: true, permissions: [] });

            const res = await app.request("/connections/c1/connect", {
                method: "POST",
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockClickHouseService).toHaveBeenCalled(); // Constructor called
            expect(mockCHInstance.ping).toHaveBeenCalled();
            expect(mockCreateSession).toHaveBeenCalled();
            const body = await res.json();
            expect(body.data.sessionId).toBeDefined();
        });

        it("should deny access if not assigned (non-superadmin)", async () => {
            mockTokenPayload.roles = ['user'];
            // Mock user connections list to NOT include c1
            mockGetUserConnections.mockResolvedValue([]);

            const res = await app.request("/connections/c1/connect", {
                method: "POST",
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(403);
            expect(mockClickHouseService).not.toHaveBeenCalled();
        });
    });
});
