/**
 * Engine tests — the DeepAgents boundary, the model and the registry snapshot
 * are mocked so binding resolution, prompt/task rendering, harness wiring,
 * subagent trees, structured extraction and runtime overrides are deterministic.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import { AppError } from "../../types";
import type { AgentRunContext, StructuredCapability } from "./types";
import type { AgentDef, HarnessDef, RegistrySnapshot } from "./registry/types";

let invokeResult: unknown = { messages: [] };
const invokeMock = mock(async () => invokeResult);
interface CreatedAgent { invoke: typeof invokeMock; withConfig: (config: unknown) => CreatedAgent; params: Record<string, unknown> }
const createDeepAgentMock = mock((params: Record<string, unknown>): CreatedAgent => {
  const agent: CreatedAgent = { invoke: invokeMock, withConfig: () => agent, params };
  return agent;
});
const registerHarnessProfileMock = mock((_key: string, _profile: unknown) => {});

mock.module("deepagents", () => ({
  CompositeBackend: class {},
  StateBackend: class {},
  GENERAL_PURPOSE_SUBAGENT: { name: "general-purpose", description: "gp", systemPrompt: "gp prompt" },
  createDeepAgent: createDeepAgentMock,
  registerHarnessProfile: registerHarnessProfileMock,
}));

// Mutable so individual tests can attach per-model runtime params.
let modelParams: Record<string, unknown> | null = null;
let fallbackModelResult: unknown = { content: "still not json" };
let fallbackWithStructuredOutput: ((...args: unknown[]) => unknown) | undefined;
const fallbackModelInvokeMock = mock(async () => fallbackModelResult);
const resolveModelMock = mock(async (id?: string) => ({
  model: {
    invoke: fallbackModelInvokeMock,
    ...(fallbackWithStructuredOutput ? { withStructuredOutput: fallbackWithStructuredOutput } : {}),
  },
  config: { model: { modelId: id ?? "gpt-4o", params: modelParams }, provider: { providerType: "openai" } },
  label: id ?? "test-model",
}));
mock.module("./model", () => ({ resolveDeepAgentModel: resolveModelMock }));

let snapshot: RegistrySnapshot;
mock.module("./registry/cache", () => ({ getRegistrySnapshot: async () => snapshot, resetRegistryCache: () => {} }));

const { invokeChat, runStructuredCapability, runFeature } = await import("./engine");

// ============================================
// Fixtures
// ============================================

function harness(overrides: Partial<HarnessDef> = {}): HarnessDef {
  return {
    id: "h-focused", slug: "focused", name: "Focused", description: "",
    excludedTools: ["task", "write_todos"], generalPurpose: { enabled: false }, promptSuffix: "Use tools directly.",
    toolDescriptionOverrides: {}, isSystem: true, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

function agent(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    id: "a-test", slug: "test-agent", name: "Test Agent", description: "tests", kind: "agent",
    systemPrompt: "instructions", taskTemplate: "Question: {{ctx.q}}", modelConfigId: null, harnessId: "h-focused",
    tuning: { stepBudget: 10 }, requiredPermissions: [], tools: [], skills: [], subagents: [], enabled: true,
    isSystem: false, seedHash: null, customized: false, version: 3, createdBy: null, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

function registry(agents: AgentDef[], bindings: Record<string, string>, harnesses: HarnessDef[] = [harness(), harness({ id: "h-deleg", slug: "delegating", excludedTools: [], promptSuffix: null })]): RegistrySnapshot {
  return {
    version: 1,
    agents: new Map(agents.map((a) => [a.id, a])),
    harnesses: new Map(harnesses.map((h) => [h.id, h])),
    skills: new Map(),
    bindings: new Map(Object.entries(bindings).map(([featureId, agentId]) => [featureId, { featureId, agentId, updatedBy: null, updatedAt: 0 }])),
  };
}

const OutputSchema = z.object({ foo: z.string() });
const CTX: AgentRunContext = {};

function fakeStructuredCapability(
  overrides: Partial<StructuredCapability<{ q: string }, { q: string }, { foo: string }, { foo: string }>> = {},
): StructuredCapability<{ q: string }, { q: string }, { foo: string }, { foo: string }> {
  return {
    id: "test-cap",
    title: "Test",
    description: "test feature",
    surface: "sql-editor",
    delivery: "structured",
    permission: PERMISSIONS.AI_CHAT,
    contexts: [],
    variables: { q: { type: "string", description: "question" } },
    inputSchema: z.object({ q: z.string() }),
    outputSchema: OutputSchema,
    prepare: (input) => input,
    templateVariables: (prepared) => ({ q: prepared.q }),
    finalize: (parsed) => parsed,
    ...overrides,
  };
}

function lastParams(): Record<string, unknown> {
  return (createDeepAgentMock.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>;
}

function lastInvoke(): { input: { messages: Array<{ role: string; content: string }> }; config: { recursionLimit?: number; signal?: AbortSignal } } {
  const call = invokeMock.mock.calls.at(-1) as unknown[] | undefined;
  return { input: call?.[0] as never, config: (call?.[1] ?? {}) as never };
}

beforeEach(() => {
  snapshot = registry([agent(), agent({ id: "a-chat", slug: "chat-agent", name: "Chat", taskTemplate: null, tuning: { stepBudget: 12 } })], { "test-cap": "a-test", chat: "a-chat" });
  createDeepAgentMock.mockClear();
  invokeMock.mockClear();
  registerHarnessProfileMock.mockClear();
  modelParams = null;
});

// ============================================
// Structured features
// ============================================

describe("runStructuredCapability", () => {
  it("runs the bound agent with its rendered prompt, task and harness", async () => {
    invokeResult = { messages: [{ content: '{"foo":"from-text"}' }] };

    const output = await runStructuredCapability(fakeStructuredCapability(), { q: "why slow?" }, CTX);

    expect(output).toEqual({ foo: "from-text" });
    const params = lastParams();
    expect(params.responseFormat).toBeUndefined();
    expect(params.subagents).toEqual([]);
    expect(params.name).toBe("test-agent");
    expect(String(params.systemPrompt)).toStartWith("instructions\nThe final answer must match this JSON Schema exactly");
    expect(String(params.systemPrompt)).toContain('"foo"');
    expect(String(params.systemPrompt)).toEndWith("\n\nUse tools directly.");
    expect((params.middleware as Array<{ name: string }>)[0].name).toBe("ChouseHarness_focused");
    expect(lastInvoke().input.messages).toEqual([{ role: "user", content: "Question: why slow?" }]);
    // The only global harness registration: no implicit general-purpose subagent.
    const [, profile] = registerHarnessProfileMock.mock.calls[0] as [string, { generalPurposeSubagent: { enabled: boolean } }];
    expect(profile).toEqual({ generalPurposeSubagent: { enabled: false } });
  });

  it("fails closed when the feature has no bound agent", async () => {
    snapshot = registry([agent()], {});
    await expect(runStructuredCapability(fakeStructuredCapability(), { q: "x" }, CTX)).rejects.toThrow("has no valid agent");
    expect(createDeepAgentMock).not.toHaveBeenCalled();
  });

  it("fails closed when the bound agent is disabled", async () => {
    snapshot = registry([agent({ enabled: false })], { "test-cap": "a-test" });
    await expect(runStructuredCapability(fakeStructuredCapability(), { q: "x" }, CTX)).rejects.toThrow("disabled agent");
  });

  it("soft-fails instead of throwing when the feature asks for it", async () => {
    snapshot = registry([agent()], {});
    const softFail = mock((error: unknown) => ({ foo: error instanceof AppError ? "soft" : "?" }));
    const output = await runStructuredCapability(fakeStructuredCapability({ softFail }), { q: "x" }, CTX);
    expect(output).toEqual({ foo: "soft" });
  });

  it("calls onParseFailure when extraction and fallback both fail, sharing the run's signal", async () => {
    invokeResult = { messages: [{ content: "no json here" }] };
    const onParseFailure = mock(() => ({ foo: "recovered" }));

    const output = await runStructuredCapability(fakeStructuredCapability({ onParseFailure }), { q: "hi" }, CTX);

    expect(onParseFailure).toHaveBeenCalled();
    expect(output).toEqual({ foo: "recovered" });
    const agentSignal = lastInvoke().config.signal;
    const fallbackSignal = (fallbackModelInvokeMock.mock.calls.at(-1)?.[1] as { signal?: AbortSignal })?.signal;
    expect(fallbackSignal).toBe(agentSignal);
  });

  it("hands the rendered prompts to the feature's fallback builder", async () => {
    invokeResult = { messages: [{ content: "no json" }] };
    const fallbackMessages = mock(() => [{ role: "user" as const, content: "format it" }]);
    await runStructuredCapability(fakeStructuredCapability({ fallbackMessages, onParseFailure: () => ({ foo: "x" }) }), { q: "hi" }, CTX);
    expect(fallbackMessages).toHaveBeenCalledWith({ q: "hi" }, CTX, "no json", { system: "instructions", core: "instructions" });
  });

  it("keeps large schemas out of the initial agent prompt", async () => {
    invokeResult = { messages: [{ content: '{"foo":"from-text"}' }] };
    const largeSchema = OutputSchema.describe("large schema ".repeat(500));

    await runStructuredCapability(fakeStructuredCapability({ outputSchema: largeSchema }), { q: "hi" }, CTX);

    const prompt = String(lastParams().systemPrompt);
    expect(prompt).toContain("dedicated formatter will enforce the complete schema");
    expect(prompt).toContain("top-level keys: foo");
    expect(prompt).not.toContain("large schema large schema");
    expect(prompt.length).toBeLessThan(2_500);
  });

  it("returns a cached result scoped to the agent revision before building an agent", async () => {
    const cachedResult = mock(() => ({ foo: "cached" }));
    const output = await runStructuredCapability(fakeStructuredCapability({ cachedResult }), { q: "hi" }, CTX);
    expect(output).toEqual({ foo: "cached" });
    expect(cachedResult).toHaveBeenCalledWith({ q: "hi" }, CTX, "a-test@3");
    expect(createDeepAgentMock).not.toHaveBeenCalled();
  });

  it("stores a successful finalized result under the agent revision", async () => {
    invokeResult = { messages: [{ content: '{"foo":"fresh"}' }] };
    const cacheResult = mock(() => {});
    const output = await runStructuredCapability(fakeStructuredCapability({ cacheResult }), { q: "hi" }, CTX);
    expect(output).toEqual({ foo: "fresh" });
    expect(cacheResult).toHaveBeenCalledWith({ foo: "fresh" }, { q: "hi" }, CTX, "a-test@3");
  });

  it("uses the request model, then the agent's model, then the default", async () => {
    invokeResult = { messages: [{ content: '{"foo":"x"}' }] };
    snapshot = registry([agent({ modelConfigId: "agent-model" })], { "test-cap": "a-test" });
    await runStructuredCapability(fakeStructuredCapability(), { q: "hi" }, CTX);
    expect(resolveModelMock.mock.calls.at(-1)?.[0]).toBe("agent-model");
    await runStructuredCapability(fakeStructuredCapability(), { q: "hi" }, { modelId: "picked" });
    expect(resolveModelMock.mock.calls.at(-1)?.[0]).toBe("picked");
  });

  it("runs a draft agent against a draft snapshot and reports the trace (test console)", async () => {
    invokeResult = { messages: [{ content: '{"foo":"draft"}' }] };
    const draft = agent({ id: "draft", slug: "draft-agent", systemPrompt: "draft instructions" });
    const onTrace = mock(() => {});
    await runStructuredCapability(fakeStructuredCapability(), { q: "hi" }, CTX, { snapshot: registry([draft], {}), agentId: "draft", onTrace });
    expect(String(lastParams().systemPrompt)).toStartWith("draft instructions");
    expect(onTrace).toHaveBeenCalledTimes(1);
    const trace = (onTrace.mock.calls[0] as unknown[])[0] as { agent: { slug: string }; task: string; raw: string };
    expect(trace.agent.slug).toBe("draft-agent");
    expect(trace.task).toBe("Question: hi");
    expect(trace.raw).toBe('{"foo":"draft"}');
  });

  it("runFeature validates the input and runs a registered feature", async () => {
    await expect(runFeature("not-a-feature", {}, CTX)).rejects.toThrow("Unknown AI feature");
    await expect(runFeature("chat", {}, CTX)).rejects.toThrow("Unknown AI feature");
  });
});

// ============================================
// Subagent trees
// ============================================

describe("agent trees", () => {
  it("compiles enabled children as named subagents with their own recursion limit", async () => {
    snapshot = registry([
      agent({ id: "root", slug: "root", taskTemplate: null, harnessId: "h-deleg", subagents: ["child", "off"] }),
      agent({ id: "child", slug: "child", description: "the child", taskTemplate: null, tuning: { stepBudget: 5, recursionLimit: 30 } }),
      agent({ id: "off", slug: "off", taskTemplate: null, enabled: false }),
    ], { chat: "root" });
    invokeResult = { messages: [{ content: "done" }] };

    const result = await invokeChat(CTX, [{ role: "user", content: "hi" }]);

    expect(result.agent.slug).toBe("root");
    const childParams = createDeepAgentMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const rootParams = lastParams();
    expect(childParams.name).toBe("child");
    expect(rootParams.name).toBe("root");
    const subagents = rootParams.subagents as Array<{ name: string; description: string }>;
    expect(subagents.map((s) => [s.name, s.description])).toEqual([["child", "the child"]]);
    // The delegating harness has no exclusions or overrides, so no harness middleware.
    expect(rootParams.middleware).toBeUndefined();
  });

  it("adds the general-purpose subagent only when the harness enables it", async () => {
    snapshot = registry(
      [agent({ id: "root", slug: "root", taskTemplate: null, harnessId: "h-gp" })],
      { chat: "root" },
      [harness({ id: "h-gp", slug: "gp", excludedTools: [], promptSuffix: null, generalPurpose: { enabled: true, description: "custom gp" } })],
    );
    invokeResult = { messages: [{ content: "done" }] };
    await invokeChat(CTX, [{ role: "user", content: "hi" }]);
    const subagents = lastParams().subagents as Array<{ name: string; description: string }>;
    expect(subagents).toHaveLength(1);
    expect(subagents[0]).toMatchObject({ name: "general-purpose", description: "custom gp" });
  });

  it("prunes children the chat user may not use", async () => {
    snapshot = registry([
      agent({ id: "root", slug: "root", taskTemplate: null, harnessId: "h-deleg", subagents: ["secret"] }),
      agent({ id: "secret", slug: "secret", taskTemplate: null, requiredPermissions: [PERMISSIONS.USERS_VIEW] }),
    ], { chat: "root" });
    invokeResult = { messages: [{ content: "done" }] };
    await invokeChat({ permissions: [] }, [{ role: "user", content: "hi" }]);
    expect(lastParams().subagents).toEqual([]);
    await invokeChat({ permissions: [PERMISSIONS.USERS_VIEW] }, [{ role: "user", content: "hi" }]);
    expect((lastParams().subagents as unknown[]).length).toBe(1);
  });

  it("rejects subagent cycles", async () => {
    snapshot = registry([
      agent({ id: "a", slug: "a", taskTemplate: null, harnessId: "h-deleg", subagents: ["b"] }),
      agent({ id: "b", slug: "b", taskTemplate: null, harnessId: "h-deleg", subagents: ["a"] }),
    ], { chat: "a" });
    await expect(invokeChat(CTX, [{ role: "user", content: "hi" }])).rejects.toThrow("cycle");
  });
});

// ============================================
// Chat
// ============================================

describe("invokeChat", () => {
  it("answers with the bound chat agent and reports it", async () => {
    invokeResult = { messages: [{ content: "Complete answer" }] };
    const result = await invokeChat(CTX, [{ role: "user", content: "hi" }]);
    expect(result).toEqual({ content: "Complete answer", toolCalls: [], agent: { id: "a-chat", slug: "chat-agent", name: "Chat" } });
    expect(lastInvoke().input.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("uses a picked agent the user may use, and refuses feature agents or forbidden ones", async () => {
    snapshot = registry([
      agent({ id: "a-chat", slug: "chat-agent", taskTemplate: null }),
      agent({ id: "a-other", slug: "other", name: "Other", taskTemplate: null }),
      agent({ id: "a-admin", slug: "admin-only", taskTemplate: null, requiredPermissions: [PERMISSIONS.USERS_VIEW] }),
      agent(),
    ], { chat: "a-chat", "test-cap": "a-test" });
    invokeResult = { messages: [{ content: "ok" }] };
    expect((await invokeChat(CTX, [{ role: "user", content: "hi" }], { agentId: "a-other" })).agent.slug).toBe("other");
    await expect(invokeChat(CTX, [{ role: "user", content: "hi" }], { agentId: "a-test" })).rejects.toThrow("not available");
    await expect(invokeChat({ permissions: [] }, [{ role: "user", content: "hi" }], { agentId: "a-admin" })).rejects.toThrow("not available");
  });
});

// ============================================
// Runtime overrides
// ============================================

describe("runtime overrides", () => {
  it("derives the recursion limit from the agent's step budget", async () => {
    invokeResult = { messages: [{ content: '{"foo":"x"}' }] };
    await runStructuredCapability(fakeStructuredCapability(), { q: "hi" }, CTX);
    // stepBudget 10 -> max(24, 10*4) = 40.
    expect(lastInvoke().config.recursionLimit).toBe(40);

    invokeResult = { messages: [{ content: "done" }] };
    await invokeChat(CTX, [{ role: "user", content: "hi" }]);
    // stepBudget 12 -> max(24, 12*4) = 48.
    expect(lastInvoke().config.recursionLimit).toBe(48);
  });

  it("honours the agent's own recursion limit", async () => {
    snapshot = registry([agent({ tuning: { stepBudget: 10, recursionLimit: 77 } })], { "test-cap": "a-test" });
    invokeResult = { messages: [{ content: '{"foo":"x"}' }] };
    await runStructuredCapability(fakeStructuredCapability(), { q: "hi" }, CTX);
    expect(lastInvoke().config.recursionLimit).toBe(77);
  });

  it("applies the per-model recursionLimit and runTimeoutMs to both run modes", async () => {
    modelParams = { recursionLimit: 99, runTimeoutMs: 30_000 };
    invokeResult = { messages: [{ content: '{"foo":"x"}' }] };
    await runStructuredCapability(fakeStructuredCapability(), { q: "hi" }, CTX);
    expect(lastInvoke().config.recursionLimit).toBe(99);
    expect(lastInvoke().config.signal).toBeInstanceOf(AbortSignal);
    expect(lastInvoke().config.signal?.aborted).toBe(false);

    invokeResult = { messages: [{ content: "done" }] };
    await invokeChat(CTX, [{ role: "user", content: "hi" }]);
    expect(lastInvoke().config.recursionLimit).toBe(99);
  });

  it("applies the per-model structured-output policy to structured runs", async () => {
    const methods: Array<string | undefined> = [];
    modelParams = { structuredOutputPolicy: "tool" };
    fallbackWithStructuredOutput = ((_schema: unknown, options: unknown) => {
      const method = (options as { method?: string } | undefined)?.method;
      methods.push(method);
      return { invoke: async () => ({ foo: method }) };
    }) as (...args: unknown[]) => unknown;
    try {
      invokeResult = { messages: [{ content: "not json" }] };
      const output = await runStructuredCapability(fakeStructuredCapability(), { q: "hi" }, CTX);
      expect(output).toEqual({ foo: "functionCalling" });
      expect(methods).toEqual(["functionCalling"]);
    } finally {
      fallbackWithStructuredOutput = undefined;
      fallbackModelResult = { content: "still not json" };
    }
  });
});
