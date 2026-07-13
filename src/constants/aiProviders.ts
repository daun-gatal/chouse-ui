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
 * Format provider type for display
 */
export function formatProviderType(type: ProviderType): string {
  const formatMap: Record<ProviderType, string> = {
    'openai': 'OpenAI',
    'anthropic': 'Anthropic',
    'google': 'Google',
    'openai-compatible': 'OpenAI Compatible',
    'azure-openai': 'Azure OpenAI',
    'groq': 'Groq',
    'mistral': 'Mistral',
    'cohere': 'Cohere',
    'ollama': 'Ollama',
    'xai': 'xAI (Grok)',
    'deepseek': 'DeepSeek',
    'cerebras': 'Cerebras',
    'bedrock': 'AWS Bedrock',
    'fireworks': 'Fireworks AI',
    'together': 'Together AI',
    'openrouter': 'OpenRouter',
  };
  return formatMap[type] || type;
}

/**
 * Provider-specific requirements (mirror of the server table); drives which
 * connection fields the admin form shows and requires.
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
  'azure-openai': { requiresBaseUrl: true, requiresApiKey: true },
  'groq': { requiresBaseUrl: false, requiresApiKey: true },
  'mistral': { requiresBaseUrl: false, requiresApiKey: true },
  'cohere': { requiresBaseUrl: false, requiresApiKey: true },
  'ollama': { requiresBaseUrl: true, requiresApiKey: false },
  'xai': { requiresBaseUrl: false, requiresApiKey: true },
  'deepseek': { requiresBaseUrl: false, requiresApiKey: true },
  'cerebras': { requiresBaseUrl: false, requiresApiKey: true },
  // Bedrock's "API key" is the composed AWS credentials JSON; the form shows
  // dedicated region/access-key fields instead of the API key input.
  'bedrock': { requiresBaseUrl: false, requiresApiKey: true },
  'fireworks': { requiresBaseUrl: false, requiresApiKey: true },
  'together': { requiresBaseUrl: false, requiresApiKey: true },
  'openrouter': { requiresBaseUrl: false, requiresApiKey: true },
};

/** Placeholder shown for the Base URL field where a preset/default exists. */
export const PROVIDER_BASE_URL_PLACEHOLDERS: Partial<Record<ProviderType, string>> = {
  'openai-compatible': 'https://api.example.com/v1',
  'azure-openai': 'https://<resource>.openai.azure.com',
  'ollama': 'http://localhost:11434',
  'fireworks': 'https://api.fireworks.ai/inference/v1 (default)',
  'together': 'https://api.together.xyz/v1 (default)',
  'openrouter': 'https://openrouter.ai/api/v1 (default)',
};
