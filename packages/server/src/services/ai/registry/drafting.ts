/**
 * Draft with AI for agents, harnesses and skills (issue #381).
 *
 * Pure logic shared by the three drafting capabilities and the route that runs
 * them: the evidence the drafter sees (only things that exist in the live
 * registry), the schema the model must fill, the mapping from that output to
 * the editable input the editors already take, the safe fixes applied to it,
 * and the completeness contract — every editor section is either drafted, or
 * left empty on purpose with a stated reason, or flagged for attention.
 *
 * Nothing here persists anything: a draft only becomes a registry row when an
 * administrator reviews and saves it through the normal registry routes.
 */

import type { AnyCapability } from "../types";
import { catalogTool, describeCatalog } from "./catalog";
import { BUILTIN_TOOLS, BUILTIN_TOOL_NAMES } from "./harness";
import type { AgentInput, HarnessInput, SkillInput } from "./service";
import { templateReferences } from "./template";
import type { AgentDef, HarnessDef, RegistrySnapshot, SkillDef, SkillLinkMode } from "./types";
import { introducedProblems, parseSkillFrontMatter, SLUG_RE, TUNING_LIMITS, withChanges } from "./validation";
import { normalizeTuning } from "./tuning";
import {
  AGENT_SECTIONS,
  draftMode,
  HARNESS_SECTIONS,
  LONG_REFERENCE_CHARS,
  SKILL_SECTIONS,
  type AgentDraft,
  type AgentSection,
  type DraftKind,
  type DraftMeta,
  type DraftRequest,
  type DraftResult,
  type HarnessDraft,
  type HarnessSection,
  type RationaleItem,
  type SectionState,
  type SectionStatus,
  type SkillDraft,
  type SkillSection,
} from "./draftSchemas";

export * from "./draftSchemas";

// ============================================
// Drafting context (resolved by the capability's prepare)
// ============================================

export interface ModelOption {
  id: string;
  label: string;
}

export interface DraftContext {
  snapshot: RegistrySnapshot;
  /** The stored custom entity being refined, if any. */
  entityId: string | null;
  /** Agents only: the feature the agent serves. */
  feature: AnyCapability | null;
  /** Agents only: model configs the agent may pin. */
  models: ModelOption[];
  /** Skills only: length of the pasted reference. */
  referenceLength: number;
}

const DRAFT_ID = "draft";

function candidateId(ctx: DraftContext): string {
  return ctx.entityId ?? DRAFT_ID;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A display name: the drafter's, or one made from the slug (editors require a name). */
function displayName(name: string, slug: string, fallback: string): string {
  const clean = oneLine(name);
  if (clean) return clip(clean, 100);
  const words = slugify(slug).split("-").filter(Boolean);
  return words.length > 0 ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : fallback;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** A free slug: the wanted one, or it with the lowest free numeric suffix. */
export function uniqueSlug(wanted: string, taken: Set<string>, fallback: string): string {
  const root = slugify(wanted).length >= 2 ? slugify(wanted) : fallback;
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root.slice(0, 56)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ============================================
// Evidence
// ============================================

function toolEvidence(): Array<Record<string, unknown>> {
  return describeCatalog()
    .filter((tool) => tool.access === "read")
    .map((tool) => ({
      name: tool.name,
      title: tool.title,
      category: tool.category,
      needsContext: tool.requires,
      permissions: tool.permissions,
      description: clip(tool.description.split("\n")[0] ?? "", 300),
    }));
}

function skillEvidence(snapshot: RegistrySnapshot): Array<Record<string, unknown>> {
  return [...snapshot.skills.values()].map((skill) => ({
    name: skill.name,
    path: skill.path,
    description: skill.description,
    files: ["SKILL.md", ...Object.keys(skill.files)],
    enabled: skill.enabled,
  }));
}

function harnessEvidence(snapshot: RegistrySnapshot): Array<Record<string, unknown>> {
  return [...snapshot.harnesses.values()].map((harness) => ({
    slug: harness.slug,
    name: harness.name,
    description: harness.description,
    hiddenBuiltinTools: harness.excludedTools,
    generalPurposeSubagent: harness.generalPurpose.enabled,
  }));
}

function subagentCandidates(snapshot: RegistrySnapshot, entityId: string | null): AgentDef[] {
  return [...snapshot.agents.values()].filter((agent) => agent.taskTemplate === null && agent.id !== entityId && !reaches(snapshot, agent.id, entityId));
}

/** Whether `targetId` is in the subtree of `fromId` (a subagent there would make a cycle). */
function reaches(snapshot: RegistrySnapshot, fromId: string, targetId: string | null): boolean {
  if (!targetId) return false;
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === targetId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (snapshot.agents.get(id)?.subagents ?? []).some(visit);
  };
  return visit(fromId);
}

function takenSlugs<T extends { id: string; slug: string }>(rows: Iterable<T>, entityId: string | null): string[] {
  return [...rows].filter((row) => row.id !== entityId).map((row) => row.slug);
}

/** The model-facing view of an agent input: names and slugs instead of ids. */
function agentView(input: AgentInput, snapshot: RegistrySnapshot): Record<string, unknown> {
  return {
    name: input.name,
    slug: input.slug,
    description: input.description,
    kind: input.kind,
    systemPrompt: input.systemPrompt,
    taskTemplate: input.taskTemplate,
    tools: input.tools,
    skills: input.skills.map((link) => ({ name: snapshot.skills.get(link.skillId)?.name ?? link.skillId, mode: link.mode, pinnedFile: link.pinnedFile })),
    subagents: input.subagents.map((id) => snapshot.agents.get(id)?.slug ?? id),
    harness: snapshot.harnesses.get(input.harnessId)?.slug ?? input.harnessId,
    modelConfigId: input.modelConfigId,
    tuning: input.tuning,
    enabled: input.enabled,
  };
}

function skillView(input: SkillInput): Record<string, unknown> {
  const front = parseSkillFrontMatter(input.skillMd);
  return {
    path: input.path,
    name: front?.name ?? "",
    description: front?.description ?? "",
    body: skillBody(input.skillMd),
    files: input.files,
    enabled: input.enabled,
  };
}

function taskEvidence<T>(kind: DraftKind, request: DraftRequest<T>, snapshot: RegistrySnapshot): Record<string, unknown> {
  const mode = draftMode(request);
  const current = request.current === undefined
    ? undefined
    : kind === "agent" ? agentView(request.current as AgentInput, snapshot)
      : kind === "skill" ? skillView(request.current as SkillInput)
        : request.current;
  return {
    mode,
    ...(request.goal ? { goal: request.goal } : {}),
    ...(request.instruction ? { instruction: request.instruction } : {}),
    ...(current !== undefined ? { current } : {}),
    ...(mode === "redraft" ? { redraftSections: request.sections, whyTheyFailed: request.feedback ?? {} } : {}),
  };
}

export function agentEvidence(request: DraftRequest<AgentInput>, ctx: DraftContext): Record<string, unknown> {
  const { snapshot, feature } = ctx;
  const hints = request.agentHints ?? { featureId: null, delegate: "auto" };
  return {
    task: taskEvidence("agent", request, snapshot),
    hints: { delegate: hints.delegate },
    feature: feature ? {
      id: feature.id,
      title: feature.title,
      description: feature.description,
      providesContexts: feature.contexts,
      templateVariables: Object.entries(feature.variables).map(([name, spec]) => ({ name: `ctx.${name}`, type: spec.type, description: spec.description })),
    } : null,
    tools: toolEvidence(),
    skills: skillEvidence(snapshot),
    harnesses: harnessEvidence(snapshot),
    subagentCandidates: subagentCandidates(snapshot, ctx.entityId).map((agent) => ({ slug: agent.slug, name: agent.name, kind: agent.kind, description: agent.description, enabled: agent.enabled })),
    models: ctx.models,
    tuningLimits: TUNING_LIMITS,
    slugRule: SLUG_RE.source,
    takenSlugs: takenSlugs(snapshot.agents.values(), ctx.entityId),
  };
}

export function harnessEvidenceFor(request: DraftRequest<HarnessInput>, ctx: DraftContext): Record<string, unknown> {
  const { snapshot } = ctx;
  return {
    task: taskEvidence("harness", request, snapshot),
    builtinTools: BUILTIN_TOOLS,
    catalogTools: toolEvidence().map((tool) => ({ name: tool.name, description: tool.description })),
    harnesses: harnessEvidence(snapshot),
    slugRule: SLUG_RE.source,
    takenSlugs: takenSlugs(snapshot.harnesses.values(), ctx.entityId),
    promptSuffixMaxChars: 4_000,
  };
}

export function skillEvidenceFor(request: DraftRequest<SkillInput>, ctx: DraftContext): Record<string, unknown> {
  const { snapshot } = ctx;
  return {
    task: taskEvidence("skill", request, snapshot),
    ...(request.reference ? { reference: request.reference } : {}),
    existingSkills: skillEvidence(snapshot),
    takenNames: [...snapshot.skills.values()].filter((s) => s.id !== ctx.entityId).map((s) => s.name),
    takenPaths: [...snapshot.skills.values()].filter((s) => s.id !== ctx.entityId).map((s) => s.path),
    pathRule: "custom/<directory>, directory in lowercase kebab-case",
    longReferenceChars: LONG_REFERENCE_CHARS,
  };
}

// ============================================
// Shared checks
// ============================================

const PLACEHOLDER_RE = /\b(TODO|TBD|lorem ipsum|FIXME)\b|\[(insert|describe|add)[^\]]*\]|<(insert|describe|your)[^>]*>/i;
const BLANK_SKILL_BODY = "Instructions the agent follows when it reads this skill.";
const BLANK_SKILL_DESCRIPTION = "When to use this skill, in one sentence.";

function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_RE.test(text);
}

