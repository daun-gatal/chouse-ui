import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock service layer
const mockListClickHouseUsers = mock();
const mockGetClickHouseUser = mock();
const mockGetCurrentUserState = mock(async () => ({ roles: [], defaultRoles: [], directGrants: [], authType: 'sha256_password' }));
const mockCreateClickHouseUser = mock(async () => {});
const mockUpdateClickHouseUser = mock(async () => {});
const mockDeleteClickHouseUser = mock(async () => {});
const mockExtractRoleFromUser = mock(async () => {});
const mockGenerateUserDDL = mock(() => ({ createUser: "", grantStatements: [], fullDDL: "" }));
const mockGenerateUpdateUserDDL = mock(() => ({ createUser: "", grantStatements: [], fullDDL: "" }));
const mockCreateAuditLogWithContext = mock(async () => {});
const mockValidatePasswordStrength = mock(() => ({ valid: true }));

mock.module("../services/clickhouseUsers", () => ({
    listClickHouseUsers: mockListClickHouseUsers,
    getClickHouseUser: mockGetClickHouseUser,
    getCurrentUserState: mockGetCurrentUserState,
    createClickHouseUser: mockCreateClickHouseUser,
    updateClickHouseUser: mockUpdateClickHouseUser,
    deleteClickHouseUser: mockDeleteClickHouseUser,
    extractRoleFromUser: mockExtractRoleFromUser,
    generateUserDDL: mockGenerateUserDDL,
    generateUpdateUserDDL: mockGenerateUpdateUserDDL,
}));

mock.module("../services/rbac", () => ({
    createAuditLogWithContext: mockCreateAuditLogWithContext,
}));

mock.module("../services/password", () => ({
    validatePasswordStrength: mockValidatePasswordStrength,
}));

const mockCHService = { executeQuery: mock(async () => ({ data: [] })) };
const mockGetSession = mock();

mock.module("../../services/clickhouse", () => ({
    getSession: mockGetSession,
}));

let mockTokenPayload = {
    sub: 'admin-id',
    roles: ['admin'],
    permissions: ['clickhouse:users:view', 'clickhouse:users:create', 'clickhouse:users:update', 'clickhouse:users:delete', 'clickhouse:roles:create'],
    sessionId: 'sess-1',
};

mock.module("../services/jwt", () => ({
    verifyAccessToken: mock(async () => mockTokenPayload),
    extractTokenFromHeader: mock((h) => h ? "valid_token" : null),
    verifyRefreshToken: mock(async () => mockTokenPayload),
}));

import clickhouseUsersRoutes from "./clickhouseUsers";
import { errorHandler } from "../../middleware/error";

const authHeaders = { "Authorization": "Bearer token", "X-Session-ID": "s1" };
const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

describe("RBAC ClickHouse Users Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/ch-users", clickhouseUsersRoutes);

        for (const m of [mockListClickHouseUsers, mockGetClickHouseUser, mockGetCurrentUserState, mockCreateClickHouseUser, mockUpdateClickHouseUser, mockDeleteClickHouseUser, mockExtractRoleFromUser, mockCreateAuditLogWithContext, mockGetSession, mockCHService.executeQuery, mockValidatePasswordStrength]) {
            m.mockClear();
        }

        mockTokenPayload = {
            sub: 'admin-id',
            roles: ['admin'],
            permissions: ['clickhouse:users:view', 'clickhouse:users:create', 'clickhouse:users:update', 'clickhouse:users:delete', 'clickhouse:roles:create'],
            sessionId: 'sess-1',
        };
        mockGetSession.mockReturnValue({ service: mockCHService, session: { rbacConnectionId: "conn1" } });
        mockValidatePasswordStrength.mockReturnValue({ valid: true });
    });

    afterAll(() => mock.restore());

    it("lists users", async () => {
        mockListClickHouseUsers.mockResolvedValue([]);
        const res = await app.request("/ch-users", { headers: authHeaders });
        expect(res.status).toBe(200);
        expect(mockListClickHouseUsers).toHaveBeenCalled();
    });

    it("fails without session", async () => {
        mockGetSession.mockReturnValue(null);
        const res = await app.request("/ch-users", { headers: authHeaders });
        expect(res.status).toBe(400);
    });

    it("creates a user with roles", async () => {
        const res = await app.request("/ch-users", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ username: "new_user", password: "StrongPassword123!", roles: ["readonly"], defaultRoles: "ALL" }),
        });
        expect(res.status).toBe(201);
        expect(mockCreateClickHouseUser).toHaveBeenCalled();
        expect(mockCreateAuditLogWithContext).toHaveBeenCalled();
    });

    it("rejects invalid username", async () => {
        const res = await app.request("/ch-users", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ username: "1bad name", password: "StrongPassword123!" }),
        });
        expect(res.status).toBe(400);
        expect(mockCreateClickHouseUser).not.toHaveBeenCalled();
    });

    it("rejects weak passwords", async () => {
        mockValidatePasswordStrength.mockReturnValue({ valid: false, errors: ["too weak"] });
        const res = await app.request("/ch-users", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ username: "u", password: "weakpassword", roles: ["readonly"] }),
        });
        expect(res.status).toBe(400);
        expect(mockCreateClickHouseUser).not.toHaveBeenCalled();
    });

    it("requires at least one role on create", async () => {
        const res = await app.request("/ch-users", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ username: "u", password: "StrongPassword123!" }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe("ROLE_REQUIRED");
        expect(mockCreateClickHouseUser).not.toHaveBeenCalled();
    });

    it("updates a user", async () => {
        const res = await app.request("/ch-users/alice", {
            method: "PATCH",
            headers: jsonHeaders,
            body: JSON.stringify({ roles: ["analytics"] }),
        });
        expect(res.status).toBe(200);
        expect(mockUpdateClickHouseUser).toHaveBeenCalled();
    });

    it("extracts a role from a user", async () => {
        const res = await app.request("/ch-users/alice/extract-role", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ roleName: "extracted_alice" }),
        });
        expect(res.status).toBe(200);
        expect(mockExtractRoleFromUser).toHaveBeenCalledWith(mockCHService, "alice", "extracted_alice", undefined);
    });

    it("deletes a user", async () => {
        const res = await app.request("/ch-users/alice", { method: "DELETE", headers: authHeaders });
        expect(res.status).toBe(200);
        expect(mockDeleteClickHouseUser).toHaveBeenCalled();
    });
});
