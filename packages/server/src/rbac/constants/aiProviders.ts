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
  'huggingface',
  'openai-compatible',
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
  'huggingface': { requiresBaseUrl: false, requiresApiKey: true },
  'openai-compatible': { requiresBaseUrl: true, requiresApiKey: true },
};

/**
 * Type guard to validate provider type
 */
export function isValidProviderType(value: unknown): value is ProviderType {
  return typeof value === 'string' && PROVIDER_TYPES.includes(value as ProviderType);
}
