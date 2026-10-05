/**
 * Pure helpers for Agents › Assistant (ADR 0019): grouping, compatibility
 * previews, agent trees, drafts and test-console inputs. The server validates
 * every save; these only shape the UI and give early hints.
 */

import type {
  AgentInput,
  AiAgent,
  AiFeature,
  AiRegistry,
  CatalogTool,
  FeatureSurface,
  RegistryProblem,
  ToolContextKind,
  VariableSpec,
} from "@/api/aiAgents";

export const SURFACE_ORDER: FeatureSurface[] = ["chat", "sql-editor", "doctor", "diagnostics", "dataops", "observe"];

export const SURFACE_LABELS: Record<FeatureSurface, string> = {
  chat: "Chat",
  "sql-editor": "SQL editor",
  doctor: "Doctor",
  diagnostics: "Diagnostics",
  dataops: "DataOps",
  observe: "Observability",
};

export const CONTEXT_LABELS: Record<ToolContextKind, string> = {
  session: "ClickHouse session",
  fleet: "Fleet nodes",
  userApi: "Your CHouse access",
};

export const CONTEXT_HINTS: Record<ToolContextKind, string> = {
  session: "Runs on the signed-in user's ClickHouse connection, with their data access rules.",
  fleet: "Read-only system.* queries on the nodes the feature resolved.",
  userApi: "Calls CHouse's own API as the chatting user — they see only what their permissions allow.",
};

export interface FeatureGroup {
  surface: FeatureSurface;
  label: string;
  features: AiFeature[];
}

export function groupFeatures(features: AiFeature[]): FeatureGroup[] {
  return SURFACE_ORDER
    .map((surface) => ({ surface, label: SURFACE_LABELS[surface], features: features.filter((f) => f.surface === surface).sort((a, b) => a.title.localeCompare(b.title)) }))
    .filter((group) => group.features.length > 0);
}

export type AgentOrigin = "built-in" | "customized" | "custom";

export function agentOrigin(row: { isSystem: boolean; customized: boolean }): AgentOrigin {
  if (!row.isSystem) return "custom";
  return row.customized ? "customized" : "built-in";
}

function byId(registry: AiRegistry): Map<string, AiAgent> {
  return new Map(registry.agents.map((a) => [a.id, a]));
}

/** The agent and every agent below it (cycle-safe). */
export function agentSubtree(agentId: string, registry: AiRegistry): AiAgent[] {
  const agents = byId(registry);
  const seen: AiAgent[] = [];
  const visit = (id: string): void => {
    const agent = agents.get(id);
    if (!agent || seen.includes(agent)) return;
    seen.push(agent);
    agent.subagents.forEach(visit);
  };
  visit(agentId);
  return seen;
}

/**
 * Agents that could serve a feature: chat agents (no task template) for the
 * chat, feature agents for structured features, and only when every tool in
 * the tree runs in a context the feature provides.
 */
export function compatibleAgents(feature: AiFeature, registry: AiRegistry): AiAgent[] {
  const tools = new Map(registry.tools.map((t) => [t.name, t]));
  return registry.agents
    .filter((agent) => agent.enabled)
    .filter((agent) => (feature.delivery === "invoke" ? agent.taskTemplate === null : agent.taskTemplate !== null))
    .filter((agent) => agentSubtree(agent.id, registry).every((member) => member.tools.every((name) => {
      const requires = tools.get(name)?.requires;
      return !requires || feature.contexts.includes(requires);
    })))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AgentTreeNode {
  agent: AiAgent;
  children: AgentTreeNode[];
}

/** Agents nobody uses as a subagent are roots; children nest below them. */
export function agentTree(registry: AiRegistry): AgentTreeNode[] {
  const agents = byId(registry);
  const childIds = new Set(registry.agents.flatMap((a) => a.subagents));
  const build = (agent: AiAgent, path: string[]): AgentTreeNode => ({
    agent,
    children: agent.subagents
      .filter((id) => !path.includes(id))
      .map((id) => agents.get(id))
      .filter((child): child is AiAgent => Boolean(child))
      .map((child) => build(child, [...path, child.id])),
  });
  return registry.agents
    .filter((agent) => !childIds.has(agent.id))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "router" ? -1 : 1))
    .map((agent) => build(agent, [agent.id]));
}

export interface ToolGroup {
  key: string;
  label: string;
  tools: CatalogTool[];
}

const DOMAIN_LABELS: Record<CatalogTool["domain"], string> = { clickhouse: "ClickHouse", chouse: "CHouse (read-only)" };

