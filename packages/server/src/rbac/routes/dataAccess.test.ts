
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock Services (only check/filter remain on these routes)
const mockCheckUserAccess = mock();
const mockFilterDatabasesForUser = mock();
const mockFilterTablesForUser = mock();

mock.module("../services/dataAccess", () => ({
    checkUserAccess: mockCheckUserAccess,
    filterDatabasesForUser: mockFilterDatabasesForUser,
    filterTablesForUser: mockFilterTablesForUser,
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

        mockCheckUserAccess.mockClear();
        mockFilterDatabasesForUser.mockClear();
        mockFilterTablesForUser.mockClear();

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
