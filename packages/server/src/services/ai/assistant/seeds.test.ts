/**
 * CHouse Assistant v3 as shipped (ADR 0025 §5): chat runs one main agent that
 * owns every write; its investigators read only; CHouse Admin is gone.
 */

import { describe, expect, it } from "bun:test";

import { ACTION_DEFINITIONS } from "../actions/definitions";
import { catalogTool } from "../registry/catalog";
import { MOVED_BINDINGS, RETIRED_AGENTS, SEED_AGENTS, SEED_BINDINGS, SEED_HARNESSES } from "../seeds";

const bySlug = (slug: string) => SEED_AGENTS.find((a) => a.slug === slug);
const INVESTIGATORS = ["clickhouse-data", "operations-analyst", "access-auditor", "platform-auditor"];

describe("CHouse Assistant v3 seeds", () => {
  it("binds chat to CHouse Assistant", () => {
    expect(SEED_BINDINGS.chat).toBe("chouse-assistant");
    expect(MOVED_BINDINGS).toEqual([{ featureId: "chat", fromSlug: "clickhouse-data" }]);
  });

  it("gives the assistant every write tool, its own tools and the investigators", () => {
    const assistant = bySlug("chouse-assistant");
    expect(assistant).toMatchObject({ kind: "agent", harness: "assistant", tuning: { memory: true } });
    for (const definition of ACTION_DEFINITIONS) expect(assistant?.tools).toContain(definition.name);
    for (const name of ["load_toolkit", "navigate", "open_entity", "fill_form", "whoami", "run_select_query", "render_chart"]) expect(assistant?.tools).toContain(name);
    expect(assistant?.subagents).toEqual(INVESTIGATORS);
    // Every tool it names exists in the catalog.
    for (const name of assistant?.tools ?? []) expect(catalogTool(name)).toBeDefined();
  });

  it("keeps the investigators read-only", () => {
    for (const slug of INVESTIGATORS) {
      const investigator = bySlug(slug);
      expect(investigator?.subagents).toEqual([]);
      for (const name of investigator?.tools ?? []) expect(catalogTool(name)?.access).toBe("read");
    }
  });

  it("lets the assistant delegate and plan, but not write files", () => {
    const harness = SEED_HARNESSES.find((h) => h.slug === "assistant");
    expect(harness?.excludedTools).not.toContain("task");
    expect(harness?.excludedTools).not.toContain("write_todos");
    for (const tool of ["write_file", "edit_file", "execute", "start_async_task"]) expect(harness?.excludedTools).toContain(tool);
  });

  it("retires CHouse Admin and the router", () => {
    expect(bySlug("chouse-admin")).toBeUndefined();
    expect(SEED_AGENTS.some((a) => a.kind === "router")).toBe(false);
    expect(RETIRED_AGENTS.map((r) => r.id)).toEqual(["builtin-agent-chouse-admin"]);
    const retired = RETIRED_AGENTS[0];
    for (const id of [...retired.replacedBy, retired.bindingsTo]) expect(SEED_AGENTS.some((a) => a.id === id)).toBe(true);
  });

  it("keeps writes with the assistant, and auto-triage's proposals with its own feature", () => {
    const writers = SEED_AGENTS.filter((a) => a.tools.some((name) => catalogTool(name)?.access === "write"));
    // Auto-triage runs without a person: its writes only ever become proposals (ADR 0024).
    expect(writers.map((a) => a.slug).sort()).toEqual(["chouse-assistant", "incident-triager"]);
  });
});
