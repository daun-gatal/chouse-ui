/**
 * Parity gate (ADR 0019 §8): the seeded registry must reproduce every AI
 * feature exactly as the pre-registry, code-defined capabilities ran it.
 *
 * `parity.fixture.json` was captured from the capability code before the
 * cut-over (same sample inputs): rendered system prompt, first user message,
 * formatter-fallback messages, tools (name, description, input schema),
 * tuning, harness profile, skill sources and skill files. Here every feature is
 * rebuilt from the seeded registry and compared field by field.
 *
 * Intentional, documented differences (not compared here):
 * - skills now load (the old engine mounted them at "/skills" without the
 *   trailing slash, so DeepAgents loaded none) — see skillsBackend.test.ts;
 * - the harness suffix follows the agent prompt instead of DeepAgents' base
 *   prompt (profiles are process-global and cannot be per agent).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { toJsonSchema } from "@langchain/core/utils/json_schema";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, initializeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const { syncRegistrySeeds } = await import("./seedSync");
const { loadSnapshot } = await import("./store");
const { CAPABILITIES } = await import("../capabilities");
const { boundAgent } = await import("../engine");
const { featureRuntime, renderAgentPrompts, renderTaskMessage, skillSources } = await import("./builder");
const { buildGrantedTools } = await import("./catalog");
const { skillFiles } = await import("./skillsBackend");

import type { AgentRunContext, AnyCapability } from "../types";
import type { RegistrySnapshot } from "./types";

interface FixtureTool { name: string; description: string; schema: unknown }
interface FixtureCase {
  name: string;
  session: boolean;
  prepared: unknown;
  instructions: string;
  messages: Array<{ role: string; content: string }> | null;
  fallbackMessages: Array<{ role: string; content: string }> | null;
  tools: FixtureTool[];
}
interface Fixture {
  skillSources: string[];
  harness: { excludedTools: string[]; generalPurposeSubagent: boolean; systemPromptSuffix: string };
  skills: Record<string, string>;
  capabilities: Record<string, { permission: string; delivery: string; tuning: { stopAtSteps?: number; maxOutputTokens?: number } | null; cases: FixtureCase[] }>;
}

const fixture = JSON.parse(readFileSync(path.join(import.meta.dir, "parity.fixture.json"), "utf-8")) as Fixture;

function ctxFor(session: boolean): AgentRunContext {
  return {
    userId: "user-1",
    isAdmin: true,
    permissions: [],
    connectionId: "conn-1",
    clickhouseService: session ? ({} as never) : undefined,
    defaultDatabase: "default",
  };
}

function toolInfo(tools: Array<{ name: string; description: string; schema: unknown }>): FixtureTool[] {
  return tools
    .map((t) => ({ name: t.name, description: t.description, schema: toJsonSchema(t.schema as never) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

let snapshot: RegistrySnapshot;

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
  await syncRegistrySeeds();
  snapshot = await loadSnapshot();
});

afterAll(async () => {
  await closeDatabase();
});

describe("registry parity with the pre-registry capabilities", () => {
  it("covers every feature, and only those", () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(Object.keys(fixture.capabilities).sort());
  });

  for (const [id, captured] of Object.entries(fixture.capabilities)) {
    describe(id, () => {
      it("keeps permission, delivery and tuning", () => {
        const cap = (CAPABILITIES as Record<string, AnyCapability>)[id];
        const agent = boundAgent(snapshot, id);
        expect(cap.permission).toBe(captured.permission);
        expect(cap.delivery).toBe(captured.delivery);
        expect(agent.tuning.stepBudget).toBe(captured.tuning?.stopAtSteps ?? 10);
        expect(agent.tuning.maxOutputTokens ?? null).toBe(captured.tuning?.maxOutputTokens ?? null);
      });

      it("keeps the harness profile and skill set", () => {
        const agent = boundAgent(snapshot, id);
        const harness = snapshot.harnesses.get(agent.harnessId)!;
        expect(harness.excludedTools).toEqual(fixture.harness.excludedTools);
        expect(harness.generalPurpose.enabled).toBe(fixture.harness.generalPurposeSubagent);
        expect(harness.promptSuffix).toBe(fixture.harness.systemPromptSuffix);
        const { sources, skills } = skillSources(agent, snapshot);
        expect(sources).toEqual(fixture.skillSources.map((s) => s.replace(/\/$/, "")));
        expect(skillFiles(skills)).toEqual(fixture.skills);
        expect(agent.subagents).toEqual([]);
      });

      for (const c of captured.cases) {
        it(`reproduces prompt, task, fallback and tools (${c.name})`, () => {
          const cap = (CAPABILITIES as Record<string, AnyCapability>)[id];
          const ctx = ctxFor(c.session);
          const agent = boundAgent(snapshot, id);
          if (cap.delivery === "invoke") {
            expect(renderAgentPrompts(agent, {}, snapshot).system).toBe(c.instructions);
            expect(toolInfo(buildGrantedTools(agent.tools, featureRuntime(ctx, cap.contexts)))).toEqual(c.tools);
            return;
          }
          const variables = cap.templateVariables(c.prepared, ctx);
          const prompts = renderAgentPrompts(agent, variables, snapshot);
          expect(prompts.system).toBe(c.instructions);
          expect([{ role: "user", content: renderTaskMessage(agent, variables, snapshot) }]).toEqual(c.messages!);
          if (c.fallbackMessages) {
            expect(cap.fallbackMessages?.(c.prepared, ctx, "RAW NOTES", prompts)).toEqual(c.fallbackMessages);
          } else {
            expect(cap.fallbackMessages).toBeUndefined();
          }
          const runtime = featureRuntime(ctx, cap.contexts, cap.fleetNodes?.(c.prepared));
          expect(toolInfo(buildGrantedTools(agent.tools, runtime))).toEqual(c.tools);
        });
      }
    });
  }
});
