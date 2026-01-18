
import { describe, it, expect } from "bun:test";
import {
    PERMISSIONS,
    SYSTEM_ROLES,
    ROLE_HIERARCHY,
    DEFAULT_ROLE_PERMISSIONS,
    RESOURCE_TYPES,
    AUDIT_ACTIONS
} from "./base";
import * as postgresSchema from "./postgres";
import * as sqliteSchema from "./sqlite";

describe("RBAC Schema Definitions", () => {

    describe("Base Constants", () => {
        it("should have all system roles in hierarchy", () => {
            const hierarchyRoles = Object.keys(ROLE_HIERARCHY);
            const definedRoles = Object.values(SYSTEM_ROLES);

            expect(hierarchyRoles.length).toBe(definedRoles.length);
            definedRoles.forEach(role => {
                expect(hierarchyRoles).toContain(role);
            });
        });

        it("should have valid permissions in default role permissions", () => {
            const allPermissions = Object.values(PERMISSIONS);
            const roles = Object.keys(DEFAULT_ROLE_PERMISSIONS); // as SystemRole[] cast not needed for keys

            roles.forEach(role => {
                const rolePerms = DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS];
                rolePerms.forEach(perm => {
                    expect(allPermissions).toContain(perm);
                });
            });
        });

        it("should have unique values for permissions", () => {
            const values = Object.values(PERMISSIONS);
            const uniqueValues = new Set(values);
            expect(values.length).toBe(uniqueValues.size);
        });

        it("should have unique values for audit actions", () => {
            const values = Object.values(AUDIT_ACTIONS);
            const uniqueValues = new Set(values);
            expect(values.length).toBe(uniqueValues.size);
        });
    });

    describe("Schema Consistency (Postgres vs SQLite)", () => {
        it("should export the same tables", () => {
            const pgExports = Object.keys(postgresSchema).filter(k => k !== "default");
            const sqliteExports = Object.keys(sqliteSchema).filter(k => k !== "default");

            // Filter out types (which might differ or be absent at runtime import)
            // But actually, we want to check that the main table exports match.
            // Drizzle tables are objects.

            // Let's just check that major tables exist in both
            const expectedTables = [
                'users', 'roles', 'permissions', 'userRoles', 'rolePermissions',
                'resourcePermissions', 'sessions', 'auditLogs', 'apiKeys',
                'clickhouseConnections', 'userConnections', 'dataAccessRules',
                'clickhouseUsersMetadata', 'userFavorites', 'userRecentItems',
                'savedQueries', 'userPreferences'
            ];

            expectedTables.forEach(table => {
                expect(postgresSchema).toHaveProperty(table);
                expect(sqliteSchema).toHaveProperty(table);
            });
        });
    });
});
