
import { describe, it, expect, mock, beforeEach } from "bun:test";

import { createUser, getUserById, createRole, listRoles, createAuditLog } from "./rbac";

// Mock data
const mockUser = {
    id: "user-123",
    email: "test@example.com",
    username: "testuser",
    passwordHash: "hashed_password",
    displayName: "Test User",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    isSystemUser: false,
};

const mockRole = {
    id: "role-123",
    name: "developer",
    displayName: "Developer",
    description: "Developer role",
    isSystem: false,
    isDefault: false,
    priority: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
};

const mockPermission = {
    id: "perm-1",
    name: "users.view",
    category: "users",
};

// Define Schema Mocks first so we can reference them
const mockSchema = {
    users: { _: "users_table" },
    roles: { _: "roles_table" },
    userRoles: { _: "user_roles_table" },
    rolePermissions: { _: "role_permissions_table" },
    permissions: { _: "permissions_table" },
    sessions: { _: "sessions_table" },
    auditLogs: { _: "audit_logs_table" },
};

// Generic mock builder generator
const createBuilder = (resolveData: any) => {
    const builder: any = {};
    // Chainable methods
    // Chainable methods
    const methods = ['where', 'orderBy', 'limit', 'offset', 'insert', 'values', 'update', 'set', 'delete', 'from', 'innerJoin', 'leftJoin'];
    methods.forEach(m => {
        builder[m] = mock(() => builder);
    });

    // Resolution
    builder.then = mock((resolve: any) => resolve(resolveData));
    return builder;
};

// Specialized Builders
const userBuilder = createBuilder([mockUser]);
const roleBuilder = createBuilder([mockRole]);
const permissionBuilder = createBuilder([mockPermission]);
const emptyBuilder = createBuilder([]);
const countBuilder = createBuilder([{ count: 1 }]);

// Router Builder - decides which builder to return based on .from(table)
const routerBuilder: any = {};
['select', 'insert', 'update', 'delete', 'where', 'orderBy', 'limit', 'values', 'set', 'innerJoin', 'leftJoin'].forEach(m => {
    routerBuilder[m] = mock(() => routerBuilder);
});

// The .from() method switches to specific builders
routerBuilder.from = mock((table: any) => {
    if (table === mockSchema.users) return userBuilder;
    if (table === mockSchema.roles) return roleBuilder;
    if (table === mockSchema.permissions) return permissionBuilder;
    if (table === mockSchema.userRoles) {
        // userRoles often returned as simple objects or counts
        return createBuilder([{ roleId: "role-123", count: 1 }]);
    }
    if (table === mockSchema.rolePermissions) {
        return createBuilder([{ permissionId: "perm-1" }]);
    }
    return emptyBuilder;
});

// Default resolution for router (if from is not called, e.g. raw insert?)
// But usually insert calls values() then .then().
// If insert(table) is called, then it returns builder.
routerBuilder.then = mock((resolve: any) => resolve([]));


// Mock database
const mockDb = {
    select: mock((args) => {
        // If counting, we might want countBuilder.
        // But we need to know the table first. 
        // Drizzle select({count: ...}).from(...)
        // So we return routerBuilder, and routerBuilder.from() will determine the data.
        // However, if we need different data for count vs list on same table, this pattern is tricky.
        // For now, let's assume count is handled by the builder returning a 'count' property if needed 
        // OR we just return broad mocks.
        // Simplest: 'roleBuilder' returns [mockRole]. userBuilder returns [mockUser].
        // For counts, we might match args? 
        if (args && args.count) {
            // It's a count query.
            // But we don't know the table yet.
            // Let's make a "countRouterBuilder"
            const countRouter = { ...routerBuilder };
            countRouter.from = mock((table: any) => {
                return createBuilder([{ count: 1 }]);
            });
            return countRouter;
        }
        return routerBuilder;
    }),
    insert: mock((table) => {
        // insert(table) -> returns builder specific to that table
        if (table === mockSchema.users) return userBuilder;
        if (table === mockSchema.roles) return roleBuilder;
        if (table === mockSchema.permissions) return permissionBuilder;
        // Default
        return routerBuilder;
    }),
    update: mock((table) => {
        if (table === mockSchema.users) return userBuilder;
        if (table === mockSchema.roles) return roleBuilder;
        return routerBuilder;
    }),
    delete: mock((table) => {
        return routerBuilder;
    }),
};

// Mock dependencies
mock.module("../db", () => ({
    getDatabase: () => mockDb,
    getSchema: () => mockSchema,
    isSqlite: () => true,
}));

mock.module("./password", () => ({
    hashPassword: mock(async () => "hashed_password"),
    verifyPassword: mock(async () => true),
    needsRehash: mock(() => false),
}));

mock.module("./jwt", () => ({
    generateTokenPair: mock(async () => ({ accessToken: "access", refreshToken: "refresh" })),
}));

describe("RBAC Service", () => {
    beforeEach(() => {
        // Reset call history
        mockDb.select.mockClear();
        mockDb.insert.mockClear();
        routerBuilder.from.mockClear();

        // Reset specialized builders if needed (e.g. if we modified them in a test)
    });

    describe("createUser", () => {
        it("should create a user and assign default role", async () => {
            // createUser checks default role -> select from roles
            // then inserts user -> insert user
            // then inserts userRole -> insert userRoles

            // Just verify basic flow and return
            const input = {
                email: "test@example.com",
                username: "testuser",
                password: "password123",
            };

            const result = await createUser(input);

            expect(result.id).toBe("user-123");
            expect(mockDb.insert).toHaveBeenCalled();
        });
    });

    describe("getUserById", () => {
        it("should return user if found", async () => {
            const result = await getUserById("user-123");
            expect(result).not.toBeNull();
            expect(result?.id).toBe("user-123");
            // It expands response, so it calls userRoles (mocked) and roles (mocked)
            // userBuilder returns mockUser.
            // userRoles -> returns [{roleId: "role-123"}]
            // roles -> returns mockRole
        });
    });

    describe("createRole", () => {
        it("should create a role", async () => {
            // createRole -> insert role -> returns roleBuilder -> resolves [mockRole]
            // insert perms...
            // returns getRoleById

            const result = await createRole({
                name: "test",
                displayName: "Test",
                permissionIds: ["p1"]
            });

            expect(result.id).toBe("role-123");
        });
    });

    describe("createAuditLog", () => {
        it("should snapshot user details", async () => {
            // Reset mocks
            routerBuilder.values.mockClear();

            // getUserById will return mockUser because userBuilder returns [mockUser]
            // and getUserRoles/Permissions will likely return [] due to routerBuilder defaults, which is fine

            await createAuditLog("test.action" as any, "user-123");

            expect(routerBuilder.values).toHaveBeenCalled();
            const callArgs = routerBuilder.values.mock.calls[0][0];
            expect(callArgs.usernameSnapshot).toBe("testuser");
            expect(callArgs.emailSnapshot).toBe("test@example.com");
        });
    });

    describe("listRoles", () => {
        it("should list roles", async () => {
            // listRoles -> select from roles -> returns roleBuilder -> [mockRole]
            // then expands...

            const result = await listRoles();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("developer");
        });
    });

});
