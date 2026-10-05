/**
 * Registry management (ADR 0019 §10): the operations behind AI Governance › Assistant.
 *
 * Every write is validated against the whole registry (a change may not
 * introduce problems), recorded as a revision, and bumps the registry version.
 * Built-in rows cannot be deleted; editing one marks it customized so seed
 * upgrades stop overwriting it, and "Reset to built-in" brings it back.
 */

import { randomUUID } from "crypto";

import { AppError } from "../../../types";
import { getCapability } from "../capabilities";
import { SEED_AGENTS, SEED_HARNESSES, SEED_SKILLS } from "../seeds";
import { resetRegistryCache } from "./cache";
import { agentRow, agentSeedHash, harnessSeedHash, skillSeedHash } from "./seedSync";
import * as store from "./store";
import type { AgentDef, FeatureBinding, HarnessDef, RegistryRevision, RegistrySnapshot, SkillDef } from "./types";
import { introducedProblems, parseSkillFrontMatter, usagesOf, withChanges, type RegistryProblem } from "./validation";

type Editable<T> = Omit<T, "id" | "isSystem" | "seedHash" | "customized" | "version" | "createdAt" | "updatedAt" | "createdBy">;

export type AgentInput = Editable<AgentDef>;
export type HarnessInput = Editable<HarnessDef>;
export type SkillInput = Omit<Editable<SkillDef>, "name" | "description">;

function reject(problems: RegistryProblem[]): never {
  throw AppError.badRequest(problems.map((p) => p.message).join("; "), { problems });
}

async function check(before: RegistrySnapshot, after: RegistrySnapshot): Promise<void> {
  const problems = introducedProblems(before, after);
  if (problems.length > 0) reject(problems);
}

function stamp<T extends object>(base: T): T & { version: number; createdAt: number; updatedAt: number; createdBy: string | null } {
  return { ...base, version: 0, createdAt: 0, updatedAt: 0, createdBy: null };
}

function done<T>(value: T): T {
  resetRegistryCache();
  return value;
}

// ============================================
// Agents
// ============================================

const AGENT_CONTENT_KEYS: Array<keyof AgentInput> = [
  "slug", "name", "description", "kind", "systemPrompt", "taskTemplate", "modelConfigId", "harnessId",
  "tuning", "requiredPermissions", "tools", "skills", "subagents",
];

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function createAgent(input: AgentInput, actor: string | null): Promise<AgentDef> {
  const before = await store.loadSnapshot();
  const candidate: AgentDef = stamp({ ...input, id: randomUUID(), isSystem: false, seedHash: null, customized: false });
  await check(before, withChanges(before, { agent: candidate }));
  const { version: _v, createdAt: _c, updatedAt: _u, createdBy: _b, ...row } = candidate;
  return done(await store.saveAgent(row, { actor, action: "create" }));
}

export async function updateAgent(id: string, input: AgentInput, expectedVersion: number, actor: string | null): Promise<AgentDef> {
  const before = await store.loadSnapshot();
  const existing = before.agents.get(id);
  if (!existing) throw AppError.notFound("Agent not found");
  const contentChanged = AGENT_CONTENT_KEYS.some((key) => !sameValue(existing[key], input[key]));
  const candidate: AgentDef = { ...existing, ...input, customized: existing.customized || (existing.isSystem && contentChanged) };
  await check(before, withChanges(before, { agent: candidate }));
  const { version: _v, createdAt: _c, updatedAt: _u, createdBy: _b, ...row } = candidate;
  return done(await store.saveAgent(row, { actor, action: "update", expectedVersion }));
}

export async function deleteAgent(id: string, expectedVersion: number, actor: string | null): Promise<void> {
  const snapshot = await store.loadSnapshot();
  const agent = snapshot.agents.get(id);
  if (!agent) throw AppError.notFound("Agent not found");
  if (agent.isSystem) throw AppError.badRequest("Built-in agents cannot be deleted. Disable it, rebind its feature, or reset it instead.");
  const uses = usagesOf(snapshot, "agent", id);
  if (uses.length > 0) throw AppError.badRequest(`Agent '${agent.name}' is still used by ${uses.join(", ")}`);
  await store.deleteAgent(id, { actor, expectedVersion });
  done(undefined);
}

// ============================================
// Harnesses
// ============================================

