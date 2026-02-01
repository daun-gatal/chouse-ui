
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock Services
const mockGetAuditLogs = mock();
const mockCreateAuditLog = mock(async () => { });

const mockDeleteAuditLogs = mock();

const mockUserHasPermission = mock();
const mockUserHasAnyPermission = mock();

mock.module("../services/rbac", () => ({
    getAuditLogs: mockGetAuditLogs,
    deleteAuditLogs: mockDeleteAuditLogs,
    createAuditLog: mockCreateAuditLog,
    userHasPermission: mockUserHasPermission,
    userHasAnyPermission: mockUserHasAnyPermission,
}));

// Mock JWT Service
let mockTokenPayload = {
    sub: 'admin-id',
    roles: ['admin'],
    permissions: ['audit:view'],
    sessionId: 'sess-1'
};

mock.module("../services/jwt", () => ({
    verifyAccessToken: mock(async () => mockTokenPayload),
    extractTokenFromHeader: mock((h) => h ? "valid_token" : null),
    verifyRefreshToken: mock(async () => mockTokenPayload)
}));

import auditRoutes from "./audit";
import { errorHandler } from "../../middleware/error";

describe("RBAC Audit Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/audit", auditRoutes);

        mockGetAuditLogs.mockClear();
        mockUserHasPermission.mockClear();
        mockUserHasAnyPermission.mockClear();

        // Default: Admin with view permission
        mockTokenPayload = {
            sub: 'admin-id',
            roles: ['admin'],
            permissions: ['audit:view'], // Full access
            sessionId: 'sess-1'
        };
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /audit", () => {
        it("should list audit logs for authorized user", async () => {
            mockGetAuditLogs.mockResolvedValue({ logs: [], total: 0 });

            const res = await app.request("/audit", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockGetAuditLogs).toHaveBeenCalled();
        });

        it("should restrict user to own logs if no audit:view permission", async () => {
            mockTokenPayload.permissions = []; // No full view
            mockTokenPayload.sub = 'u1';
            mockGetAuditLogs.mockResolvedValue({ logs: [], total: 0 });

            const res = await app.request("/audit", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            // Should have called with userId: u1 check?
            // The implementation overrides the query.userId in this case or sets it
            expect(mockGetAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }));
        });

        it("should deny if user tries to view others logs without permission", async () => {
            mockTokenPayload.permissions = [];
            mockTokenPayload.sub = 'u1';

            const res = await app.request("/audit?userId=u2", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(403);
        });
    });

    describe("GET /audit/stats", () => {
        it("should return stats", async () => {
            const logs = [
                { action: 'login', status: 'success', createdAt: new Date() },
                { action: 'login', status: 'failure', createdAt: new Date() }
            ];
            mockGetAuditLogs.mockResolvedValue({ logs, total: 2 });

            const res = await app.request("/audit/stats", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.stats.byAction.login).toBe(2);
            expect(body.data.stats.byStatus.success).toBe(1);
        });
    });

    describe("GET /audit/export", () => {
        it("should export csv", async () => {
            // Needs export permission
            mockTokenPayload.permissions = ['audit:export'];
            const logs = [
                { id: 'l1', userId: 'u1', action: 'login', status: 'success', createdAt: new Date() }
            ];
            mockGetAuditLogs.mockResolvedValue({ logs, total: 1 });

            const res = await app.request("/audit/export", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toBe('text/csv');
            const text = await res.text();
            expect(text).toContain('"l1","u1","login"');
        });
    });

    describe("DELETE /audit", () => {
        it("should delete audit logs for authorized user", async () => {
            mockTokenPayload.permissions = ['audit:delete'];
            mockDeleteAuditLogs.mockResolvedValue({ deletedCount: 5 });

            const res = await app.request("/audit?action=login", {
                method: "DELETE",
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.deletedCount).toBe(5);
            expect(mockDeleteAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ action: "login" }));
            expect(mockCreateAuditLog).toHaveBeenCalledWith(
                'audit.delete',
                'admin-id',
                expect.objectContaining({
                    details: expect.objectContaining({ deletedCount: 5 })
                })
            );
        });

        it("should deny delete if unauthorized", async () => {
            mockTokenPayload.permissions = ['audit:view']; // Only view, no delete

            const res = await app.request("/audit", {
                method: "DELETE",
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(403);
        });
    });
});
