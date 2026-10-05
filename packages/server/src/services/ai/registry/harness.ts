/**
 * Per-agent harness (ADR 0019 §3).
 *
 * DeepAgents harness profiles are process-global, keyed by model and merge-only,
 * so they cannot vary per agent. A harness row is compiled per agent instead:
 * - excluded tools          → a tool-filtering middleware (the same wrapModelCall
 *                             filter DeepAgents installs for a profile)
 * - tool description edits  → applied to catalog tools, and to built-in tools in
 *                             the same middleware
 * - prompt suffix           → appended to the rendered system prompt
 * - general-purpose subagent → added explicitly when enabled
 *
 * The only global registration is the baseline "no implicit general-purpose
 * subagent" (see registerHarnessBaseline), which a merge-only registry allows.
 */

import { GENERAL_PURPOSE_SUBAGENT, registerHarnessProfile, type SubAgent } from "deepagents";
import { createMiddleware, type AgentMiddleware } from "langchain";

import type { AgentTool } from "../langchainTools";
import type { HarnessDef } from "./types";

/** Built-in DeepAgents tools an admin can hide (shown in the harness editor). */
export const BUILTIN_TOOLS: ReadonlyArray<{ name: string; description: string }> = [
  { name: "task", description: "Delegate work to a subagent. Required for agents with subagents." },
  { name: "write_todos", description: "Plan multi-step work as a todo list." },
  { name: "ls", description: "List files in the agent's virtual filesystem (skills live under /skills/)." },
  { name: "read_file", description: "Read a file — how the agent opens a skill's SKILL.md and reference files." },
  { name: "glob", description: "Find files by pattern." },
  { name: "grep", description: "Search file contents." },
  { name: "write_file", description: "Write a scratch file in the run's in-memory filesystem (never to disk; skills stay read-only)." },
  { name: "edit_file", description: "Edit a scratch file in the run's in-memory filesystem." },
  { name: "execute", description: "Run a shell command — only available with a sandbox backend; CHouse never provides one." },
  { name: "start_async_task", description: "Start a remote async subagent (not used by CHouse)." },
  { name: "check_async_task", description: "Check a remote async subagent (not used by CHouse)." },
  { name: "update_async_task", description: "Update a remote async subagent (not used by CHouse)." },
  { name: "cancel_async_task", description: "Cancel a remote async subagent (not used by CHouse)." },
  { name: "list_async_tasks", description: "List remote async subagents (not used by CHouse)." },
];

export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set(BUILTIN_TOOLS.map((t) => t.name));

/** Model-spec keys DeepAgents resolves a profile from (engine model.ts aliases other providers to "openai"). */
const BASELINE_PROVIDER_KEYS = ["openai", "anthropic", "google"];
const registeredBaselineKeys = new Set<string>();

/**
 * Register the global baseline once per key: no implicit general-purpose
 * subagent. Agents whose harness enables it get it explicitly. Model ids that
 * contain ":" (e.g. Bedrock ARNs) are looked up verbatim, so they get their own
 * key. Idempotent; merge-only registration makes repeats harmless.
 */
export function registerHarnessBaseline(modelId?: string | null): void {
  const keys = [...BASELINE_PROVIDER_KEYS];
  if (modelId && modelId.includes(":")) keys.push(modelId);
  for (const key of keys) {
    if (registeredBaselineKeys.has(key)) continue;
    registerHarnessProfile(key, { generalPurposeSubagent: { enabled: false } });
    registeredBaselineKeys.add(key);
  }
}

interface ToolLike {
  name: string;
  description: string;
}

/** Filter excluded tools and rewrite descriptions on every model call. */
export function harnessToolMiddleware(harness: HarnessDef): AgentMiddleware | null {
  const excluded = new Set(harness.excludedTools);
  const overrides = harness.toolDescriptionOverrides;
  if (excluded.size === 0 && Object.keys(overrides).length === 0) return null;
  return createMiddleware({
    name: `ChouseHarness_${harness.slug.replace(/[^A-Za-z0-9]/g, "_")}`,
    wrapModelCall: async (request, handler) => {
      const tools = request.tools
        ?.filter((t) => !excluded.has((t as ToolLike).name))
        .map((t) => {
          const name = (t as ToolLike).name;
          if (!(name in overrides)) return t;
          return Object.assign(Object.create(Object.getPrototypeOf(t) as object) as object, t, { description: overrides[name] });
        });
      return handler({ ...request, tools: tools as typeof request.tools });
    },
  }) as AgentMiddleware;
}

/** Catalog tools with the harness's description overrides applied. */
export function applyDescriptionOverrides(tools: AgentTool[], harness: HarnessDef): AgentTool[] {
  const overrides = harness.toolDescriptionOverrides;
  return tools.map((t) => (t.name in overrides
    ? (Object.assign(Object.create(Object.getPrototypeOf(t) as object) as object, t, { description: overrides[t.name] }) as AgentTool)
    : t));
}

/** Append the harness suffix to a rendered system prompt. */
export function applyPromptSuffix(prompt: string, harness: HarnessDef): string {
  const suffix = harness.promptSuffix?.trim();
  return suffix ? `${prompt}\n\n${suffix}` : prompt;
}

/** The general-purpose subagent when the harness enables it. */
export function generalPurposeSubagent(harness: HarnessDef, tools: AgentTool[], skills: string[]): SubAgent | null {
  if (!harness.generalPurpose.enabled) return null;
  return {
    ...GENERAL_PURPOSE_SUBAGENT,
    description: harness.generalPurpose.description?.trim() || GENERAL_PURPOSE_SUBAGENT.description,
    systemPrompt: harness.generalPurpose.systemPrompt?.trim() || GENERAL_PURPOSE_SUBAGENT.systemPrompt,
    tools,
    skills,
  } as SubAgent;
}
