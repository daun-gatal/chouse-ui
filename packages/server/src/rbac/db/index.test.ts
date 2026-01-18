
import { describe, it, expect, mock, beforeEach, afterAll, beforeAll } from "bun:test";
import {
    initializeDatabase,
    getDatabase,
    closeDatabase,
    getDatabaseConfig,
    checkDatabaseHealth,
    isSqlite,
    isPostgres
} from "./index";

// Mock dependencies
const mockSqliteClient = { exec: mock(), close: mock(), run: mock() };
mock.module("bun:sqlite", () => ({
    Database: mock().mockImplementation(() => mockSqliteClient)
}));

const mockPostgresClient = mock(() => ({
    end: mock(),
    unsafe: mock(),
    execute: mock()
}));
mock.module("postgres", () => mockPostgresClient);

// Mock Drizzle
mock.module("drizzle-orm/bun-sqlite", () => ({
    drizzle: mock(() => ({ run: mock() }))
}));
mock.module("drizzle-orm/postgres-js", () => ({
    drizzle: mock(() => ({ execute: mock() }))
}));

// Mock FS
mock.module("fs", () => ({
    existsSync: mock(() => true)
}));
mock.module("fs/promises", () => ({
    mkdir: mock(async () => { })
}));

describe("RBAC Database Layer", () => {
    // Save original env
    const originalEnv = process.env;

    beforeEach(async () => {
        // Reset env
        process.env = { ...originalEnv };
        // Close DB if open
        await closeDatabase();
        // Clear mocks
        mockSqliteClient.exec.mockClear();
        mockSqliteClient.close.mockClear();
    });

    afterAll(async () => {
        process.env = originalEnv;
        await closeDatabase();
        mock.restore();
    });

    describe("getDatabaseConfig", () => {
        it("should default to sqlite", () => {
            delete process.env.RBAC_DB_TYPE;
            const config = getDatabaseConfig();
            expect(config.type).toBe("sqlite");
            expect(config.sqlitePath).toContain("rbac.db");
        });

        it("should parse postgres config", () => {
            process.env.RBAC_DB_TYPE = "postgres";
            process.env.RBAC_POSTGRES_URL = "postgres://user:pass@localhost:5432/db";
            const config = getDatabaseConfig();
            expect(config.type).toBe("postgres");
            expect(config.postgresUrl).toBe("postgres://user:pass@localhost:5432/db");
        });
    });

    describe("initializeDatabase", () => {
        it("should initialize sqlite", async () => {
            process.env.RBAC_DB_TYPE = "sqlite";

            const db = await initializeDatabase();
            expect(db).toBeDefined();
            expect(isSqlite()).toBe(true);
            expect(isPostgres()).toBe(false);
            expect(mockSqliteClient.exec).toHaveBeenCalled(); // Pragma calls
        });

        // This test might fail if getDatabaseConfig reads env once at module load time. 
        // Based on code reading: `const dbType = (process.env.RBAC_DB_TYPE || 'sqlite')`.
        // It is inside `getDatabaseConfig`, so it should be dynamic. 

        it("should initialize postgres", async () => {
            process.env.RBAC_DB_TYPE = "postgres";
            process.env.RBAC_POSTGRES_URL = "postgres://localhost/db";

            const db = await initializeDatabase();
            expect(db).toBeDefined();
            expect(isPostgres()).toBe(true);
        });

        it("should return existing instance if called twice", async () => {
            process.env.RBAC_DB_TYPE = "sqlite";

            const db1 = await initializeDatabase();
            const db2 = await initializeDatabase();

            expect(db1).toBe(db2);
            // Should not init twice
            expect(mockSqliteClient.exec).toHaveBeenCalledTimes(2); // 2 pragma calls from FIRST init only
        });
    });

    describe("getDatabase", () => {
        it("should throw if not initialized", () => {
            expect(() => getDatabase()).toThrow("Database not initialized");
        });

        it("should return db if initialized", async () => {
            await initializeDatabase();
            expect(getDatabase()).toBeDefined();
        });
    });

    describe("checkDatabaseHealth", () => {
        it("should return healthy for sqlite", async () => {
            process.env.RBAC_DB_TYPE = "sqlite";
            await initializeDatabase();

            const health = await checkDatabaseHealth();
            expect(health.healthy).toBe(true);
            expect(health.type).toBe("sqlite");
        });
    });

    describe("closeDatabase", () => {
        it("should close sqlite client", async () => {
            process.env.RBAC_DB_TYPE = "sqlite";
            await initializeDatabase();

            await closeDatabase();
            expect(mockSqliteClient.close).toHaveBeenCalled();

            // Verify it clears instance
            expect(() => getDatabase()).toThrow("Database not initialized");
        });
    });
});
