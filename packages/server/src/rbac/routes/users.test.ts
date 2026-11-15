
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
// NOTE: We must mock BEFORE importing the routes to ensure the mocks are applied.

// Mock Services
const mockCreateUser = mock();
const mockGetUserById = mock();
const mockGetRoleById = mock();
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
    getRoleById: mockGetRoleById,
    updateUser: mockUpdateUser,
    deleteUser: mockDeleteUser,
    listUsers: mockListUsers,
    updateUserPassword: mockUpdateUserPassword,
    createAuditLog: mockCreateAuditLog,
}));

// Roles mapped to a ClickHouse role on some connection (ADR 0033 §6).
const mappedRoles = new Set<string>();
const mappedHolders = new Set<string>();
let defaultRoleMapped = false;
mock.module("../services/connectionIdentity", () => ({
    mappedRoleIds: async (roleIds: string[]) => roleIds.filter((id) => mappedRoles.has(id)),
    holdsMappedRole: async (userId: string) => mappedHolders.has(userId),
    defaultRoleIsMapped: async () => defaultRoleMapped,
}));

// Links to ClickHouse users are suspended when someone else changes how an account signs in (ADR 0033 §7.4).
const mockSuspend = mock(async (_userId: string, _reason: string, _actorId?: string) => 0);
mock.module("../services/clickhouseBindings", () => ({ suspendBindingsOf: mockSuspend }));

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
        mockGetRoleById.mockReset();
        mockUpdateUser.mockClear();
        mockDeleteUser.mockClear();
        mockListUsers.mockClear();
        mockUpdateUserPassword.mockClear();
        mockCreateAuditLog.mockClear();
        mockSuspend.mockClear();

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
            mockListUsers.mockResolvedValue({ users: [], total: 0, activeCount: 0, inactiveCount: 0 });

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
            mockGetRoleById.mockResolvedValue({ id: "r1", name: "viewer", permissions: ["users:view"] });

            const res = await app.request("/users", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ email: "test@example.com", username: "test", roleIds: ["r1"] })
            });

            expect(res.status).toBe(201);
            expect(mockCreateUser).toHaveBeenCalled();
        });
    });

    describe("role assignment cannot exceed the caller's own permissions", () => {
        const roles: Record<string, { id: string; name: string; permissions: string[] }> = {
            "role-super": { id: "role-super", name: "super_admin", permissions: ["users:view", "settings:update"] },
            "role-wide": { id: "role-wide", name: "ops", permissions: ["users:view", "settings:update"] },
            "role-narrow": { id: "role-narrow", name: "viewer", permissions: ["users:view"] },
        };
        const json = { "Content-Type": "application/json", "Authorization": "Bearer token" };

        beforeEach(() => {
            mockTokenPayload.permissions = ["users:view", "users:create", "users:update", "roles:assign"];
            mockGetRoleById.mockImplementation(async (id: string) => roles[id] ?? null);
            mockGetUserById.mockResolvedValue({ id: "admin-id", username: "me", roles: ["admin"] });
            mockCreateUser.mockResolvedValue({ id: "new" });
            mockUpdateUser.mockResolvedValue({ id: "admin-id" });
        });

        it.each([
            ["assign-roles", "POST", "/users/admin-id/assign-roles", { roleIds: ["role-super"] }],
            ["create user", "POST", "/users", { email: "n@x.io", username: "newuser", password: "Password-123!", roleIds: ["role-super"] }],
            ["update user", "PATCH", "/users/admin-id", { roleIds: ["role-super"] }],
        ])("denies granting super_admin via %s", async (_label, method, path, body) => {
            const res = await app.request(path, { method, headers: json, body: JSON.stringify(body) });
            expect(res.status).toBe(403);
            expect(mockCreateUser).not.toHaveBeenCalled();
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });

        it("denies a role holding permissions the caller lacks", async () => {
            const res = await app.request("/users/admin-id/assign-roles", {
                method: "POST", headers: json, body: JSON.stringify({ roleIds: ["role-wide"] }),
            });
            expect(res.status).toBe(403);
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });

        it("allows a role within the caller's permissions", async () => {
            const res = await app.request("/users/admin-id/assign-roles", {
                method: "POST", headers: json, body: JSON.stringify({ roleIds: ["role-narrow"] }),
            });
            expect(res.status).toBe(200);
            expect(mockUpdateUser).toHaveBeenCalledWith("admin-id", { roleIds: ["role-narrow"] });
        });

        // ADR 0033 §6: a role mapped to a ClickHouse role decides what ClickHouse lets its holder do.
        it.each([
            ["assign-roles", "POST", "/users/admin-id/assign-roles", { roleIds: ["role-narrow"] }],
            ["create user", "POST", "/users", { email: "n@x.io", username: "newuser", password: "Password-123!", roleIds: ["role-narrow"] }],
            ["update user", "PATCH", "/users/admin-id", { roleIds: ["role-narrow"] }],
        ])("denies a non-super-admin a role mapped to a ClickHouse role via %s, though its permissions are within theirs", async (_label, method, path, body) => {
            mappedRoles.add("role-narrow");
            try {
                const res = await app.request(path, { method, headers: json, body: JSON.stringify(body) });
                expect(res.status).toBe(403);
                expect((await res.json()).error.message).toContain("super admin");
                expect(mockCreateUser).not.toHaveBeenCalled();
                expect(mockUpdateUser).not.toHaveBeenCalled();
            } finally {
                mappedRoles.clear();
            }
        });

        // Whoever can reset such an account's password can sign in as it.
        it.each([
            ["reset-password", "POST", "/users/admin-id/reset-password", { generatePassword: true }],
            ["update", "PATCH", "/users/admin-id", { displayName: "x" }],
        ])("denies a non-super-admin %s on an account that holds a mapped role", async (_label, method, path, body) => {
            mappedHolders.add("admin-id");
            try {
                const res = await app.request(path, { method, headers: json, ...(body ? { body: JSON.stringify(body) } : {}) });
                expect(res.status).toBe(403);
                expect((await res.json()).error.message).toContain("super admin");
                expect(mockUpdateUser).not.toHaveBeenCalled();
            } finally {
                mappedHolders.clear();
            }
        });

        it("denies a non-super-admin creating an account with no role while the default role is mapped", async () => {
            defaultRoleMapped = true;
            try {
                const res = await app.request("/users", { method: "POST", headers: json, body: JSON.stringify({ email: "n@x.io", username: "newuser", password: "Password-123!" }) });
                expect(res.status).toBe(403);
                expect(mockCreateUser).not.toHaveBeenCalled();
            } finally {
                defaultRoleMapped = false;
            }
        });

        it("lets a super admin assign a mapped role", async () => {
            mappedRoles.add("role-narrow");
            mockTokenPayload.roles = ["super_admin"];
            try {
                const res = await app.request("/users/admin-id/assign-roles", {
                    method: "POST", headers: json, body: JSON.stringify({ roleIds: ["role-narrow"] }),
                });
                expect(res.status).toBe(200);
            } finally {
                mappedRoles.clear();
            }
        });

        it("lets a super admin assign any role", async () => {
            mockTokenPayload.roles = ["super_admin"];
            const res = await app.request("/users/admin-id/assign-roles", {
                method: "POST", headers: json, body: JSON.stringify({ roleIds: ["role-super"] }),
            });
            expect(res.status).toBe(200);
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

    describe("a change to how an account signs in suspends its ClickHouse links (ADR 0033 §7.4)", () => {
        const headers = { "Content-Type": "application/json", "Authorization": "Bearer token" };
        const patch = (id: string, body: unknown) => app.request(`/users/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) });

        it("when someone else resets the password, and not when the holder is the one acting", async () => {
            mockGetUserById.mockResolvedValue({ id: "u1", roles: [], email: "u1@x.io", isActive: true });
            expect((await app.request("/users/u1/reset-password", { method: "POST", headers, body: JSON.stringify({ generatePassword: true }) })).status).toBe(200);
            expect(mockSuspend).toHaveBeenCalledWith("u1", expect.stringContaining("password"), "admin-id");
            mockSuspend.mockClear();
            mockGetUserById.mockResolvedValue({ id: "admin-id", roles: [], email: "a@x.io", isActive: true });
            expect((await app.request("/users/admin-id/reset-password", { method: "POST", headers, body: JSON.stringify({ generatePassword: true }) })).status).toBe(200);
            expect(mockSuspend).not.toHaveBeenCalled();
        });

        it("when someone else changes the email or reactivates the account", async () => {
            mockUpdateUser.mockResolvedValue({ id: "u1" });
            mockGetUserById.mockResolvedValue({ id: "u1", roles: [], email: "u1@x.io", isActive: true });
            await patch("u1", { email: "other@x.io" });
            expect(mockSuspend).toHaveBeenCalledWith("u1", expect.stringContaining("email"), "admin-id");
            mockSuspend.mockClear();
            mockGetUserById.mockResolvedValue({ id: "u1", roles: [], email: "u1@x.io", isActive: false });
            await patch("u1", { isActive: true });
            expect(mockSuspend).toHaveBeenCalledWith("u1", expect.stringContaining("reactivated"), "admin-id");
        });

        it("not for the same email in another case, a display name, a deactivation, or the holder's own change", async () => {
            mockUpdateUser.mockResolvedValue({ id: "u1" });
            mockGetUserById.mockResolvedValue({ id: "u1", roles: [], email: "u1@x.io", isActive: true });
            await patch("u1", { email: "U1@X.io" });
            await patch("u1", { displayName: "New name" });
            await patch("u1", { isActive: false });
            await patch("u1", { isActive: true });
            mockGetUserById.mockResolvedValue({ id: "admin-id", roles: [], email: "a@x.io", isActive: true });
            await patch("admin-id", { email: "new@x.io" });
            expect(mockSuspend).not.toHaveBeenCalled();
        });

        it("not when the change was refused", async () => {
            mockGetUserById.mockResolvedValue({ id: "boss", roles: ["super_admin"], email: "b@x.io", isActive: true });
            expect((await patch("boss", { email: "x@x.io" })).status).toBe(403);
            expect((await app.request("/users/boss/reset-password", { method: "POST", headers, body: JSON.stringify({ generatePassword: true }) })).status).toBe(403);
            expect(mockSuspend).not.toHaveBeenCalled();
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
