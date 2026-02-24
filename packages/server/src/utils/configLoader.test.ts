import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { flattenConfig } from "./configLoader";

describe("configLoader", () => {
    const TEST_YAML_FILE = "./test-config.yaml";
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        // Reset process.env before each test to prevent cross-contamination
        process.env = { ...ORIGINAL_ENV };
    });

    afterEach(() => {
        // Clean up mock config files and restore env
        if (fs.existsSync(TEST_YAML_FILE)) {
            fs.unlinkSync(TEST_YAML_FILE);
        }
        process.env = ORIGINAL_ENV;
    });

    describe("flattenConfig", () => {
        it("should flatten a simple one-level object", () => {
            const config = { port: 5521, node_env: "production" };
            const flat = flattenConfig(config);
            expect(flat).toEqual({
                PORT: "5521",
                NODE_ENV: "production",
            });
        });

        it("should flatten a nested object", () => {
            const config = {
                rbac: {
                    db_type: "sqlite",
                    sqlite_path: "./data.db",
                },
            };
            const flat = flattenConfig(config);
            expect(flat).toEqual({
                RBAC_DB_TYPE: "sqlite",
                RBAC_SQLITE_PATH: "./data.db",
            });
        });

        it("should flatten deeply nested objects", () => {
            const config = {
                rbac: {
                    admin: {
                        email: "admin@test.com",
                        username: "admin",
                    },
                },
                ai: {
                    provider: "openai",
                },
            };

            const flat = flattenConfig(config);
            expect(flat).toEqual({
                RBAC_ADMIN_EMAIL: "admin@test.com",
                RBAC_ADMIN_USERNAME: "admin",
                AI_PROVIDER: "openai",
            });
        });

        it("should convert arrays and numbers to strings strings", () => {
            const config = {
                cors: {
                    origins: ["*", "localhost"]
                },
                port: 3000
            };

            const flat = flattenConfig(config);
            expect(flat).toEqual({
                CORS_ORIGINS: "*,localhost",
                PORT: "3000"
            });
        });
    });
});