function listStatus(items: RationaleItem[], reason: string | null, noun: string): { state: SectionState; problems: string[] } {
  const problems: string[] = [];
  if (items.length === 0) {
    if (!reason?.trim()) problems.push(`No ${noun} and no reason why — pick some or say why none fit`);
    return { state: problems.length > 0 ? "attention" : "empty", problems };
  }
  for (const item of items) if (!item.why.trim()) problems.push(`Give a reason for ${noun.replace(/s$/, "")} '${item.subject}'`);
  return { state: problems.length > 0 ? "attention" : "drafted", problems };
}

function sectionOf<S extends string>(message: string, rules: Array<[RegExp, S]>, fallback: S): S {
  for (const [pattern, section] of rules) if (pattern.test(message)) return section;
  return fallback;
}

function finishSections(
  sections: readonly string[],
  states: Record<string, { state: SectionState; problems: string[] }>,
  meta: DraftMeta,
): Record<string, SectionStatus> {
  return Object.fromEntries(sections.map((section) => {
    const status = states[section] ?? { state: "drafted", problems: [] };
    return [section, {
      state: status.problems.length > 0 ? "attention" : status.state,
      reason: meta.reasons[section] ?? null,
      problems: status.problems,
      rationale: meta.rationale[section] ?? [],
    }];
  }));
}

function emptyMeta(): DraftMeta {
  return { reasons: {}, rationale: {} };
}

/** Keep `previous` and take only `sections` from `next` (inputs are merged by the caller). */
export function mergeMeta(previous: DraftMeta, next: DraftMeta, sections: readonly string[]): DraftMeta {
  const merged: DraftMeta = { reasons: { ...previous.reasons }, rationale: { ...previous.rationale } };
  for (const section of sections) {
    merged.reasons[section] = next.reasons[section] ?? null;
    merged.rationale[section] = next.rationale[section] ?? [];
  }
  return merged;
}

/** Feedback for a targeted re-ask: the problems of every section that needs attention. */
export function failingSections(result: { sections: Record<string, SectionStatus> }): Record<string, string[]> {
  return Object.fromEntries(Object.entries(result.sections).filter(([, s]) => s.state === "attention").map(([section, s]) => [section, s.problems]));
}

export function attentionCount(result: { sections: Record<string, SectionStatus> }): number {
  return Object.values(result.sections).filter((s) => s.state === "attention").length;
}

// ============================================
// Agents
// ============================================

const AGENT_FIELDS: Record<AgentSection, Array<keyof AgentInput>> = {
  identity: ["name", "slug", "description", "enabled"],
  prompt: ["systemPrompt", "taskTemplate"],
  tools: ["tools"],
  skills: ["skills"],
  subagents: ["subagents"],
  settings: ["kind", "harnessId", "modelConfigId", "tuning", "requiredPermissions"],
};

