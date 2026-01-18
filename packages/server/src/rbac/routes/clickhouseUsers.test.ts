
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock Services
const mockListClickHouseUsers = mock();
const mockGetClickHouseUser = mock();
const mockGetUserGrants = mock();
const mockCreateClickHouseUser = mock();
const mockUpdateClickHouseUser = mock();
const mockDeleteClickHouseUser = mock();
const mockGenerateUserDDL = mock();
const mockGenerateUpdateUserDDL = mock();
const mockSyncUnregisteredUsers = mock();
const mockCreateAuditLog = mock(async () => { });
const mockValidatePasswordStrength = mock();

mock.module("../services/clickhouseUsers", () => ({
    listClickHouseUsers: mockListClickHouseUsers,
    getClickHouseUser: mockGetClickHouseUser,
    getUserGrants: mockGetUserGrants,
    createClickHouseUser: mockCreateClickHouseUser,
    updateClickHouseUser: mockUpdateClickHouseUser,
    deleteClickHouseUser: mockDeleteClickHouseUser,
    generateUserDDL: mockGenerateUserDDL,
    generateUpdateUserDDL: mockGenerateUpdateUserDDL,
    syncUnregisteredUsers: mockSyncUnregisteredUsers
}));

mock.module("../services/rbac", () => ({
    createAuditLog: mockCreateAuditLog
}));

mock.module("../services/password", () => ({
    validatePasswordStrength: mockValidatePasswordStrength
}));

// Mock ClickHouse Service for Session
const mockCHService = {
    executeQuery: mock()
};

const mockGetSession = mock();

mock.module("../../services/clickhouse", () => ({
    getSession: mockGetSession
}));

// Mock JWT Service
let mockTokenPayload = {
    sub: 'admin-id',
    roles: ['admin'],
    permissions: ['clickhouse:users:view', 'clickhouse:users:create', 'clickhouse:users:update', 'clickhouse:users:delete'],
    sessionId: 'sess-1'
};

mock.module("../services/jwt", () => ({
    verifyAccessToken: mock(async () => mockTokenPayload),
    extractTokenFromHeader: mock((h) => h ? "valid_token" : null),
    verifyRefreshToken: mock(async () => mockTokenPayload)
}));

import clickhouseUsersRoutes from "./clickhouseUsers";
import { errorHandler } from "../../middleware/error";

describe("RBAC ClickHouse Users Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/ch-users", clickhouseUsersRoutes);

        mockListClickHouseUsers.mockClear();
        mockGetClickHouseUser.mockClear();
        mockCreateClickHouseUser.mockClear();
        mockUpdateClickHouseUser.mockClear();
        mockDeleteClickHouseUser.mockClear();
        mockCreateAuditLog.mockClear();
        mockGetSession.mockClear();
        mockCHService.executeQuery.mockClear();
        mockValidatePasswordStrength.mockClear();

        // Default: Admin
        mockTokenPayload = {
            sub: 'admin-id',
            roles: ['admin'],
            permissions: ['clickhouse:users:view', 'clickhouse:users:create', 'clickhouse:users:update', 'clickhouse:users:delete'],
            sessionId: 'sess-1'
        };

        // Mock valid session
        mockGetSession.mockReturnValue({
            service: mockCHService,
            session: { rbacConnectionId: "conn1" }
        });
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /ch-users/clusters", () => {
        it("should return clusters", async () => {
            mockCHService.executeQuery.mockResolvedValue({ data: [{ cluster: "c1" }] });

            const res = await app.request("/ch-users/clusters", {
                headers: { "Authorization": "Bearer token", "X-Session-ID": "s1" }
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data).toEqual(["c1"]);
        });
    });

    describe("GET /ch-users", () => {
        it("should list users", async () => {
            mockListClickHouseUsers.mockResolvedValue([]);

            const res = await app.request("/ch-users", {
                headers: { "Authorization": "Bearer token", "X-Session-ID": "s1" }
            });

            expect(res.status).toBe(200);
            expect(mockListClickHouseUsers).toHaveBeenCalled();
        });

        it("should fail without session", async () => {
            mockGetSession.mockReturnValue(null);

            const res = await app.request("/ch-users", {
                headers: { "Authorization": "Bearer token", "X-Session-ID": "s1" }
            });

            expect(res.status).toBe(400); // Handled error
        });
    });

    describe("POST /ch-users", () => {
        it("should create user", async () => {
            mockValidatePasswordStrength.mockReturnValue({ valid: true });

            const res = await app.request("/ch-users", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token", "X-Session-ID": "s1" },
                body: JSON.stringify({
                    username: "new_user",
                    password: "StrongPassword123!",
                    role: "developer",
                    authType: "sha256_password"
                })
            });

            expect(res.status).toBe(201);
            expect(mockCreateClickHouseUser).toHaveBeenCalled();
        });
    });

    describe("POST /ch-users/generate-ddl", () => {
        it("should generate DDL", async () => {
            mockGenerateUserDDL.mockReturnValue("CREATE USER ...");

            const res = await app.request("/ch-users/generate-ddl", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({
                    username: "new_user",
                    password: "StrongPassword123!",
                    role: "developer",
                    authType: "sha256_password"
                })
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data).toBe("CREATE USER ...");
        });
    });
});
