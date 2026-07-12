import { describe, expect, it } from 'vitest';
import {
  NUMBER_PARAM_FIELDS,
  PARAM_BOUNDS,
  PROVIDER_PARAM_KEYS,
  REASONING_EFFORT_OPTIONS,
  hasAnyParams,
  validateAiModelParams,
  type AiModelParams,
} from './aiModelParams';
import { PROVIDER_TYPES, type ProviderType } from './aiProviders';

interface Case {
  name: string;
  providerType: ProviderType;
  params: AiModelParams;
  expectErrors: boolean;
  errorIncludes?: string;
}

// Mirrors the server-side table in
// packages/server/src/rbac/constants/aiModelParams.test.ts — the drift guard.
const cases: Case[] = [
  {
    name: 'openai full valid set',
    providerType: 'openai',
    params: {
      temperature: 0.7,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: -0.5,
      maxTokens: 4096,
      stopSequences: ['END'],
      verbosity: 'low',
      reasoningEffort: 'minimal',
      maxRetries: 3,
      requestTimeoutMs: 60_000,
      recursionLimit: 64,
      runTimeoutMs: 120_000,
      extra: { seed: 42 },
    },
    expectErrors: false,
  },
  { name: 'anthropic valid thinking config', providerType: 'anthropic', params: { maxTokens: 16_000, thinkingBudgetTokens: 4096, topK: 40 }, expectErrors: false },
  { name: 'google valid set', providerType: 'google', params: { temperature: 1.5, topK: 40, thinkingBudgetTokens: -1, apiVersion: 'v1beta' }, expectErrors: false },
  { name: 'openai rejects topK', providerType: 'openai', params: { topK: 40 }, expectErrors: true, errorIncludes: "'topK'" },
  { name: 'anthropic rejects frequencyPenalty', providerType: 'anthropic', params: { frequencyPenalty: 1 }, expectErrors: true, errorIncludes: "'frequencyPenalty'" },
  { name: 'google rejects extra', providerType: 'google', params: { extra: { a: 1 } }, expectErrors: true, errorIncludes: "'extra'" },
  { name: 'google rejects requestTimeoutMs', providerType: 'google', params: { requestTimeoutMs: 30_000 }, expectErrors: true, errorIncludes: "'requestTimeoutMs'" },
  { name: 'anthropic temperature above 1 rejected', providerType: 'anthropic', params: { temperature: 1.5 }, expectErrors: true, errorIncludes: "'temperature'" },
  { name: 'recursionLimit below 8 rejected', providerType: 'openai', params: { recursionLimit: 4 }, expectErrors: true, errorIncludes: "'recursionLimit'" },
  { name: 'anthropic thinking requires maxTokens', providerType: 'anthropic', params: { thinkingBudgetTokens: 4096 }, expectErrors: true, errorIncludes: "'maxTokens'" },
  { name: 'anthropic maxTokens must exceed budget', providerType: 'anthropic', params: { maxTokens: 2048, thinkingBudgetTokens: 4096 }, expectErrors: true, errorIncludes: 'greater than' },
  { name: 'anthropic effort minimal rejected', providerType: 'anthropic', params: { reasoningEffort: 'minimal' }, expectErrors: true, errorIncludes: "'minimal'" },
  { name: 'google thinking budget above 32768 rejected', providerType: 'google', params: { thinkingBudgetTokens: 64_000 }, expectErrors: true, errorIncludes: '32768' },
  { name: 'openai rejects 5 stop sequences', providerType: 'openai', params: { stopSequences: ['a', 'b', 'c', 'd', 'e'] }, expectErrors: true, errorIncludes: "'stopSequences'" },
  { name: 'extra blocked key stream rejected', providerType: 'openai', params: { extra: { stream: true } }, expectErrors: true, errorIncludes: 'reserved' },
  { name: 'empty params valid', providerType: 'anthropic', params: {}, expectErrors: false },
];

describe('validateAiModelParams (frontend mirror)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const errors = validateAiModelParams(c.params, c.providerType);
      if (c.expectErrors) {
        expect(errors.length).toBeGreaterThan(0);
        if (c.errorIncludes) {
          expect(errors.join('; ')).toContain(c.errorIncludes);
        }
      } else {
        expect(errors).toEqual([]);
      }
    });
  }
});

describe('UI metadata consistency', () => {
  it('covers every provider type in PROVIDER_PARAM_KEYS and REASONING_EFFORT_OPTIONS', () => {
    for (const providerType of PROVIDER_TYPES) {
      expect(PROVIDER_PARAM_KEYS[providerType].length).toBeGreaterThan(0);
      expect(REASONING_EFFORT_OPTIONS[providerType]).toBeDefined();
    }
  });

  it('keeps number-field bounds in sync with PARAM_BOUNDS', () => {
    for (const field of NUMBER_PARAM_FIELDS) {
      const bounds = PARAM_BOUNDS[field.key as keyof typeof PARAM_BOUNDS];
      expect(bounds, `missing bounds for ${field.key}`).toBeDefined();
      expect(field.min).toBe(bounds.min);
      expect(field.max).toBe(bounds.max);
    }
  });

  it('only lists fields that at least one provider accepts', () => {
    const allAllowed = new Set(Object.values(PROVIDER_PARAM_KEYS).flat());
    for (const field of NUMBER_PARAM_FIELDS) {
      expect(allAllowed.has(field.key), `${field.key} not allowed anywhere`).toBe(true);
    }
  });
});

describe('hasAnyParams', () => {
  it('detects meaningful values', () => {
    expect(hasAnyParams(null)).toBe(false);
    expect(hasAnyParams({})).toBe(false);
    expect(hasAnyParams({ temperature: 0 })).toBe(true);
  });
});
