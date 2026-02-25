/**
 * AI Provider Types
 * 
 * MUST stay in sync with packages/server/src/rbac/constants/aiProviders.ts
 * When adding new providers, update both files.
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
 * Format provider type for display
 */
export function formatProviderType(type: ProviderType): string {
  const formatMap: Record<ProviderType, string> = {
    'openai': 'OpenAI',
    'anthropic': 'Anthropic',
    'google': 'Google',
    'huggingface': 'Hugging Face',
    'openai-compatible': 'OpenAI Compatible',
  };
  return formatMap[type] || type;
}
