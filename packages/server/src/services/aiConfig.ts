/**
 * Shared AI Configuration Module
 * 
 * Provides AI provider initialization, configuration, and validation
 * used by both the AI optimizer/debugger and the AI chat assistant.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createHuggingFace } from "@ai-sdk/huggingface";
import { AppError } from "../types";

// ============================================
// Types
// ============================================

export type AIProvider = "openai" | "anthropic" | "google" | "huggingface" | "openai-compatible";

export interface AIConfiguration {
    enabled: boolean;
    provider: AIProvider;
    apiKey: string | undefined;
    modelName: string | undefined;
    baseUrl: string | undefined;
    headers: Record<string, string> | undefined;
}

// ============================================
// Configuration
// ============================================

/**
 * Get AI configuration from environment variables
 */
export function getConfiguration(): AIConfiguration {
    const provider = (process.env.AI_PROVIDER || "openai") as AIProvider;
    return {
        enabled: process.env.AI_OPTIMIZER_ENABLED === "true",
        provider,
        apiKey: process.env.AI_API_KEY,
        modelName: process.env.AI_MODEL_NAME,
        baseUrl: process.env.AI_BASE_URL,
        headers: process.env.AI_OPENAI_COMPATIBLE_HEADERS
            ? JSON.parse(process.env.AI_OPENAI_COMPATIBLE_HEADERS)
            : undefined,
    };
}

/**
 * Validate AI configuration
 */
export function validateConfiguration(): { valid: boolean; error?: string } {
    const config = getConfiguration();

    if (!config.enabled) {
        return {
            valid: false,
            error: "AI features are not enabled. Please contact your administrator.",
        };
    }

    if (!config.apiKey) {
        return {
            valid: false,
            error: "AI features are not configured. Missing AI_API_KEY.",
        };
    }

    // Validate provider
    const validProviders: AIProvider[] = ["openai", "anthropic", "google", "huggingface", "openai-compatible"];
    if (!validProviders.includes(config.provider)) {
        return {
            valid: false,
            error: `Invalid AI provider: ${config.provider}.Supported: ${validProviders.join(", ")}`,
        };
    }

    // Validate baseUrl protocol for openai-compatible
    if (config.provider === "openai-compatible") {
        if (!config.baseUrl) {
            return {
                valid: false,
                error: "AI_BASE_URL is required when using the openai-compatible provider",
            };
        }
    }

    if (config.baseUrl) {
        try {
            const url = new URL(config.baseUrl);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
                return {
                    valid: false,
                    error: "AI_BASE_URL must be a valid HTTP/HTTPS URL",
                };
            }
        } catch (e) {
            return {
                valid: false,
                error: "AI_BASE_URL must be a valid URL",
            };
        }
    }

    return { valid: true };
}

/**
 * Initialize AI model based on provider configuration
 */
export function initializeAIModel(config: AIConfiguration) {
    // Model name must be provided via env or config
    const modelName = config.modelName;

    if (!modelName) {
        throw new AppError("AI model name is not configured. Please set AI_MODEL_NAME environment variable.", "AI_CONFIGURATION_ERROR", "validation", 500);
    }

    switch (config.provider) {
        case "openai": {
            const provider = createOpenAI({
                apiKey: config.apiKey,
                baseURL: config.baseUrl,
            });
            return provider(modelName);
        }
        case "anthropic": {
            const provider = createAnthropic({
                apiKey: config.apiKey,
                baseURL: config.baseUrl,
            });
            return provider(modelName);
        }
        case "google": {
            const provider = createGoogleGenerativeAI({
                apiKey: config.apiKey,
                baseURL: config.baseUrl,
            });
            return provider(modelName);
        }
        case "huggingface": {
            const provider = createHuggingFace({
                apiKey: config.apiKey,
                baseURL: config.baseUrl,
            });
            return provider(modelName);
        }
        case "openai-compatible": {
            if (!config.baseUrl) {
                throw new AppError("AI_BASE_URL is required for openai-compatible", "AI_CONFIGURATION_ERROR", "validation", 500);
            }
            const provider = createOpenAICompatible({
                name: "openai-compatible",
                baseURL: config.baseUrl,
                apiKey: config.apiKey,
                headers: config.headers,
            });
            return provider(modelName);
        }
        default:
            throw new AppError(
                `Unsupported AI provider: ${config.provider} `,
                "CONFIGURATION_ERROR",
                "unknown",
                500
            );
    }
}

/**
 * Check if AI features are enabled
 */
export function isAIEnabled(): boolean {
    return getConfiguration().enabled;
}
