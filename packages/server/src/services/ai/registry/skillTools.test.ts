import { describe, expect, it } from "bun:test";

import { skillIncludeTools, withSkillIncludeTools } from "./skillTools";

const SKILL = `---
name: query-optimization
description: Tune slow queries
metadata:
  author: chouse
  include_tools: explain_query analyze_query
---
# Body
`;

describe("skillIncludeTools", () => {
  it("reads the space-separated DeepAgents form", () => {
    expect(skillIncludeTools(SKILL)).toEqual(["explain_query", "analyze_query"]);
  });

  it("reads a YAML flow list and drops duplicates", () => {
    const md = SKILL.replace("include_tools: explain_query analyze_query", "include_tools: [explain_query, 'analyze_query', explain_query]");
    expect(skillIncludeTools(md)).toEqual(["explain_query", "analyze_query"]);
  });

  it("is empty without front matter, metadata or the field", () => {
    expect(skillIncludeTools("# no front matter")).toEqual([]);
    expect(skillIncludeTools("---\nname: x\ndescription: y\n---\n")).toEqual([]);
    expect(skillIncludeTools("---\nname: x\nmetadata:\n  author: me\n---\n")).toEqual([]);
  });

  it("does not read a field outside the metadata block", () => {
    expect(skillIncludeTools("---\nname: x\nmetadata:\n  author: me\ninclude_tools: a b\n---\n")).toEqual([]);
  });
});

describe("withSkillIncludeTools", () => {
  it("replaces the list and keeps the rest of the file", () => {
    const next = withSkillIncludeTools(SKILL, ["get_slow_queries"]);
    expect(skillIncludeTools(next)).toEqual(["get_slow_queries"]);
    expect(next).toContain("  author: chouse");
    expect(next).toContain("# Body");
  });

  it("adds a metadata block when there is none, and removes an emptied one", () => {
    const plain = "---\nname: x\ndescription: y\n---\nBody\n";
    const added = withSkillIncludeTools(plain, ["explain_query"]);
    expect(skillIncludeTools(added)).toEqual(["explain_query"]);
    expect(added.endsWith("Body\n")).toBe(true);
    const removed = withSkillIncludeTools(added, []);
    expect(removed).not.toContain("metadata:");
    expect(removed).toBe(plain);
  });

  it("keeps other metadata when the list is cleared", () => {
    const cleared = withSkillIncludeTools(SKILL, []);
    expect(cleared).toContain("metadata:\n  author: chouse");
    expect(cleared).not.toContain("include_tools");
  });

  it("leaves a file without front matter alone", () => {
    expect(withSkillIncludeTools("# none", ["a"])).toBe("# none");
  });
});
