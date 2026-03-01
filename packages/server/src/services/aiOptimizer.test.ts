import { describe, it, expect, mock } from "bun:test";
import {
    isOptimizerEnabled,
    getSystemPrompt,
    buildOptimizationPrompt,
    buildDebugPrompt,
    optimizeQuery,
    debugQuery,
} from "./aiOptimizer";
import type { AgentToolContext } from "./agentTools";
import { AppError } from "../types";

// ============================================
// AI Models Mock
// ============================================

mock.module("../rbac/services/aiModels", () => {
    return {
        getDefaultAiConfig: async () => {
            if (process.env.AI_OPTIMIZER_ENABLED !== "true") return null;
            const providerType = (
                process.env.AI_PROVIDER || "openai"
            ) as
                | "openai"
                | "anthropic"
                | "google"
                | "huggingface"
                | "openai-compatible";
            return {
                id: "test",
                isActive: true,
                provider: {
                    id: "provider1",
                    name: process.env.AI_PROVIDER || "openai",
                    providerType,
                    apiKey:
                        process.env.AI_API_KEY !== undefined
                            ? process.env.AI_API_KEY
                            : null,
                    baseUrl: process.env.AI_BASE_URL || null,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                model: {
                    id: "model1",
                    providerId: "provider1",
                    name: "Test Model",
                    modelId: "test-model",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                modelId: "model1",
                name: "Test Config",
                isDefault: true,
                createdBy: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
        },
        getAiConfigById: async (_id: string) => {
            if (process.env.AI_OPTIMIZER_ENABLED !== "true") return null;
            const providerType = (
                process.env.AI_PROVIDER || "openai"
            ) as
                | "openai"
                | "anthropic"
                | "google"
                | "huggingface"
                | "openai-compatible";
            return {
                id: "test",
                isActive: true,
                provider: {
                    id: "provider1",
                    name: process.env.AI_PROVIDER || "openai",
                    providerType,
                    apiKey:
                        process.env.AI_API_KEY !== undefined
                            ? process.env.AI_API_KEY
                            : null,
                    baseUrl: process.env.AI_BASE_URL || null,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                model: {
                    id: "model1",
                    providerId: "provider1",
                    name: "Test Model",
                    modelId: "test-model",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                modelId: "model1",
                name: "Test Config",
                isDefault: true,
                createdBy: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
        },
        getAiConfigWithKey: async (_id: string) => {
            if (process.env.AI_OPTIMIZER_ENABLED !== "true") return null;
            const providerType = (
                process.env.AI_PROVIDER || "openai"
            ) as
                | "openai"
                | "anthropic"
                | "google"
                | "huggingface"
                | "openai-compatible";
            return {
                id: "test",
                isActive: true,
                provider: {
                    id: "provider1",
                    name: process.env.AI_PROVIDER || "openai",
                    providerType,
                    apiKey:
                        process.env.AI_API_KEY !== undefined
                            ? process.env.AI_API_KEY
                            : null,
                    baseUrl: process.env.AI_BASE_URL || null,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                model: {
                    id: "model1",
                    providerId: "provider1",
                    name: "Test Model",
                    modelId: "test-model",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                modelId: "model1",
                name: "Test Config",
                isDefault: true,
                createdBy: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
        },
    };
});

// ============================================
// Helpers
// ============================================

/** Minimal AgentToolContext stub for testing config-validation paths. */
function makeTestContext(): AgentToolContext {
    return {
        userId: "test-user",
        isAdmin: false,
        permissions: [],
        connectionId: undefined,
        // The clickhouseService is never called in config-validation tests
        clickhouseService: {} as AgentToolContext["clickhouseService"],
        defaultDatabase: "default",
    };
}

// ============================================
// Tests
// ============================================

describe("aiOptimizer", () => {
    // ----------------------------------------
    describe("isOptimizerEnabled", () => {
        it("should return false when AI_OPTIMIZER_ENABLED is not set", async () => {
            const originalValue = process.env.AI_OPTIMIZER_ENABLED;
            delete process.env.AI_OPTIMIZER_ENABLED;

            const result = await isOptimizerEnabled();
            expect(result).toBe(false);

            if (originalValue !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalValue;
            }
        });

        it("should return true when AI_OPTIMIZER_ENABLED is 'true'", async () => {
            const originalValue = process.env.AI_OPTIMIZER_ENABLED;
            process.env.AI_OPTIMIZER_ENABLED = "true";

            const result = await isOptimizerEnabled();
            expect(result).toBe(true);

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

            if (originalValue !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalValue;
            } else {
                delete process.env.AI_OPTIMIZER_ENABLED;
            }
        });
    });

    // ----------------------------------------
    describe("getSystemPrompt", () => {
        it("should return a non-empty system prompt", async () => {
            const prompt = await getSystemPrompt();

            expect(prompt).toBeDefined();
            expect(prompt.length).toBeGreaterThan(0);
            expect(prompt).toContain("ClickHouse");
            expect(prompt).toContain("optimize");
        });
    });

    // ----------------------------------------
    describe("buildOptimizationPrompt", () => {
        it("should include the query in the prompt", () => {
            const query = "SELECT * FROM users WHERE id = 1";
            const prompt = buildOptimizationPrompt(query);

            expect(prompt).toContain(query);
            expect(prompt).toContain("get_table_ddl");
            expect(prompt).toContain("query-optimizer");
        });

        it("should include additional instructions when provided", () => {
            const query = "SELECT * FROM users";
            const additionalPrompt = "Optimize for speed";

            const prompt = buildOptimizationPrompt(query, additionalPrompt);

            expect(prompt).toContain("Additional instructions from the user");
            expect(prompt).toContain(additionalPrompt);
        });

        it("should not include additional section when additionalPrompt is empty", () => {
            const query = "SELECT * FROM users";

            const prompt = buildOptimizationPrompt(query, "");

            expect(prompt).not.toContain("Additional instructions");
        });
    });

    // ----------------------------------------
    describe("buildDebugPrompt", () => {
        it("should include query and error in the prompt", () => {
            const query = "SELECT * FROM nonexistent";
            const error = "Table not found";
            const prompt = buildDebugPrompt(query, error);

            expect(prompt).toContain(query);
            expect(prompt).toContain(error);
            expect(prompt).toContain("query-debugger");
            expect(prompt).toContain("validate_sql");
        });

        it("should include additional instructions when provided", () => {
            const query = "SELECT * FROM users";
            const error = "Column 'foo' does not exist";
            const additionalPrompt = "Keep the GROUP BY intact";

            const prompt = buildDebugPrompt(query, error, additionalPrompt);

            expect(prompt).toContain("Additional instructions from the user");
            expect(prompt).toContain(additionalPrompt);
        });
    });

    // ----------------------------------------
    describe("optimizeQuery — configuration validation", () => {
        it("should throw error when optimizer is disabled", async () => {
            const originalEnabled = process.env.AI_OPTIMIZER_ENABLED;
            process.env.AI_OPTIMIZER_ENABLED = "false";

            try {
                await optimizeQuery("SELECT * FROM users", makeTestContext());
                expect(true).toBe(false); // unreachable
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

            try {
                await optimizeQuery("SELECT * FROM users", makeTestContext());
                expect(true).toBe(false);
            } catch (error) {
                expect(error).toBeDefined();
                if (error instanceof Error) {
                    expect(error.message).toContain("API key is missing");
                }
            }

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

        it("should throw error if openai-compatible is missing baseUrl", async () => {
            const originalEnabled = process.env.AI_OPTIMIZER_ENABLED;
            const originalProvider = process.env.AI_PROVIDER;
            const originalApiKey = process.env.AI_API_KEY;

            process.env.AI_OPTIMIZER_ENABLED = "true";
            process.env.AI_PROVIDER = "openai-compatible";
            process.env.AI_API_KEY = "test-key";
            delete process.env.AI_BASE_URL;

            try {
                await optimizeQuery("SELECT 1", makeTestContext());
                expect(true).toBe(false);
            } catch (error) {
                expect(
                    error instanceof AppError &&
                        error.message.includes("Base URL is required")
                ).toBe(true);
            }

            if (originalEnabled !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalEnabled;
            } else {
                delete process.env.AI_OPTIMIZER_ENABLED;
            }
            if (originalProvider !== undefined) {
                process.env.AI_PROVIDER = originalProvider;
            } else {
                delete process.env.AI_PROVIDER;
            }
            if (originalApiKey !== undefined) {
                process.env.AI_API_KEY = originalApiKey;
            } else {
                delete process.env.AI_API_KEY;
            }
        });

        it("should throw error if openai-compatible baseUrl has invalid protocol", async () => {
            const originalEnabled = process.env.AI_OPTIMIZER_ENABLED;
            const originalProvider = process.env.AI_PROVIDER;
            const originalApiKey = process.env.AI_API_KEY;
            const originalBaseUrl = process.env.AI_BASE_URL;

            process.env.AI_OPTIMIZER_ENABLED = "true";
            process.env.AI_PROVIDER = "openai-compatible";
            process.env.AI_API_KEY = "test-key";
            process.env.AI_BASE_URL = "ftp://localhost:11434";

            try {
                await optimizeQuery("SELECT 1", makeTestContext());
                expect(true).toBe(false);
            } catch (error) {
                expect(
                    error instanceof Error &&
                        error.message.includes("HTTP/HTTPS URL")
                ).toBe(true);
            }

            if (originalEnabled !== undefined) {
                process.env.AI_OPTIMIZER_ENABLED = originalEnabled;
            } else {
                delete process.env.AI_OPTIMIZER_ENABLED;
            }
            if (originalProvider !== undefined) {
                process.env.AI_PROVIDER = originalProvider;
            } else {
                delete process.env.AI_PROVIDER;
            }
            if (originalApiKey !== undefined) {
                process.env.AI_API_KEY = originalApiKey;
            } else {
                delete process.env.AI_API_KEY;
            }
            if (originalBaseUrl !== undefined) {
                process.env.AI_BASE_URL = originalBaseUrl;
            } else {
                delete process.env.AI_BASE_URL;
            }
        });
    });

    // ----------------------------------------
    describe("debugQuery — configuration validation", () => {
        it("should throw error when debug is disabled", async () => {
            const originalEnabled = process.env.AI_OPTIMIZER_ENABLED;
            process.env.AI_OPTIMIZER_ENABLED = "false";

            try {
                await debugQuery(
                    "SELECT * FROM users",
                    "Table not found",
                    makeTestContext()
                );
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
            process.env.AI_API_KEY = "";

            try {
                await debugQuery(
                    "SELECT * FROM users",
                    "Table not found",
                    makeTestContext()
                );
                expect(true).toBe(false);
            } catch (error) {
                expect(error).toBeDefined();
                if (error instanceof Error) {
                    expect(error.message).toContain("API key is missing");
                }
            }

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
    });
});