interface Mapped<T> {
  input: T;
  meta: DraftMeta;
  fixes: string[];
  summary: string;
  suggestedSkills: string[];
}

function clampTuning(value: number | null, key: keyof typeof TUNING_LIMITS, fixes: string[]): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const { min, max } = TUNING_LIMITS[key];
  const clamped = Math.min(max, Math.max(min, Math.round(value)));
  if (clamped !== value) fixes.push(`Tuning ${key} ${value} was clamped to ${clamped} (${min}–${max})`);
  return clamped;
}

function harnessBySlug(snapshot: RegistrySnapshot, slug: string): HarnessDef | undefined {
  for (const harness of snapshot.harnesses.values()) if (harness.slug === slug) return harness;
  return undefined;
}

function skillByName(snapshot: RegistrySnapshot, name: string): SkillDef | undefined {
  for (const skill of snapshot.skills.values()) if (skill.name === name) return skill;
  return undefined;
}

function agentBySlug(snapshot: RegistrySnapshot, slug: string): AgentDef | undefined {
  for (const agent of snapshot.agents.values()) if (agent.slug === slug) return agent;
  return undefined;
}

/** Map the drafter's output to an agent input, dropping what does not exist. */
export function mapAgentDraft(parsed: AgentDraft, ctx: DraftContext): Mapped<AgentInput> {
  const { snapshot } = ctx;
  const fixes: string[] = [];
  const meta = emptyMeta();

  const tools: string[] = [];
  const toolWhy: RationaleItem[] = [];
  for (const item of parsed.tools.items) {
    const entry = catalogTool(item.name);
    if (!entry || entry.access !== "read") {
      fixes.push(`Dropped tool '${item.name}': it is not a read-only tool in the catalog`);
      continue;
    }
    if (ctx.feature && entry.requires && !ctx.feature.contexts.includes(entry.requires)) {
      fixes.push(`Dropped tool '${item.name}': it needs the ${entry.requires} context, which '${ctx.feature.title}' does not provide`);
      continue;
    }
    if (tools.includes(item.name)) continue;
    tools.push(item.name);
    toolWhy.push({ subject: item.name, why: oneLine(item.why) });
  }
  meta.rationale.tools = toolWhy;
  meta.reasons.tools = tools.length === 0 ? parsed.tools.emptyReason : null;

  const skills: AgentInput["skills"] = [];
  const skillWhy: RationaleItem[] = [];
  for (const item of parsed.skills.items) {
    const skill = skillByName(snapshot, item.name);
    if (!skill) {
      fixes.push(`Dropped skill '${item.name}': no such skill`);
      continue;
    }
    let mode: SkillLinkMode = item.mode;
    let pinnedFile = item.pinnedFile && item.pinnedFile !== "SKILL.md" ? item.pinnedFile : null;
    if (mode === "pinned" && pinnedFile && !(pinnedFile in skill.files)) {
      fixes.push(`Skill '${skill.name}' has no file '${pinnedFile}'; pinned SKILL.md instead`);
      pinnedFile = null;
    }
    if (mode === "pinned" && !skill.enabled) {
      fixes.push(`Skill '${skill.name}' is disabled, so it is read on demand instead of pinned`);
      mode = "progressive";
      pinnedFile = null;
    }
    if (mode === "progressive") pinnedFile = null;
    if (skills.some((link) => link.skillId === skill.id && link.mode === mode)) continue;
    skills.push({ skillId: skill.id, mode, pinnedFile });
    skillWhy.push({ subject: `${skill.name} (${mode === "pinned" ? `pinned: ${pinnedFile ?? "SKILL.md"}` : "on demand"})`, why: oneLine(item.why) });
  }
  meta.rationale.skills = skillWhy;
  meta.reasons.skills = skills.length === 0 ? parsed.skills.emptyReason : null;

  const allowed = new Set(subagentCandidates(snapshot, ctx.entityId).map((a) => a.id));
  const subagents: string[] = [];
  const subagentWhy: RationaleItem[] = [];
  for (const item of parsed.subagents.items) {
    const agent = agentBySlug(snapshot, item.slug);
    if (!agent || !allowed.has(agent.id)) {
      fixes.push(`Dropped subagent '${item.slug}': ${agent ? "only chat agents that would not form a cycle can be subagents" : "no such agent"}`);
      continue;
    }
    if (subagents.includes(agent.id)) continue;
    subagents.push(agent.id);
    subagentWhy.push({ subject: agent.slug, why: oneLine(item.why) });
  }
  meta.rationale.subagents = subagentWhy;
  meta.reasons.subagents = subagents.length === 0 ? parsed.subagents.emptyReason : null;

  const harness = harnessBySlug(snapshot, parsed.harness.slug);
  if (!harness) fixes.push(`Harness '${parsed.harness.slug}' does not exist; picked one that fits`);
  let modelConfigId = parsed.model.configId;
  if (modelConfigId !== null && !ctx.models.some((m) => m.id === modelConfigId)) {
    fixes.push(`Model '${modelConfigId}' is not configured; the agent inherits the default model`);
    modelConfigId = null;
  }
  const tuning = normalizeTuning({
    stepBudget: clampTuning(parsed.tuning.stepBudget, "stepBudget", fixes) ?? 8,
    recursionLimit: clampTuning(parsed.tuning.recursionLimit, "recursionLimit", fixes),
    timeoutMs: clampTuning(parsed.tuning.timeoutMs, "timeoutMs", fixes),
    maxOutputTokens: clampTuning(parsed.tuning.maxOutputTokens, "maxOutputTokens", fixes),
  });
  meta.rationale.settings = [
    { subject: `harness: ${harness?.slug ?? parsed.harness.slug}`, why: oneLine(parsed.harness.why) },
    { subject: `model: ${modelConfigId ?? "inherit the default"}`, why: oneLine(parsed.model.why) },
    { subject: `tuning: ${tuning.stepBudget} steps`, why: oneLine(parsed.tuning.why) },
  ];
  meta.reasons.settings = null;
  meta.reasons.identity = null;
  meta.reasons.prompt = null;

  let taskTemplate = parsed.taskTemplate;
  if (!ctx.feature && taskTemplate !== null) {
    fixes.push("Removed the task template: only an agent drafted for a feature has one");
    taskTemplate = null;
  }

  const input: AgentInput = {
    slug: parsed.slug,
    name: displayName(parsed.name, parsed.slug, "Custom agent"),
    description: parsed.description.trim(),
    kind: parsed.kind,
    systemPrompt: parsed.systemPrompt.trim(),
    taskTemplate: taskTemplate === null ? null : taskTemplate.trim(),
    modelConfigId,
    harnessId: harness?.id ?? "",
    tuning,
    requiredPermissions: [],
    tools,
    skills,
    subagents,
    enabled: false,
  };
  return { input, meta, fixes, summary: parsed.summary.trim(), suggestedSkills: parsed.suggestedSkills.map(oneLine).filter(Boolean) };
}

