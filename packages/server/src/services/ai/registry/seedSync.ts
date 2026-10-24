/**
 * Startup seed sync (ADR 0019 §8).
 *
 * Idempotent and safe on every boot, on every replica:
 * - inserts missing built-in harnesses, skills and agents;
 * - upgrades built-in rows an administrator has not customized when the
 *   shipped definition changed (seed hash differs);
 * - never touches customized rows (the UI offers "Reset to built-in");
 * - binds every built-in feature that has no valid agent to its seeded agent;
 * - moves a binding the seed set to a default that changed (an admin's choice stays);
 * - retires built-ins that no longer ship: their references and bindings move
 *   to the replacements, and the row goes unless an administrator customized it.
 *
 * Two replicas booting at once may race; a lost race surfaces as a conflict or
 * duplicate-key error on one row, which is skipped because the winner wrote the
 * same row.
 */

import { logger } from "../../../utils/logger";
import {
  MOVED_BINDINGS,
  RETIRED_AGENTS,
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
import { deleteAgent, loadSnapshot, saveAgent, saveGuardrail, saveHarness, saveSkill, setBinding } from "./store";
import { SEED_GUARDRAILS } from "../seeds/guardrails";
import { guardrailRow, guardrailSeedHash } from "../guardrails/service";
import { syncBuiltinEvalCases } from "../evals/builtin";
import type { AgentDef, HarnessDef, RegistrySnapshot, SkillDef } from "./types";

export interface SeedSyncResult {
  inserted: number;
  upgraded: number;
  /** Customized built-ins whose shipped definition changed. */
  updateAvailable: number;
  bindingsRestored: number;
  /** Bindings moved from an old built-in default to the new one. */
  bindingsMoved: number;
  /** Built-ins that no longer ship and were removed (customized ones are kept). */
  retired: number;
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
  const result: SeedSyncResult = { inserted: 0, upgraded: 0, updateAvailable: 0, bindingsRestored: 0, bindingsMoved: 0, retired: 0 };
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

  for (const seed of SEED_GUARDRAILS) {
    const existing = snapshot.guardrails.get(seed.id);
    count(await guarded(`guardrail:${seed.id}`, () => syncRow(existing, guardrailSeedHash(seed),
      // An upgrade keeps the administrator's switch, mode and position.
      (meta) => saveGuardrail(guardrailRow(seed, existing ? { enabled: existing.enabled, mode: existing.mode, position: existing.position } : seed.defaults), { actor: SEED_ACTOR, ...meta }))));
  }

  result.retired = await retireAgents();
  result.bindingsMoved = await moveBindings();
  try {
    await syncBuiltinEvalCases();
  } catch (error) {
    logger.warn({ module: "AIRegistry", err: error instanceof Error ? error.message : String(error) }, "Built-in eval cases could not be added");
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

function editable(agent: AgentDef): Omit<AgentDef, "version" | "createdAt" | "updatedAt" | "createdBy"> {
  return {
    id: agent.id, slug: agent.slug, name: agent.name, description: agent.description, kind: agent.kind,
    systemPrompt: agent.systemPrompt, taskTemplate: agent.taskTemplate, modelConfigId: agent.modelConfigId, harnessId: agent.harnessId,
    tuning: agent.tuning, requiredPermissions: agent.requiredPermissions, tools: agent.tools, skills: agent.skills, subagents: agent.subagents,
    enabled: agent.enabled, isSystem: agent.isSystem, seedHash: agent.seedHash, customized: agent.customized,
  };
}

/** Retire built-ins that no longer ship (ADR 0025 §5). Returns how many rows were removed. */
async function retireAgents(): Promise<number> {
  let removed = 0;
  for (const retired of RETIRED_AGENTS) {
    const snapshot = await loadSnapshot();
    const row = snapshot.agents.get(retired.id);
    if (!row) continue;
    if (row.customized) {
      logger.info({ module: "AIRegistry", agent: row.slug }, "A retired built-in agent was customized; it stays as it is");
      continue;
    }
    // Agents that delegated to it delegate to its replacements instead.
    for (const agent of snapshot.agents.values()) {
      if (agent.id === retired.id || !agent.subagents.includes(retired.id)) continue;
      const subagents = [...new Set(agent.subagents.flatMap((id) => (id === retired.id ? retired.replacedBy : [id])))]
        .filter((id) => id !== agent.id && snapshot.agents.has(id));
      await guarded(`agent:${agent.id}`, async () => {
        await saveAgent({ ...editable(agent), subagents }, { actor: SEED_ACTOR, action: "seed-retire", expectedVersion: agent.version });
        return "upgraded";
      });
    }
    for (const [featureId, binding] of snapshot.bindings) {
      if (binding.agentId !== retired.id || !snapshot.agents.has(retired.bindingsTo)) continue;
      await guarded(`binding:${featureId}`, async () => {
        await setBinding(featureId, retired.bindingsTo, { actor: SEED_ACTOR, action: "seed-retire" });
        return "upgraded";
      });
    }
    const outcome = await guarded(`agent:${retired.id}`, async () => {
      await deleteAgent(retired.id, { actor: SEED_ACTOR, expectedVersion: row.version });
      return "upgraded";
    });
    if (outcome === "upgraded") removed += 1;
  }
  return removed;
}

/** Move bindings the seed set to a default that changed; an administrator's choice stays. Returns how many moved. */
async function moveBindings(): Promise<number> {
  const snapshot = await loadSnapshot();
  let moved = 0;
  for (const change of MOVED_BINDINGS) {
    const binding = snapshot.bindings.get(change.featureId);
    const from = SEED_AGENTS.find((a) => a.slug === change.fromSlug);
    const toSlug = SEED_BINDINGS[change.featureId];
    const to = SEED_AGENTS.find((a) => a.slug === toSlug);
    if (!binding || !from || !to || binding.agentId !== from.id || binding.updatedBy !== SEED_ACTOR) continue;
    if (!snapshot.agents.get(to.id)?.enabled) continue;
    const outcome = await guarded(`binding:${change.featureId}`, async () => {
      await setBinding(change.featureId, to.id, { actor: SEED_ACTOR, action: "seed-upgrade" });
      return "upgraded";
    });
    if (outcome === "upgraded") moved += 1;
  }
  return moved;
}
