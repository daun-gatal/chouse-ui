/**
 * Engine tests — the DeepAgents boundary is mocked so fast-path invocation,
 * structured extraction, and harness policy are deterministic.
 */

import { describe, it, expect, mock } from "bun:test";
import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import type { AgentRunContext, InvokeCapability, StructuredCapability } from "./types";

let invokeResult: unknown = { messages: [] };
const invokeMock = mock(async () => invokeResult);
const createDeepAgentMock = mock(() => ({ invoke: invokeMock }));
const registerHarnessProfileMock = mock((_key: string, _profile: unknown) => {});

mock.module("deepagents", () => ({
  CompositeBackend: class {},
  FilesystemBackend: class {},
  StateBackend: class {},
  createDeepAgent: createDeepAgentMock,
  registerHarnessProfile: registerHarnessProfileMock,
}));

// Mutable so individual tests can attach per-model runtime params.
let modelParams: Record<string, unknown> | null = null;
mock.module("./model", () => ({
  resolveDeepAgentModel: mock(async () => ({
    model: {},
    config: { model: { modelId: "gpt-4o", params: modelParams }, provider: { providerType: "openai" } },
    label: "test-model",
  })),
}));

const { invokeCapabilityAgent, runStructuredCapability } = await import("./engine");

const OutputSchema = z.object({ foo: z.string() });
const CTX: AgentRunContext = {};

function fakeStructuredCapability(
  overrides: Partial<StructuredCapability<{ q: string }, { q: string }, { foo: string }, { foo: string }>> = {},
): StructuredCapability<{ q: string }, { q: string }, { foo: string }, { foo: string }> {
  return {
    id: "test-cap",
    delivery: "structured",
    permission: PERMISSIONS.AI_CHAT,
    inputSchema: z.object({ q: z.string() }),
    outputSchema: OutputSchema,
    prepare: (input) => input,
    tools: () => ({}),
    instructions: () => "instructions",
    messages: () => [{ role: "user", content: "hi" }],
    finalize: (parsed) => parsed,
    ...overrides,
  };
}

function fakeInvokeCapability(): InvokeCapability<{ threadId?: string }> {
  return {
    id: "chat-test",
    delivery: "invoke",
    permission: PERMISSIONS.AI_CHAT,
    inputSchema: z.object({ threadId: z.string().optional() }),
    tools: () => ({}),
    instructions: () => "instructions",
  };
}

describe("runStructuredCapability", () => {
  it("parses schema-valid JSON from the agent's final response", async () => {
    invokeResult = { messages: [{ content: '{"foo":"from-text"}' }] };
    registerHarnessProfileMock.mockClear();

    const output = await runStructuredCapability(fakeStructuredCapability(), { q: "hi" }, CTX);

    expect(output).toEqual({ foo: "from-text" });
    const config = createDeepAgentMock.mock.calls.at(-1)?.[0] as {
      responseFormat?: unknown;
      subagents?: unknown[];
    };
    expect(config.responseFormat).toBeUndefined();
    expect(config.subagents).toEqual([]);
    expect(registerHarnessProfileMock).toHaveBeenCalled();
    const [, profile] = registerHarnessProfileMock.mock.calls[0] as [
      string,
      { excludedTools: string[]; generalPurposeSubagent: { enabled: boolean } },
    ];
    expect(profile.excludedTools).toContain("task");
    expect(profile.excludedTools).toContain("write_todos");
    expect(profile.excludedTools).toContain("execute");
    expect(profile.generalPurposeSubagent.enabled).toBe(false);
  });

  it("calls onParseFailure when extraction and fallback both fail", async () => {
    invokeResult = { messages: [{ content: "no json here" }] };
    const onParseFailure = mock(() => ({ foo: "recovered" }));

    const output = await runStructuredCapability(
      fakeStructuredCapability({ onParseFailure }),
      { q: "hi" },
      CTX,
    );

    expect(onParseFailure).toHaveBeenCalled();
    expect(output).toEqual({ foo: "recovered" });
  });

  it("returns an evidence-keyed cached result before creating an agent", async () => {
    createDeepAgentMock.mockClear();
    const cachedResult = mock(() => ({ foo: "cached" }));
    const output = await runStructuredCapability(fakeStructuredCapability({ cachedResult }), { q: "hi" }, CTX);
    expect(output).toEqual({ foo: "cached" });
    expect(cachedResult).toHaveBeenCalledWith({ q: "hi" }, CTX);
    expect(createDeepAgentMock).not.toHaveBeenCalled();
  });

  it("stores a successful finalized result", async () => {
    invokeResult = { messages: [{ content: '{"foo":"fresh"}' }] };
    const cacheResult = mock(() => {});
    const output = await runStructuredCapability(fakeStructuredCapability({ cacheResult }), { q: "hi" }, CTX);
    expect(output).toEqual({ foo: "fresh" });
    expect(cacheResult).toHaveBeenCalledWith({ foo: "fresh" }, { q: "hi" }, CTX);
  });
});

describe("invokeCapabilityAgent", () => {
  it("returns one final response without a streaming run", async () => {
    invokeResult = { messages: [{ content: "Complete answer" }] };

    const result = await invokeCapabilityAgent(
      fakeInvokeCapability(),
      {},
      CTX,
      [{ role: "user", content: "hi" }],
    );

    expect(result).toEqual({ content: "Complete answer", toolCalls: [] });
  });
});

describe("per-model runtime overrides", () => {
  function lastInvokeConfig(): { recursionLimit?: number; signal?: AbortSignal } {
    const call = invokeMock.mock.calls.at(-1) as unknown[] | undefined;
    return (call?.[1] ?? {}) as { recursionLimit?: number; signal?: AbortSignal };
  }

  it("uses the computed recursion limit when no params are set", async () => {
    modelParams = null;
    invokeResult = { messages: [{ content: '{"foo":"x"}' }] };

    await runStructuredCapability(fakeStructuredCapability(), { q: "hi" }, CTX);
    // Default stopAtSteps 10 -> max(24, 10*4) = 40.
    expect(lastInvokeConfig().recursionLimit).toBe(40);

    invokeResult = { messages: [{ content: "done" }] };
    await invokeCapabilityAgent(fakeInvokeCapability(), {}, CTX, [{ role: "user", content: "hi" }]);
    // Default stopAtSteps 12 -> max(24, 12*4) = 48.
    expect(lastInvokeConfig().recursionLimit).toBe(48);
  });

  it("applies the per-model recursionLimit and runTimeoutMs to both run modes", async () => {
    modelParams = { recursionLimit: 99, runTimeoutMs: 30_000 };
    try {
      invokeResult = { messages: [{ content: '{"foo":"x"}' }] };
      await runStructuredCapability(fakeStructuredCapability(), { q: "hi" }, CTX);
      let cfg = lastInvokeConfig();
      expect(cfg.recursionLimit).toBe(99);
      expect(cfg.signal).toBeInstanceOf(AbortSignal);
      expect(cfg.signal?.aborted).toBe(false);

      invokeResult = { messages: [{ content: "done" }] };
      await invokeCapabilityAgent(fakeInvokeCapability(), {}, CTX, [{ role: "user", content: "hi" }]);
      cfg = lastInvokeConfig();
      expect(cfg.recursionLimit).toBe(99);
      expect(cfg.signal).toBeInstanceOf(AbortSignal);
    } finally {
      modelParams = null;
    }
  });
});
