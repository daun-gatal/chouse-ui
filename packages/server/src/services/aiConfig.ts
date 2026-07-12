/**
 * Shared AI Configuration Module
 * 
 * Provides AI provider initialization, configuration, and validation
 * used by both the AI optimizer/debugger and the AI chat assistant.
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AppError } from "../types";
import { getAiConfigById, getDefaultAiConfig, getAiConfigWithKey } from "../rbac/services/aiModels";
import type { AiConfigWithKey } from "../rbac/services/aiModels";
import { ProviderType, PROVIDER_TYPES, PROVIDER_REQUIREMENTS, isValidProviderType } from "../rbac/constants/aiProviders";
import type { AiModelParams } from "../rbac/constants/aiModelParams";

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
        // We need the key to initialize the provider client.
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
type ProviderInitializer = (
    config: { apiKey?: string; baseUrl?: string; params?: AiModelParams },
    modelName: string,
) => BaseChatModel;

function buildOpenAiModel(
    config: { apiKey?: string; baseUrl?: string; params?: AiModelParams },
    modelName: string,
): BaseChatModel {
    const p = config.params ?? {};
    return new ChatOpenAI({
        model: modelName,
        apiKey: config.apiKey || undefined,
        configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
        temperature: p.temperature ?? 0,
        topP: p.topP,
        frequencyPenalty: p.frequencyPenalty,
        presencePenalty: p.presencePenalty,
        maxTokens: p.maxTokens,
        stopSequences: p.stopSequences,
        verbosity: p.verbosity,
        reasoning: p.reasoningEffort ? { effort: p.reasoningEffort } : undefined,
        maxRetries: p.maxRetries,
        timeout: p.requestTimeoutMs,
        modelKwargs: p.extra,
    });
}

/**
 * Provider Registry
 *
 * Maps provider types to their initialization functions. Each initializer
 * applies the per-model runtime params (rbac_ai_models.params); an absent
 * param keeps the pre-existing default (notably temperature 0).
 * To add a new provider:
 * 1. Add it to PROVIDER_TYPES in constants/aiProviders.ts
 * 2. Add initialization logic here
 * 3. Add its allowed params to constants/aiModelParams.ts
 */
const providerRegistry: Record<ProviderType, ProviderInitializer> = {
    'openai': buildOpenAiModel,
    'anthropic': (config, modelName) => {
        const p = config.params ?? {};
        const clientOptions = config.baseUrl || p.requestTimeoutMs
            ? {
                ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
                ...(p.requestTimeoutMs ? { timeout: p.requestTimeoutMs } : {}),
            }
            : undefined;
        const thinking = p.thinkingBudgetTokens !== undefined
            ? { type: 'enabled' as const, budget_tokens: p.thinkingBudgetTokens }
            : undefined;
        return new ChatAnthropic({
            model: modelName,
            apiKey: config.apiKey || undefined,
            clientOptions,
            // Anthropic rejects temperature != 1 when extended thinking is on,
            // so the temperature-0 default must not be sent alongside a budget.
            temperature: thinking ? p.temperature : (p.temperature ?? 0),
            topP: p.topP,
            topK: p.topK,
            maxTokens: p.maxTokens,
            stopSequences: p.stopSequences,
            thinking,
            outputConfig: p.reasoningEffort && p.reasoningEffort !== 'minimal'
                ? { effort: p.reasoningEffort }
                : undefined,
            maxRetries: p.maxRetries,
            invocationKwargs: p.extra,
        });
    },
    'google': (config, modelName) => {
        const p = config.params ?? {};
        return new ChatGoogleGenerativeAI({
            model: modelName,
            apiKey: config.apiKey || undefined,
            baseUrl: config.baseUrl || undefined,
            apiVersion: p.apiVersion,
            temperature: p.temperature ?? 0,
            topP: p.topP,
            topK: p.topK,
            maxOutputTokens: p.maxTokens,
            stopSequences: p.stopSequences,
            // Stored as validated {category, threshold} string pairs; the Google
            // SDK enum types aren't importable here (transitive, non-hoisted dep),
            // so the structural cast below is the only way to hand them over.
            safetySettings: p.safetySettings as ConstructorParameters<typeof ChatGoogleGenerativeAI>[0]['safetySettings'],
            thinkingConfig: p.thinkingBudgetTokens !== undefined
                ? { thinkingBudget: p.thinkingBudgetTokens }
                : undefined,
            maxRetries: p.maxRetries,
        });
    },
    'openai-compatible': (config, modelName) => {
        if (!config.baseUrl) {
            throw new AppError("Base URL is required for openai-compatible", "AI_CONFIGURATION_ERROR", "validation", 500);
        }
        return buildOpenAiModel(config, modelName);
    },
};

/**
 * Initialize a DeepAgents/LangChain chat model based on provider configuration.
 */
export function initializeDeepAgentModel(config: AiConfigWithKey): BaseChatModel {
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

    return initializer(
        {
            apiKey: config.provider.apiKey || undefined,
            baseUrl: config.provider.baseUrl || undefined,
            params: config.model.params ?? undefined,
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