export function groupTools(tools: CatalogTool[]): ToolGroup[] {
  const groups = new Map<string, ToolGroup>();
  for (const tool of tools) {
    const key = `${tool.domain}:${tool.category}`;
    const group = groups.get(key) ?? { key, label: `${DOMAIN_LABELS[tool.domain]} · ${tool.category}`, tools: [] };
    group.tools.push(tool);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(base) || "agent";
  if (!used.has(root)) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root.slice(0, 56)}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function blankAgent(registry: AiRegistry): AgentInput {
  const focused = registry.harnesses.find((h) => h.slug === "focused") ?? registry.harnesses[0];
  return {
    slug: uniqueSlug("new-agent", registry.agents.map((a) => a.slug)),
    name: "New agent",
    description: "",
    kind: "agent",
    systemPrompt: "",
    taskTemplate: null,
    modelConfigId: null,
    harnessId: focused?.id ?? "",
    tuning: { stepBudget: 8, recursionLimit: null, timeoutMs: null, maxOutputTokens: null },
    requiredPermissions: [],
    tools: [],
    skills: [],
    subagents: [],
    enabled: true,
  };
}

/** A copy of an agent with a free slug — the safe way to experiment with a built-in. */
export function duplicateAgent(agent: AiAgent, registry: AiRegistry): AgentInput {
  return {
    slug: uniqueSlug(`${agent.slug}-copy`, registry.agents.map((a) => a.slug)),
    name: `${agent.name} (copy)`,
    description: agent.description,
    kind: agent.kind,
    systemPrompt: agent.systemPrompt,
    taskTemplate: agent.taskTemplate,
    modelConfigId: agent.modelConfigId,
    harnessId: agent.harnessId,
    tuning: { ...agent.tuning },
    requiredPermissions: [...agent.requiredPermissions],
    tools: [...agent.tools],
    skills: agent.skills.map((s) => ({ ...s })),
    subagents: [...agent.subagents],
    enabled: true,
  };
}

export function featuresBoundTo(agentId: string, registry: AiRegistry): AiFeature[] {
  return registry.features.filter((f) => f.agentId === agentId);
}

/** Variables every feature bound to the agent supplies (the editor's palette). */
export function variablesFor(agentId: string | null, registry: AiRegistry): Record<string, VariableSpec> {
  if (!agentId) return {};
  const features = featuresBoundTo(agentId, registry).filter((f) => f.delivery === "structured");
  if (features.length === 0) return {};
  const [first, ...rest] = features;
  return Object.fromEntries(Object.entries(first.variables).filter(([name]) => rest.every((f) => name in f.variables)));
}

export function problemsFor(problems: RegistryProblem[], entity: RegistryProblem["entity"], id: string): string[] {
  return problems.filter((p) => p.entity === entity && p.id === id).map((p) => p.message);
}

export type JsonParse = { ok: true; value: unknown } | { ok: false; error: string };

export function parseJsonInput(text: string): JsonParse {
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

/** A starting input for the test console, per feature. */
export function sampleInput(featureId: string): unknown {
  switch (featureId) {
    case "optimize-query":
      return { query: "SELECT user_id, count() FROM events GROUP BY user_id ORDER BY count() DESC LIMIT 10" };
    case "check-optimize":
      return { query: "SELECT * FROM events WHERE toDate(ts) = today()" };
    case "debug-query":
      return { query: "SELEC 1", error: "Syntax error: failed at position 1" };
    case "optimize-log":
      return { query: "SELECT * FROM system.query_log LIMIT 10" };
    case "diagnose-error":
      return { name: "TOO_MANY_PARTS", code: 252, message: "Too many parts (300) in all partitions in total" };
    case "diagnose-parts":
      return { database: "default", table: "events" };
    case "diagnose-schema":
      return { database: "default", table: "events", column: "user_id", columnType: "Nullable(UInt64)", category: "nullable" };
    case "fleet-scan":
      return { hours: 6 };
    case "compile-watcher":
      return { connectionId: "", text: "alert me when no orders arrive for an hour" };
    default:
      return {};
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

const REVISION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Edited",
  delete: "Deleted",
  reset: "Reset to built-in",
  rollback: "Rolled back",
  seed: "Installed",
  "seed-upgrade": "Upgraded with CHouse",
};

export function revisionLabel(action: string): string {
  return REVISION_LABELS[action] ?? action;
}

/** Insert text at a textarea selection, returning the new value and caret. */
export function insertAt(value: string, start: number, end: number, text: string): { value: string; caret: number } {
  return { value: `${value.slice(0, start)}${text}${value.slice(end)}`, caret: start + text.length };
}

/** Harness description overrides from `tool: description` lines; lines without a colon are ignored. */
export function parseOverrides(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const tool = line.slice(0, colon).trim();
    const description = line.slice(colon + 1).trim();
    if (tool && description) out[tool] = description;
  }
  return out;
}
