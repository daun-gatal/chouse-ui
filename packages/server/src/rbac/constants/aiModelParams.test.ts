import { describe, expect, it } from 'bun:test';
import {
  EXTRA_MAX_KEYS,
  PROVIDER_PARAM_KEYS,
  hasAnyParams,
  validateAiModelParams,
  type AiModelParams,
} from './aiModelParams';
import type { ProviderType } from './aiProviders';

interface Case {
  name: string;
  providerType: ProviderType;
  params: AiModelParams;
  expectErrors: boolean;
  errorIncludes?: string;
}

const cases: Case[] = [
  // Valid per provider
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
      extra: { seed: 42, logprobs: true },
    },
    expectErrors: false,
  },
  {
    name: 'anthropic valid thinking config',
    providerType: 'anthropic',
    params: { maxTokens: 16_000, thinkingBudgetTokens: 4096, topK: 40 },
    expectErrors: false,
  },
  {
    name: 'google valid set',
    providerType: 'google',
    params: {
      temperature: 1.5,
      topK: 40,
      maxTokens: 8192,
      thinkingBudgetTokens: -1,
      apiVersion: 'v1beta',
      safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }],
    },
    expectErrors: false,
  },
  {
    name: 'openai-compatible mirrors openai keys',
    providerType: 'openai-compatible',
    params: { frequencyPenalty: 1, extra: { repetition_penalty: 1.1 } },
    expectErrors: false,
  },

  // Provider allowlist rejections
  { name: 'openai rejects topK', providerType: 'openai', params: { topK: 40 }, expectErrors: true, errorIncludes: "'topK'" },
  { name: 'anthropic rejects frequencyPenalty', providerType: 'anthropic', params: { frequencyPenalty: 1 }, expectErrors: true, errorIncludes: "'frequencyPenalty'" },
  { name: 'google rejects extra', providerType: 'google', params: { extra: { a: 1 } }, expectErrors: true, errorIncludes: "'extra'" },
  { name: 'google rejects requestTimeoutMs', providerType: 'google', params: { requestTimeoutMs: 30_000 }, expectErrors: true, errorIncludes: "'requestTimeoutMs'" },
  { name: 'google rejects reasoningEffort', providerType: 'google', params: { reasoningEffort: 'high' }, expectErrors: true, errorIncludes: "'reasoningEffort'" },
  { name: 'openai rejects safetySettings', providerType: 'openai', params: { safetySettings: [{ category: 'x', threshold: 'y' }] }, expectErrors: true, errorIncludes: "'safetySettings'" },

  // Range checks
  { name: 'temperature above 2 rejected', providerType: 'openai', params: { temperature: 2.5 }, expectErrors: true, errorIncludes: "'temperature'" },
  { name: 'anthropic temperature above 1 rejected', providerType: 'anthropic', params: { temperature: 1.5 }, expectErrors: true, errorIncludes: "'temperature'" },
  { name: 'recursionLimit below 8 rejected', providerType: 'openai', params: { recursionLimit: 4 }, expectErrors: true, errorIncludes: "'recursionLimit'" },
  { name: 'non-integer maxTokens rejected', providerType: 'openai', params: { maxTokens: 10.5 }, expectErrors: true, errorIncludes: 'integer' },
  { name: 'NaN temperature rejected', providerType: 'openai', params: { temperature: Number.NaN }, expectErrors: true, errorIncludes: "'temperature'" },

  // Cross-field anthropic thinking rules
  { name: 'anthropic thinking requires maxTokens', providerType: 'anthropic', params: { thinkingBudgetTokens: 4096 }, expectErrors: true, errorIncludes: "'maxTokens'" },
  { name: 'anthropic thinking budget below 1024 rejected', providerType: 'anthropic', params: { maxTokens: 16_000, thinkingBudgetTokens: 512 }, expectErrors: true, errorIncludes: '1024' },
  { name: 'anthropic maxTokens must exceed budget', providerType: 'anthropic', params: { maxTokens: 2048, thinkingBudgetTokens: 4096 }, expectErrors: true, errorIncludes: 'greater than' },
  { name: 'anthropic thinking rejects temperature 0', providerType: 'anthropic', params: { maxTokens: 16_000, thinkingBudgetTokens: 4096, temperature: 0 }, expectErrors: true, errorIncludes: 'thinking' },
  { name: 'anthropic thinking allows temperature 1', providerType: 'anthropic', params: { maxTokens: 16_000, thinkingBudgetTokens: 4096, temperature: 1 }, expectErrors: false },
  { name: 'anthropic thinking + effort rejected', providerType: 'anthropic', params: { maxTokens: 16_000, thinkingBudgetTokens: 4096, reasoningEffort: 'high' }, expectErrors: true, errorIncludes: 'combined' },
  { name: 'anthropic effort minimal rejected', providerType: 'anthropic', params: { reasoningEffort: 'minimal' }, expectErrors: true, errorIncludes: "'minimal'" },

  // Google thinking budget upper bound
  { name: 'google thinking budget above 32768 rejected', providerType: 'google', params: { thinkingBudgetTokens: 64_000 }, expectErrors: true, errorIncludes: '32768' },

  // Stop sequences
  { name: 'openai allows 4 stop sequences', providerType: 'openai', params: { stopSequences: ['a', 'b', 'c', 'd'] }, expectErrors: false },
  { name: 'openai rejects 5 stop sequences', providerType: 'openai', params: { stopSequences: ['a', 'b', 'c', 'd', 'e'] }, expectErrors: true, errorIncludes: "'stopSequences'" },
  { name: 'anthropic allows 10 stop sequences', providerType: 'anthropic', params: { stopSequences: Array.from({ length: 10 }, (_, i) => `s${i}`) }, expectErrors: false },
  { name: 'empty stop sequence entry rejected', providerType: 'openai', params: { stopSequences: [''] }, expectErrors: true, errorIncludes: 'non-empty' },

  // Extra escape hatch
  { name: 'extra blocked key stream rejected', providerType: 'openai', params: { extra: { stream: true } }, expectErrors: true, errorIncludes: 'reserved' },
  { name: 'extra blocked key max_tokens rejected', providerType: 'openai', params: { extra: { max_tokens: 100 } }, expectErrors: true, errorIncludes: 'reserved' },
  {
    name: 'extra too many keys rejected',
    providerType: 'openai',
    params: { extra: Object.fromEntries(Array.from({ length: EXTRA_MAX_KEYS + 1 }, (_, i) => [`k${i}`, i])) },
    expectErrors: true,
    errorIncludes: 'at most',
  },
  { name: 'extra oversized payload rejected', providerType: 'openai', params: { extra: { blob: 'x'.repeat(9000) } }, expectErrors: true, errorIncludes: 'bytes' },

  // Empty object is valid everywhere
  { name: 'empty params valid', providerType: 'anthropic', params: {}, expectErrors: false },
];

describe('validateAiModelParams', () => {
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

describe('PROVIDER_PARAM_KEYS', () => {
  it('covers every provider type with agent-runtime keys', () => {
    for (const keys of Object.values(PROVIDER_PARAM_KEYS)) {
      expect(keys).toContain('recursionLimit');
      expect(keys).toContain('runTimeoutMs');
      expect(keys).toContain('temperature');
      expect(keys).toContain('maxTokens');
    }
  });
});

describe('hasAnyParams', () => {
  it('detects meaningful values', () => {
    expect(hasAnyParams(null)).toBe(false);
    expect(hasAnyParams(undefined)).toBe(false);
    expect(hasAnyParams({})).toBe(false);
    expect(hasAnyParams({ temperature: undefined })).toBe(false);
    expect(hasAnyParams({ temperature: 0 })).toBe(true);
  });
});
