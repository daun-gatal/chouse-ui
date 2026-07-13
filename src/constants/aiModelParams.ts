/**
 * AI Model Runtime Parameters
 *
 * MUST stay in sync with packages/server/src/rbac/constants/aiModelParams.ts
 * (types, allowed keys, bounds, and validateAiModelParams). The server copy is
 * the source of truth; this mirror exists because the zod v3/v4 split prevents
 * sharing a schema file. UI-only field metadata lives at the bottom.
 */

import type { ProviderType } from './aiProviders';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type Verbosity = 'low' | 'medium' | 'high';

export interface AiSafetySetting {
  category: string;
  threshold: string;
}

export interface AiModelParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxTokens?: number;
  stopSequences?: string[];
  verbosity?: Verbosity;
  reasoningEffort?: ReasoningEffort;
  thinkingBudgetTokens?: number;
  maxRetries?: number;
  requestTimeoutMs?: number;
  apiVersion?: string;
  safetySettings?: AiSafetySetting[];
  recursionLimit?: number;
  runTimeoutMs?: number;
  extra?: Record<string, unknown>;
}

export type AiModelParamKey = keyof AiModelParams;

const COMMON_KEYS: readonly AiModelParamKey[] = [
  'temperature',
  'topP',
  'maxTokens',
  'stopSequences',
  'maxRetries',
  'recursionLimit',
  'runTimeoutMs',
];

const OPENAI_FAMILY_KEYS: readonly AiModelParamKey[] = [
  ...COMMON_KEYS,
  'frequencyPenalty',
  'presencePenalty',
  'verbosity',
  'reasoningEffort',
  'requestTimeoutMs',
  'extra',
];

// Key lists mirror what each SDK's constructor actually accepts — see the
// server copy for the per-provider rationale.
export const PROVIDER_PARAM_KEYS: Record<ProviderType, readonly AiModelParamKey[]> = {
  'openai': OPENAI_FAMILY_KEYS,
  'openai-compatible': OPENAI_FAMILY_KEYS,
  'anthropic': [...COMMON_KEYS, 'topK', 'reasoningEffort', 'thinkingBudgetTokens', 'requestTimeoutMs', 'extra'],
  'google': [...COMMON_KEYS, 'topK', 'thinkingBudgetTokens', 'apiVersion', 'safetySettings'],
  'azure-openai': [...OPENAI_FAMILY_KEYS, 'apiVersion'],
  'groq': [...COMMON_KEYS, 'requestTimeoutMs'],
  'mistral': ['temperature', 'topP', 'maxTokens', 'maxRetries', 'recursionLimit', 'runTimeoutMs'],
  'cohere': ['temperature', 'maxRetries', 'recursionLimit', 'runTimeoutMs'],
  'ollama': [...COMMON_KEYS, 'topK'],
  'xai': ['temperature', 'maxTokens', 'stopSequences', 'maxRetries', 'recursionLimit', 'runTimeoutMs'],
  'deepseek': [...COMMON_KEYS, 'frequencyPenalty', 'presencePenalty', 'requestTimeoutMs', 'extra'],
  'cerebras': ['temperature', 'topP', 'maxTokens', 'maxRetries', 'requestTimeoutMs', 'recursionLimit', 'runTimeoutMs'],
  'bedrock': ['temperature', 'topP', 'maxTokens', 'maxRetries', 'recursionLimit', 'runTimeoutMs'],
  'fireworks': OPENAI_FAMILY_KEYS,
  'together': OPENAI_FAMILY_KEYS,
  'openrouter': OPENAI_FAMILY_KEYS,
};

export const PARAM_BOUNDS = {
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  topK: { min: 1, max: 500 },
  frequencyPenalty: { min: -2, max: 2 },
  presencePenalty: { min: -2, max: 2 },
  maxTokens: { min: 1, max: 2_000_000 },
  maxRetries: { min: 0, max: 10 },
  requestTimeoutMs: { min: 1_000, max: 600_000 },
  recursionLimit: { min: 8, max: 1000 },
  runTimeoutMs: { min: 10_000, max: 3_600_000 },
  thinkingBudgetTokens: { min: -1, max: 128_000 },
} as const;

export const STOP_SEQUENCES_MAX: Record<ProviderType, number> = {
  'openai': 4,
  'openai-compatible': 4,
  'anthropic': 10,
  'google': 5,
  'azure-openai': 4,
  'groq': 4,
  'mistral': 4,
  'cohere': 4,
  'ollama': 4,
  'xai': 4,
  'deepseek': 4,
  'cerebras': 4,
  'bedrock': 4,
  'fireworks': 4,
  'together': 4,
  'openrouter': 4,
};

