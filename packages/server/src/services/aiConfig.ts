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
import { ProviderType, PROVIDER_TYPES, PROVIDER_REQUIREMENTS, isValidProviderType } from "../rbac/constants/aiProviders";

// ============================================
// Types
// ============================================

// Re-export ProviderType for backward compatibility
export type AIProvider = ProviderType;

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

    // Validate provider type
    if (!isValidProviderType(config.provider.providerType)) {
        return {
            valid: false,
            error: `Invalid AI provider type: ${config.provider.providerType}. Supported: ${PROVIDER_TYPES.join(", ")}`,
        };
    }

    const requirements = PROVIDER_REQUIREMENTS[config.provider.providerType];

    // Validate API key requirement
    if (requirements.requiresApiKey && !config.provider.apiKey) {
        return {
            valid: false,
            error: `API key is missing for provider ${config.provider.name}. Please supply an API key in the Admin UI.`,
        };
    }

    // Validate baseUrl requirement
    if (requirements.requiresBaseUrl && !config.provider.baseUrl) {
        return {
            valid: false,
            error: `Base URL is required when using the ${config.provider.providerType} provider.`,
        };
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
 * Provider initialization function type
 */
type ProviderInitializer = (config: { apiKey?: string; baseUrl?: string }, modelName: string) => any;

/**
 * Provider Registry
 * 
 * Maps provider types to their initialization functions.
 * To add a new provider:
 * 1. Add it to PROVIDER_TYPES in constants/aiProviders.ts
 * 2. Add initialization logic here
 */
const providerRegistry: Record<ProviderType, ProviderInitializer> = {
    'openai': (config, modelName) => {
        const OpenAIProvider = createOpenAI({
            apiKey: config.apiKey || undefined,
            baseURL: config.baseUrl || undefined,
        });
        return OpenAIProvider(modelName);
    },
    'anthropic': (config, modelName) => {
        const AnthropicProvider = createAnthropic({
            apiKey: config.apiKey || undefined,
            baseURL: config.baseUrl || undefined,
        });
        return AnthropicProvider(modelName);
    },
    'google': (config, modelName) => {
        const GoogleProvider = createGoogleGenerativeAI({
            apiKey: config.apiKey || undefined,
            baseURL: config.baseUrl || undefined,
        });
        return GoogleProvider(modelName);
    },
    'huggingface': (config, modelName) => {
        const HuggingFaceProvider = createHuggingFace({
            apiKey: config.apiKey || undefined,
            baseURL: config.baseUrl || undefined,
        });
        return HuggingFaceProvider(modelName);
    },
    'openai-compatible': (config, modelName) => {
        if (!config.baseUrl) {
            throw new AppError("Base URL is required for openai-compatible", "AI_CONFIGURATION_ERROR", "validation", 500);
        }
        const OpenAICompatibleProvider = createOpenAICompatible({
            name: "openai-compatible",
            baseURL: config.baseUrl,
            apiKey: config.apiKey || undefined,
        });
        return OpenAICompatibleProvider(modelName);
    },
};

/**
 * Initialize AI model based on provider configuration
 */
export function initializeAIModel(config: AiConfigWithKey) {
    const modelName = config.model.modelId;

    if (!modelName) {
        throw new AppError("AI model ID string is not configured.", "AI_CONFIGURATION_ERROR", "validation", 500);
    }

    // Validate provider type
    if (!isValidProviderType(config.provider.providerType)) {
        throw new AppError(
            `Unsupported AI provider type: ${config.provider.providerType}. Supported: ${PROVIDER_TYPES.join(", ")}`,
            "CONFIGURATION_ERROR",
            "unknown",
            500
        );
    }

    // Get initializer from registry
    const initializer = providerRegistry[config.provider.providerType];
    if (!initializer) {
        throw new AppError(
            `Provider initializer not found for type: ${config.provider.providerType}`,
            "CONFIGURATION_ERROR",
            "unknown",
            500
        );
    }

    // Initialize provider with config
    return initializer(
        {
            apiKey: config.provider.apiKey || undefined,
            baseUrl: config.provider.baseUrl || undefined,
        },
        modelName
    );
}

/**
 * Check if AI features are enabled (returns true if a default active model exists)
 */
export async function isAIEnabled(): Promise<boolean> {
    const config = await getConfiguration();
    return !!config;
}
