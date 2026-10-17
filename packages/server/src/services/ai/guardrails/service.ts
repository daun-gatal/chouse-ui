/**
 * Guardrail management (ADR 0022 §7): the operations behind AI Governance ›
 * Guardrails. Guardrails are registry rows, so every write is validated,
 * recorded as a revision and bumps the registry version (ADR 0019).
 */

import { randomUUID } from "crypto";

import { AppError } from "../../../types";
import { getCapability } from "../capabilities";
import { resetRegistryCache } from "../registry/cache";
import * as store from "../registry/store";
import { seedHash } from "../seeds";
import { SEED_GUARDRAILS, type SeedGuardrail } from "../seeds/guardrails";
import { guardrailProblems } from "./kinds";
import type { GuardrailDef, GuardrailMode } from "./types";

type Row = Omit<GuardrailDef, "version" | "createdAt" | "updatedAt" | "createdBy">;
export type GuardrailInput = Omit<GuardrailDef, "id" | "isSystem" | "seedHash" | "customized" | "version" | "createdAt" | "updatedAt" | "createdBy">;

/** Fields whose change marks a built-in guardrail customized. */
const CONTENT_KEYS = ["slug", "name", "description", "kind", "config", "stages", "action", "scope"] as const;

export function guardrailSeedHash(seed: SeedGuardrail): string {
  const { defaults: _defaults, ...content } = seed;
  return seedHash(content);
}

export function guardrailRow(seed: SeedGuardrail, operational: Pick<GuardrailDef, "enabled" | "mode" | "position"> = seed.defaults): Row {
  const { defaults: _defaults, ...content } = seed;
  return { ...content, scope: { ...content.scope }, ...operational, isSystem: true, seedHash: guardrailSeedHash(seed), customized: false };
}

/** Validate a guardrail against its kind and the registry (agents, features, judge model). */
async function check(input: Row, snapshot: Awaited<ReturnType<typeof store.loadSnapshot>>): Promise<void> {
  const problems = guardrailProblems(input);
  for (const g of snapshot.guardrails.values()) {
    if (g.id !== input.id && g.slug === input.slug) problems.push(`Another guardrail already uses the slug '${input.slug}'`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.slug)) problems.push("Slugs use lowercase letters, digits and dashes");
  if (input.scope.agents !== "all") {
    for (const id of input.scope.agents) if (!snapshot.agents.has(id)) problems.push(`Unknown agent '${id}' in the scope`);
    if (input.scope.agents.length === 0) problems.push("Choose at least one agent, or all agents");
  }
  if (input.scope.features !== "all") {
    for (const id of input.scope.features) if (!getCapability(id)) problems.push(`Unknown AI feature '${id}' in the scope`);
    if (input.scope.features.length === 0) problems.push("Choose at least one feature, or all features");
  }
  if (input.kind === "judge" && input.enabled) {
    const modelConfigId = (input.config as { modelConfigId?: unknown }).modelConfigId;
    if (typeof modelConfigId === "string") {
      const { getAiConfigById } = await import("../../../rbac/services/aiModels");
      const config = await getAiConfigById(modelConfigId);
      if (!config || !config.isActive) problems.push("The judge model does not exist or is not active");
    }
  }
  if (problems.length > 0) throw AppError.badRequest(problems.join("; "), { problems });
}

function done<T>(value: T): T {
  resetRegistryCache();
  return value;
}

export async function createGuardrail(input: GuardrailInput, actor: string | null): Promise<GuardrailDef> {
  const snapshot = await store.loadSnapshot();
  const row: Row = { ...input, id: randomUUID(), isSystem: false, seedHash: null, customized: false };
  await check(row, snapshot);
  return done(await store.saveGuardrail(row, { actor, action: "create" }));
}

export async function updateGuardrail(id: string, input: GuardrailInput, expectedVersion: number, actor: string | null): Promise<GuardrailDef> {
  const snapshot = await store.loadSnapshot();
  const existing = snapshot.guardrails.get(id);
  if (!existing) throw AppError.notFound("Guardrail not found");
  if (existing.isSystem && input.kind !== existing.kind) throw AppError.badRequest("Built-in guardrails keep their kind");
  const changed = CONTENT_KEYS.some((key) => JSON.stringify(existing[key]) !== JSON.stringify(input[key]));
  const row: Row = { ...existing, ...input, customized: existing.customized || (existing.isSystem && changed) };
  await check(row, snapshot);
  return done(await store.saveGuardrail(row, { actor, action: "update", expectedVersion }));
}

