
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
import authRoutes from "./auth";
import { errorHandler } from "../../middleware/error";

// Mock Services
const mockAuthenticateUser = mock();
const mockRefreshAccessToken = mock();
const mockLogoutUser = mock();
const mockLogoutAllSessions = mock();
const mockUpdateUserPassword = mock();
const mockGetUserById = mock();
const mockCreateAuditLog = mock(async () => { });
const mockValidatePasswordStrength = mock(() => ({ valid: true, errors: [] }));
const mockDestroyUserSessions = mock();

// Mock RBAC Service
mock.module("../services/rbac", () => ({
    authenticateUser: mockAuthenticateUser,
    refreshAccessToken: mockRefreshAccessToken,
    logoutUser: mockLogoutUser,
    logoutAllSessions: mockLogoutAllSessions,
    updateUserPassword: mockUpdateUserPassword,
    getUserById: mockGetUserById,
    createAuditLog: mockCreateAuditLog,
}));

// Mock Password Service
mock.module("../services/password", () => ({
    validatePasswordStrength: mockValidatePasswordStrength
}));

// Mock JWT Service
mock.module("../services/jwt", () => ({
    verifyRefreshToken: mock(async () => ({ sub: 'user-123', roles: ['viewer'], sessionId: 'sess-123' })),
    verifyAccessToken: mock(async () => ({
        sub: 'user-123',
        roles: ['viewer'],
        permissions: ['read'],
        sessionId: 'sess-123'
    })),
    extractTokenFromHeader: mock((h) => h ? h.split(' ')[1] : null)
}));

// Mock Middleware
const mockRbacAuthMiddleware = mock(async (c: any, next: any) => {
    c.set('rbacUser', {
        sub: 'user-123',
        roles: ['viewer'],
        permissions: ['read'],
        sessionId: 'sess-123',
        email: 'test@example.com'
    });
    c.set('rbacUserId', 'user-123');
    await next();
});

mock.module("../middleware/rbacAuth", () => ({
    rbacAuthMiddleware: mockRbacAuthMiddleware,
    getClientIp: () => "127.0.0.1",
    getRbacUser: (c: any) => c.get('rbacUser'),
    requirePermission: () => mockRbacAuthMiddleware // Simplify
}));

// Mock ClickHouse Service for session destruction
mock.module("../../services/clickhouse", () => ({
    destroyUserSessions: mockDestroyUserSessions
}));

describe("RBAC Auth Routes", () => {
    let app: Hono;


    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler); // Apply error handler for AppError -> 401 mapping
        app.route("/auth", authRoutes);

        mockAuthenticateUser.mockClear();
        mockRefreshAccessToken.mockClear();
        mockLogoutUser.mockClear();
        mockLogoutAllSessions.mockClear();
        mockUpdateUserPassword.mockClear();
        mockGetUserById.mockClear();
        mockCreateAuditLog.mockClear();
        mockValidatePasswordStrength.mockClear();
        mockDestroyUserSessions.mockClear();
    });

    afterAll(() => {
        mock.restore();
    });

    describe("POST /auth/login", () => {
        it("should login successfully", async () => {
            mockAuthenticateUser.mockResolvedValue({
                user: { id: "user-1", username: "test" },
                tokens: { accessToken: "access", refreshToken: "refresh" }
            });

            const res = await app.request("/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: "test", password: "password" })
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.user.id).toBe("user-1");
            expect(mockCreateAuditLog).toHaveBeenCalled();
        });

        it("should fail with invalid credentials", async () => {
            mockAuthenticateUser.mockResolvedValue(null);

            const res = await app.request("/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: "test", password: "wrong" })
            });

            expect(res.status).toBe(401);
            expect(mockCreateAuditLog).toHaveBeenCalled();
        });
    });

    describe("POST /auth/refresh", () => {
        it("should refresh tokens", async () => {
            mockRefreshAccessToken.mockResolvedValue({ accessToken: "new", refreshToken: "new_ref" });

            const res = await app.request("/auth/refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken: "valid_ref" })
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.tokens.accessToken).toBe("new");
        });
    });

    describe("POST /auth/logout", () => {
        it("should logout successfully", async () => {
            mockDestroyUserSessions.mockResolvedValue(1);

            const res = await app.request("/auth/logout", {
                method: "POST",
                headers: { "Authorization": "Bearer valid" }
            });

            expect(res.status).toBe(200);
            expect(mockLogoutUser).toHaveBeenCalledWith("sess-123");
        });
    });

    describe("GET /auth/me", () => {
        it("should return profile", async () => {
            mockGetUserById.mockResolvedValue({ id: "user-123", username: "me" });

            const res = await app.request("/auth/me", {
                headers: { "Authorization": "Bearer valid" }
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.user.username).toBe("me");
        });
    });

    describe("POST /auth/change-password", () => {
        it("should change password", async () => {
            mockAuthenticateUser.mockResolvedValue(true); // Re-auth check
            mockUpdateUserPassword.mockResolvedValue(true);

            const res = await app.request("/auth/change-password", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer valid"
                },
                body: JSON.stringify({ currentPassword: "old", newPassword: "newSecurePass1!" })
            });

            expect(res.status).toBe(200);
            expect(mockUpdateUserPassword).toHaveBeenCalled();
            expect(mockLogoutAllSessions).toHaveBeenCalled();
        });

        it("should fail on weak password", async () => {
            mockValidatePasswordStrength.mockReturnValue({ valid: false, errors: ["Too weak"] });

            const res = await app.request("/auth/change-password", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer valid"
                },
                body: JSON.stringify({ currentPassword: "old", newPassword: "weak" })
            });

            expect(res.status).toBe(400);
        });
    });
});
