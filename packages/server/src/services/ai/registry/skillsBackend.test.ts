import { describe, expect, it } from "bun:test";
import { CompositeBackend, StateBackend, createSkillsMiddleware } from "deepagents";

import { RegistrySkillsBackend, skillFiles } from "./skillsBackend";
import type { SkillDef } from "./types";

function skill(path: string, name: string, extra: Record<string, string> = {}): SkillDef {
  return {
    id: name,
    name,
    path,
    description: `${name} description`,
    skillMd: `---\nname: ${name}\ndescription: ${name} description\n---\n\nBody of ${name}.\n`,
    files: extra,
    enabled: true,
    isSystem: true,
    seedHash: null,
    customized: false,
    version: 1,
    createdBy: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

const files = skillFiles([
  skill("ai-chat/data-exploration", "data-exploration"),
  skill("ai-optimizer/optimizer", "query-optimizer"),
  skill("references/clickhouse-playbook", "clickhouse-playbook", { "reference.md": "# Playbook\nargMax line\n" }),
]);

describe("RegistrySkillsBackend", () => {
  const backend = new RegistrySkillsBackend(files);

  it("lists directories and files like DeepAgents' in-memory backend", () => {
    expect(backend.ls("/").files?.map((f) => f.path)).toEqual(["/ai-chat/", "/ai-optimizer/", "/references/"]);
    expect(backend.ls("/ai-chat").files).toEqual([{ path: "/ai-chat/data-exploration/", is_dir: true, size: 0, modified_at: new Date(0).toISOString() }]);
    // localeCompare ordering, as DeepAgents' own backends sort.
    expect(backend.ls("/references/clickhouse-playbook/").files?.map((f) => f.path)).toEqual([
      "/references/clickhouse-playbook/reference.md",
      "/references/clickhouse-playbook/SKILL.md",
    ]);
  });

  it("reads with offset/limit and reports missing files", () => {
    expect(backend.read("/references/clickhouse-playbook/reference.md").content).toBe("# Playbook\nargMax line\n");
    expect(backend.read("/references/clickhouse-playbook/reference.md", 1, 1).content).toBe("argMax line");
    expect(backend.read("/nope.md").error).toContain("not found");
    expect(backend.read("/references/clickhouse-playbook/reference.md", 99).error).toContain("exceeds");
  });

  it("greps literally and globs relative to the search path", () => {
    expect(backend.grep("argMax", "/references").matches).toEqual([
      { path: "/references/clickhouse-playbook/reference.md", line: 2, text: "argMax line" },
    ]);
    expect(backend.grep("Body", "/", "SKILL.md").matches?.length).toBe(3);
    expect(backend.glob("**/SKILL.md", "/ai-chat").files?.map((f) => f.path)).toEqual(["/ai-chat/data-exploration/SKILL.md"]);
  });

  it("rejects writes", () => {
    expect(backend.write().error).toContain("read-only");
    expect(backend.edit().error).toContain("read-only");
  });

  it("downloads files as bytes", () => {
    const [found, missing] = backend.downloadFiles(["/ai-chat/data-exploration/SKILL.md", "/x"]);
    expect(new TextDecoder().decode(found.content!)).toContain("Body of data-exploration");
    expect(missing.error).toBe("file_not_found");
  });

  it("is loadable by DeepAgents' skills loader when mounted at /skills/", async () => {
    // Regression: the pre-registry engine mounted its skills at "/skills" (no
    // trailing slash), which made CompositeBackend build "//group/..." paths and
    // silently load zero skills. The trailing slash is required.
    const composite = new CompositeBackend(new StateBackend(), { "/skills/": backend });
    const listed = await composite.ls("/skills/ai-optimizer/");
    expect(listed.files?.map((f) => f.path)).toEqual(["/skills/ai-optimizer/optimizer/"]);
    const read = await composite.read("/skills/ai-optimizer/optimizer/SKILL.md");
    expect(String(read.content)).toContain("name: query-optimizer");

    const middleware = createSkillsMiddleware({ backend: composite, sources: ["/skills/ai-chat", "/skills/ai-optimizer", "/skills/references"] }) as unknown as {
      beforeAgent: (state: unknown) => Promise<{ skillsMetadata?: Array<{ name: string; path: string }> }>;
    };
    const loaded = await middleware.beforeAgent({});
    expect(loaded.skillsMetadata?.map((s) => `${s.name}@${s.path}`)).toEqual([
      "data-exploration@/skills/ai-chat/data-exploration/SKILL.md",
      "query-optimizer@/skills/ai-optimizer/optimizer/SKILL.md",
      "clickhouse-playbook@/skills/references/clickhouse-playbook/SKILL.md",
    ]);
  });
});
