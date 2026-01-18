
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock DB
const mockCheckDatabaseHealth = mock();
const mockGetMigrationStatus = mock();

mock.module("../db", () => ({
    checkDatabaseHealth: mockCheckDatabaseHealth,
    getMigrationStatus: mockGetMigrationStatus,
    APP_VERSION: "1.0.0-test"
}));

// We need to mock the sub-routes to avoid loading their dependencies
mock.module("./auth", () => ({ default: new Hono() }));
mock.module("./users", () => ({ default: new Hono() }));
mock.module("./roles", () => ({ default: new Hono() }));
mock.module("./audit", () => ({ default: new Hono() }));
mock.module("./connections", () => ({ default: new Hono() }));
mock.module("./dataAccess", () => ({ default: new Hono() }));
mock.module("./clickhouseUsers", () => ({ default: new Hono() }));
mock.module("./userPreferences", () => ({ default: new Hono() }));

import rbacRoutes from "./index";

describe("RBAC Index Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.route("/rbac", rbacRoutes);

        mockCheckDatabaseHealth.mockClear();
        mockGetMigrationStatus.mockClear();
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /rbac/health", () => {
        it("should return 200 when healthy", async () => {
            mockCheckDatabaseHealth.mockResolvedValue({ healthy: true, type: 'postgres' });

            const res = await app.request("/rbac/health");
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.status).toBe('healthy');
        });

        it("should return 503 when unhealthy", async () => {
            mockCheckDatabaseHealth.mockResolvedValue({ healthy: false, type: 'postgres', error: 'down' });

            const res = await app.request("/rbac/health");
            expect(res.status).toBe(503);
            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.data.status).toBe('unhealthy');
        });
    });

    describe("GET /rbac/status", () => {
        it("should return status", async () => {
            mockCheckDatabaseHealth.mockResolvedValue({ healthy: true, type: 'postgres' });
            mockGetMigrationStatus.mockResolvedValue({
                currentVersion: 1,
                targetVersion: 1,
                pendingMigrations: [],
                appliedMigrations: [1]
            });

            const res = await app.request("/rbac/status");
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.version).toBe("1.0.0-test");
            expect(body.data.migrations.appliedCount).toBe(1);
        });
    });
});
