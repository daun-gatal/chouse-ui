
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock Services
const mockListDataAccessRules = mock();
const mockGetRulesForRole = mock();
const mockGetDataAccessRuleById = mock();
const mockCreateDataAccessRule = mock();
const mockUpdateDataAccessRule = mock();
const mockDeleteDataAccessRule = mock();
const mockSetRulesForRole = mock();
const mockSetRulesForUser = mock();
const mockGetUserSpecificRules = mock();
const mockCheckUserAccess = mock();
const mockFilterDatabasesForUser = mock();
const mockFilterTablesForUser = mock();
const mockCreateAuditLog = mock(async () => { });

mock.module("../services/dataAccess", () => ({
    listDataAccessRules: mockListDataAccessRules,
    getRulesForRole: mockGetRulesForRole,
    getDataAccessRuleById: mockGetDataAccessRuleById,
    createDataAccessRule: mockCreateDataAccessRule,
    updateDataAccessRule: mockUpdateDataAccessRule,
    deleteDataAccessRule: mockDeleteDataAccessRule,
    setRulesForRole: mockSetRulesForRole,
    setRulesForUser: mockSetRulesForUser,
    getUserSpecificRules: mockGetUserSpecificRules,
    checkUserAccess: mockCheckUserAccess,
    filterDatabasesForUser: mockFilterDatabasesForUser,
    filterTablesForUser: mockFilterTablesForUser,
    createAuditLog: mockCreateAuditLog
}));

mock.module("../services/rbac", () => ({
    createAuditLog: mockCreateAuditLog
}));

// Mock JWT Service
let mockTokenPayload = {
    sub: 'admin-id',
    roles: ['admin'],
    permissions: ['roles:view', 'roles:update', 'users:view'],
    sessionId: 'sess-1'
};

mock.module("../services/jwt", () => ({
    verifyAccessToken: mock(async () => mockTokenPayload),
    extractTokenFromHeader: mock((h) => h ? "valid_token" : null),
    verifyRefreshToken: mock(async () => mockTokenPayload)
}));

import dataAccessRoutes from "./dataAccess";
import { errorHandler } from "../../middleware/error";

describe("RBAC Data Access Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/data-access", dataAccessRoutes);

        mockListDataAccessRules.mockClear();
        mockGetRulesForRole.mockClear();
        mockGetDataAccessRuleById.mockClear();
        mockCreateDataAccessRule.mockClear();
        mockUpdateDataAccessRule.mockClear();
        mockDeleteDataAccessRule.mockClear();
        mockSetRulesForRole.mockClear();
        mockSetRulesForUser.mockClear();
        mockGetUserSpecificRules.mockClear();
        mockCheckUserAccess.mockClear();
        mockFilterDatabasesForUser.mockClear();
        mockFilterTablesForUser.mockClear();
        mockCreateAuditLog.mockClear();

        // Default: Admin with view permission
        mockTokenPayload = {
            sub: 'admin-id',
            roles: ['admin'],
            permissions: ['roles:view', 'roles:update', 'users:view'],
            sessionId: 'sess-1'
        };
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /data-access", () => {
        it("should list rules", async () => {
            mockListDataAccessRules.mockResolvedValue({ rules: [], total: 0 });
            const res = await app.request("/data-access", { headers: { "Authorization": "Bearer token" } });
            expect(res.status).toBe(200);
            expect(mockListDataAccessRules).toHaveBeenCalled();
        });
    });

    describe("POST /data-access", () => {
        it("should create rule", async () => {
            mockCreateDataAccessRule.mockResolvedValue({ id: "rule1" });

            const res = await app.request("/data-access", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ roleId: "123e4567-e89b-12d3-a456-426614174000", databasePattern: "db1", accessType: "read" })
            });

            expect(res.status).toBe(201);
            expect(mockCreateDataAccessRule).toHaveBeenCalled();
        });

        it("should validate input (either roleId or userId)", async () => {
            const res = await app.request("/data-access", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ databasePattern: "db1", accessType: "read" }) // Missing roleId/userId
            });

            expect(res.status).toBe(400);
        });
    });

    describe("PATCH /data-access/:id", () => {
        it("should update rule", async () => {
            mockUpdateDataAccessRule.mockResolvedValue({ id: "rule1" });

            const res = await app.request("/data-access/rule1", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ isAllowed: false })
            });

            expect(res.status).toBe(200);
            expect(mockUpdateDataAccessRule).toHaveBeenCalledWith("rule1", expect.objectContaining({ isAllowed: false }));
        });
    });

    describe("DELETE /data-access/:id", () => {
        it("should delete rule", async () => {
            mockGetDataAccessRuleById.mockResolvedValue({ id: "rule1" });
            mockDeleteDataAccessRule.mockResolvedValue(true);

            const res = await app.request("/data-access/rule1", {
                method: "DELETE",
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockDeleteDataAccessRule).toHaveBeenCalledWith("rule1");
        });
    });

    describe("POST /data-access/check", () => {
        it("should check access", async () => {
            mockCheckUserAccess.mockResolvedValue({ allowed: true });

            const res = await app.request("/data-access/check", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ database: "db1", table: "t1", accessType: "read" })
            });

            expect(res.status).toBe(200);
            expect(mockCheckUserAccess).toHaveBeenCalledWith("admin-id", "db1", "t1", "read", undefined);
        });
    });

    describe("POST /data-access/filter/databases", () => {
        it("should return all DBs for admin", async () => {
            const res = await app.request("/data-access/filter/databases", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ databases: ["db1", "db2"] })
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data).toEqual(["db1", "db2"]);
            expect(mockFilterDatabasesForUser).not.toHaveBeenCalled();
        });

        it("should filter DBs for regular user", async () => {
            mockTokenPayload.roles = ["user"];
            mockFilterDatabasesForUser.mockResolvedValue(["db1"]);

            const res = await app.request("/data-access/filter/databases", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ databases: ["db1", "db2"] })
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data).toEqual(["db1"]);
            expect(mockFilterDatabasesForUser).toHaveBeenCalled();
        });
    });
});
