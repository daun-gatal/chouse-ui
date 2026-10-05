/**
 * Registry persistence (ADR 0019) on the metadata DB — SQLite and PostgreSQL
 * through the dialect-agnostic observe/db helpers.
 *
 * Every write bumps `ai_registry_state.version`, the counter each request reads
 * to decide whether its cached snapshot is current (ADR 0010: no pod-local
 * authority). Updates use optimistic concurrency on the row `version`.
 */

import { randomUUID } from "crypto";

import { AppError } from "../../../types";
import { all, json, num, one, run, sql, str, strOrNull, type Row } from "../../observe/db";
import type {
  AgentDef,
  AgentKind,
  AgentSkillLink,
  AgentTuning,
  FeatureBinding,
  GeneralPurposeConfig,
  HarnessDef,
  RegistryEntity,
  RegistryRevision,
  RegistrySnapshot,
  SkillDef,
  SkillLinkMode,
} from "./types";

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "t";
}

function stringArray(value: unknown): string[] {
  const parsed = json<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
}

function stringRecord(value: unknown): Record<string, string> {
  const parsed = json<unknown>(value, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseTuning(value: unknown): AgentTuning {
  const parsed = json<Record<string, unknown>>(value, {});
  const stepBudget = typeof parsed.stepBudget === "number" && parsed.stepBudget > 0 ? parsed.stepBudget : 10;
  return {
    stepBudget,
    recursionLimit: optionalNumber(parsed.recursionLimit),
    timeoutMs: optionalNumber(parsed.timeoutMs),
    maxOutputTokens: optionalNumber(parsed.maxOutputTokens),
  };
}

function parseSkillLinks(value: unknown): AgentSkillLink[] {
  const parsed = json<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  const links: AgentSkillLink[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.skillId !== "string") continue;
    const mode: SkillLinkMode = record.mode === "pinned" ? "pinned" : "progressive";
    links.push({ skillId: record.skillId, mode, pinnedFile: typeof record.pinnedFile === "string" ? record.pinnedFile : null });
  }
  return links;
}

function parseGeneralPurpose(value: unknown): GeneralPurposeConfig {
  const parsed = json<Record<string, unknown>>(value, {});
  return {
    enabled: parsed.enabled === true,
    description: typeof parsed.description === "string" ? parsed.description : null,
    systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : null,
  };
}

export function harnessFromRow(r: Row): HarnessDef {
  return {
    id: str(r.id),
    slug: str(r.slug),
    name: str(r.name),
    description: str(r.description),
    excludedTools: stringArray(r.excluded_tools),
    generalPurpose: parseGeneralPurpose(r.general_purpose),
    promptSuffix: strOrNull(r.prompt_suffix),
    toolDescriptionOverrides: stringRecord(r.tool_description_overrides),
    isSystem: bool(r.is_system),
    seedHash: strOrNull(r.seed_hash),
    customized: bool(r.customized),
    version: num(r.version),
    createdBy: strOrNull(r.created_by),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function agentFromRow(r: Row): AgentDef {
  const kind: AgentKind = str(r.kind) === "router" ? "router" : "agent";
  return {
    id: str(r.id),
    slug: str(r.slug),
    name: str(r.name),
    description: str(r.description),
    kind,
    systemPrompt: str(r.system_prompt),
    taskTemplate: strOrNull(r.task_template),
    modelConfigId: strOrNull(r.model_config_id),
    harnessId: str(r.harness_id),
    tuning: parseTuning(r.tuning),
    requiredPermissions: stringArray(r.required_permissions),
    tools: stringArray(r.tools),
    skills: parseSkillLinks(r.skills),
    subagents: stringArray(r.subagents),
    enabled: bool(r.enabled),
    isSystem: bool(r.is_system),
    seedHash: strOrNull(r.seed_hash),
    customized: bool(r.customized),
    version: num(r.version),
    createdBy: strOrNull(r.created_by),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function skillFromRow(r: Row): SkillDef {
  return {
    id: str(r.id),
    name: str(r.name),
    path: str(r.dir_path),
    description: str(r.description),
    skillMd: str(r.skill_md),
    files: stringRecord(r.files),
    enabled: bool(r.enabled),
    isSystem: bool(r.is_system),
    seedHash: strOrNull(r.seed_hash),
    customized: bool(r.customized),
    version: num(r.version),
    createdBy: strOrNull(r.created_by),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function bindingFromRow(r: Row): FeatureBinding {
  return {
    featureId: str(r.feature_id),
    agentId: str(r.agent_id),
    updatedBy: strOrNull(r.updated_by),
    updatedAt: num(r.updated_at),
  };
}

// ============================================
// Version counter
// ============================================

export async function getRegistryVersion(): Promise<number> {
  const row = await one(sql`SELECT version FROM ai_registry_state WHERE id = 1`);
  return row ? num(row.version) : 0;
}

async function bumpRegistryVersion(): Promise<void> {
  await run(sql`UPDATE ai_registry_state SET version = version + 1 WHERE id = 1`);
}

/** Read the whole registry. The version is read first so a racing write only ever makes the snapshot look older. */
export async function loadSnapshot(): Promise<RegistrySnapshot> {
  const version = await getRegistryVersion();
  const [harnesses, agents, skills, bindings] = await Promise.all([
    all(sql`SELECT * FROM ai_harnesses`),
    all(sql`SELECT * FROM ai_agents`),
    all(sql`SELECT * FROM ai_skills`),
    all(sql`SELECT * FROM ai_feature_bindings`),
  ]);
  return {
    version,
    harnesses: new Map(harnesses.map((r) => { const h = harnessFromRow(r); return [h.id, h]; })),
    agents: new Map(agents.map((r) => { const a = agentFromRow(r); return [a.id, a]; })),
    skills: new Map(skills.map((r) => { const s = skillFromRow(r); return [s.id, s]; })),
    bindings: new Map(bindings.map((r) => { const b = bindingFromRow(r); return [b.featureId, b]; })),
  };
}

// ============================================
// Revisions
// ============================================

async function recordRevision(entity: RegistryEntity, entityId: string, version: number, action: string, snapshot: unknown, actor: string | null): Promise<void> {
  await run(sql`
    INSERT INTO ai_registry_revisions (id, entity, entity_id, version, action, snapshot, actor, created_at)
    VALUES (${randomUUID()}, ${entity}, ${entityId}, ${version}, ${action}, ${JSON.stringify(snapshot)}, ${actor}, ${Date.now()})
  `);
}

function revisionFromRow(r: Row): RegistryRevision {
  const entity = str(r.entity);
  return {
    id: str(r.id),
    entity: (["agent", "harness", "skill", "binding"].includes(entity) ? entity : "agent") as RegistryEntity,
    entityId: str(r.entity_id),
    version: num(r.version),
    action: str(r.action),
    snapshot: json<unknown>(r.snapshot, null),
    actor: strOrNull(r.actor),
    createdAt: num(r.created_at),
  };
}

export async function listRevisions(entity: RegistryEntity, entityId: string, limit = 50): Promise<RegistryRevision[]> {
  const rows = await all(sql`
    SELECT * FROM ai_registry_revisions WHERE entity = ${entity} AND entity_id = ${entityId}
    ORDER BY created_at DESC, version DESC LIMIT ${limit}`);
  return rows.map(revisionFromRow);
}

export async function getRevision(id: string): Promise<RegistryRevision | null> {
  const row = await one(sql`SELECT * FROM ai_registry_revisions WHERE id = ${id}`);
  return row ? revisionFromRow(row) : null;
}

// ============================================
// Writes
// ============================================

export interface WriteMeta {
  actor: string | null;
  /** Revision label, e.g. "create", "update", "reset", "seed", "rollback". */
  action: string;
  /** Row version the caller edited; a mismatch is a conflict. Omit to skip the check (seed sync). */
  expectedVersion?: number;
}

function conflict(entity: string, id: string): AppError {
  return AppError.conflict(`The ${entity} '${id}' was changed by someone else. Reload and apply your edit again.`);
}

type HarnessInput = Omit<HarnessDef, "version" | "createdAt" | "updatedAt" | "createdBy">;

export async function saveHarness(input: HarnessInput, meta: WriteMeta): Promise<HarnessDef> {
  const now = Date.now();
  const existing = await one(sql`SELECT version FROM ai_harnesses WHERE id = ${input.id}`);
  if (!existing) {
    await run(sql`
      INSERT INTO ai_harnesses (id, slug, name, description, excluded_tools, general_purpose, prompt_suffix, tool_description_overrides, is_system, seed_hash, customized, version, created_by, created_at, updated_at)
      VALUES (${input.id}, ${input.slug}, ${input.name}, ${input.description}, ${JSON.stringify(input.excludedTools)}, ${JSON.stringify(input.generalPurpose)},
        ${input.promptSuffix}, ${JSON.stringify(input.toolDescriptionOverrides)}, ${input.isSystem ? 1 : 0}, ${input.seedHash}, ${input.customized ? 1 : 0}, 1, ${meta.actor}, ${now}, ${now})
    `);
  } else {
    const current = num(existing.version);
    if (meta.expectedVersion !== undefined && meta.expectedVersion !== current) throw conflict("harness", input.id);
    const updated = await all(sql`
      UPDATE ai_harnesses SET slug = ${input.slug}, name = ${input.name}, description = ${input.description},
        excluded_tools = ${JSON.stringify(input.excludedTools)}, general_purpose = ${JSON.stringify(input.generalPurpose)},
        prompt_suffix = ${input.promptSuffix}, tool_description_overrides = ${JSON.stringify(input.toolDescriptionOverrides)},
        is_system = ${input.isSystem ? 1 : 0}, seed_hash = ${input.seedHash}, customized = ${input.customized ? 1 : 0},
        version = version + 1, updated_at = ${now}
      WHERE id = ${input.id} AND version = ${current} RETURNING id`);
    if (updated.length === 0) throw conflict("harness", input.id);
  }
  const saved = harnessFromRow((await one(sql`SELECT * FROM ai_harnesses WHERE id = ${input.id}`))!);
  await recordRevision("harness", saved.id, saved.version, meta.action, saved, meta.actor);
  await bumpRegistryVersion();
  return saved;
}

type AgentInput = Omit<AgentDef, "version" | "createdAt" | "updatedAt" | "createdBy">;

export async function saveAgent(input: AgentInput, meta: WriteMeta): Promise<AgentDef> {
  const now = Date.now();
  const existing = await one(sql`SELECT version FROM ai_agents WHERE id = ${input.id}`);
  const tuning = JSON.stringify(input.tuning);
  const skills = JSON.stringify(input.skills);
  if (!existing) {
    await run(sql`
      INSERT INTO ai_agents (id, slug, name, description, kind, system_prompt, task_template, model_config_id, harness_id, tuning, required_permissions,
        tools, skills, subagents, enabled, is_system, seed_hash, customized, version, created_by, created_at, updated_at)
      VALUES (${input.id}, ${input.slug}, ${input.name}, ${input.description}, ${input.kind}, ${input.systemPrompt}, ${input.taskTemplate}, ${input.modelConfigId},
        ${input.harnessId}, ${tuning}, ${JSON.stringify(input.requiredPermissions)}, ${JSON.stringify(input.tools)}, ${skills}, ${JSON.stringify(input.subagents)},
        ${input.enabled ? 1 : 0}, ${input.isSystem ? 1 : 0}, ${input.seedHash}, ${input.customized ? 1 : 0}, 1, ${meta.actor}, ${now}, ${now})
    `);
  } else {
    const current = num(existing.version);
    if (meta.expectedVersion !== undefined && meta.expectedVersion !== current) throw conflict("agent", input.id);
    const updated = await all(sql`
      UPDATE ai_agents SET slug = ${input.slug}, name = ${input.name}, description = ${input.description}, kind = ${input.kind},
        system_prompt = ${input.systemPrompt}, task_template = ${input.taskTemplate}, model_config_id = ${input.modelConfigId},
        harness_id = ${input.harnessId}, tuning = ${tuning}, required_permissions = ${JSON.stringify(input.requiredPermissions)},
        tools = ${JSON.stringify(input.tools)}, skills = ${skills}, subagents = ${JSON.stringify(input.subagents)},
        enabled = ${input.enabled ? 1 : 0}, is_system = ${input.isSystem ? 1 : 0}, seed_hash = ${input.seedHash}, customized = ${input.customized ? 1 : 0},
        version = version + 1, updated_at = ${now}
      WHERE id = ${input.id} AND version = ${current} RETURNING id`);
    if (updated.length === 0) throw conflict("agent", input.id);
  }
  const saved = agentFromRow((await one(sql`SELECT * FROM ai_agents WHERE id = ${input.id}`))!);
  await recordRevision("agent", saved.id, saved.version, meta.action, saved, meta.actor);
  await bumpRegistryVersion();
  return saved;
}

type SkillInput = Omit<SkillDef, "version" | "createdAt" | "updatedAt" | "createdBy">;

export async function saveSkill(input: SkillInput, meta: WriteMeta): Promise<SkillDef> {
  const now = Date.now();
  const existing = await one(sql`SELECT version FROM ai_skills WHERE id = ${input.id}`);
  const files = JSON.stringify(input.files);
  if (!existing) {
    await run(sql`
      INSERT INTO ai_skills (id, name, dir_path, description, skill_md, files, enabled, is_system, seed_hash, customized, version, created_by, created_at, updated_at)
      VALUES (${input.id}, ${input.name}, ${input.path}, ${input.description}, ${input.skillMd}, ${files}, ${input.enabled ? 1 : 0},
        ${input.isSystem ? 1 : 0}, ${input.seedHash}, ${input.customized ? 1 : 0}, 1, ${meta.actor}, ${now}, ${now})
    `);
  } else {
    const current = num(existing.version);
    if (meta.expectedVersion !== undefined && meta.expectedVersion !== current) throw conflict("skill", input.id);
    const updated = await all(sql`
      UPDATE ai_skills SET name = ${input.name}, dir_path = ${input.path}, description = ${input.description}, skill_md = ${input.skillMd},
        files = ${files}, enabled = ${input.enabled ? 1 : 0}, is_system = ${input.isSystem ? 1 : 0}, seed_hash = ${input.seedHash},
        customized = ${input.customized ? 1 : 0}, version = version + 1, updated_at = ${now}
      WHERE id = ${input.id} AND version = ${current} RETURNING id`);
    if (updated.length === 0) throw conflict("skill", input.id);
  }
  const saved = skillFromRow((await one(sql`SELECT * FROM ai_skills WHERE id = ${input.id}`))!);
  await recordRevision("skill", saved.id, saved.version, meta.action, saved, meta.actor);
  await bumpRegistryVersion();
  return saved;
}

export async function setBinding(featureId: string, agentId: string, meta: Pick<WriteMeta, "actor" | "action">): Promise<FeatureBinding> {
  const now = Date.now();
  await run(sql`
    INSERT INTO ai_feature_bindings (feature_id, agent_id, updated_by, updated_at) VALUES (${featureId}, ${agentId}, ${meta.actor}, ${now})
    ON CONFLICT (feature_id) DO UPDATE SET agent_id = ${agentId}, updated_by = ${meta.actor}, updated_at = ${now}
  `);
  const binding: FeatureBinding = { featureId, agentId, updatedBy: meta.actor, updatedAt: now };
  await recordRevision("binding", featureId, now, meta.action, binding, meta.actor);
  await bumpRegistryVersion();
  return binding;
}

async function deleteRow(entity: RegistryEntity, table: "ai_agents" | "ai_harnesses" | "ai_skills", id: string, meta: Pick<WriteMeta, "actor" | "expectedVersion">): Promise<void> {
  const existing = await one(sql`SELECT * FROM ${sql.raw(table)} WHERE id = ${id}`);
  if (!existing) throw AppError.notFound(`The ${entity} '${id}' does not exist`);
  if (meta.expectedVersion !== undefined && meta.expectedVersion !== num(existing.version)) throw conflict(entity, id);
  await run(sql`DELETE FROM ${sql.raw(table)} WHERE id = ${id}`);
  const snapshot = entity === "agent" ? agentFromRow(existing) : entity === "harness" ? harnessFromRow(existing) : skillFromRow(existing);
  await recordRevision(entity, id, num(existing.version), "delete", snapshot, meta.actor);
  await bumpRegistryVersion();
}

export function deleteAgent(id: string, meta: Pick<WriteMeta, "actor" | "expectedVersion">): Promise<void> {
  return deleteRow("agent", "ai_agents", id, meta);
}

export function deleteHarness(id: string, meta: Pick<WriteMeta, "actor" | "expectedVersion">): Promise<void> {
  return deleteRow("harness", "ai_harnesses", id, meta);
}

export function deleteSkill(id: string, meta: Pick<WriteMeta, "actor" | "expectedVersion">): Promise<void> {
  return deleteRow("skill", "ai_skills", id, meta);
}
