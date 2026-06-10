/**
 * AI Engine — the single agent-run ritual shared by every capability.
 *
 * Owns: model resolution, ToolLoopAgent construction, the stream→text →
 * structured-output extraction (with generateObject fallback), tool-call step
 * collection, and provider-error mapping. Capabilities supply only what varies.
 *
 * This replaces the ~8 hand-rolled copies of the same loop in aiOptimizer.ts
 * and chouseDoctor.ts.
 */

import { ToolLoopAgent, stepCountIs, type ModelMessage } from "ai";
import { AppError } from "../../types";
import { resolveModel } from "./model";
import { structuredOutput } from "./structuredOutput";
import { handleAiError } from "./errors";
import type {
  AgentRunContext,
  AnyStructuredCapability,
  StreamCapability,
  StructuredCapability,
} from "./types";

/** Collect the agent's tool-call audit trail (best-effort). */
async function collectSteps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamResult: any,
): Promise<{ tool: string; input: unknown }[]> {
  try {
    const stepArr = (await streamResult.steps) as {
      toolCalls?: { toolName: string; input?: unknown; args?: unknown }[];
    }[];
    return stepArr.flatMap((s) =>
      (s.toolCalls ?? []).map((tc) => ({ tool: tc.toolName, input: tc.input ?? tc.args })),
    );
  } catch {
    return [];
  }
}

/**
 * Run a structured (non-streaming) capability end to end.
 */
export async function runStructuredCapability<TInput, TPrepared, TParsed, TOutput>(
  cap: StructuredCapability<TInput, TPrepared, TParsed, TOutput>,
  input: TInput,
  ctx: AgentRunContext,
): Promise<TOutput> {
  try {
    const { model, label } = await resolveModel(ctx.modelId);

    const prepared = await cap.prepare(input, ctx);
    const tools = await cap.tools(prepared, ctx);
    const instructions = await cap.instructions(prepared, ctx);
    const messages = await cap.messages(prepared, ctx);

    const agent = new ToolLoopAgent({
      model,
      instructions,
      tools,
      stopWhen: stepCountIs(cap.tuning?.stopAtSteps ?? 10),
      temperature: cap.tuning?.temperature ?? 0,
      ...(cap.tuning?.maxOutputTokens ? { maxOutputTokens: cap.tuning.maxOutputTokens } : {}),
    });

    const streamResult = await agent.stream({ messages });
    const raw = await streamResult.text;
    const steps = await collectSteps(streamResult);

    const fallbackMessages: ModelMessage[] = cap.fallbackMessages
      ? cap.fallbackMessages(prepared, ctx, raw)
      : [
          { role: "system", content: instructions },
          {
            role: "user",
            content: `Investigation notes (may be empty):\n${raw || "(none)"}\n\nProduce the JSON result now.`,
          },
        ];

    const parsed = await structuredOutput({
      model,
      schema: cap.outputSchema,
      raw,
      fallbackMessages,
      maxOutputTokens: cap.tuning?.maxOutputTokens,
      module: `AI:${cap.id}`,
    });

    const meta = { raw, steps, modelLabel: label };

    if (parsed === null) {
      if (cap.onParseFailure) return await cap.onParseFailure(prepared, ctx, meta);
      throw AppError.internal(
        `Chouse AI could not complete '${cap.id}' — please try again.`,
      );
    }

    return await cap.finalize(parsed, prepared, ctx, meta);
  } catch (error) {
    if (cap.softFail) return cap.softFail(error);
    handleAiError(error, `AI:${cap.id}`);
  }
}

/**
 * Build a streaming agent for a stream capability (chat). Returns the AI-SDK
 * stream result; the route owns SSE framing + presentation.
 */
export async function streamCapabilityAgent<TInput>(
  cap: StreamCapability<TInput>,
  _input: TInput,
  ctx: AgentRunContext,
  messages: ModelMessage[],
) {
  const { model } = await resolveModel(ctx.modelId);
  const tools = await cap.tools(ctx);
  const instructions = await cap.instructions(ctx);

  const agent = new ToolLoopAgent({
    model,
    instructions,
    tools,
    stopWhen: stepCountIs(cap.tuning?.stopAtSteps ?? 30),
    temperature: cap.tuning?.temperature ?? 0,
    ...(cap.tuning?.maxOutputTokens ? { maxOutputTokens: cap.tuning.maxOutputTokens } : {}),
  });

  return agent.stream({ messages });
}

/** Type guard: is this capability structured (vs stream)? */
export function isStructured(cap: {
  delivery: string;
}): cap is AnyStructuredCapability {
  return cap.delivery === "structured";
}
