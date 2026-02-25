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
import { getAiConfigById, getDefaultAiConfig, getAiConfigWithKey } from "../rbac/services/aiModels";
import type { AiConfigWithKey } from "../rbac/services/aiModels";

// ============================================
// Types
// ============================================

export type AIProvider = "openai" | "anthropic" | "google" | "huggingface" | "openai-compatible";

// ============================================
// Configuration
// ============================================

/**
 * Get AI configuration from the database. 
 * If a modelId is provided, it fetches that specific config. 
 * Otherwise, it fetches the default active config.
 */
export async function getConfiguration(configId?: string): Promise<AiConfigWithKey | null> {
    if (configId) {
        const config = await getAiConfigById(configId);
        // We need the key to initialize the SDK
        if (config) {
            return getAiConfigWithKey(configId);
        }
        return null;
    }

    return getDefaultAiConfig();
}

/**
 * Validate AI configuration
 */
export function validateConfiguration(config: AiConfigWithKey | null): { valid: boolean; error?: string } {
    if (!config) {
        return {
            valid: false,
            error: "No active AI model found. Please configure an AI model in the Admin page.",
        };
    }

    if (!config.isActive) {
        return {
            valid: false,
            error: "The selected AI model configuration is not active.",
        };
    }

    if (!config.provider.apiKey) {
        return {
            valid: false,
            error: `API key is missing for provider ${config.provider.name}. Please supply an API key in the Admin UI.`,
        };
    }

    // Validate provider
    const validProviders: string[] = ["openai", "anthropic", "google", "huggingface", "openai-compatible"];
    if (!validProviders.includes(config.provider.name)) {
        return {
            valid: false,
            error: `Invalid AI provider: ${config.provider.name}. Supported: ${validProviders.join(", ")}`,
        };
    }

    // Validate baseUrl protocol for openai-compatible
    if (config.provider.name === "openai-compatible") {
        if (!config.provider.baseUrl) {
            return {
                valid: false,
                error: "Base URL is required when using the openai-compatible provider.",
            };
        }
    }

    if (config.provider.baseUrl) {
        try {
            const url = new URL(config.provider.baseUrl);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
                return {
                    valid: false,
                    error: "Base URL must be a valid HTTP/HTTPS URL.",
                };
            }
        } catch (e) {
            return {
                valid: false,
                error: "Base URL must be a valid URL.",
            };
        }
    }

    return { valid: true };
}

/**
 * Initialize AI model based on provider configuration
 */
export function initializeAIModel(config: AiConfigWithKey) {
    const modelName = config.model.modelId;

    if (!modelName) {
        throw new AppError("AI model ID string is not configured.", "AI_CONFIGURATION_ERROR", "validation", 500);
    }

    switch (config.provider.name) {
        case "openai": {
            const OpenAIProvider = createOpenAI({
                apiKey: config.provider.apiKey || undefined,
                baseURL: config.provider.baseUrl || undefined,
            });
            return OpenAIProvider(modelName);
        }
        case "anthropic": {
            const AnthropicProvider = createAnthropic({
                apiKey: config.provider.apiKey || undefined,
                baseURL: config.provider.baseUrl || undefined,
            });
            return AnthropicProvider(modelName);
        }
        case "google": {
            const GoogleProvider = createGoogleGenerativeAI({
                apiKey: config.provider.apiKey || undefined,
                baseURL: config.provider.baseUrl || undefined,
            });
            return GoogleProvider(modelName);
        }
        case "huggingface": {
            const HuggingFaceProvider = createHuggingFace({
                apiKey: config.provider.apiKey || undefined,
                baseURL: config.provider.baseUrl || undefined,
            });
            return HuggingFaceProvider(modelName);
        }
        case "openai-compatible": {
            if (!config.provider.baseUrl) {
                throw new AppError("Base URL is required for openai-compatible", "AI_CONFIGURATION_ERROR", "validation", 500);
            }
            const OpenAICompatibleProvider = createOpenAICompatible({
                name: "openai-compatible",
                baseURL: config.provider.baseUrl,
                apiKey: config.provider.apiKey || undefined,
            });
            return OpenAICompatibleProvider(modelName);
        }
        default:
            throw new AppError(
                `Unsupported AI provider: ${config.provider.name}`,
                "CONFIGURATION_ERROR",
                "unknown",
                500
            );
    }
}

/**
 * Check if AI features are enabled (returns true if a default active model exists)
 */
export async function isAIEnabled(): Promise<boolean> {
    const config = await getConfiguration();
    return !!config;
}
