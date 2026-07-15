/**
 * AI Model Runtime Parameters
 *
 * This is the SINGLE SOURCE OF TRUTH for the runtime parameters an admin can
 * configure per Provider Model (rbac_ai_models.params). The frontend keeps a
 * mirrored copy in src/constants/aiModelParams.ts (zod v3/v4 split prevents a
 * shared schema file) — keep both files in sync.
 *
 * Every field is optional; an absent field (or a NULL column) means "use the
 * built-in default", which preserves the pre-feature behavior exactly.
 */

import type { ProviderType } from './aiProviders';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type Verbosity = 'low' | 'medium' | 'high';
export const STRUCTURED_OUTPUT_POLICIES = ['auto', 'native', 'tool', 'json', 'plain'] as const;
export type StructuredOutputPolicy = (typeof STRUCTURED_OUTPUT_POLICIES)[number];

export function isStructuredOutputPolicy(value: unknown): value is StructuredOutputPolicy {
  return typeof value === 'string' && STRUCTURED_OUTPUT_POLICIES.some((policy) => policy === value);
}

export interface AiSafetySetting {
  category: string;
  threshold: string;
}

export interface AiModelParams {
  // — Sampling —
  /** 0–2 (Anthropic caps at 1). Unset keeps the built-in default of 0. */
  temperature?: number;
  /** Nucleus sampling, 0–1. All providers. */
  topP?: number;
  /** Top-k sampling, int ≥ 1. Anthropic and Google only. */
  topK?: number;
  /** -2–2. OpenAI and OpenAI-compatible only. */
  frequencyPenalty?: number;
  /** -2–2. OpenAI and OpenAI-compatible only. */
  presencePenalty?: number;

  // — Output —
  /** Max output tokens (Google: maxOutputTokens). All providers. */
  maxTokens?: number;
  /** Stop sequences. Max 4 (openai/compatible), 5 (google), 10 (anthropic). */
  stopSequences?: string[];
  /** Response verbosity. OpenAI only (GPT-5 family). */
  verbosity?: Verbosity;

  // — Reasoning / thinking —
  /**
   * OpenAI/compatible: reasoning.effort ('minimal' allowed).
   * Anthropic: outputConfig.effort ('minimal' rejected).
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * Anthropic: thinking {type:'enabled', budget_tokens} (min 1024, requires
   * maxTokens > budget). Google: thinkingConfig.thinkingBudget (-1 = dynamic,
   * 0 = off).
   */
  thinkingBudgetTokens?: number;

  // — Reliability / transport —
  /** Retry attempts on transient provider errors, 0–10. All providers. */
  maxRetries?: number;
  /** Per-request timeout in ms. OpenAI/compatible and Anthropic only. */
  requestTimeoutMs?: number;

  // — API transport —
  /** API version: Google (e.g. 'v1beta') or Azure OpenAI (e.g. '2024-10-21'). */
  apiVersion?: string;
  /** Gemini safety settings. Google only. */
  safetySettings?: AiSafetySetting[];

  // — Agent runtime (engine-level, all providers) —
  /** LangGraph recursion limit per agent run. Overrides the computed default. */
  recursionLimit?: number;
  /** Wall-clock budget per agent run in ms. Overrides both built-in run timeouts. */
  runTimeoutMs?: number;
  /** Preferred structured-output strategy. `auto` negotiates with safe fallbacks. */
  structuredOutputPolicy?: StructuredOutputPolicy;

  // — Escape hatch —
  /**
   * Extra request-body params: modelKwargs (openai/compatible) or
   * invocationKwargs (anthropic). Rejected for Google (no passthrough).
   */
  extra?: Record<string, unknown>;
}

export type AiModelParamKey = keyof AiModelParams;

const ENGINE_KEYS: readonly AiModelParamKey[] = [
  'recursionLimit',
  'runTimeoutMs',
  'structuredOutputPolicy',
];

const COMMON_KEYS: readonly AiModelParamKey[] = [
  'temperature',
  'topP',
  'maxTokens',
  'stopSequences',
  'maxRetries',
  ...ENGINE_KEYS,
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

// Key lists mirror what each SDK's constructor actually accepts (verified
// against the installed @langchain/* type definitions) — e.g. Mistral,
// Cerebras, and Bedrock expose no stop-sequence constructor field, Cohere
// only exposes temperature, and xAI omits topP.
export const PROVIDER_PARAM_KEYS: Record<ProviderType, readonly AiModelParamKey[]> = {
  'openai': OPENAI_FAMILY_KEYS,
  'openai-compatible': OPENAI_FAMILY_KEYS,
  'anthropic': [...COMMON_KEYS, 'topK', 'reasoningEffort', 'thinkingBudgetTokens', 'requestTimeoutMs', 'extra'],
  'google': [...COMMON_KEYS, 'topK', 'thinkingBudgetTokens', 'apiVersion', 'safetySettings'],
  'azure-openai': [...OPENAI_FAMILY_KEYS, 'apiVersion'],
  'groq': [...COMMON_KEYS, 'requestTimeoutMs'],
  'mistral': ['temperature', 'topP', 'maxTokens', 'maxRetries', ...ENGINE_KEYS],
  'cohere': ['temperature', 'maxRetries', ...ENGINE_KEYS],
  'ollama': [...COMMON_KEYS, 'topK'],
  'xai': ['temperature', 'maxTokens', 'stopSequences', 'maxRetries', ...ENGINE_KEYS],
  'deepseek': [...COMMON_KEYS, 'frequencyPenalty', 'presencePenalty', 'requestTimeoutMs', 'extra'],
  'cerebras': ['temperature', 'topP', 'maxTokens', 'maxRetries', 'requestTimeoutMs', ...ENGINE_KEYS],
  'bedrock': ['temperature', 'topP', 'maxTokens', 'maxRetries', ...ENGINE_KEYS],
  'fireworks': OPENAI_FAMILY_KEYS,
  'together': OPENAI_FAMILY_KEYS,
  'openrouter': OPENAI_FAMILY_KEYS,
};

/** Provider-independent bounds (the widest any provider accepts). */
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

/**
 * Keys that must never appear in `extra`: they would shadow canonical fields
 * or break the engine's non-streaming `.invoke()` handling.
 */
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
 * Validate params against a provider type. Returns a list of human-readable
 * errors; an empty array means the params are valid. Pure (no zod) so the
 * frontend mirror can reuse it verbatim for instant form feedback.
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

  if (params.structuredOutputPolicy !== undefined
      && !isStructuredOutputPolicy(params.structuredOutputPolicy)) {
    errors.push(`'structuredOutputPolicy' must be one of: ${STRUCTURED_OUTPUT_POLICIES.join(', ')}`);
  }

  // Per-provider tightenings on top of the generic bounds.
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

/**
 * True when the object carries at least one meaningful (non-null/undefined)
 * parameter. Used to normalize empty payloads to NULL.
 */
export function hasAnyParams(params: AiModelParams | null | undefined): boolean {
  if (!params) return false;
  return definedKeys(params).length > 0;
}