/** The permissions a chat user needs to see the agent: the tools' own guards. */
export function requiredPermissionsFor(input: Pick<AgentInput, "tools" | "taskTemplate">): string[] {
  if (input.taskTemplate !== null) return [];
  const entries = input.tools.map((name) => catalogTool(name)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  // A tool anyone may use keeps the agent useful to everyone with ai:chat.
  if (entries.length === 0 || entries.some((entry) => entry.permissions.length === 0)) return [];
  return [...new Set(entries.flatMap((entry) => entry.permissions))].sort();
}

/** Built-in tools the agent cannot work without. */
function neededBuiltins(input: AgentInput): string[] {
  const needs: string[] = [];
  if (input.subagents.length > 0) needs.push("task");
  if (input.skills.some((link) => link.mode === "progressive")) needs.push("read_file");
  return needs;
}

function keepsAll(harness: HarnessDef, needs: string[]): boolean {
  return needs.every((tool) => !harness.excludedTools.includes(tool));
}

/**
 * Safe, deterministic fixes on an agent input: a free slug, a harness that
 * keeps the built-in tools the agent needs, tuning in range, permissions
 * worked out from the tools. Idempotent, so it runs again after a merge.
 */
export function repairAgent(input: AgentInput, ctx: DraftContext, locked: { slug?: string; enabled?: boolean }): { input: AgentInput; fixes: string[] } {
  const { snapshot } = ctx;
  const fixes: string[] = [];
  const next: AgentInput = { ...input, tuning: { ...input.tuning } };

  if (locked.slug !== undefined) next.slug = locked.slug;
  else {
    const taken = new Set([...takenSlugs(snapshot.agents.values(), ctx.entityId), "general-purpose", ...BUILTIN_TOOL_NAMES]);
    const slug = uniqueSlug(next.slug || next.name, taken, "custom-agent");
    if (slug !== next.slug) fixes.push(`Slug '${next.slug}' was changed to the free, valid '${slug}'`);
    next.slug = slug;
  }
  next.enabled = locked.enabled ?? false;
  if (!ctx.feature) next.taskTemplate = null;

  const needs = neededBuiltins(next);
  const current = snapshot.harnesses.get(next.harnessId);
  if (!current || !keepsAll(current, needs)) {
    const preferred = [current?.slug, needs.includes("task") ? (next.kind === "router" && next.skills.length === 0 ? "router" : "delegating") : "focused", "delegating", "focused"];
    const options = [...snapshot.harnesses.values()].filter((h) => keepsAll(h, needs));
    const pick = preferred.map((slug) => options.find((h) => h.slug === slug)).find(Boolean) ?? options[0];
    if (pick && pick.id !== next.harnessId) {
      if (current) fixes.push(`Harness '${current.slug}' hides ${needs.filter((t) => current.excludedTools.includes(t)).join(" and ")}, which this agent needs; switched to '${pick.slug}'`);
      next.harnessId = pick.id;
    } else if (!pick && !current) {
      // Keep the draft savable; assess flags that no harness fits.
      next.harnessId = harnessBySlug(snapshot, "focused")?.id ?? snapshot.harnesses.keys().next().value ?? "";
    }
  }

  for (const key of Object.keys(TUNING_LIMITS) as Array<keyof typeof TUNING_LIMITS>) {
    const value = next.tuning[key];
    if (value === null || value === undefined) continue;
    const { min, max } = TUNING_LIMITS[key];
    const clamped = Math.min(max, Math.max(min, Math.round(value)));
    if (clamped !== value) {
      fixes.push(`Tuning ${key} ${value} was clamped to ${clamped}`);
      next.tuning[key] = clamped;
    }
  }

  const permissions = requiredPermissionsFor(next);
  if (JSON.stringify(permissions) !== JSON.stringify(next.requiredPermissions) && next.requiredPermissions.length > 0) {
    fixes.push(`Required permissions were recomputed from the tools: ${permissions.join(", ") || "none"}`);
  }
  next.requiredPermissions = permissions;
  return { input: next, fixes };
}

const PROMPT_PARTS: Array<{ label: string; pattern: RegExp }> = [
  { label: "the role (\"You are …\")", pattern: /\byou are\b|\byour (role|job)\b/i },
  { label: "the scope and what is out of scope", pattern: /\b(scope|out of scope|only|not for|do not handle|outside)\b/i },
  { label: "a step-by-step method (a numbered list)", pattern: /^\s*\d+[.)]\s/m },
  { label: "safety rules", pattern: /\b(never|must not|do not|don't|read-only|safe(ly|ty)?)\b/i },
  { label: "the output format", pattern: /\b(output|format|respond|answer|reply|return)\b/i },
];

export const MIN_SYSTEM_PROMPT_CHARS = 400;
export const MIN_DESCRIPTION_CHARS = 30;
export const MIN_SKILL_BODY_CHARS = 300;

function templateProblems(label: string, source: string, ctx: DraftContext): { problems: string[]; variables: Set<string> } {
  try {
    const refs = templateReferences(source);
    const problems: string[] = [];
    for (const ref of refs.skills) {
      const skill = skillByName(ctx.snapshot, ref.name);
      if (!skill || !skill.enabled || (ref.file && ref.file !== "SKILL.md" && !(ref.file in skill.files))) {
        problems.push(`${label} inlines an unknown or disabled skill {{skill:${ref.name}${ref.file ? `/${ref.file}` : ""}}}`);
      }
    }
    if (ctx.feature) {
      for (const name of refs.variables) {
        if (!(name in ctx.feature.variables)) problems.push(`${label} uses {{ctx.${name}}}, which '${ctx.feature.title}' does not supply`);
      }
    } else if (refs.variables.size > 0) {
      problems.push(`${label} uses {{ctx.…}} variables, but only an agent drafted for a feature receives them`);
    }
    return { problems, variables: refs.variables };
  } catch (error) {
    return { problems: [`${label}: ${error instanceof Error ? error.message : String(error)}`], variables: new Set() };
  }
}

function agentDef(input: AgentInput, ctx: DraftContext): AgentDef {
  const stored = ctx.entityId ? ctx.snapshot.agents.get(ctx.entityId) : undefined;
  return stored
    ? { ...stored, ...input }
    : { ...input, id: DRAFT_ID, isSystem: false, seedHash: null, customized: false, version: 0, createdBy: null, createdAt: 0, updatedAt: 0 };
}

/** Section statuses and remaining registry problems for an agent draft. */
export function assessAgent(input: AgentInput, meta: DraftMeta, ctx: DraftContext): { sections: Record<string, SectionStatus>; problems: string[] } {
  const states: Record<string, { state: SectionState; problems: string[] }> = {};
  const add = (section: AgentSection, problem: string): void => {
    const s = (states[section] ??= { state: "drafted", problems: [] });
    if (!s.problems.includes(problem)) s.problems.push(problem);
  };

  // Identity
  if (!input.name.trim()) add("identity", "Name is empty");
  if (!SLUG_RE.test(input.slug)) add("identity", "Slug is not valid");
  if (input.description.trim().length < MIN_DESCRIPTION_CHARS) add("identity", "Description is too short to route on — say what the agent answers");
  if (isPlaceholder(input.description)) add("identity", "Description still has placeholder text");

  // Prompt
  const prompt = input.systemPrompt;
  if (prompt.trim().length < MIN_SYSTEM_PROMPT_CHARS) add("prompt", `System prompt is too short (${prompt.trim().length} characters; at least ${MIN_SYSTEM_PROMPT_CHARS})`);
  if (isPlaceholder(prompt)) add("prompt", "System prompt still has placeholder text");
  for (const part of PROMPT_PARTS) if (!part.pattern.test(prompt)) add("prompt", `System prompt does not cover ${part.label}`);
  if (input.kind === "agent" && input.tools.length > 0 && !input.tools.some((tool) => prompt.includes(tool))) {
    add("prompt", "System prompt never says which tool to use when — name the tools in the method");
  }
  if (input.kind === "router" && input.subagents.length > 0 && !input.subagents.some((id) => prompt.includes(ctx.snapshot.agents.get(id)?.slug ?? "\u0000")) && !/\bdelegat/i.test(prompt)) {
    add("prompt", "A router's prompt must say how it chooses between its subagents");
  }
  const system = templateProblems("System prompt", prompt, ctx);
  system.problems.forEach((p) => add("prompt", p));
  if (ctx.feature) {
    if (input.taskTemplate === null || !input.taskTemplate.trim()) add("prompt", `A task template is required: the agent serves '${ctx.feature.title}'`);
    else {
      const task = templateProblems("Task template", input.taskTemplate, ctx);
      task.problems.forEach((p) => add("prompt", p));
      const used = new Set([...system.variables, ...task.variables]);
      const missing = Object.keys(ctx.feature.variables).filter((name) => !used.has(name));
      if (missing.length > 0) add("prompt", `The templates never use ${missing.map((n) => `{{ctx.${n}}}`).join(", ")}, which the feature supplies`);
    }
  }

  // Tools, skills, subagents
  states.tools = listStatus(meta.rationale.tools ?? [], meta.reasons.tools ?? null, "tools");
  if (input.kind === "router" && input.tools.length > 0) add("tools", "A router only delegates — remove its tools or make it an agent");
  states.skills = listStatus(meta.rationale.skills ?? [], meta.reasons.skills ?? null, "skills");
  states.subagents = listStatus(meta.rationale.subagents ?? [], meta.reasons.subagents ?? null, "subagents");
  if (input.kind === "router" && input.subagents.length === 0) add("subagents", "A router needs at least one subagent");

  // Settings
  for (const item of meta.rationale.settings ?? []) if (!item.why.trim()) add("settings", `Give a reason for the ${item.subject.split(":")[0]} choice`);
  if ((meta.rationale.settings ?? []).length === 0) add("settings", "No reasons were given for the harness, model and tuning");
  const harness = ctx.snapshot.harnesses.get(input.harnessId);
  if (!harness) add("settings", "No harness keeps the built-in tools this agent needs");
  else {
    const hidden = neededBuiltins(input).filter((tool) => harness.excludedTools.includes(tool));
    if (hidden.length > 0) add("settings", `Harness '${harness.slug}' hides ${hidden.join(", ")}, which this agent needs`);
  }

  // What saving would introduce
  const candidate = agentDef(input, ctx);
  const problems = introducedProblems(ctx.snapshot, withChanges(ctx.snapshot, { agent: candidate }))
    .filter((p) => p.entity === "agent" && p.id === candidate.id)
    .map((p) => p.message);
  for (const message of problems) {
    add(sectionOf<AgentSection>(message, [
      [/^(System prompt|Task template)/, "prompt"],
      [/subagent|router|task tool|cycle|nest/i, "subagents"],
      [/skill/i, "skills"],
      [/^Tool /, "tools"],
      [/^Tuning|Harness/, "settings"],
    ], "identity"), message);
  }

  return { sections: finishSections(AGENT_SECTIONS, states, meta), problems };
}

// ============================================
// Harnesses
// ============================================

const HARNESS_FIELDS: Record<HarnessSection, Array<keyof HarnessInput>> = {
  identity: ["name", "slug", "description"],
  builtinTools: ["excludedTools"],
  generalPurpose: ["generalPurpose"],
  promptSuffix: ["promptSuffix"],
  overrides: ["toolDescriptionOverrides"],
};

export function mapHarnessDraft(parsed: HarnessDraft): Mapped<HarnessInput> {
  const fixes: string[] = [];
  const meta = emptyMeta();
  const excluded: string[] = [];
  const decisions: RationaleItem[] = [];
  for (const item of parsed.builtinTools) {
    if (!BUILTIN_TOOL_NAMES.has(item.name)) {
      fixes.push(`Ignored '${item.name}': it is not a built-in DeepAgents tool`);
      continue;
    }
    if (decisions.some((d) => d.subject.startsWith(`${item.name}:`))) continue;
    if (!item.enabled) excluded.push(item.name);
    decisions.push({ subject: `${item.name}: ${item.enabled ? "on" : "off"}`, why: oneLine(item.why) });
  }
  meta.rationale.builtinTools = decisions;

  const overrides: Record<string, string> = {};
  const overrideWhy: RationaleItem[] = [];
  for (const item of parsed.toolDescriptionOverrides.items) {
    if (!BUILTIN_TOOL_NAMES.has(item.tool) && !catalogTool(item.tool)) {
      fixes.push(`Dropped the description override for '${item.tool}': no such tool`);
      continue;
    }
    if (excluded.includes(item.tool)) {
      fixes.push(`Dropped the description override for '${item.tool}': the harness hides that tool`);
      continue;
    }
    if (!item.description.trim()) continue;
    overrides[item.tool] = clip(item.description.trim(), 4_000);
    overrideWhy.push({ subject: item.tool, why: oneLine(item.why) });
  }
  meta.rationale.overrides = overrideWhy;
  meta.reasons.overrides = overrideWhy.length === 0 ? parsed.toolDescriptionOverrides.emptyReason : null;

  const suffix = parsed.promptSuffix.text?.trim() ? parsed.promptSuffix.text.trim() : null;
  meta.reasons.promptSuffix = suffix === null ? parsed.promptSuffix.emptyReason : null;
  meta.rationale.generalPurpose = [{ subject: parsed.generalPurpose.enabled ? "enabled" : "disabled", why: oneLine(parsed.generalPurpose.why) }];
  meta.reasons.generalPurpose = null;
  meta.reasons.identity = null;
  meta.reasons.builtinTools = null;

  const input: HarnessInput = {
    slug: parsed.slug,
    name: displayName(parsed.name, parsed.slug, "Custom harness"),
    description: parsed.description.trim(),
    excludedTools: excluded,
    generalPurpose: {
      enabled: parsed.generalPurpose.enabled,
      description: parsed.generalPurpose.enabled ? parsed.generalPurpose.description?.trim() || null : null,
      systemPrompt: parsed.generalPurpose.enabled ? parsed.generalPurpose.systemPrompt?.trim() || null : null,
    },
    promptSuffix: suffix,
    toolDescriptionOverrides: overrides,
  };
  return { input, meta, fixes, summary: parsed.summary.trim(), suggestedSkills: [] };
}

export function repairHarness(input: HarnessInput, ctx: DraftContext, locked: { slug?: string }): { input: HarnessInput; fixes: string[] } {
  const fixes: string[] = [];
  const next: HarnessInput = { ...input, excludedTools: input.excludedTools.filter((t) => BUILTIN_TOOL_NAMES.has(t)) };
  if (locked.slug !== undefined) next.slug = locked.slug;
  else {
    const slug = uniqueSlug(next.slug || next.name, new Set(takenSlugs(ctx.snapshot.harnesses.values(), ctx.entityId)), "custom-harness");
    if (slug !== next.slug) fixes.push(`Slug '${next.slug}' was changed to the free, valid '${slug}'`);
    next.slug = slug;
  }
  const overrides = Object.fromEntries(Object.entries(next.toolDescriptionOverrides).filter(([tool]) => !next.excludedTools.includes(tool)));
  if (Object.keys(overrides).length !== Object.keys(next.toolDescriptionOverrides).length) fixes.push("Dropped description overrides for tools the harness hides");
  next.toolDescriptionOverrides = overrides;
  return { input: next, fixes };
}

function harnessDef(input: HarnessInput, ctx: DraftContext): HarnessDef {
  const stored = ctx.entityId ? ctx.snapshot.harnesses.get(ctx.entityId) : undefined;
  return stored
    ? { ...stored, ...input }
    : { ...input, id: DRAFT_ID, isSystem: false, seedHash: null, customized: false, version: 0, createdBy: null, createdAt: 0, updatedAt: 0 };
}

export function assessHarness(input: HarnessInput, meta: DraftMeta, ctx: DraftContext): { sections: Record<string, SectionStatus>; problems: string[] } {
  const states: Record<string, { state: SectionState; problems: string[] }> = {};
  const add = (section: HarnessSection, problem: string): void => {
    const s = (states[section] ??= { state: "drafted", problems: [] });
    if (!s.problems.includes(problem)) s.problems.push(problem);
  };

  if (!input.name.trim()) add("identity", "Name is empty");
  if (!SLUG_RE.test(input.slug)) add("identity", "Slug is not valid");
  if (input.description.trim().length < MIN_DESCRIPTION_CHARS) add("identity", "Description is too short — say which agents this harness is for");
  if (isPlaceholder(input.description)) add("identity", "Description still has placeholder text");

  const decisions = meta.rationale.builtinTools ?? [];
  for (const tool of BUILTIN_TOOLS) {
    const decision = decisions.find((d) => d.subject.startsWith(`${tool.name}:`));
    if (!decision) add("builtinTools", `No on/off decision for the built-in tool '${tool.name}'`);
    else if (!decision.why.trim()) add("builtinTools", `Give a reason for the '${tool.name}' decision`);
  }

  const gp = input.generalPurpose;
  if (!(meta.rationale.generalPurpose ?? []).some((r) => r.why.trim())) add("generalPurpose", "Say why the general-purpose subagent is on or off");
  if (gp.enabled) {
    if (!gp.description?.trim()) add("generalPurpose", "The enabled general-purpose subagent needs a description");
    if (!gp.systemPrompt?.trim()) add("generalPurpose", "The enabled general-purpose subagent needs a system prompt");
    if (input.excludedTools.includes("task")) add("generalPurpose", "The general-purpose subagent is reached with the task tool, which this harness hides");
  }

  if (input.promptSuffix === null) {
    if (!meta.reasons.promptSuffix?.trim()) add("promptSuffix", "No prompt suffix and no reason why");
    states.promptSuffix ??= { state: "empty", problems: [] };
  } else {
    if (input.promptSuffix.length > 4_000) add("promptSuffix", `Prompt suffix is ${input.promptSuffix.length} characters; the limit is 4000`);
    if (isPlaceholder(input.promptSuffix)) add("promptSuffix", "Prompt suffix still has placeholder text");
  }

  const overrideStatus = listStatus(meta.rationale.overrides ?? [], meta.reasons.overrides ?? null, "overrides");
  states.overrides = { state: overrideStatus.state, problems: [...overrideStatus.problems, ...(states.overrides?.problems ?? [])] };

  const candidate = harnessDef(input, ctx);
  const problems = introducedProblems(ctx.snapshot, withChanges(ctx.snapshot, { harness: candidate }))
    .filter((p) => p.entity === "harness" && p.id === candidate.id)
    .map((p) => p.message);
  for (const message of problems) {
    add(sectionOf<HarnessSection>(message, [
      [/^Excluded tool/, "builtinTools"],
      [/^Description override/, "overrides"],
      [/^Prompt suffix/, "promptSuffix"],
      [/^General-purpose/, "generalPurpose"],
    ], "identity"), message);
  }
  return { sections: finishSections(HARNESS_SECTIONS, states, meta), problems };
}

// ============================================
// Skills
// ============================================

const SKILL_FIELDS: Record<SkillSection, Array<keyof SkillInput>> = {
  path: ["path"],
  skillMd: ["skillMd"],
  files: ["files"],
  enabled: ["enabled"],
};

const SKILL_FILE_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

/** SKILL.md without its front matter. */
export function skillBody(skillMd: string): string {
  return skillMd.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "").trim();
}

/** A SKILL.md whose front matter always parses: single-line, quoted values. */
export function composeSkillMd(name: string, description: string, body: string): string {
  const quoted = (value: string): string => JSON.stringify(oneLine(value));
  return `---\nname: ${name}\ndescription: ${quoted(description)}\n---\n\n${body.trim()}\n`;
}

export function mapSkillDraft(parsed: SkillDraft): Mapped<SkillInput> {
  const fixes: string[] = [];
  const meta = emptyMeta();
  const name = slugify(parsed.name) || "custom-skill";
  if (name !== parsed.name) fixes.push(`Skill name '${parsed.name}' was normalized to '${name}'`);
  const description = clip(oneLine(parsed.description), 1_024);

  const files: Record<string, string> = {};
  const fileWhy: RationaleItem[] = [];
  for (const item of parsed.files.items) {
    const file = item.name.trim();
    if (file === "SKILL.md" || !SKILL_FILE_RE.test(file) || file.includes("..")) {
      fixes.push(`Dropped file '${item.name}': not a valid reference file name`);
      continue;
    }
    if (!item.content.trim()) {
      fixes.push(`Dropped file '${file}': it was empty`);
      continue;
    }
    files[file] = item.content.endsWith("\n") ? item.content : `${item.content}\n`;
    fileWhy.push({ subject: file, why: oneLine(item.why) });
  }
  meta.rationale.files = fileWhy;
  meta.reasons.files = fileWhy.length === 0 ? parsed.files.emptyReason : null;
  meta.rationale.enabled = [{ subject: parsed.enabled ? "enabled" : "disabled", why: oneLine(parsed.enabledWhy) }];
  meta.reasons.enabled = null;
  meta.reasons.path = null;
  meta.reasons.skillMd = null;

  const input: SkillInput = {
    path: `custom/${slugify(parsed.dir) || name}`,
    skillMd: composeSkillMd(name, description, parsed.body),
    files,
    enabled: parsed.enabled,
  };
  return { input, meta, fixes, summary: parsed.summary.trim(), suggestedSkills: [] };
}

export function repairSkill(input: SkillInput, ctx: DraftContext, locked: { path?: string; name?: string }): { input: SkillInput; fixes: string[] } {
  const fixes: string[] = [];
  const next: SkillInput = { ...input, files: { ...input.files } };
  const others = [...ctx.snapshot.skills.values()].filter((s) => s.id !== ctx.entityId);
  if (locked.path !== undefined) next.path = locked.path;
  else {
    const dir = next.path.startsWith("custom/") ? next.path.slice("custom/".length) : next.path.split("/").pop() ?? "";
    const takenDirs = new Set(others.filter((s) => s.path.startsWith("custom/")).map((s) => s.path.slice("custom/".length)));
    const free = uniqueSlug(dir, takenDirs, "custom-skill");
    const path = `custom/${free}`;
    if (path !== next.path) fixes.push(`Path '${next.path}' was changed to the free, valid '${path}'`);
    next.path = path;
  }
  const front = parseSkillFrontMatter(next.skillMd);
  if (front && locked.name !== undefined) {
    if (front.name !== locked.name) fixes.push(`Kept the skill name '${locked.name}': agents refer to the skill by it`);
    next.skillMd = composeSkillMd(locked.name, front.description, skillBody(next.skillMd));
  } else if (front) {
    const takenNames = new Set(others.map((s) => s.name));
    const free = uniqueSlug(front.name, takenNames, "custom-skill");
    if (free !== front.name) {
      fixes.push(`Skill name '${front.name}' is taken; renamed to '${free}'`);
      next.skillMd = composeSkillMd(free, front.description, skillBody(next.skillMd));
    }
  }
  return { input: next, fixes };
}

function skillDef(input: SkillInput, ctx: DraftContext): SkillDef {
  const front = parseSkillFrontMatter(input.skillMd);
  const stored = ctx.entityId ? ctx.snapshot.skills.get(ctx.entityId) : undefined;
  const base = { ...input, name: front?.name ?? "", description: front?.description ?? "" };
  return stored
    ? { ...stored, ...base }
    : { ...base, id: DRAFT_ID, isSystem: false, seedHash: null, customized: false, version: 0, createdBy: null, createdAt: 0, updatedAt: 0 };
}

const SKILL_BODY_PARTS: Array<{ label: string; pattern: RegExp }> = [
  { label: "when to use it", pattern: /when to use|use (this|it) when|^#+\s*when\b/im },
  { label: "a step-by-step procedure", pattern: /^\s*\d+[.)]\s/m },
  { label: "examples", pattern: /\bexamples?\b/i },
  { label: "pitfalls", pattern: /\b(pitfalls?|gotchas?|caveats?|avoid|mistakes?)\b/i },
];

export function assessSkill(input: SkillInput, meta: DraftMeta, ctx: DraftContext): { sections: Record<string, SectionStatus>; problems: string[] } {
  const states: Record<string, { state: SectionState; problems: string[] }> = {};
  const add = (section: SkillSection, problem: string): void => {
    const s = (states[section] ??= { state: "drafted", problems: [] });
    if (!s.problems.includes(problem)) s.problems.push(problem);
  };
  if (!ctx.entityId && !/^custom\/[a-z0-9][a-z0-9-]*$/.test(input.path)) add("path", "A drafted skill lives under custom/<directory>");

  const front = parseSkillFrontMatter(input.skillMd);
  const body = skillBody(input.skillMd);
  if (!front) add("skillMd", "SKILL.md front matter does not parse");
  else {
    if (!front.description.trim() || front.description === BLANK_SKILL_DESCRIPTION) add("skillMd", "The description is missing or still the template text");
    else if (front.description.length < MIN_DESCRIPTION_CHARS || !/\bwhen\b|\bfor\b/i.test(front.description)) add("skillMd", "The description must say when to use the skill — agents trigger skills by it");
  }
  if (body === BLANK_SKILL_BODY || isPlaceholder(body)) add("skillMd", "SKILL.md body is still placeholder text");
  if (body.length < MIN_SKILL_BODY_CHARS) add("skillMd", `SKILL.md body is too short (${body.length} characters; at least ${MIN_SKILL_BODY_CHARS})`);
  for (const part of SKILL_BODY_PARTS) if (!part.pattern.test(body)) add("skillMd", `SKILL.md does not cover ${part.label}`);

  const fileNames = Object.keys(input.files);
  states.files = listStatus(meta.rationale.files ?? [], meta.reasons.files ?? null, "files");
  if (fileNames.length === 0 && ctx.referenceLength > LONG_REFERENCE_CHARS) {
    add("files", `The pasted reference is ${ctx.referenceLength} characters; split it into reference files that SKILL.md links to`);
  }
  for (const file of fileNames) if (!body.includes(file)) add("files", `SKILL.md never mentions '${file}', so agents won't know to read it`);
  if (!(meta.rationale.enabled ?? []).some((r) => r.why.trim())) add("enabled", "Say why the skill is enabled or disabled");

  const candidate = skillDef(input, ctx);
  const problems = introducedProblems(ctx.snapshot, withChanges(ctx.snapshot, { skill: candidate }))
    .filter((p) => p.entity === "skill" && p.id === candidate.id)
    .map((p) => p.message);
  for (const message of problems) {
    add(sectionOf<SkillSection>(message, [[/^Path/, "path"], [/file/i, "files"]], "skillMd"), message);
  }
  return { sections: finishSections(SKILL_SECTIONS, states, meta), problems };
}

// ============================================
// One entry point per kind
// ============================================

type Locked = { slug?: string; path?: string; name?: string; enabled?: boolean };

/** Fields a refine of a stored entity never changes: its identity on disk and its enabled switch. */
export function lockedFields(kind: DraftKind, ctx: DraftContext): Locked {
  if (!ctx.entityId) return {};
  if (kind === "agent") {
    const stored = ctx.snapshot.agents.get(ctx.entityId);
    return stored ? { slug: stored.slug, enabled: stored.enabled } : {};
  }
  if (kind === "harness") {
    const stored = ctx.snapshot.harnesses.get(ctx.entityId);
    return stored ? { slug: stored.slug } : {};
  }
  const stored = ctx.snapshot.skills.get(ctx.entityId);
  // Agents inline skills by name, so a stored skill keeps it.
  return stored ? { path: stored.path, name: stored.name } : {};
}

const FIELDS: Record<DraftKind, Record<string, string[]>> = {
  agent: AGENT_FIELDS,
  harness: HARNESS_FIELDS,
  skill: SKILL_FIELDS,
};

/** `base` with only the fields of `sections` taken from `next`. */
export function mergeInput<T extends object>(kind: DraftKind, base: T, next: T, sections: readonly string[]): T {
  const merged = { ...base } as Record<string, unknown>;
  const source = next as Record<string, unknown>;
  for (const section of sections) for (const field of FIELDS[kind][section] ?? []) merged[field] = source[field];
  return merged as T;
}

/**
 * Turn one drafter answer into a reviewed draft: map it, merge it into the
 * current draft when only some sections were asked for, apply the safe
 * fixes, and assess every section.
 */
export function finalizeDraft<T extends AgentInput | HarnessInput | SkillInput>(
  kind: DraftKind,
  parsed: AgentDraft | HarnessDraft | SkillDraft,
  request: DraftRequest<T>,
  ctx: DraftContext,
): DraftResult<T> {
  const mapped = (kind === "agent"
    ? mapAgentDraft(parsed as AgentDraft, ctx)
    : kind === "harness" ? mapHarnessDraft(parsed as HarnessDraft) : mapSkillDraft(parsed as SkillDraft)) as unknown as Mapped<T>;
  const mode = draftMode(request);

  let input = mapped.input;
  let meta = mapped.meta;
  if (mode === "redraft" && request.current) {
    const sections = request.sections ?? [];
    input = mergeInput(kind, request.current, mapped.input, sections);
    meta = mergeMeta(request.currentMeta ?? emptyMeta(), mapped.meta, sections);
  }

  const locked = lockedFields(kind, ctx);
  // A draft that is already open keeps the enabled switch the admin set.
  if (kind === "agent" && locked.enabled === undefined && mode !== "draft" && request.current) locked.enabled = (request.current as AgentInput).enabled;
  const repaired = kind === "agent"
    ? repairAgent(input as AgentInput, ctx, locked)
    : kind === "harness" ? repairHarness(input as HarnessInput, ctx, locked) : repairSkill(input as SkillInput, ctx, locked);
  input = repaired.input as T;

  const assessed = kind === "agent"
    ? assessAgent(input as AgentInput, meta, ctx)
    : kind === "harness" ? assessHarness(input as HarnessInput, meta, ctx) : assessSkill(input as SkillInput, meta, ctx);

  return {
    kind,
    mode,
    input,
    sections: assessed.sections,
    meta,
    summary: mapped.summary,
    fixes: [...new Set([...mapped.fixes, ...repaired.fixes])],
    problems: assessed.problems,
    suggestedSkills: mapped.suggestedSkills,
    rounds: 1,
  };
}

/**
 * Fold a targeted re-ask into the draft so far: only the asked-for sections
 * change, and every section is assessed again on the merged result.
 */
export function foldRedraft<T>(previous: DraftResult<T>, redraft: DraftResult<T>): DraftResult<T> {
  return {
    ...redraft,
    mode: previous.mode,
    summary: previous.summary || redraft.summary,
    fixes: [...new Set([...previous.fixes, ...redraft.fixes])],
    suggestedSkills: previous.suggestedSkills.length > 0 ? previous.suggestedSkills : redraft.suggestedSkills,
    rounds: previous.rounds + redraft.rounds,
  };
}
