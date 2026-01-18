
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
// NOTE: We must mock BEFORE importing the routes to ensure the mocks are applied.

// Mock Services
const mockCreateUser = mock();
const mockGetUserById = mock();
const mockUpdateUser = mock();
const mockDeleteUser = mock();
const mockListUsers = mock();
const mockUpdateUserPassword = mock();
const mockCreateAuditLog = mock(async () => { });
const mockGenerateSecurePassword = mock(() => "secure-pass");
const mockValidatePasswordStrength = mock(() => ({ valid: true, errors: [] }));

mock.module("../services/rbac", () => ({
    createUser: mockCreateUser,
    getUserById: mockGetUserById,
    updateUser: mockUpdateUser,
    deleteUser: mockDeleteUser,
    listUsers: mockListUsers,
    updateUserPassword: mockUpdateUserPassword,
    createAuditLog: mockCreateAuditLog,
}));

mock.module("../services/password", () => ({
    validatePasswordStrength: mockValidatePasswordStrength,
    generateSecurePassword: mockGenerateSecurePassword
}));

// Mock JWT Service to support real middleware
let mockTokenPayload = {
    sub: 'admin-id',
    roles: ['admin'],
    permissions: ['users:view', 'users:create', 'users:update', 'users:delete'],
    sessionId: 'sess-1'
};

mock.module("../services/jwt", () => ({
    verifyAccessToken: mock(async () => mockTokenPayload),
    extractTokenFromHeader: mock((h) => h ? "valid_token" : null),
    verifyRefreshToken: mock(async () => mockTokenPayload)
}));

import userRoutes from "./users";
import { errorHandler } from "../../middleware/error";

describe("RBAC Users Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/users", userRoutes);

        // Reset mocks & state
        mockCreateUser.mockClear();
        mockGetUserById.mockClear();
        mockUpdateUser.mockClear();
        mockDeleteUser.mockClear();
        mockListUsers.mockClear();
        mockUpdateUserPassword.mockClear();
        mockCreateAuditLog.mockClear();

        // Reset default admin state
        mockTokenPayload = {
            sub: 'admin-id',
            roles: ['admin'],
            permissions: ['users:view', 'users:create', 'users:update', 'users:delete'],
            sessionId: 'sess-1'
        };
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /users", () => {
        it("should list users", async () => {
            mockListUsers.mockResolvedValue({ users: [], total: 0 });

            const res = await app.request("/users?page=1&limit=10", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockListUsers).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 10 }));
        });
    });

    describe("GET /users/:id", () => {
        it("should return user if allowed", async () => {
            mockGetUserById.mockResolvedValue({ id: "u1", username: "user1", roles: [] });

            const res = await app.request("/users/u1", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.user.username).toBe("user1");
        });

        it("should allow viewing self without permission", async () => {
            mockTokenPayload.permissions = []; // No permissions
            mockTokenPayload.sub = "u1";

            mockGetUserById.mockResolvedValue({ id: "u1", username: "me", roles: [] });

            const res = await app.request("/users/u1", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
        });

        it("should deny viewing others without permission", async () => {
            mockTokenPayload.permissions = []; // No permissions
            mockTokenPayload.sub = "u1";

            const res = await app.request("/users/u2", { // Other user
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(403);
            expect(mockGetUserById).not.toHaveBeenCalled();
        });
    });

    describe("POST /users", () => {
        it("should create user", async () => {
            mockCreateUser.mockResolvedValue({ id: "new-u", email: "test@example.com", roles: [] });

            const res = await app.request("/users", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ email: "test@example.com", username: "test", roleIds: ["r1"] })
            });

            expect(res.status).toBe(201);
            expect(mockCreateUser).toHaveBeenCalled();
        });
    });

    describe("PATCH /users/:id", () => {
        it("should update user", async () => {
            mockGetUserById.mockResolvedValue({ id: "u1", roles: [] });
            mockUpdateUser.mockResolvedValue({ id: "u1", isActive: false });

            const res = await app.request("/users/u1", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ isActive: false })
            });

            expect(res.status).toBe(200);
            expect(mockUpdateUser).toHaveBeenCalledWith("u1", expect.objectContaining({ isActive: false }));
        });

        it("should prevent deactivating self", async () => {
            mockTokenPayload.sub = "u1";
            mockGetUserById.mockResolvedValue({ id: "u1", roles: [] });

            const res = await app.request("/users/u1", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ isActive: false })
            });

            expect(res.status).toBe(400); // Bad Request
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });
    });

    describe("DELETE /users/:id", () => {
        it("should delete user", async () => {
            mockGetUserById.mockResolvedValue({ id: "u2", roles: [] });
            mockDeleteUser.mockResolvedValue(true);

            const res = await app.request("/users/u2", {
                method: "DELETE",
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockDeleteUser).toHaveBeenCalledWith("u2");
        });

        it("should prevent deleting self", async () => {
            mockTokenPayload.sub = "u1";
            mockGetUserById.mockResolvedValue({ id: "u1", roles: [] });

            const res = await app.request("/users/u1", {
                method: "DELETE",
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(400);
        });
    });
});
