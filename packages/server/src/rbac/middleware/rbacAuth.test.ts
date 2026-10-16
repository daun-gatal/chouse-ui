
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import {
    rbacAuthMiddleware,
    requirePermission,
    requireRole,
    superAdminOnly,
    optionalRbacAuthMiddleware
} from "./rbacAuth";
import { AppError } from "../../types";

// Mock Services
const mockVerifyAccessToken = mock(async () => ({
    sub: "user-123",
    roles: ["viewer"],
    permissions: ["read"]
}));
const mockExtractToken = mock((header: string) => header === "Bearer valid" ? "valid" : null);
const mockUserHasPermission = mock(async () => true);
const mockCreateAuditLog = mock(async () => { });

mock.module("../services/jwt", () => ({
    verifyAccessToken: mockVerifyAccessToken,
    extractTokenFromHeader: mockExtractToken,
}));

mock.module("../services/rbac", () => ({
    userHasPermission: mockUserHasPermission,
    userHasAnyPermission: mock(async () => true),
    userHasAllPermissions: mock(async () => true),
    createAuditLog: mockCreateAuditLog,
}));

// Mock Hono Context
const mockContext = {
    req: {
        header: mock((name: string) => {
            if (name === "Authorization") return "Bearer valid";
            return undefined;
        })
    },
    set: mock(),
    get: mock((key: string) => {
        if (key === "rbacUserId") return "user-123";
        if (key === "rbacRoles") return ["viewer"];
        if (key === "rbacPermissions") return ["read"];
        return null;
    }),
};
const mockNext = mock(async () => { });

describe("RBAC Auth Middleware", () => {
    beforeEach(() => {
        mockVerifyAccessToken.mockClear();
        mockExtractToken.mockClear();
        mockUserHasPermission.mockClear();
        mockCreateAuditLog.mockClear();
        mockContext.set.mockClear();
        mockContext.get.mockClear();
        mockNext.mockClear();

        // Default sucess behavior
        mockVerifyAccessToken.mockResolvedValue({
            sub: "user-123",
            roles: ["viewer"],
            permissions: ["read"]
        });
    });

    afterAll(() => {
        mock.restore();
    });

    describe("rbacAuthMiddleware", () => {
        it("should authenticate valid token", async () => {
            // Mock header to return valid token
            mockContext.req.header.mockReturnValue("Bearer valid");

            await rbacAuthMiddleware(mockContext as any, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockContext.set).toHaveBeenCalledWith("rbacUserId", "user-123");
        });

        it("should throw if no token provided", async () => {
            mockContext.req.header.mockReturnValue(undefined); // No auth header
            mockExtractToken.mockReturnValue(null);

            await expect(rbacAuthMiddleware(mockContext as any, mockNext)).rejects.toThrow("No authentication token provided");
        });

        it("should throw and log audit on invalid token", async () => {
            mockContext.req.header.mockReturnValue("Bearer invalid");
            mockExtractToken.mockReturnValue("invalid");
            mockVerifyAccessToken.mockRejectedValue(new Error("Invalid signature"));

            await expect(rbacAuthMiddleware(mockContext as any, mockNext)).rejects.toThrow("Invalid signature");
            expect(mockCreateAuditLog).toHaveBeenCalled();
        });
    });

    describe("requirePermission", () => {
        it("should allow if user has permission in token", async () => {
            // Token has 'read'
            const middleware = requirePermission("read");

            // Mock rbacAuthMiddleware internal call to succeed immediately
            // (In real execution it calls rbacAuthMiddleware first)
            // We can mock the auth middleware behavior by relying on Context.get values which are set.

            await middleware(mockContext as any, mockNext);
            expect(mockNext).toHaveBeenCalled();
        });

        it("should check database if token misses permission", async () => {
            // Token has 'read', we want 'write'
            const middleware = requirePermission("write");

            mockUserHasPermission.mockResolvedValue(true); // Database says yes

            await middleware(mockContext as any, mockNext);
            expect(mockUserHasPermission).toHaveBeenCalledWith("user-123", "write");
            expect(mockNext).toHaveBeenCalled();
        });

        it("should deny if missing in both token and db", async () => {
            const middleware = requirePermission("write");
            mockUserHasPermission.mockResolvedValue(false); // Database says no

            await expect(middleware(mockContext as any, mockNext)).rejects.toThrow("Permission 'write' required");
        });
    });

    describe("requireRole", () => {
        it("should allow if user has role", async () => {
            const middleware = requireRole("viewer");
            await middleware(mockContext as any, mockNext);
            expect(mockNext).toHaveBeenCalled();
        });

        it("should deny if user missing role", async () => {
            const middleware = requireRole("admin");
            await expect(middleware(mockContext as any, mockNext)).rejects.toThrow("Role 'admin' required");
        });
    });

    describe("superAdminOnly", () => {
        it("should deny non-super-admin", async () => {
            await expect(superAdminOnly(mockContext as any, mockNext)).rejects.toThrow("Super administrator access required");
        });
    });

    describe("optionalRbacAuthMiddleware", () => {
        it("should continue if no token", async () => {
            mockContext.req.header.mockReturnValue(undefined);
            mockExtractToken.mockReturnValue(null);

            await optionalRbacAuthMiddleware(mockContext as any, mockNext);
            expect(mockNext).toHaveBeenCalled();
            // Should not set context
            expect(mockContext.set).not.toHaveBeenCalled();
        });
    });
});
