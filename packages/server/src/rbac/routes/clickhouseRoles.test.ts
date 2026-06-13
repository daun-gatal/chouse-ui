import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

const mockListClickHouseRoles = mock(async () => []);
const mockGetClickHouseRole = mock();
const mockGetRoleGrants = mock(async () => []);
const mockCreateClickHouseRole = mock(async () => {});
const mockUpdateClickHouseRole = mock(async () => {});
const mockDeleteClickHouseRole = mock(async () => {});
const mockGenerateCreateRoleDDL = mock(() => ["CREATE ROLE IF NOT EXISTS `r`"]);
const mockGenerateRoleDiffDDL = mock(() => []);
const mockListClickHousePrivileges = mock(async () => [
    { name: "SELECT", group: "Read/Write", supportsColumns: true },
    { name: "INSERT", group: "Read/Write", supportsColumns: true },
]);
const mockDisableClickHouseRole = mock(async () => {});
const mockEnableClickHouseRole = mock(async () => {});
const mockCreateAuditLogWithContext = mock(async () => {});

mock.module("../services/clickhouseRoles", () => ({
    listClickHouseRoles: mockListClickHouseRoles,
    getClickHouseRole: mockGetClickHouseRole,
    getRoleGrants: mockGetRoleGrants,
    createClickHouseRole: mockCreateClickHouseRole,
    updateClickHouseRole: mockUpdateClickHouseRole,
    deleteClickHouseRole: mockDeleteClickHouseRole,
    disableClickHouseRole: mockDisableClickHouseRole,
    enableClickHouseRole: mockEnableClickHouseRole,
    generateCreateRoleDDL: mockGenerateCreateRoleDDL,
    generateRoleDiffDDL: mockGenerateRoleDiffDDL,
    listClickHousePrivileges: mockListClickHousePrivileges,
}));

mock.module("../services/rbac", () => ({
    createAuditLogWithContext: mockCreateAuditLogWithContext,
}));

const mockCHService = { executeQuery: mock(async () => ({ data: [] })) };
const mockGetSession = mock();
mock.module("../../services/clickhouse", () => ({ getSession: mockGetSession }));

let mockTokenPayload = {
    sub: 'admin-id',
    roles: ['admin'],
    permissions: ['clickhouse:roles:view', 'clickhouse:roles:create', 'clickhouse:roles:update', 'clickhouse:roles:delete'],
    sessionId: 'sess-1',
};

mock.module("../services/jwt", () => ({
    verifyAccessToken: mock(async () => mockTokenPayload),
    extractTokenFromHeader: mock((h) => h ? "valid_token" : null),
    verifyRefreshToken: mock(async () => mockTokenPayload),
}));

import clickhouseRolesRoutes from "./clickhouseRoles";
import { errorHandler } from "../../middleware/error";

const authHeaders = { "Authorization": "Bearer token", "X-Session-ID": "s1" };
const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

describe("RBAC ClickHouse Roles Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/ch-roles", clickhouseRolesRoutes);
        for (const m of [mockListClickHouseRoles, mockGetClickHouseRole, mockGetRoleGrants, mockCreateClickHouseRole, mockUpdateClickHouseRole, mockDeleteClickHouseRole, mockDisableClickHouseRole, mockEnableClickHouseRole, mockCreateAuditLogWithContext, mockGetSession, mockCHService.executeQuery]) {
            m.mockClear();
        }
        mockTokenPayload = {
            sub: 'admin-id',
            roles: ['admin'],
            permissions: ['clickhouse:roles:view', 'clickhouse:roles:create', 'clickhouse:roles:update', 'clickhouse:roles:delete'],
            sessionId: 'sess-1',
        };
        mockGetSession.mockReturnValue({ service: mockCHService, session: { rbacConnectionId: "conn1" } });
    });

    afterAll(() => mock.restore());

    it("returns the privilege catalog", async () => {
        const res = await app.request("/ch-roles/privileges", { headers: authHeaders });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.some((p: { name: string }) => p.name === 'SELECT')).toBe(true);
    });

    it("lists roles", async () => {
        const res = await app.request("/ch-roles", { headers: authHeaders });
        expect(res.status).toBe(200);
        expect(mockListClickHouseRoles).toHaveBeenCalled();
    });

    it("404s for missing role", async () => {
        mockGetClickHouseRole.mockResolvedValue(null);
        const res = await app.request("/ch-roles/nope", { headers: authHeaders });
        expect(res.status).toBe(404);
    });

    it("creates a role", async () => {
        const res = await app.request("/ch-roles", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ name: "analytics", grants: [{ privileges: ["SELECT"], database: "db", table: null, grantOption: false }] }),
        });
        expect(res.status).toBe(201);
        expect(mockCreateClickHouseRole).toHaveBeenCalled();
        expect(mockCreateAuditLogWithContext).toHaveBeenCalled();
    });

    it("rejects an invalid role name", async () => {
        const res = await app.request("/ch-roles", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ name: "1 bad", grants: [] }),
        });
        expect(res.status).toBe(400);
        expect(mockCreateClickHouseRole).not.toHaveBeenCalled();
    });

    it("updates a role", async () => {
        const res = await app.request("/ch-roles/analytics", {
            method: "PATCH",
            headers: jsonHeaders,
            body: JSON.stringify({ grants: [] }),
        });
        expect(res.status).toBe(200);
        expect(mockUpdateClickHouseRole).toHaveBeenCalled();
    });

    it("deletes a role", async () => {
        const res = await app.request("/ch-roles/analytics", { method: "DELETE", headers: authHeaders });
        expect(res.status).toBe(200);
        expect(mockDeleteClickHouseRole).toHaveBeenCalled();
    });

    it("disables a role", async () => {
        const res = await app.request("/ch-roles/analytics/disable", { method: "POST", headers: authHeaders });
        expect(res.status).toBe(200);
        expect(mockDisableClickHouseRole).toHaveBeenCalledWith(mockCHService, "conn1", "analytics", undefined, "admin-id");
        expect(mockCreateAuditLogWithContext).toHaveBeenCalled();
    });

    it("enables a role", async () => {
        const res = await app.request("/ch-roles/analytics/enable", { method: "POST", headers: authHeaders });
        expect(res.status).toBe(200);
        expect(mockEnableClickHouseRole).toHaveBeenCalledWith(mockCHService, "conn1", "analytics", undefined);
    });
});