export const EXTRA_BLOCKED_KEYS = [
  'model',
  'messages',
  'stream',
  'tools',
  'tool_choice',
  'api_key',
  'max_tokens',
  'temperature',
] as const;

export const EXTRA_MAX_KEYS = 20;
export const EXTRA_MAX_BYTES = 8192;

const INT_KEYS: readonly AiModelParamKey[] = [
  'topK',
  'maxTokens',
  'maxRetries',
  'requestTimeoutMs',
  'recursionLimit',
  'runTimeoutMs',
  'thinkingBudgetTokens',
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function definedKeys(params: AiModelParams): AiModelParamKey[] {
  return (Object.keys(params) as AiModelParamKey[]).filter(
    (key) => params[key] !== undefined && params[key] !== null,
  );
}

/**
 * Validate params against a provider type. Returns human-readable errors;
 * empty array = valid. Mirrors the server implementation exactly.
 */
export function validateAiModelParams(params: AiModelParams, providerType: ProviderType): string[] {
  const errors: string[] = [];
  const allowed = PROVIDER_PARAM_KEYS[providerType];
  const keys = definedKeys(params);

  for (const key of keys) {
    if (!allowed.includes(key)) {
      errors.push(`'${key}' is not supported by ${providerType} providers`);
    }
  }

  for (const [key, bounds] of Object.entries(PARAM_BOUNDS) as [AiModelParamKey, { min: number; max: number }][]) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (!isFiniteNumber(value)) {
      errors.push(`'${key}' must be a number`);
      continue;
    }
    if (INT_KEYS.includes(key) && !Number.isInteger(value)) {
      errors.push(`'${key}' must be an integer`);
      continue;
    }
    if (value < bounds.min || value > bounds.max) {
      errors.push(`'${key}' must be between ${bounds.min} and ${bounds.max}`);
    }
  }

  if (providerType === 'anthropic') {
    if (isFiniteNumber(params.temperature) && params.temperature > 1) {
      errors.push(`'temperature' must be between 0 and 1 for anthropic providers`);
    }
    if (params.reasoningEffort === 'minimal') {
      errors.push(`'reasoningEffort' does not support 'minimal' for anthropic providers`);
    }
    if (isFiniteNumber(params.thinkingBudgetTokens)) {
      if (params.thinkingBudgetTokens < 1024) {
        errors.push(`'thinkingBudgetTokens' must be at least 1024 for anthropic providers`);
      }
      if (params.reasoningEffort !== undefined) {
        errors.push(`'thinkingBudgetTokens' and 'reasoningEffort' cannot be combined for anthropic providers`);
      }
      if (!isFiniteNumber(params.maxTokens)) {
        errors.push(`'maxTokens' is required when 'thinkingBudgetTokens' is set for anthropic providers`);
      } else if (params.maxTokens <= params.thinkingBudgetTokens) {
        errors.push(`'maxTokens' must be greater than 'thinkingBudgetTokens' for anthropic providers`);
      }
      if (isFiniteNumber(params.temperature) && params.temperature !== 1) {
        errors.push(`'temperature' must be unset or 1 when extended thinking is enabled for anthropic providers`);
      }
    }
  }

  if (providerType === 'google' && isFiniteNumber(params.thinkingBudgetTokens) && params.thinkingBudgetTokens > 32_768) {
    errors.push(`'thinkingBudgetTokens' must be between -1 and 32768 for google providers`);
  }

  if (Array.isArray(params.stopSequences)) {
    const max = STOP_SEQUENCES_MAX[providerType];
    if (params.stopSequences.length > max) {
      errors.push(`'stopSequences' allows at most ${max} entries for ${providerType} providers`);
    }
    if (params.stopSequences.some((s) => typeof s !== 'string' || s.length === 0 || s.length > 500)) {
      errors.push(`'stopSequences' entries must be non-empty strings of at most 500 characters`);
    }
  }

  const extra = params.extra;
  if (extra !== undefined && extra !== null) {
    if (typeof extra !== 'object' || Array.isArray(extra)) {
      errors.push(`'extra' must be an object`);
    } else {
      const extraKeys = Object.keys(extra);
      if (extraKeys.length > EXTRA_MAX_KEYS) {
        errors.push(`'extra' allows at most ${EXTRA_MAX_KEYS} keys`);
      }
      const blocked = extraKeys.filter((key) => (EXTRA_BLOCKED_KEYS as readonly string[]).includes(key));
      if (blocked.length > 0) {
        errors.push(`'extra' must not contain reserved keys: ${blocked.join(', ')}`);
      }
      try {
        if (JSON.stringify(extra).length > EXTRA_MAX_BYTES) {
          errors.push(`'extra' must serialize to at most ${EXTRA_MAX_BYTES} bytes`);
        }
      } catch {
        errors.push(`'extra' must be JSON-serializable`);
      }
    }
  }

  return errors;
}

