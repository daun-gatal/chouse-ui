import { describe, expect, it } from "bun:test";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import { createDeepAgent } from "deepagents";
import { z } from "zod";

import { guardrailMiddleware } from "./middleware";
import { GuardrailBlockedError, GuardrailRunner, guardrailErrorIn } from "./runner";
import type { GuardrailDef, GuardrailEvent } from "./types";

/** Replays scripted replies and records what each call was sent. */
class ScriptedModel extends BaseChatModel {
  readonly seen: BaseMessage[][] = [];
  constructor(private readonly replies: AIMessage[]) {
    super({});
  }
  _llmType(): string {
    return "scripted";
  }
  bindTools(): this {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    const reply = this.replies.shift() ?? new AIMessage("done");
    return { generations: [{ text: typeof reply.content === "string" ? reply.content : "", message: reply }] };
  }
}

const lookup = tool(async () => JSON.stringify({ rows: [{ email: "dana@acme.io", plan: "pro" }] }), {
  name: "lookup", description: "Look up a customer", schema: z.object({ q: z.string() }),
});

function guardrail(partial: Partial<GuardrailDef> & Pick<GuardrailDef, "kind" | "config" | "stages" | "action">): GuardrailDef {
  return {
    id: "g", slug: "g", name: "PII", description: "", mode: "enforce", scope: { agents: "all", features: "all", mcp: false },
    position: 10, enabled: true, isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0, ...partial,
  };
}

const PII = guardrail({ kind: "pattern", config: { detectors: ["email", "card"], patterns: [], strategy: "placeholder" }, stages: ["input", "tool_result", "output"], action: "redact" });

function agentWith(model: ScriptedModel, list: GuardrailDef[]): { invoke: (text: string) => Promise<{ messages: BaseMessage[] }>; events: GuardrailEvent[] } {
  const events: GuardrailEvent[] = [];
  const runner = new GuardrailRunner(list, {
    featureId: "chat", permissions: [], isAdmin: false, estimateRows: null,
    judge: async () => ({ violates: false, reason: "" }), record: (e) => events.push(e),
  });
  const middleware = guardrailMiddleware(runner, { agentId: "a1", agentSlug: "root", path: "root", isRoot: true });
  const agent = createDeepAgent({ model: model as never, tools: [lookup], middleware: middleware ? [middleware] : [] });
  return { events, invoke: (text) => agent.invoke({ messages: [new HumanMessage(text)] }) as Promise<{ messages: BaseMessage[] }> };
}

function text(message: BaseMessage | undefined): string {
  return typeof message?.content === "string" ? message.content : JSON.stringify(message?.content);
}

describe("guardrail middleware in a DeepAgents run", () => {
  it("redacts what the model is sent and what it answers", async () => {
    const model = new ScriptedModel([
      new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "lookup", args: { q: "x" } }] }),
      new AIMessage("Write to dana@acme.io"),
    ]);
    const { invoke, events } = agentWith(model, [PII]);
    const result = await invoke("Customer with card 4242 4242 4242 4242?");

    const firstCall = model.seen[0];
    expect(text(firstCall.find((m) => HumanMessage.isInstance(m)))).toBe("Customer with card [CARD]?");
    const toolResult = model.seen[1].find((m) => ToolMessage.isInstance(m));
    expect(JSON.parse(text(toolResult))).toEqual({ rows: [{ email: "[EMAIL]", plan: "pro" }] });
    expect(text(result.messages[result.messages.length - 1])).toBe("Write to [EMAIL]");
    // The stored conversation holds the redacted input too, not a copy next to it.
    expect(result.messages.filter((m) => HumanMessage.isInstance(m)).map(text)).toEqual(["Customer with card [CARD]?"]);
    expect(events.map((e) => e.stage)).toEqual(["input", "tool_result", "output"]);
  });

  it("stops the run when a guardrail blocks", async () => {
    const model = new ScriptedModel([new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "lookup", args: { q: "x" } }] })]);
    const deny = guardrail({ kind: "tool", config: { tool: "lookup", rule: "deny", maxCalls: null, permission: null }, stages: ["tool_call"], action: "block" });
    const { invoke } = agentWith(model, [deny]);
    // LangChain wraps middleware errors; the engine unwraps them with guardrailErrorIn.
    const error = guardrailErrorIn(await invoke("go").catch((e: unknown) => e));
    expect(error).toBeInstanceOf(GuardrailBlockedError);
    expect((error as Error).message).toBe("Blocked by guardrail 'PII': The tool lookup is not allowed");
  });

  it("installs nothing when no guardrail applies", () => {
    const runner = new GuardrailRunner([], { featureId: "chat", permissions: [], isAdmin: false, estimateRows: null, judge: async () => ({ violates: false, reason: "" }), record: () => undefined });
    expect(guardrailMiddleware(runner, { agentId: "a1", agentSlug: "root", path: "root", isRoot: true })).toBeNull();
  });
});
