
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
    getDefaultConnection: mockGetDefaultConnection,
    testConnection: mockTestConnection,
    testSavedConnection: mockTestSavedConnection,
    listConnectionDatabases: mock(),
    listConnectionTables: mock(),
}));

const mockUserHasPermission = mock();
const mockUserHasAnyPermission = mock();
const mockUserHasAllPermissions = mock();

mock.module("../services/rbac", () => ({
    createAuditLog: mockCreateAuditLog,
    userHasPermission: mockUserHasPermission,
    userHasAnyPermission: mockUserHasAnyPermission,
    userHasAllPermissions: mockUserHasAllPermissions,
}));

// Mock ClickHouse Service
const mockCHInstance = {
    ping: mock(),
    close: mock(),
    getVersion: mock(),
    checkIsAdmin: mock()
};
const mockClickHouseService = mock().mockImplementation(() => mockCHInstance);

// ADR 0010: there is no session map to mock any more.
mock.module("../../services/clickhouse", () => ({
    ClickHouseService: mockClickHouseService,
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
import { errorHandler } from "../../middleware/error";

const PRIVILEGES_OK = { ok: true, username: "default", database: "default", missingCount: 0, features: [], grantScript: "" };
const PASSING_TEST = { success: true, version: "26.5", databases: ["default"], latencyMs: 5, privileges: PRIVILEGES_OK };
const PRIVILEGES_MISSING = {
    ok: false,
    username: "reader",
    database: "analytics",
    missingCount: 1,
    features: [{ id: "query_control", name: "Query control", description: "Kill running queries", status: "missing", missing: ["KILL QUERY ON *.*"], unavailable: [], errors: [], grants: ["GRANT KILL QUERY ON *.* TO reader;"] }],
    grantScript: "GRANT KILL QUERY ON *.* TO reader;",
};
const SAVED_PUBLIC = {
    id: "c1", name: "prod", host: "ch.internal", port: 8443, username: "reader",
    database: "analytics", sslEnabled: true, isActive: true, isDefault: false,
};
const SAVED = { ...SAVED_PUBLIC, password: "s3cret" };

function jsonRequest(method: string, body: unknown): RequestInit {
    return { method, headers: { "Content-Type": "application/json", "Authorization": "Bearer token" }, body: JSON.stringify(body) };
}

describe("RBAC Connections Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler); // Handle AppError exceptions properly
        app.route("/connections", connectionsRoutes);

        // Reset mocks & state
        mockListConnections.mockClear();
        mockGetConnectionById.mockClear();
        mockCreateConnection.mockClear();
        mockUpdateConnection.mockClear();
        mockDeleteConnection.mockClear();
        mockGetUserConnections.mockClear();
        mockGetConnectionWithPassword.mockReset();
        mockGetConnectionById.mockReset();
        mockCreateAuditLog.mockClear();
        mockCHInstance.ping.mockClear();
        mockCHInstance.close.mockClear();
        mockClickHouseService.mockClear();
        mockUserHasPermission.mockClear();
        mockUserHasAnyPermission.mockClear();
        mockUserHasAllPermissions.mockClear();
        mockTestConnection.mockReset();
        mockTestConnection.mockResolvedValue(PASSING_TEST);

        // Default: Super Admin
        mockTokenPayload = {
            sub: 'admin-id',
            roles: ['super_admin'],
            permissions: ['settings:view'],
            sessionId: 'sess-1'
        };

        // Mock permission checks to use token permissions by default
        // This prevents database access during tests
        mockUserHasPermission.mockImplementation(async (userId: string, permission: string) => {
            return mockTokenPayload.permissions.includes(permission);
        });
        mockUserHasAnyPermission.mockImplementation(async (userId: string, permissions: string[]) => {
            return permissions.some(p => mockTokenPayload.permissions.includes(p));
        });
        mockUserHasAllPermissions.mockImplementation(async (userId: string, permissions: string[]) => {
            return permissions.every(p => mockTokenPayload.permissions.includes(p));
        });
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /connections", () => {
        it("should list connections for user with permission", async () => {
            mockTokenPayload.permissions = ['connections:view'];
            mockListConnections.mockResolvedValue({ connections: [], total: 0 });

            const res = await app.request("/connections", { headers: { "Authorization": "Bearer token" } });
            expect(res.status).toBe(200);
            expect(mockListConnections).toHaveBeenCalled();
        });

        it("should deny list for user without permission", async () => {
            mockTokenPayload.roles = ['user'];
            mockTokenPayload.permissions = []; // No permissions

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
        it("should create connection with permission", async () => {
            mockTokenPayload.permissions = ['connections:edit'];
            mockCreateConnection.mockResolvedValue({ id: "c1", name: "test", host: "localhost" });

            const res = await app.request("/connections", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ name: "test", host: "localhost", username: "default" })
            });

            expect(res.status).toBe(201);
            expect(mockCreateConnection).toHaveBeenCalled();
        });

        it("should deny create without permission", async () => {
            mockTokenPayload.roles = ['user'];
            mockTokenPayload.permissions = [];

            const res = await app.request("/connections", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ name: "test", host: "localhost", username: "default" })
            });

            expect(res.status).toBe(403);
            expect(mockCreateConnection).not.toHaveBeenCalled();
        });

        it("checks the connection before saving it", async () => {
            mockTokenPayload.permissions = ['connections:edit'];
            mockCreateConnection.mockResolvedValue({ id: "c1", name: "test", host: "localhost" });

            const res = await app.request("/connections", jsonRequest("POST", { name: "test", host: "localhost", username: "default", password: "pw", database: "analytics" }));

            expect(res.status).toBe(201);
            expect(mockTestConnection).toHaveBeenCalledWith(expect.objectContaining({ host: "localhost", username: "default", password: "pw", database: "analytics" }));
        });

        it("refuses to save a connection whose login fails", async () => {
            mockTokenPayload.permissions = ['connections:edit'];
            mockTestConnection.mockResolvedValue({ success: false, error: "Authentication failed" });

            const res = await app.request("/connections", jsonRequest("POST", { name: "test", host: "localhost", username: "default" }));

            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error).toEqual({ code: "CONNECTION_TEST_FAILED", message: "Authentication failed" });
            expect(mockCreateConnection).not.toHaveBeenCalled();
        });

        it("refuses to save a connection whose user lacks privileges, returning the report", async () => {
            mockTokenPayload.permissions = ['connections:edit'];
            mockTestConnection.mockResolvedValue({ ...PASSING_TEST, privileges: PRIVILEGES_MISSING });

            const res = await app.request("/connections", jsonRequest("POST", { name: "test", host: "localhost", username: "reader" }));

            expect(res.status).toBe(422);
            const body = await res.json();
            expect(body.error.code).toBe("PRIVILEGES_MISSING");
            expect(body.error.message).toBe("reader is missing 1 privilege across 1 feature. Run as an admin, then save again:\nGRANT KILL QUERY ON *.* TO reader;");
            expect(body.error.details.privileges).toEqual(PRIVILEGES_MISSING);
            expect(mockCreateConnection).not.toHaveBeenCalled();
            expect(mockCreateAuditLog).not.toHaveBeenCalled();
        });
    });

    describe("PATCH /connections/:id", () => {
        beforeEach(() => {
            mockTokenPayload.permissions = ['connections:edit'];
            mockGetConnectionById.mockResolvedValue(SAVED_PUBLIC);
            mockGetConnectionWithPassword.mockResolvedValue({ ...SAVED });
            mockUpdateConnection.mockResolvedValue(SAVED_PUBLIC);
        });

        it("saves a rename or an unchanged form without re-checking", async () => {
            const res = await app.request("/connections/c1", jsonRequest("PATCH", {
                name: "renamed", host: SAVED.host, port: SAVED.port, username: SAVED.username, database: SAVED.database, sslEnabled: true,
            }));

            expect(res.status).toBe(200);
            expect(mockTestConnection).not.toHaveBeenCalled();
            expect(mockGetConnectionWithPassword).not.toHaveBeenCalled();
            expect(mockUpdateConnection).toHaveBeenCalled();
        });

        it("still renames a connection whose saved password can't be decrypted", async () => {
            mockGetConnectionWithPassword.mockRejectedValue(new Error("Failed to decrypt password"));
            const res = await app.request("/connections/c1", jsonRequest("PATCH", { name: "renamed" }));
            expect(res.status).toBe(200);
        });

        it("asks for the password again when the saved one can't be decrypted", async () => {
            mockGetConnectionWithPassword.mockRejectedValue(new Error("Failed to decrypt password"));

            const res = await app.request("/connections/c1", jsonRequest("PATCH", { username: "writer" }));

            expect(res.status).toBe(400);
            expect((await res.json()).error.code).toBe("PASSWORD_REQUIRED");
            expect(mockUpdateConnection).not.toHaveBeenCalled();

            const retyped = await app.request("/connections/c1", jsonRequest("PATCH", { password: "typed-again" }));
            expect(retyped.status).toBe(200);
            expect(mockTestConnection).toHaveBeenLastCalledWith(expect.objectContaining({ password: "typed-again" }));
        });

        it("never sends the saved password to another host, port or over plain HTTP", async () => {
            for (const change of [{ host: "other.internal" }, { port: 9440 }, { sslEnabled: false }]) {
                const res = await app.request("/connections/c1", jsonRequest("PATCH", change));
                expect(res.status).toBe(400);
                expect((await res.json()).error).toEqual({
                    code: "PASSWORD_REQUIRED",
                    message: "Enter the password again to use it with a different host, port or protocol.",
                });
            }
            expect(mockTestConnection).not.toHaveBeenCalled();
            expect(mockUpdateConnection).not.toHaveBeenCalled();
        });

        it("moves a connection to another host once the password is given", async () => {
            const res = await app.request("/connections/c1", jsonRequest("PATCH", { host: "other.internal", password: "s3cret" }));
            expect(res.status).toBe(200);
            expect(mockTestConnection).toHaveBeenCalledWith(expect.objectContaining({ host: "other.internal", password: "s3cret" }));
        });

        it("moves a connection without a saved password without asking for one", async () => {
            mockGetConnectionWithPassword.mockResolvedValue({ ...SAVED, password: null });
            const res = await app.request("/connections/c1", jsonRequest("PATCH", { host: "other.internal" }));
            expect(res.status).toBe(200);
            expect(mockTestConnection).toHaveBeenCalledWith(expect.objectContaining({ host: "other.internal", password: undefined }));
        });

        it("doesn't check when only toggling active", async () => {
            const res = await app.request("/connections/c1", jsonRequest("PATCH", { isActive: false }));
            expect(res.status).toBe(200);
            expect(mockTestConnection).not.toHaveBeenCalled();
        });

        it("re-checks a changed username with the saved password", async () => {
            const res = await app.request("/connections/c1", jsonRequest("PATCH", { username: "writer" }));

            expect(res.status).toBe(200);
            expect(mockTestConnection).toHaveBeenCalledWith(expect.objectContaining({
                host: SAVED.host, port: SAVED.port, username: "writer", password: "s3cret", database: "analytics", sslEnabled: true,
            }));
        });

        it("re-checks with a new password, and treats an empty one as clearing it", async () => {
            await app.request("/connections/c1", jsonRequest("PATCH", { password: "n3w" }));
            expect(mockTestConnection).toHaveBeenLastCalledWith(expect.objectContaining({ password: "n3w" }));

            await app.request("/connections/c1", jsonRequest("PATCH", { password: "" }));
            expect(mockTestConnection).toHaveBeenLastCalledWith(expect.objectContaining({ password: "" }));
        });

        it("re-checks when the default database changes, including clearing it", async () => {
            await app.request("/connections/c1", jsonRequest("PATCH", { database: null }));
            expect(mockTestConnection).toHaveBeenLastCalledWith(expect.objectContaining({ database: null }));
        });

        it("keeps the saved connection when the new settings lack privileges", async () => {
            mockTestConnection.mockResolvedValue({ ...PASSING_TEST, privileges: PRIVILEGES_MISSING });

            const res = await app.request("/connections/c1", jsonRequest("PATCH", { username: "reader2" }));

            expect(res.status).toBe(422);
            expect((await res.json()).error.code).toBe("PRIVILEGES_MISSING");
            expect(mockUpdateConnection).not.toHaveBeenCalled();
        });

        it("returns 404 for an unknown connection", async () => {
            mockGetConnectionById.mockResolvedValue(null);
            const res = await app.request("/connections/nope", jsonRequest("PATCH", { name: "x" }));
            expect(res.status).toBe(404);
            expect(mockUpdateConnection).not.toHaveBeenCalled();
        });
    });

    describe("POST /connections/test", () => {
        const form = { host: SAVED.host, port: SAVED.port, username: "reader", sslEnabled: true, database: "analytics" };

        it("passes a typed password straight through", async () => {
            const res = await app.request("/connections/test", jsonRequest("POST", { ...form, password: "typed", connectionId: "c1" }));

            expect(res.status).toBe(200);
            expect(mockGetConnectionWithPassword).not.toHaveBeenCalled();
            expect(mockTestConnection).toHaveBeenCalledWith(expect.objectContaining({ password: "typed" }));
            expect((await res.json()).data.privileges).toEqual(PRIVILEGES_OK);
        });

        beforeEach(() => {
            mockGetConnectionById.mockResolvedValue(SAVED_PUBLIC);
            mockGetConnectionWithPassword.mockResolvedValue({ ...SAVED });
        });

        it("uses the saved password for an editor testing the same host", async () => {
            mockTokenPayload.permissions = ['settings:view', 'connections:edit'];

            const res = await app.request("/connections/test", jsonRequest("POST", { ...form, password: "", connectionId: "c1" }));

            expect(res.status).toBe(200);
            expect(mockTestConnection).toHaveBeenCalledWith(expect.objectContaining({ password: "s3cret" }));
            expect(mockTestConnection.mock.calls[0][0]).not.toHaveProperty("connectionId");
        });

        it("never sends the saved password to a different host, port or over plain HTTP", async () => {
            mockTokenPayload.permissions = ['settings:view', 'connections:edit'];

            const otherHost = await app.request("/connections/test", jsonRequest("POST", { ...form, host: "evil.example", connectionId: "c1" }));
            const otherPort = await app.request("/connections/test", jsonRequest("POST", { ...form, port: 9999, connectionId: "c1" }));
            const plainHttp = await app.request("/connections/test", jsonRequest("POST", { ...form, sslEnabled: false, connectionId: "c1" }));

            expect(otherHost.status).toBe(400);
            expect((await otherHost.json()).error.code).toBe("PASSWORD_REQUIRED");
            expect(otherPort.status).toBe(400);
            expect(plainHttp.status).toBe(400);
            expect(mockTestConnection).not.toHaveBeenCalled();
        });

        it("asks for the password when the saved one can't be decrypted", async () => {
            mockTokenPayload.permissions = ['settings:view', 'connections:edit'];
            mockGetConnectionWithPassword.mockRejectedValue(new Error("Failed to decrypt password"));

            const res = await app.request("/connections/test", jsonRequest("POST", { ...form, connectionId: "c1" }));

            expect(res.status).toBe(400);
            expect((await res.json()).error.message).toBe("The saved password can't be read any more. Enter it again.");
        });

        it("hides saved connections from someone who can't edit them", async () => {
            mockTokenPayload.roles = ['user'];
            mockTokenPayload.permissions = ['settings:view'];

            const res = await app.request("/connections/test", jsonRequest("POST", { ...form, connectionId: "c1" }));

            expect(res.status).toBe(404);
            expect(mockGetConnectionWithPassword).not.toHaveBeenCalled();
            expect(mockTestConnection).not.toHaveBeenCalled();
        });

        it("returns 404 for an unknown connection id", async () => {
            mockTokenPayload.permissions = ['settings:view', 'connections:edit'];
            mockGetConnectionById.mockResolvedValue(null);
            const res = await app.request("/connections/test", jsonRequest("POST", { ...form, connectionId: "nope" }));
            expect(res.status).toBe(404);
        });
    });

    describe("POST /connections/:id/connect", () => {
        it("validates the connection and returns a correlation id (no server-side session)", async () => {
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
            // ADR 0010: connecting no longer mints pod-local state. It validates
            // the connection and returns an id the client correlates on; every
            // later request re-resolves from the database on any replica.
            const body = await res.json();
            expect(body.data.sessionId).toBeDefined();
            expect(body.data.connectionId).toBe("c1");
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