export async function createHarness(input: HarnessInput, actor: string | null): Promise<HarnessDef> {
  const before = await store.loadSnapshot();
  const candidate: HarnessDef = stamp({ ...input, id: randomUUID(), isSystem: false, seedHash: null, customized: false });
  await check(before, withChanges(before, { harness: candidate }));
  const { version: _v, createdAt: _c, updatedAt: _u, createdBy: _b, ...row } = candidate;
  return done(await store.saveHarness(row, { actor, action: "create" }));
}

export async function updateHarness(id: string, input: HarnessInput, expectedVersion: number, actor: string | null): Promise<HarnessDef> {
  const before = await store.loadSnapshot();
  const existing = before.harnesses.get(id);
  if (!existing) throw AppError.notFound("Harness not found");
  const candidate: HarnessDef = { ...existing, ...input, customized: existing.customized || existing.isSystem };
  await check(before, withChanges(before, { harness: candidate }));
  const { version: _v, createdAt: _c, updatedAt: _u, createdBy: _b, ...row } = candidate;
  return done(await store.saveHarness(row, { actor, action: "update", expectedVersion }));
}

export async function deleteHarness(id: string, expectedVersion: number, actor: string | null): Promise<void> {
  const snapshot = await store.loadSnapshot();
  const harness = snapshot.harnesses.get(id);
  if (!harness) throw AppError.notFound("Harness not found");
  if (harness.isSystem) throw AppError.badRequest("Built-in harnesses cannot be deleted.");
  const uses = usagesOf(snapshot, "harness", id);
  if (uses.length > 0) throw AppError.badRequest(`Harness '${harness.name}' is still used by ${uses.join(", ")}`);
  await store.deleteHarness(id, { actor, expectedVersion });
  done(undefined);
}

// ============================================
// Skills
// ============================================

/** Name and description come from the SKILL.md front matter. */
function skillIdentity(input: SkillInput): { name: string; description: string } {
  const front = parseSkillFrontMatter(input.skillMd);
  if (!front?.name) throw AppError.badRequest("SKILL.md must start with front matter that has a name and a description");
  return front;
}

export async function createSkill(input: SkillInput, actor: string | null): Promise<SkillDef> {
  const before = await store.loadSnapshot();
  const candidate: SkillDef = stamp({ ...input, ...skillIdentity(input), id: randomUUID(), isSystem: false, seedHash: null, customized: false });
  await check(before, withChanges(before, { skill: candidate }));
  const { version: _v, createdAt: _c, updatedAt: _u, createdBy: _b, ...row } = candidate;
  return done(await store.saveSkill(row, { actor, action: "create" }));
}

export async function updateSkill(id: string, input: SkillInput, expectedVersion: number, actor: string | null): Promise<SkillDef> {
  const before = await store.loadSnapshot();
  const existing = before.skills.get(id);
  if (!existing) throw AppError.notFound("Skill not found");
  const identity = skillIdentity(input);
  if (existing.isSystem && identity.name !== existing.name) throw AppError.badRequest("Built-in skills keep their name");
  const contentChanged = !sameValue([existing.path, existing.skillMd, existing.files], [input.path, input.skillMd, input.files]);
  const candidate: SkillDef = { ...existing, ...input, ...identity, customized: existing.customized || (existing.isSystem && contentChanged) };
  await check(before, withChanges(before, { skill: candidate }));
  const { version: _v, createdAt: _c, updatedAt: _u, createdBy: _b, ...row } = candidate;
  return done(await store.saveSkill(row, { actor, action: "update", expectedVersion }));
}

export async function deleteSkill(id: string, expectedVersion: number, actor: string | null): Promise<void> {
  const snapshot = await store.loadSnapshot();
  const skill = snapshot.skills.get(id);
  if (!skill) throw AppError.notFound("Skill not found");
  if (skill.isSystem) throw AppError.badRequest("Built-in skills cannot be deleted. Disable it or reset it instead.");
  const uses = usagesOf(snapshot, "skill", id);
  if (uses.length > 0) throw AppError.badRequest(`Skill '${skill.name}' is still used by ${uses.join(", ")}`);
  await store.deleteSkill(id, { actor, expectedVersion });
  done(undefined);
}

// ============================================
// Bindings
// ============================================

export async function bindFeature(featureId: string, agentId: string, actor: string | null): Promise<FeatureBinding> {
  if (!getCapability(featureId)) throw AppError.notFound(`Unknown AI feature '${featureId}'`);
  const before = await store.loadSnapshot();
  if (!before.agents.has(agentId)) throw AppError.notFound("Agent not found");
  await check(before, withChanges(before, { binding: { featureId, agentId } }));
  return done(await store.setBinding(featureId, agentId, { actor, action: "update" }));
}