/** Flip shadow ↔ enforce or the enable switch without touching the content. */
export async function setGuardrailState(id: string, state: { mode?: GuardrailMode; enabled?: boolean }, expectedVersion: number, actor: string | null): Promise<GuardrailDef> {
  const snapshot = await store.loadSnapshot();
  const existing = snapshot.guardrails.get(id);
  if (!existing) throw AppError.notFound("Guardrail not found");
  const row: Row = { ...existing, mode: state.mode ?? existing.mode, enabled: state.enabled ?? existing.enabled };
  await check(row, snapshot);
  return done(await store.saveGuardrail(row, { actor, action: state.mode ? "mode" : "toggle", expectedVersion }));
}

/** Set positions from an ordered list of ids (every guardrail, in its new order). */
export async function reorderGuardrails(ids: string[], actor: string | null): Promise<GuardrailDef[]> {
  const snapshot = await store.loadSnapshot();
  const all = [...snapshot.guardrails.keys()];
  if (ids.length !== all.length || new Set(ids).size !== ids.length || ids.some((id) => !snapshot.guardrails.has(id))) {
    throw AppError.badRequest("Send every guardrail id exactly once, in the new order");
  }
  const saved: GuardrailDef[] = [];
  for (const [index, id] of ids.entries()) {
    const existing = snapshot.guardrails.get(id)!;
    const position = (index + 1) * 10;
    if (existing.position === position) {
      saved.push(existing);
      continue;
    }
    saved.push(await store.saveGuardrail({ ...existing, position }, { actor, action: "reorder", expectedVersion: existing.version }));
  }
  return done(saved);
}

export async function deleteGuardrail(id: string, expectedVersion: number, actor: string | null): Promise<void> {
  const snapshot = await store.loadSnapshot();
  const existing = snapshot.guardrails.get(id);
  if (!existing) throw AppError.notFound("Guardrail not found");
  if (existing.isSystem) throw AppError.badRequest("Built-in guardrails cannot be deleted. Disable it or reset it instead.");
  await store.deleteGuardrail(id, { actor, expectedVersion });
  done(undefined);
}

export async function resetGuardrail(id: string, actor: string | null): Promise<GuardrailDef> {
  const seed = SEED_GUARDRAILS.find((g) => g.id === id);
  if (!seed) throw AppError.badRequest("Only built-in guardrails can be reset");
  const snapshot = await store.loadSnapshot();
  const existing = snapshot.guardrails.get(id);
  const row = guardrailRow(seed, existing ? { enabled: existing.enabled, mode: existing.mode, position: existing.position } : seed.defaults);
  // Reset brings back the shipped content; a built-in judge left enabled without a model would fail every run.
  if (row.kind === "judge" && (row.config as { modelConfigId?: unknown }).modelConfigId === null) row.enabled = false;
  await check(row, snapshot);
  return done(await store.saveGuardrail(row, { actor, action: "reset", expectedVersion: existing?.version }));
}

export function guardrailUpdateAvailable(row: GuardrailDef): boolean {
  if (!row.customized) return false;
  const seed = SEED_GUARDRAILS.find((g) => g.id === row.id);
  return seed !== undefined && guardrailSeedHash(seed) !== row.seedHash;
}

/** Restore a guardrail from a revision snapshot, as a new version. */
export async function rollbackGuardrail(snapshotValue: GuardrailDef, actor: string | null): Promise<GuardrailDef> {
  const snapshot = await store.loadSnapshot();
  const current = snapshot.guardrails.get(snapshotValue.id);
  const { version: _v, createdAt: _c, updatedAt: _u, createdBy: _b, ...row } = snapshotValue;
  await check(row, snapshot);
  return done(await store.saveGuardrail(row, { actor, action: "rollback", expectedVersion: current?.version }));
}
