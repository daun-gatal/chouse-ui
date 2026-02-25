import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
    isOptimizerEnabled,
    getSystemPrompt,
    buildOptimizationPrompt,
    optimizeQuery,
    debugQuery,
    type TableSchema,
} from "./aiOptimizer";
import type { TableDetails } from "../types";
import { AppError } from "../types";

mock.module("../rbac/services/aiModels", () => {
    return {
        getDefaultAiConfig: async () => {
            if (process.env.AI_OPTIMIZER_ENABLED !== 'true') return null;
            const providerType = (process.env.AI_PROVIDER || "openai") as "openai" | "anthropic" | "google" | "huggingface" | "openai-compatible";
            return {
                id: "test",
                isActive: true,
                provider: {
                    id: "provider1",
                    name: process.env.AI_PROVIDER || "openai",
                    providerType: providerType,
                    apiKey: process.env.AI_API_KEY !== undefined ? process.env.AI_API_KEY : null,
                    baseUrl: process.env.AI_BASE_URL || null,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                model: {
                    id: "model1",
                    providerId: "provider1",
                    name: "Test Model",
                    modelId: "test-model",
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                modelId: "model1",
                name: "Test Config",
                isDefault: true,
                createdBy: null,
                createdAt: new Date(),
                updatedAt: new Date()
            };
        },
        getAiConfigById: async (id: string) => {
            if (process.env.AI_OPTIMIZER_ENABLED !== 'true') return null;
            const providerType = (process.env.AI_PROVIDER || "openai") as "openai" | "anthropic" | "google" | "huggingface" | "openai-compatible";
            return {
                id: "test",
                isActive: true,
                provider: {
                    id: "provider1",
                    name: process.env.AI_PROVIDER || "openai",
                    providerType: providerType,
                    apiKey: process.env.AI_API_KEY !== undefined ? process.env.AI_API_KEY : null,
                    baseUrl: process.env.AI_BASE_URL || null,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                model: {
                    id: "model1",
                    providerId: "provider1",
                    name: "Test Model",
                    modelId: "test-model",
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                modelId: "model1",
                name: "Test Config",
                isDefault: true,
                createdBy: null,
                createdAt: new Date(),
                updatedAt: new Date()
            };
        },
        getAiConfigWithKey: async (id: string) => {
            if (process.env.AI_OPTIMIZER_ENABLED !== 'true') return null;
            const providerType = (process.env.AI_PROVIDER || "openai") as "openai" | "anthropic" | "google" | "huggingface" | "openai-compatible";
            return {
                id: "test",
                isActive: true,
                provider: {
                    id: "provider1",
                    name: process.env.AI_PROVIDER || "openai",
                    providerType: providerType,
                    apiKey: process.env.AI_API_KEY !== undefined ? process.env.AI_API_KEY : null,
                    baseUrl: process.env.AI_BASE_URL || null,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                model: {
                    id: "model1",
                    providerId: "provider1",
                    name: "Test Model",
                    modelId: "test-model",
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                modelId: "model1",
                name: "Test Config",
                isDefault: true,
                createdBy: null,
                createdAt: new Date(),
                updatedAt: new Date()
            };
        }
    };
});
describe("aiOptimizer", () => {
    describe("isOptimizerEnabled", () => {
        it("should return false when AI_OPTIMIZER_ENABLED is not set", async () => {
            const originalValue = process.env.AI_OPTIMIZER_ENABLED;
            delete process.env.AI_OPTIMIZER_ENABLED;

            const result = await isOptimizerEnabled();

            expect(result).toBe(false);

            // Restore
            if (originalValue !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalValue;
            }
        });

        it("should return true when AI_OPTIMIZER_ENABLED is 'true'", async () => {
            const originalValue = process.env.AI_OPTIMIZER_ENABLED;
            process.env.AI_OPTIMIZER_ENABLED = "true";

            const result = await isOptimizerEnabled();

            expect(result).toBe(true);

            // Restore
            if (originalValue !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalValue;
            } else {
                delete process.env.AI_OPTIMIZER_ENABLED;
            }
        });

        it("should return false when AI_OPTIMIZER_ENABLED is 'false'", async () => {
            const originalValue = process.env.AI_OPTIMIZER_ENABLED;
            process.env.AI_OPTIMIZER_ENABLED = "false";

            const result = await isOptimizerEnabled();

            expect(result).toBe(false);

            // Restore
            if (originalValue !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalValue;
            } else {
                delete process.env.AI_OPTIMIZER_ENABLED;
            }
        });
    });

    describe("getSystemPrompt", () => {
        it("should return a non-empty system prompt", async () => {
            const prompt = await getSystemPrompt();

            expect(prompt).toBeDefined();
            expect(prompt.length).toBeGreaterThan(0);
            expect(prompt).toContain("ClickHouse");
            expect(prompt).toContain("optimize");
        });
    });

    describe("buildOptimizationPrompt", () => {
        it("should build a prompt with query and table DDLs", () => {
            const query = "SELECT * FROM users WHERE id = 1";
            const tableDetails: TableDetails[] = [
                {
                    database: "default",
                    table: "users",
                    engine: "MergeTree",
                    total_rows: "100",
                    total_bytes: "1024",
                    columns: [],
                    create_table_query: "CREATE TABLE users (id UInt64, name String) ENGINE = MergeTree ORDER BY id",
                },
            ];

            const prompt = buildOptimizationPrompt(query, tableDetails);

            expect(prompt).toContain(query);
            expect(prompt).toContain("TABLE: default.users");
            expect(prompt).toContain("CREATE TABLE users");
        });

        it("should build a prompt with additional instructions when provided", () => {
            const query = "SELECT * FROM users";
            const tableDetails: TableDetails[] = [];
            const additionalPrompt = "Optimize for speed";

            const prompt = buildOptimizationPrompt(query, tableDetails, additionalPrompt);

            expect(prompt).toContain("Additional Instructions:");
            expect(prompt).toContain(additionalPrompt);
        });
    });

    describe("optimizeQuery", () => {
        it("should throw error when optimizer is disabled", async () => {
            const originalEnabled = process.env.AI_OPTIMIZER_ENABLED;
            process.env.AI_OPTIMIZER_ENABLED = "false";

            const query = "SELECT * FROM users";
            const tableDetails: TableDetails[] = [];

            try {
                await optimizeQuery(query, tableDetails);
                expect(true).toBe(false);
            } catch (error) {
                expect(error).toBeDefined();
            }

            if (originalEnabled !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalEnabled;
            }
        });

        it("should throw error when API key is missing", async () => {
            const originalEnabled = process.env.AI_OPTIMIZER_ENABLED;
            const originalApiKey = process.env.AI_API_KEY;

            process.env.AI_OPTIMIZER_ENABLED = "true";
            delete process.env.AI_API_KEY;

            const query = "SELECT * FROM users";
            const tableDetails: TableDetails[] = [];

            try {
                await optimizeQuery(query, tableDetails);
                expect(true).toBe(false); // Should not reach here
            } catch (error) {
                expect(error).toBeDefined();
                if (error instanceof Error) {
                    expect(error.message).toContain("API key is missing");
                }
            }

            // Restore
            if (originalEnabled !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalEnabled;
            } else {
                delete process.env.AI_OPTIMIZER_ENABLED;
            }
            if (originalApiKey !== undefined) {
                process.env.AI_API_KEY = originalApiKey;
            } else {
                delete process.env.AI_API_KEY;
            }
        });

        // Note: Testing actual AI optimization would require mocking the AI SDK
        // or using integration tests with a real API key. For unit tests, we focus
        // on configuration validation and error handling.
    });

    describe("validateConfiguration (via optimizeQuery)", () => {
        it("should throw error if openai-compatible is missing baseUrl", async () => {
            const originalEnabled = process.env.AI_OPTIMIZER_ENABLED;
            const originalProvider = process.env.AI_PROVIDER;
            const originalApiKey = process.env.AI_API_KEY;

            process.env.AI_OPTIMIZER_ENABLED = "true";
            process.env.AI_PROVIDER = "openai-compatible";
            process.env.AI_API_KEY = "test-key";
            delete process.env.AI_BASE_URL;

            try {
                await optimizeQuery("SELECT 1", []);
                expect(true).toBe(false);
            } catch (error) {
                expect(error instanceof AppError && error.message.includes("Base URL is required")).toBe(true);
            }

            if (originalEnabled !== undefined) process.env.AI_OPTIMIZER_ENABLED = originalEnabled;
            else delete process.env.AI_OPTIMIZER_ENABLED;
            if (originalProvider !== undefined) process.env.AI_PROVIDER = originalProvider;
            else delete process.env.AI_PROVIDER;
            if (originalApiKey !== undefined) process.env.AI_API_KEY = originalApiKey;
            else delete process.env.AI_API_KEY;
        });

        it("should throw error if openai-compatible baseUrl is invalid protocol", async () => {
            const originalEnabled = process.env.AI_OPTIMIZER_ENABLED;
            const originalProvider = process.env.AI_PROVIDER;
            const originalApiKey = process.env.AI_API_KEY;
            const originalBaseUrl = process.env.AI_BASE_URL;

            process.env.AI_OPTIMIZER_ENABLED = "true";
            process.env.AI_PROVIDER = "openai-compatible";
            process.env.AI_API_KEY = "test-key";
            process.env.AI_BASE_URL = "ftp://localhost:11434"; // Invalid protocol

            try {
                await optimizeQuery("SELECT 1", []);
                expect(true).toBe(false);
            } catch (error) {
                expect(error instanceof Error && error.message.includes("HTTP/HTTPS URL")).toBe(true);
            }

            if (originalEnabled !== undefined) process.env.AI_OPTIMIZER_ENABLED = originalEnabled;
            else delete process.env.AI_OPTIMIZER_ENABLED;
            if (originalProvider !== undefined) process.env.AI_PROVIDER = originalProvider;
            else delete process.env.AI_PROVIDER;
            if (originalApiKey !== undefined) process.env.AI_API_KEY = originalApiKey;
            else delete process.env.AI_API_KEY;
            if (originalBaseUrl !== undefined) process.env.AI_BASE_URL = originalBaseUrl;
            else delete process.env.AI_BASE_URL;
        });
    });

    describe("debugQuery", () => {
        it("should throw error when debug is disabled", async () => {
            const originalEnabled = process.env.AI_OPTIMIZER_ENABLED;
            process.env.AI_OPTIMIZER_ENABLED = "false";

            const query = "SELECT * FROM users";
            const errorMsg = "Table not found";

            try {
                await debugQuery(query, errorMsg);
                expect(true).toBe(false);
            } catch (error) {
                expect(error).toBeDefined();
            }

            if (originalEnabled !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalEnabled;
            }
        });

        it("should throw error when API key is missing", async () => {
            const originalEnabled = process.env.AI_OPTIMIZER_ENABLED;
            process.env.AI_API_KEY = ""; // Ensure empty

            process.env.AI_OPTIMIZER_ENABLED = "true";

            const query = "SELECT * FROM users";
            const errorMsg = "Table not found";

            try {
                await debugQuery(query, errorMsg);
                expect(true).toBe(false); // Should not reach here
            } catch (error) {
                expect(error).toBeDefined();
                if (error instanceof Error) {
                    expect(error.message).toContain("API key is missing");
                }
            }

            // Restore
            if (originalEnabled !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalEnabled;
            } else {
                delete process.env.AI_OPTIMIZER_ENABLED;
            }
        });
    });

});
