/**
 * Draft with AI (issue #381): evidence, mapping, safe fixes and the
 * completeness contract for agents, harnesses and skills, against the real
 * seeded registry.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, initializeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const { syncRegistrySeeds } = await import("./seedSync");
const { loadSnapshot } = await import("./store");
const { getCapability } = await import("../capabilities");
const drafting = await import("./drafting");
const { BUILTIN_TOOLS } = await import("./harness");

import type { AnyCapability } from "../types";
import type { AgentDraft, DraftContext, HarnessDraft, SkillDraft } from "./drafting";
import type { AgentInput, HarnessInput, SkillInput } from "./service";
import type { RegistrySnapshot } from "./types";

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

function context(overrides: Partial<DraftContext> = {}): DraftContext {
  return { snapshot, entityId: null, feature: null, models: [{ id: "model-1", label: "Model one" }], referenceLength: 0, ...overrides };
}

const GOOD_PROMPT = [
  "You are the Table Size Analyst for CHouse. Your job is to explain how much disk space ClickHouse tables use and why.",
  "Scope: table and database sizes, compression ratios and part counts. Out of scope: changing data, schema advice beyond size, and anything about users or permissions.",
  "Method:",
  "1. Call list_tables to find the tables the user means; ask when the name is ambiguous.",
  "2. Call get_table_size for each table to read rows, compressed and uncompressed bytes.",
  "3. Compare the numbers and explain the largest contributors in plain words.",
  "Safety: every tool is read-only. Never claim you changed anything and never invent numbers that a tool did not return.",
  "Output format: answer with a short summary first, then a Markdown table of table, rows, compressed size and ratio.",
].join("\n");

function goodAgent(overrides: Partial<AgentDraft> = {}): AgentDraft {
  return {
    summary: "A read-only analyst for table sizes.",
    name: "Table Size Analyst",
    slug: "table-size-analyst",
    description: "Answers how much space ClickHouse tables and databases use, and which tables grow fastest.",
    kind: "agent",
    systemPrompt: GOOD_PROMPT,
    taskTemplate: null,
    tools: { items: [{ name: "list_tables", why: "Find the tables" }, { name: "get_table_size", why: "Read sizes" }], emptyReason: null },
    skills: { items: [{ name: "clickhouse-playbook", mode: "progressive", pinnedFile: null, why: "Compression guidance" }], emptyReason: null },
    subagents: { items: [], emptyReason: "A single-purpose agent that answers itself." },
    harness: { slug: "focused", why: "One agent, no delegation" },
    model: { configId: null, why: "The default model is enough" },
    tuning: { stepBudget: 6, recursionLimit: null, timeoutMs: null, maxOutputTokens: null, why: "A few lookups per question" },
    suggestedSkills: [],
    ...overrides,
  };
}

function agentDraft(parsed: AgentDraft, ctx: DraftContext = context()): ReturnType<typeof drafting.finalizeDraft<AgentInput>> {
  return drafting.finalizeDraft<AgentInput>("agent", parsed, { goal: "Explain table sizes" }, ctx);
}

describe("agent drafts", () => {
  it("maps a complete draft with every section drafted and nothing to fix", () => {
    const result = agentDraft(goodAgent());
    expect(result.problems).toEqual([]);
    expect(Object.fromEntries(Object.entries(result.sections).map(([k, v]) => [k, v.state]))).toEqual({
      identity: "drafted", prompt: "drafted", tools: "drafted", skills: "drafted", subagents: "empty", settings: "drafted",
    });
    expect(result.sections.subagents.reason).toBe("A single-purpose agent that answers itself.");
    expect(result.input.enabled).toBe(false);
    expect(result.input.harnessId).toBe("builtin-harness-focused");
    expect(result.input.skills).toEqual([{ skillId: "builtin-skill-clickhouse-playbook", mode: "progressive", pinnedFile: null }]);
    expect(result.sections.tools.rationale).toEqual([{ subject: "list_tables", why: "Find the tables" }, { subject: "get_table_size", why: "Read sizes" }]);
  });

  it("drops hallucinated tools, skills and subagents, and says so", () => {
    const result = agentDraft(goodAgent({
      tools: { items: [{ name: "list_tables", why: "x" }, { name: "drop_table", why: "x" }, { name: "get_table_size", why: "y" }], emptyReason: null },
      skills: { items: [{ name: "made-up-skill", mode: "progressive", pinnedFile: null, why: "x" }], emptyReason: null },
      subagents: { items: [{ slug: "ghost-agent", why: "x" }, { slug: "sql-optimizer", why: "x" }], emptyReason: null },
    }));
    expect(result.input.tools).toEqual(["list_tables", "get_table_size"]);
    expect(result.input.skills).toEqual([]);
    expect(result.input.subagents).toEqual([]);
    expect(result.fixes.join("\n")).toContain("Dropped tool 'drop_table'");
    expect(result.fixes.join("\n")).toContain("Dropped skill 'made-up-skill'");
    expect(result.fixes.join("\n")).toContain("Dropped subagent 'ghost-agent'");
    // A feature agent cannot be a subagent.
    expect(result.fixes.join("\n")).toContain("Dropped subagent 'sql-optimizer'");
    // Everything was dropped and no reason was given: flagged, not silently empty.
    expect(result.sections.skills.state).toBe("attention");
    expect(result.sections.subagents.state).toBe("attention");
  });

  it("makes a taken or invalid slug unique and valid", () => {
    expect(agentDraft(goodAgent({ slug: "sql-optimizer" })).input.slug).toBe("sql-optimizer-2");
    expect(agentDraft(goodAgent({ slug: "Table Size!!" })).input.slug).toBe("table-size");
    expect(agentDraft(goodAgent({ slug: "task" })).input.slug).toBe("task-2");
  });

  it("recomputes required permissions from the tools", () => {
    const guarded = agentDraft(goodAgent({ tools: { items: [{ name: "list_users", why: "a" }, { name: "list_roles", why: "b" }], emptyReason: null } }));
    expect(guarded.input.requiredPermissions).toEqual(["roles:view", "users:view"]);
    const open = agentDraft(goodAgent({ tools: { items: [{ name: "list_users", why: "a" }, { name: "whoami", why: "b" }], emptyReason: null } }));
    expect(open.input.requiredPermissions).toEqual([]);
  });

  it("switches to a harness that keeps the task tool when there are subagents", () => {
    const result = agentDraft(goodAgent({
      subagents: { items: [{ slug: "access-auditor", why: "Delegates access questions" }], emptyReason: null },
      harness: { slug: "focused", why: "x" },
    }));
    expect(result.input.harnessId).toBe("builtin-harness-delegating");
    expect(result.fixes.join("\n")).toContain("hides task");
    expect(result.sections.settings.state).toBe("drafted");
  });

  it("clamps tuning into the registry limits and drops an unknown model", () => {
    const result = agentDraft(goodAgent({
      tuning: { stepBudget: 500, recursionLimit: 2, timeoutMs: null, maxOutputTokens: 10, why: "x" },
      model: { configId: "no-such-model", why: "x" },
    }));
    expect(result.input.tuning).toEqual({ stepBudget: 100, recursionLimit: 8, timeoutMs: null, maxOutputTokens: 256 });
    expect(result.input.modelConfigId).toBeNull();
    expect(result.fixes.join("\n")).toContain("Model 'no-such-model' is not configured");
    expect(agentDraft(goodAgent({ model: { configId: "model-1", why: "Pinned" } })).input.modelConfigId).toBe("model-1");
  });

  it("flags a weak identity", () => {
    const result = agentDraft(goodAgent({ description: "Sizes." }));
    expect(result.sections.identity.state).toBe("attention");
    expect(result.sections.identity.problems.join()).toContain("Description is too short");
  });

  it("flags a one-line or placeholder prompt", () => {
    const short = agentDraft(goodAgent({ systemPrompt: "You help with sizes." }));
    expect(short.sections.prompt.state).toBe("attention");
    expect(short.sections.prompt.problems.join("\n")).toContain("too short");
    const placeholder = agentDraft(goodAgent({ systemPrompt: `${GOOD_PROMPT}\nTODO: add examples` }));
    expect(placeholder.sections.prompt.problems.join("\n")).toContain("placeholder");
  });

  it("flags a prompt with no safety rules or output format", () => {
    const noRules = GOOD_PROMPT.split("\n").filter((line) => !line.startsWith("Safety") && !line.startsWith("Output")).join("\n").padEnd(500, " Keep the answer focused on sizes.");
    const result = agentDraft(goodAgent({ systemPrompt: noRules }));
    expect(result.sections.prompt.state).toBe("attention");
    expect(result.sections.prompt.problems.join("\n")).toContain("the output format");
  });

  it("requires a reason for an empty list, and accepts one", () => {
    const silent = agentDraft(goodAgent({ skills: { items: [], emptyReason: null } }));
    expect(silent.sections.skills.state).toBe("attention");
    const reasoned = agentDraft(goodAgent({ skills: { items: [], emptyReason: "No skill covers table sizes." } }));
    expect(reasoned.sections.skills).toMatchObject({ state: "empty", reason: "No skill covers table sizes." });
  });

  it("requires a reason for every pick and setting", () => {
    const result = agentDraft(goodAgent({
      tools: { items: [{ name: "list_tables", why: "" }, { name: "get_table_size", why: "Sizes" }], emptyReason: null },
      harness: { slug: "focused", why: " " },
    }));
    expect(result.sections.tools.problems).toEqual(["Give a reason for tool 'list_tables'"]);
    expect(result.sections.settings.state).toBe("attention");
  });

  it("requires a router to have subagents", () => {
    const result = agentDraft(goodAgent({ kind: "router", tools: { items: [], emptyReason: "Routers only delegate." } }));
    expect(result.sections.subagents.state).toBe("attention");
    expect(result.sections.subagents.problems.join()).toContain("A router needs at least one subagent");
  });

  it("removes a task template from an agent drafted without a feature", () => {
    const result = agentDraft(goodAgent({ taskTemplate: "Explain {{ctx.query}}" }));
    expect(result.input.taskTemplate).toBeNull();
    expect(result.fixes.join()).toContain("Removed the task template");
  });

  describe("for a feature", () => {
    const feature = (): AnyCapability => getCapability("optimize-query")!;
    const taskTemplate = "Optimize:\n```sql\n{{ctx.query}}\n```{{#ctx.additionalPrompt}}\nAlso: {{ctx.additionalPrompt}}{{/ctx.additionalPrompt}}";

    it("accepts a task template that uses the feature's variables", () => {
      const result = agentDraft(goodAgent({ taskTemplate }), context({ feature: feature() }));
      expect(result.sections.prompt.state).toBe("drafted");
      expect(result.input.taskTemplate).toBe(taskTemplate);
    });

    it("rejects unknown template variables", () => {
      const result = agentDraft(goodAgent({ taskTemplate: `${taskTemplate}\n{{ctx.tableName}}` }), context({ feature: feature() }));
      expect(result.sections.prompt.state).toBe("attention");
      expect(result.sections.prompt.problems.join("\n")).toContain("{{ctx.tableName}}");
    });

    it("requires a task template and every variable the feature supplies", () => {
      expect(agentDraft(goodAgent({ taskTemplate: null }), context({ feature: feature() })).sections.prompt.problems.join()).toContain("A task template is required");
      const partial = agentDraft(goodAgent({ taskTemplate: "Optimize {{ctx.query}}" }), context({ feature: feature() }));
      expect(partial.sections.prompt.problems.join()).toContain("{{ctx.additionalPrompt}}");
    });

    it("drops tools that need a context the feature does not provide", () => {
      const result = agentDraft(goodAgent({
        taskTemplate,
        tools: { items: [{ name: "list_tables", why: "a" }, { name: "list_users", why: "b" }], emptyReason: null },
      }), context({ feature: feature() }));
      expect(result.input.tools).toEqual(["list_tables"]);
      expect(result.fixes.join()).toContain("Dropped tool 'list_users'");
    });
  });

  it("shows only real, read-only tools, existing skills and possible subagents in the evidence", () => {
    const evidence = drafting.agentEvidence({ goal: "x" }, context());
    const tools = evidence.tools as Array<{ name: string }>;
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.every((t) => typeof t.name === "string")).toBe(true);
    expect((evidence.skills as Array<{ name: string }>).map((s) => s.name)).toContain("clickhouse-playbook");
    const candidates = (evidence.subagentCandidates as Array<{ slug: string }>).map((a) => a.slug);
    expect(candidates).toContain("access-auditor");
    expect(candidates).not.toContain("sql-optimizer");
    expect(evidence.takenSlugs).toContain("sql-optimizer");
    // Models are named, never described with their provider credentials.
    expect(evidence.models).toEqual([{ id: "model-1", label: "Model one" }]);
    expect(JSON.stringify(evidence)).not.toMatch(/"(apiKey|password|secret|token)"\s*:/i);
  });
});

function goodHarness(overrides: Partial<HarnessDraft> = {}): HarnessDraft {
  return {
    summary: "Terse and filesystem-free.",
    name: "Terse",
    slug: "terse",
    description: "For single agents that answer briefly: no planning, no delegation, no file writes.",
    builtinTools: BUILTIN_TOOLS.map((tool) => ({ name: tool.name, enabled: tool.name === "read_file", why: tool.name === "read_file" ? "Skills are read with it" : "Not needed" })),
    generalPurpose: { enabled: false, description: null, systemPrompt: null, why: "No delegation" },
    promptSuffix: { text: "Answer in at most three sentences.", emptyReason: null },
    toolDescriptionOverrides: { items: [], emptyReason: "The default descriptions are clear." },
    ...overrides,
  };
}

function harnessDraft(parsed: HarnessDraft, ctx: DraftContext = context()): ReturnType<typeof drafting.finalizeDraft<HarnessInput>> {
  return drafting.finalizeDraft<HarnessInput>("harness", parsed, { goal: "Terse agents" }, ctx);
}

describe("harness drafts", () => {
  it("maps a complete draft with a decision for every built-in tool", () => {
    const result = harnessDraft(goodHarness());
    expect(result.problems).toEqual([]);
    expect(Object.values(result.sections).map((s) => s.state)).toEqual(["drafted", "drafted", "drafted", "drafted", "empty"]);
    expect(result.input.excludedTools).toHaveLength(BUILTIN_TOOLS.length - 1);
    expect(result.input.excludedTools).not.toContain("read_file");
  });

  it("flags a built-in tool with no decision", () => {
    const result = harnessDraft(goodHarness({ builtinTools: goodHarness().builtinTools.filter((t) => t.name !== "grep") }));
    expect(result.sections.builtinTools.state).toBe("attention");
    expect(result.sections.builtinTools.problems).toEqual(["No on/off decision for the built-in tool 'grep'"]);
  });

  it("needs a description and prompt for an enabled general-purpose subagent", () => {
    const result = harnessDraft(goodHarness({ generalPurpose: { enabled: true, description: null, systemPrompt: null, why: "Hand off" } }));
    expect(result.sections.generalPurpose.state).toBe("attention");
    expect(result.sections.generalPurpose.problems.join()).toContain("needs a description");
  });

  it("accepts no prompt suffix only with a reason", () => {
    expect(harnessDraft(goodHarness({ promptSuffix: { text: null, emptyReason: null } })).sections.promptSuffix.state).toBe("attention");
    expect(harnessDraft(goodHarness({ promptSuffix: { text: null, emptyReason: "The agents' prompts are enough." } })).sections.promptSuffix.state).toBe("empty");
  });

  it("drops overrides for hidden or unknown tools and uniquifies the slug", () => {
    const result = harnessDraft(goodHarness({
      slug: "focused",
      toolDescriptionOverrides: { items: [{ tool: "grep", description: "x", why: "y" }, { tool: "nope", description: "x", why: "y" }, { tool: "read_file", description: "Open a skill file.", why: "Clearer" }], emptyReason: null },
    }));
    expect(result.input.slug).toBe("focused-2");
    expect(result.input.toolDescriptionOverrides).toEqual({ read_file: "Open a skill file." });
    expect(result.fixes.join("\n")).toContain("'grep': the harness hides that tool");
    expect(result.fixes.join("\n")).toContain("'nope': no such tool");
  });
});

const GOOD_BODY = [
  "## When to use",
  "Use this skill when inserts fail with TOO_MANY_PARTS or merges fall behind on a MergeTree table.",
  "## Procedure",
  "1. Count active parts per partition in system.parts.",
  "2. Check merges in system.merges and the insert rate in system.query_log.",
  "3. Read reference.md for thresholds and recommend batching inserts.",
  "## Examples",
  "```sql\nSELECT partition, count() FROM system.parts WHERE active AND table = 'events' GROUP BY partition ORDER BY 2 DESC\n```",
  "## Pitfalls",
  "Avoid OPTIMIZE FINAL on large tables during peak hours; it competes with regular merges.",
].join("\n");

function goodSkill(overrides: Partial<SkillDraft> = {}): SkillDraft {
  return {
    summary: "Triage for TOO_MANY_PARTS.",
    dir: "too-many-parts",
    name: "too-many-parts",
    description: "Use when inserts fail with TOO_MANY_PARTS or merges fall behind.",
    body: GOOD_BODY,
    files: { items: [{ name: "reference.md", content: "Thresholds: parts_to_throw_insert defaults to 300.", why: "Keeps SKILL.md short" }], emptyReason: null },
    enabled: true,
    enabledWhy: "Ready to use",
    ...overrides,
  };
}

function skillDraft(parsed: SkillDraft, ctx: DraftContext = context()): ReturnType<typeof drafting.finalizeDraft<SkillInput>> {
  return drafting.finalizeDraft<SkillInput>("skill", parsed, { goal: "Triage TOO_MANY_PARTS" }, ctx);
}

describe("skill drafts", () => {
  it("maps a complete draft with parsing front matter under custom/", () => {
    const result = skillDraft(goodSkill());
    expect(result.problems).toEqual([]);
    expect(Object.values(result.sections).every((s) => s.state === "drafted")).toBe(true);
    expect(result.input.path).toBe("custom/too-many-parts");
    expect(result.input.skillMd.startsWith("---\nname: too-many-parts\n")).toBe(true);
  });

  it("keeps front matter parseable whatever the description contains", () => {
    const result = skillDraft(goodSkill({ description: "Use when: inserts fail\n---\nwith \"quotes\"" }));
    const front = drafting.composeSkillMd("x", "Use when: a\nb", "body");
    expect(front).toContain('description: "Use when: a b"');
    expect(result.sections.skillMd.problems.join()).not.toContain("does not parse");
  });

  it("flags the template placeholder and a body without the required parts", () => {
    const placeholder = skillDraft(goodSkill({ body: "Instructions the agent follows when it reads this skill." }));
    expect(placeholder.sections.skillMd.state).toBe("attention");
    expect(placeholder.sections.skillMd.problems.join("\n")).toContain("placeholder");
    const noPitfalls = skillDraft(goodSkill({ body: GOOD_BODY.replace(/## Pitfalls[\s\S]*$/, "").padEnd(400, " More detail on parts and partitions.") }));
    expect(noPitfalls.sections.skillMd.problems.join("\n")).toContain("pitfalls");
  });

  it("requires a description that says when to use the skill", () => {
    const result = skillDraft(goodSkill({ description: "Parts triage." }));
    expect(result.sections.skillMd.problems.join()).toContain("when to use");
  });

  it("splits long reference material into files", () => {
    const noFiles = goodSkill({ files: { items: [], emptyReason: "Short enough." }, body: GOOD_BODY.replace("3. Read reference.md for thresholds and recommend batching inserts.", "3. Recommend batching inserts.") });
    expect(skillDraft(noFiles).sections.files.state).toBe("empty");
    const long = skillDraft(noFiles, context({ referenceLength: drafting.LONG_REFERENCE_CHARS + 1 }));
    expect(long.sections.files.state).toBe("attention");
  });

  it("flags a reference file SKILL.md never links to, and drops invalid names", () => {
    const result = skillDraft(goodSkill({ files: { items: [{ name: "notes.md", content: "x", why: "y" }, { name: "../evil.md", content: "x", why: "y" }], emptyReason: null } }));
    expect(Object.keys(result.input.files)).toEqual(["notes.md"]);
    expect(result.sections.files.problems.join()).toContain("never mentions 'notes.md'");
  });

  it("renames a taken name and path", () => {
    const result = skillDraft(goodSkill({ name: "clickhouse-playbook", dir: "clickhouse-playbook" }));
    expect(drafting.skillBody(result.input.skillMd)).toBe(GOOD_BODY);
    expect(result.input.skillMd).toContain("name: clickhouse-playbook-2");
    expect(result.input.path).toBe("custom/clickhouse-playbook");
  });
});

describe("redraft and refine", () => {
  it("takes only the requested sections from a redraft and keeps the rest", () => {
    const first = agentDraft(goodAgent({ description: "Sizes." }));
    expect(first.sections.identity.state).toBe("attention");
    const redraft = drafting.finalizeDraft<AgentInput>("agent", goodAgent({ systemPrompt: "Changed prompt that must not be used." }), {
      current: first.input,
      currentMeta: first.meta,
      sections: ["identity"],
      feedback: { identity: first.sections.identity.problems },
    }, context());
    expect(redraft.mode).toBe("redraft");
    expect(redraft.input.description).toBe(goodAgent().description);
    expect(redraft.input.systemPrompt).toBe(GOOD_PROMPT);
    expect(redraft.sections.identity.state).toBe("drafted");
    expect(redraft.sections.subagents.reason).toBe("A single-purpose agent that answers itself.");
  });

  it("keeps a stored custom entity's slug and enabled switch when refining it", () => {
    const stored = [...snapshot.agents.values()].find((a) => a.slug === "access-auditor")!;
    const custom = { ...stored, id: "custom-agent", slug: "my-auditor", isSystem: false, enabled: true };
    const ctx = context({ snapshot: { ...snapshot, agents: new Map([...snapshot.agents, [custom.id, custom]]) }, entityId: custom.id });
    const result = drafting.finalizeDraft<AgentInput>("agent", goodAgent({ slug: "something-else" }), { current: custom, instruction: "Be stricter" }, ctx);
    expect(result.mode).toBe("refine");
    expect(result.input.slug).toBe("my-auditor");
    expect(result.input.enabled).toBe(true);
  });

  it("validates the request shape", () => {
    const schema = drafting.draftRequestSchema(drafting.SkillDraftSchema, drafting.SKILL_SECTIONS);
    expect(schema.safeParse({ goal: "short" }).success).toBe(false);
    expect(schema.safeParse({ goal: "Triage TOO_MANY_PARTS errors" }).success).toBe(true);
    expect(schema.safeParse({ instruction: "Make it stricter" }).success).toBe(false);
    expect(schema.safeParse({ goal: "x".repeat(drafting.LIMITS.goal + 1) }).success).toBe(false);
    expect(schema.safeParse({ goal: "Triage parts", reference: "x".repeat(drafting.LIMITS.reference + 1) }).success).toBe(false);
  });
});
