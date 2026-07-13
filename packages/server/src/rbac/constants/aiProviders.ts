/**
 * Supported AI Provider Types
 * 
 * This is the SINGLE SOURCE OF TRUTH for all provider types.
 * To add a new provider type:
 * 1. Add it to PROVIDER_TYPES array
 * 2. Add initialization logic to providerRegistry in aiConfig.ts
 * 3. Add requirements to PROVIDER_REQUIREMENTS if needed
 * 4. Update database migration if needed
 */

export const PROVIDER_TYPES = [
  'openai',
  'anthropic',
  'google',
  'openai-compatible',
  'azure-openai',
  'groq',
  'mistral',
  'cohere',
  'ollama',
  'xai',
  'deepseek',
  'cerebras',
  'bedrock',
  'fireworks',
  'together',
  'openrouter',
] as const;

export type ProviderType = typeof PROVIDER_TYPES[number];

/**
 * Provider-specific requirements
 */
export interface ProviderRequirements {
  requiresBaseUrl: boolean;
  requiresApiKey: boolean;
}

export const PROVIDER_REQUIREMENTS: Record<ProviderType, ProviderRequirements> = {
  'openai': { requiresBaseUrl: false, requiresApiKey: true },
  'anthropic': { requiresBaseUrl: false, requiresApiKey: true },
  'google': { requiresBaseUrl: false, requiresApiKey: true },
  'openai-compatible': { requiresBaseUrl: true, requiresApiKey: true },
  // Base URL is the Azure resource endpoint (https://<resource>.openai.azure.com).
  'azure-openai': { requiresBaseUrl: true, requiresApiKey: true },
  'groq': { requiresBaseUrl: false, requiresApiKey: true },
  'mistral': { requiresBaseUrl: false, requiresApiKey: true },
  'cohere': { requiresBaseUrl: false, requiresApiKey: true },
  'ollama': { requiresBaseUrl: true, requiresApiKey: false },
  'xai': { requiresBaseUrl: false, requiresApiKey: true },
  'deepseek': { requiresBaseUrl: false, requiresApiKey: true },
  'cerebras': { requiresBaseUrl: false, requiresApiKey: true },
  // The "API key" slot holds encrypted JSON credentials
  // {region, accessKeyId, secretAccessKey} — see aiProviders route.
  'bedrock': { requiresBaseUrl: false, requiresApiKey: true },
  // Preset base URLs are applied in aiConfig.ts when none is stored.
  'fireworks': { requiresBaseUrl: false, requiresApiKey: true },
  'together': { requiresBaseUrl: false, requiresApiKey: true },
  'openrouter': { requiresBaseUrl: false, requiresApiKey: true },
};

/**
 * Type guard to validate provider type
 */
export function isValidProviderType(value: unknown): value is ProviderType {
  return typeof value === 'string' && PROVIDER_TYPES.includes(value as ProviderType);
}
