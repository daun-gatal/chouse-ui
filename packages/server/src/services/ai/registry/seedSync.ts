/**
 * Startup seed sync (ADR 0019 §8).
 *
 * Idempotent and safe on every boot, on every replica:
 * - inserts missing built-in harnesses, skills and agents;
 * - upgrades built-in rows an administrator has not customized when the
 *   shipped definition changed (seed hash differs);
 * - never touches customized rows (the UI offers "Reset to built-in");
 * - binds every built-in feature that has no valid agent to its seeded agent.
 *
 * Two replicas booting at once may race; a lost race surfaces as a conflict or
 * duplicate-key error on one row, which is skipped because the winner wrote the
 * same row.
 */

import { logger } from "../../../utils/logger";
import {
  SEED_AGENTS,
  SEED_BINDINGS,
  SEED_HARNESSES,
  SEED_SKILLS,
  seedHash,
  type SeedAgent,
  type SeedHarness,
  type SeedSkill,
} from "../seeds";
import { resetRegistryCache } from "./cache";
import { loadSnapshot, saveAgent, saveHarness, saveSkill, setBinding } from "./store";
import type { AgentDef, HarnessDef, RegistrySnapshot, SkillDef } from "./types";

export interface SeedSyncResult {
  inserted: number;
  upgraded: number;
  /** Customized built-ins whose shipped definition changed. */
  updateAvailable: number;
  bindingsRestored: number;
}

type Outcome = "inserted" | "upgraded" | "update-available" | "current";

const SEED_ACTOR = null;

export function harnessSeedHash(seed: SeedHarness): string {
  return seedHash(seed);
}

export function skillSeedHash(seed: SeedSkill): string {
  return seedHash(seed);
}

export function agentSeedHash(seed: SeedAgent): string {
  return seedHash(seed);
}

function harnessRow(seed: SeedHarness): Omit<HarnessDef, "version" | "createdAt" | "updatedAt" | "createdBy"> {
  return { ...seed, isSystem: true, seedHash: harnessSeedHash(seed), customized: false };
}

function skillRow(seed: SeedSkill): Omit<SkillDef, "version" | "createdAt" | "updatedAt" | "createdBy"> {
  return { ...seed, enabled: true, isSystem: true, seedHash: skillSeedHash(seed), customized: false };
}

/** Resolve a seed agent's slugs/names to ids. Throws when the seeds are inconsistent (a bug, caught by tests). */
export function agentRow(seed: SeedAgent): Omit<AgentDef, "version" | "createdAt" | "updatedAt" | "createdBy"> {
  const harness = SEED_HARNESSES.find((h) => h.slug === seed.harness);
  if (!harness) throw new Error(`Seed agent ${seed.slug} uses unknown harness ${seed.harness}`);
  const skills = seed.skills.map((link) => {
    const skill = SEED_SKILLS.find((s) => s.name === link.skill);
    if (!skill) throw new Error(`Seed agent ${seed.slug} uses unknown skill ${link.skill}`);
    return { skillId: skill.id, mode: link.mode, pinnedFile: link.pinnedFile };
  });
  const subagents = seed.subagents.map((slug) => {
    const child = SEED_AGENTS.find((a) => a.slug === slug);
    if (!child) throw new Error(`Seed agent ${seed.slug} uses unknown subagent ${slug}`);
    return child.id;
  });
  return {
    id: seed.id,
    slug: seed.slug,
    name: seed.name,
    description: seed.description,
    kind: seed.kind,
    systemPrompt: seed.systemPrompt,
    taskTemplate: seed.taskTemplate,
    modelConfigId: null,
    harnessId: harness.id,
    tuning: seed.tuning,
    requiredPermissions: seed.requiredPermissions,
    tools: seed.tools,
    skills,
    subagents,
    enabled: true,
    isSystem: true,
    seedHash: agentSeedHash(seed),
    customized: false,
  };
}

async function syncRow<T extends { version: number; customized: boolean; seedHash: string | null }>(
  existing: T | undefined,
  hash: string,
  write: (meta: { action: string; expectedVersion?: number }) => Promise<unknown>,
): Promise<Outcome> {
  if (!existing) {
    await write({ action: "seed" });
    return "inserted";
  }
  if (existing.seedHash === hash) return "current";
  if (existing.customized) return "update-available";
  await write({ action: "seed-upgrade", expectedVersion: existing.version });
  return "upgraded";
}

async function guarded(label: string, run: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await run();
  } catch (error) {
    // A concurrent replica wrote the same row first; its write is identical.
    logger.warn({ module: "AIRegistry", row: label, err: error instanceof Error ? error.message : String(error) }, "Seed sync skipped a row another writer changed");
    return "current";
  }
}

export async function syncRegistrySeeds(): Promise<SeedSyncResult> {
  const snapshot: RegistrySnapshot = await loadSnapshot();
  const result: SeedSyncResult = { inserted: 0, upgraded: 0, updateAvailable: 0, bindingsRestored: 0 };
  const count = (outcome: Outcome): void => {
    if (outcome === "inserted") result.inserted++;
    else if (outcome === "upgraded") result.upgraded++;
    else if (outcome === "update-available") result.updateAvailable++;
  };

  for (const seed of SEED_HARNESSES) {
    count(await guarded(`harness:${seed.id}`, () => syncRow(snapshot.harnesses.get(seed.id), harnessSeedHash(seed),
      (meta) => saveHarness(harnessRow(seed), { actor: SEED_ACTOR, ...meta }))));
  }
  for (const seed of SEED_SKILLS) {
    count(await guarded(`skill:${seed.id}`, () => syncRow(snapshot.skills.get(seed.id), skillSeedHash(seed),
      (meta) => saveSkill(skillRow(seed), { actor: SEED_ACTOR, ...meta }))));
  }
  for (const seed of SEED_AGENTS) {
    const existing = snapshot.agents.get(seed.id);
    count(await guarded(`agent:${seed.id}`, () => syncRow(existing, agentSeedHash(seed),
      // An upgrade keeps the administrator's enable switch.
      (meta) => saveAgent({ ...agentRow(seed), enabled: existing ? existing.enabled : true }, { actor: SEED_ACTOR, ...meta }))));
  }

  const after = await loadSnapshot();
  for (const [featureId, slug] of Object.entries(SEED_BINDINGS)) {
    const binding = after.bindings.get(featureId);
    if (binding && after.agents.has(binding.agentId)) continue;
    const agent = SEED_AGENTS.find((a) => a.slug === slug);
    if (!agent) throw new Error(`Seed binding ${featureId} uses unknown agent ${slug}`);
    try {
      await setBinding(featureId, agent.id, { actor: SEED_ACTOR, action: "seed" });
      result.bindingsRestored++;
    } catch (error) {
      logger.warn({ module: "AIRegistry", featureId, err: error instanceof Error ? error.message : String(error) }, "Seed sync could not bind a feature");
    }
  }

  resetRegistryCache();
  logger.info({ module: "AIRegistry", ...result }, "AI agent registry seeds synced");
  return result;
}
