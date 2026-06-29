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

import { Output, ToolLoopAgent, stepCountIs, type ModelMessage } from "ai";
import { AppError } from "../../types";
import { resolveFallbackModels, resolveModel, type ResolvedModel } from "./model";
import { structuredOutput } from "./structuredOutput";
import { handleAiError } from "./errors";
import { logger } from "../../utils/logger";
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
    const prepared = await cap.prepare(input, ctx);
    const tools = await cap.tools(prepared, ctx);
    const instructions = await cap.instructions(prepared, ctx);
    const messages = await cap.messages(prepared, ctx);

    const primary = await resolveModel(ctx.modelId, cap.id);
    const fallbacks = await resolveFallbackModels(primary.policy, cap.id);
    const candidates = [primary, ...fallbacks];
    let lastError: unknown;

    async function runWithModel(
      resolved: ResolvedModel,
      fallbackDepth: number,
    ): Promise<TOutput> {
      const { model, label, policy } = resolved;
      const stopAtSteps = policy?.stopAtSteps ?? cap.tuning?.stopAtSteps ?? 10;
      const maxOutputTokens = policy?.maxOutputTokens ?? cap.tuning?.maxOutputTokens;
      const temperature = policy?.temperature ?? cap.tuning?.temperature ?? 0;

      const agent = new ToolLoopAgent({
        model,
        instructions,
        tools,
        output: Output.object({ schema: cap.outputSchema, name: cap.id }),
        stopWhen: stepCountIs(stopAtSteps),
        temperature,
        providerOptions: policy?.providerOptions ?? undefined,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
      });

      let raw = "";
      let parsed: TParsed | null = null;
      let steps: { tool: string; input: unknown }[] = [];
      let usage: unknown;
      let finishReason: string | undefined;
      let outputMode: "native" | "fallback" = "native";

      try {
        const result = await agent.generate({
          messages,
          abortSignal: ctx.abortSignal,
          ...(policy?.maxRuntimeMs ? { timeout: { totalMs: policy.maxRuntimeMs } } : {}),
        });
        raw = result.text;
        parsed = result.output as TParsed;
        steps = await collectSteps(result);
        usage = result.totalUsage;
        finishReason = result.finishReason;
      } catch {
        outputMode = "fallback";
        const fallbackAgent = new ToolLoopAgent({
          model,
          instructions,
          tools,
          stopWhen: stepCountIs(stopAtSteps),
          temperature,
          providerOptions: policy?.providerOptions ?? undefined,
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
        });
        const streamResult = await fallbackAgent.stream({
          messages,
          abortSignal: ctx.abortSignal,
          ...(policy?.maxRuntimeMs ? { timeout: { totalMs: policy.maxRuntimeMs } } : {}),
        });
        raw = await streamResult.text;
        steps = await collectSteps(streamResult);
        usage = await Promise.resolve(streamResult.totalUsage).catch(() => undefined);
      }

      const fallbackMessages: ModelMessage[] = cap.fallbackMessages
        ? cap.fallbackMessages(prepared, ctx, raw)
        : [
            { role: "system", content: instructions },
            {
              role: "user",
              content: `Investigation notes (may be empty):\n${raw || "(none)"}\n\nProduce the JSON result now.`,
            },
          ];

      if (parsed === null) {
        parsed = await structuredOutput({
          model,
          schema: cap.outputSchema,
          raw,
          fallbackMessages,
          maxOutputTokens,
          module: `AI:${cap.id}`,
        });
      }

      const meta = { raw, steps, modelLabel: label, usage, finishReason, policy, outputMode };

      if (parsed === null) {
        if (cap.onParseFailure) return await cap.onParseFailure(prepared, ctx, meta);
        throw AppError.internal(
          `Chouse AI could not complete '${cap.id}' — please try again.`,
        );
      }

      logger.info(
        {
          module: "AIEngine",
          capability: cap.id,
          configId: resolved.config.id,
          model: label,
          outputMode,
          toolCalls: steps.length,
          finishReason,
          usage,
          policyId: policy?.id,
          fallbackDepth,
          fallbackUsed: fallbackDepth > 0,
        },
        "AI structured capability completed",
      );

      return await cap.finalize(parsed, prepared, ctx, meta);
    }

    for (let index = 0; index < candidates.length; index += 1) {
      try {
        return await runWithModel(candidates[index], index);
      } catch (error) {
        lastError = error;
        if (index < candidates.length - 1) {
          logger.warn(
            {
              module: "AIEngine",
              capability: cap.id,
              configId: candidates[index].config.id,
              nextConfigId: candidates[index + 1].config.id,
              error: error instanceof Error ? error.message : String(error),
            },
            "AI capability failed; trying fallback deployment",
          );
        }
      }
    }

    throw lastError ?? AppError.internal(`Chouse AI could not complete '${cap.id}' — please try again.`);
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
  const { model, policy } = await resolveModel(ctx.modelId, cap.id);
  const tools = await cap.tools(ctx);
  const instructions = await cap.instructions(ctx);
  const stopAtSteps = policy?.stopAtSteps ?? cap.tuning?.stopAtSteps ?? 30;
  const maxOutputTokens = policy?.maxOutputTokens ?? cap.tuning?.maxOutputTokens;
  const temperature = policy?.temperature ?? cap.tuning?.temperature ?? 0;

  const agent = new ToolLoopAgent({
    model,
    instructions,
    tools,
    stopWhen: stepCountIs(stopAtSteps),
    temperature,
    providerOptions: policy?.providerOptions ?? undefined,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  });

  return agent.stream({
    messages,
    abortSignal: ctx.abortSignal,
    ...(policy?.maxRuntimeMs ? { timeout: { totalMs: policy.maxRuntimeMs } } : {}),
  });
}

/** Type guard: is this capability structured (vs stream)? */
export function isStructured(cap: {
  delivery: string;
}): cap is AnyStructuredCapability {
  return cap.delivery === "structured";
}