/** True when the object carries at least one meaningful parameter. */
export function hasAnyParams(params: AiModelParams | null | undefined): boolean {
  if (!params) return false;
  return definedKeys(params).length > 0;
}

// ============================================
// UI metadata (frontend-only)
// ============================================

export type ParamGroup = 'Sampling' | 'Output' | 'Reasoning' | 'Reliability & agent';

/** Params whose values are numbers — exactly the keys with bounds. */
export type NumericParamKey = keyof typeof PARAM_BOUNDS;

export interface NumberParamField {
  key: NumericParamKey;
  label: string;
  description: string;
  group: ParamGroup;
  step: number;
  min: number;
  max: number;
  placeholder: string;
}

/** Numeric fields rendered as clamped number inputs, in display order. */
export const NUMBER_PARAM_FIELDS: NumberParamField[] = [
  { key: 'temperature', label: 'Temperature', description: 'Sampling randomness. Empty keeps the default of 0.', group: 'Sampling', step: 0.1, min: 0, max: 2, placeholder: '0' },
  { key: 'topP', label: 'Top P', description: 'Nucleus sampling probability mass.', group: 'Sampling', step: 0.05, min: 0, max: 1, placeholder: 'provider default' },
  { key: 'topK', label: 'Top K', description: 'Sample from the K most likely tokens.', group: 'Sampling', step: 1, min: 1, max: 500, placeholder: 'provider default' },
  { key: 'frequencyPenalty', label: 'Frequency penalty', description: 'Penalize tokens by their frequency so far.', group: 'Sampling', step: 0.1, min: -2, max: 2, placeholder: '0' },
  { key: 'presencePenalty', label: 'Presence penalty', description: 'Penalize tokens that already appeared.', group: 'Sampling', step: 0.1, min: -2, max: 2, placeholder: '0' },
  { key: 'maxTokens', label: 'Max output tokens', description: 'Hard cap on generated tokens per response.', group: 'Output', step: 1, min: 1, max: 2_000_000, placeholder: 'provider default' },
  { key: 'thinkingBudgetTokens', label: 'Thinking budget (tokens)', description: 'Anthropic: min 1024, requires max tokens above it. Google: -1 = dynamic, 0 = off.', group: 'Reasoning', step: 1, min: -1, max: 128_000, placeholder: 'off' },
  { key: 'maxRetries', label: 'Max retries', description: 'Retries on transient provider errors.', group: 'Reliability & agent', step: 1, min: 0, max: 10, placeholder: 'provider default' },
  { key: 'requestTimeoutMs', label: 'Request timeout (ms)', description: 'Per-request timeout to the provider API.', group: 'Reliability & agent', step: 1000, min: 1_000, max: 600_000, placeholder: 'provider default' },
  { key: 'recursionLimit', label: 'Recursion limit', description: 'Max agent graph steps per run. Raise if runs stop with a recursion-limit error.', group: 'Reliability & agent', step: 1, min: 8, max: 1000, placeholder: 'auto (24+)' },
  { key: 'runTimeoutMs', label: 'Run timeout (ms)', description: 'Wall-clock budget for a whole agent run.', group: 'Reliability & agent', step: 1000, min: 10_000, max: 3_600_000, placeholder: 'auto (2–4 min)' },
];

const OPENAI_EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

export const REASONING_EFFORT_OPTIONS: Record<ProviderType, readonly ReasoningEffort[]> = {
  'openai': OPENAI_EFFORTS,
  'openai-compatible': OPENAI_EFFORTS,
  'anthropic': ['low', 'medium', 'high'],
  'google': [],
  'azure-openai': OPENAI_EFFORTS,
  'groq': [],
  'mistral': [],
  'cohere': [],
  'ollama': [],
  'xai': [],
  'deepseek': [],
  'cerebras': [],
  'bedrock': [],
  'fireworks': OPENAI_EFFORTS,
  'together': OPENAI_EFFORTS,
  'openrouter': OPENAI_EFFORTS,
};

export const VERBOSITY_OPTIONS: readonly Verbosity[] = ['low', 'medium', 'high'];
