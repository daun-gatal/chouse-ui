/**
 * The analysis sandbox (ADR 0024 §Phase 5): `js_eval`, a QuickJS WASM
 * interpreter (@langchain/quickjs) for harnesses that turn analysis on.
 *
 * - No network, no modules, no host filesystem; 64 MB of memory and a wall
 *   clock per evaluation. The clock counts time spent waiting for tools, so
 *   it is long enough for a ClickHouse query and still stops runaway loops.
 * - Inside, the agent calls its granted read-only tools as async functions
 *   (`tools.runSelectQuery({...})`), so rows reach the computation without
 *   passing through the model. Write tools are never bridged. Every bridged
 *   call passes the run's tool-call and tool-result guardrails, as it would
 *   as a normal tool call.
 * - One interpreter per agent node per run, disposed when the run ends.
 */

import { randomUUID } from "crypto";
import { tool } from "@langchain/core/tools";
import type { ReplSession } from "@langchain/quickjs";
import { z } from "zod";

import { createAgentTool, type AgentTool } from "../langchainTools";
import type { GuardrailRunner, StageMeta } from "../guardrails/runner";

export const ANALYSIS_TOOL = "js_eval";
export const ANALYSIS_LIMITS = {
  memoryLimitBytes: 64 * 1024 * 1024,
  /** Per evaluation, including the time bridged tools take. */
  timeoutMs: 15_000,
  /** Bridged tool calls per evaluation. */
  maxToolCalls: 20,
  /** Characters of output and result the model gets back. */
  maxResultChars: 8_000,
  maxCodeChars: 20_000,
} as const;

/** How the sandbox names a bridged tool (`run_select_query` → `runSelectQuery`), as @langchain/quickjs does. */
export function camelCaseToolName(name: string): string {
  return name.replace(/[-_]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

function resultText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * A read-only tool as the sandbox calls it: the same tool, checked by the
 * run's guardrails before and after, returning text like a tool message.
 */
export function bridgedTool(original: AgentTool, guard: { runner: GuardrailRunner; agentId: string; path: string } | null): AgentTool {
  if (!guard) return original;
  const callList = guard.runner.at("tool_call", guard.agentId);
  const resultList = guard.runner.at("tool_result", guard.agentId);
  if (callList.length + resultList.length === 0) return original;
  const meta: StageMeta = { agentPath: guard.path, tool: original.name };
  return tool(async (args: Record<string, unknown>) => {
    const notes = callList.length > 0 ? await guard.runner.checkToolCall(callList, original.name, args, meta) : [];
    const result = resultText(await original.invoke(args as never));
    return resultList.length > 0 || notes.length > 0 ? guard.runner.checkToolResult(resultList, result, meta, notes) : result;
  }, { name: original.name, description: original.description, schema: original.schema as z.ZodTypeAny }) as AgentTool;
}

/** The prompt section that tells the agent how to use the sandbox. */
export function analysisPrompt(bridged: readonly string[]): string {
  const lines = [
    "## ANALYSIS",
    `\`${ANALYSIS_TOOL}\` runs JavaScript or TypeScript in a sandbox: no network, no modules, no files. Variables persist between calls in this run. Use it to compute (aggregate, compare, reshape) instead of doing arithmetic in your head. End with an expression or console.log() to see a result.`,
    `Limits per call: ${ANALYSIS_LIMITS.timeoutMs / 1000} s including tool calls, ${ANALYSIS_LIMITS.memoryLimitBytes / 1048576} MB, ${ANALYSIS_LIMITS.maxToolCalls} tool calls.`,
  ];
  if (bridged.length > 0) {
    lines.push(
      "Inside it, your read-only tools are async functions that return the tool's text (usually JSON, so JSON.parse it). Rows you fetch there never pass through the conversation; return only the result you need.",
      ...bridged.map((name) => `- await tools.${camelCaseToolName(name)}({...}) — same arguments as \`${name}\``),
    );
  }
  return lines.join("\n");
}

/**
 * Build `js_eval` for one agent node. The interpreter starts on first use;
 * `onDispose` receives its cleanup, which the engine runs when the run ends.
 */
export function buildAnalysisTool(bridged: AgentTool[], onDispose: (dispose: () => void) => void): AgentTool {
  let session: ReplSession | null = null;
  onDispose(() => {
    session?.dispose();
    session = null;
  });
  return createAgentTool(ANALYSIS_TOOL, {
    description: "Evaluate JavaScript/TypeScript in a sandboxed interpreter (no network or files). State persists across calls in this run. Read-only tools are available as `tools.<camelCaseName>(args)`.",
    inputSchema: z.object({ code: z.string().min(1).max(ANALYSIS_LIMITS.maxCodeChars).describe("The code to evaluate") }),
    execute: async ({ code }: { code: string }) => {
      // Loaded on first use: servers whose harnesses never turn analysis on never load the interpreter.
      const { ReplSession: Session, formatReplResult } = await import("@langchain/quickjs");
      session ??= new Session(`chouse-analysis-${randomUUID()}`, {
        memoryLimitBytes: ANALYSIS_LIMITS.memoryLimitBytes,
        maxPtcCalls: ANALYSIS_LIMITS.maxToolCalls,
        maxResultChars: ANALYSIS_LIMITS.maxResultChars,
        captureConsole: true,
        tools: bridged,
      });
      return formatReplResult(await session.eval(code, ANALYSIS_LIMITS.timeoutMs));
    },
  });
}