// ============================================
// Reset to built-in
// ============================================

export async function resetAgent(id: string, actor: string | null): Promise<AgentDef> {
  const seed = SEED_AGENTS.find((a) => a.id === id);
  if (!seed) throw AppError.badRequest("Only built-in agents can be reset");
  const before = await store.loadSnapshot();
  const existing = before.agents.get(id);
  const row = { ...agentRow(seed), enabled: existing?.enabled ?? true };
  await check(before, withChanges(before, { agent: stamp(row) }));
  return done(await store.saveAgent(row, { actor, action: "reset", expectedVersion: existing?.version }));
}

export async function resetHarness(id: string, actor: string | null): Promise<HarnessDef> {
  const seed = SEED_HARNESSES.find((h) => h.id === id);
  if (!seed) throw AppError.badRequest("Only built-in harnesses can be reset");
  const before = await store.loadSnapshot();
  const existing = before.harnesses.get(id);
  const row = { ...seed, isSystem: true, seedHash: harnessSeedHash(seed), customized: false };
  await check(before, withChanges(before, { harness: stamp(row) }));
  return done(await store.saveHarness(row, { actor, action: "reset", expectedVersion: existing?.version }));
}

export async function resetSkill(id: string, actor: string | null): Promise<SkillDef> {
  const seed = SEED_SKILLS.find((s) => s.id === id);
  if (!seed) throw AppError.badRequest("Only built-in skills can be reset");
  const before = await store.loadSnapshot();
  const existing = before.skills.get(id);
  const row = { ...seed, enabled: existing?.enabled ?? true, isSystem: true, seedHash: skillSeedHash(seed), customized: false };
  await check(before, withChanges(before, { skill: stamp(row) }));
  return done(await store.saveSkill(row, { actor, action: "reset", expectedVersion: existing?.version }));
}

/** Whether a built-in row differs from the shipped definition (customized rows only). */
export function builtInUpdateAvailable(entity: "agent" | "harness" | "skill", row: { id: string; customized: boolean; seedHash: string | null }): boolean {
  if (!row.customized) return false;
  const hash = entity === "agent"
    ? (() => { const s = SEED_AGENTS.find((a) => a.id === row.id); return s ? agentSeedHash(s) : null; })()
    : entity === "harness"
      ? (() => { const s = SEED_HARNESSES.find((h) => h.id === row.id); return s ? harnessSeedHash(s) : null; })()
      : (() => { const s = SEED_SKILLS.find((k) => k.id === row.id); return s ? skillSeedHash(s) : null; })();
  return hash !== null && hash !== row.seedHash;
}

// ============================================
// Rollback
// ============================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Restore an entity (or binding) to the state captured by a revision, as a new version. */
export async function rollback(revisionId: string, actor: string | null): Promise<RegistryRevision["entity"]> {
  const revision = await store.getRevision(revisionId);
  if (!revision || !isRecord(revision.snapshot)) throw AppError.notFound("Revision not found");
  const before = await store.loadSnapshot();
  const snap = revision.snapshot;
  if (revision.entity === "binding") {
    const agentId = typeof snap.agentId === "string" ? snap.agentId : "";
    await bindFeature(revision.entityId, agentId, actor);
    return "binding";
  }
  if (revision.entity === "agent") {
    const restored = snap as unknown as AgentDef;
    const current = before.agents.get(revision.entityId);
    await check(before, withChanges(before, { agent: { ...restored, version: current?.version ?? 0 } }));
    const { version: _v, createdAt: _c, updatedAt: _u, createdBy: _b, ...row } = restored;
    await store.saveAgent(row, { actor, action: "rollback", expectedVersion: current?.version });
  } else if (revision.entity === "harness") {
    const restored = snap as unknown as HarnessDef;
    const current = before.harnesses.get(revision.entityId);
    await check(before, withChanges(before, { harness: { ...restored, version: current?.version ?? 0 } }));
    const { version: _v, createdAt: _c, updatedAt: _u, createdBy: _b, ...row } = restored;
    await store.saveHarness(row, { actor, action: "rollback", expectedVersion: current?.version });
  } else {
    const restored = snap as unknown as SkillDef;
    const current = before.skills.get(revision.entityId);
    await check(before, withChanges(before, { skill: { ...restored, version: current?.version ?? 0 } }));
    const { version: _v, createdAt: _c, updatedAt: _u, createdBy: _b, ...row } = restored;
    await store.saveSkill(row, { actor, action: "rollback", expectedVersion: current?.version });
  }
  resetRegistryCache();
  return revision.entity;
}
