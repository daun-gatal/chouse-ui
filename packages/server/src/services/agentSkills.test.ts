import { describe, it, expect } from "bun:test";
import { discoverSkills, stripFrontmatter, createLoadSkillTool } from "./agentSkills";

describe("agentSkills", () => {
    describe("stripFrontmatter", () => {
        it("should remove yaml frontmatter from content", () => {
            const content = `---
name: test-skill
description: this is a test
---
Here are the actual instructions`;

            const result = stripFrontmatter(content);
            expect(result).toBe("Here are the actual instructions");
        });

        it("should return content unchanged if no frontmatter", () => {
            const content = "Just some instructions";
            const result = stripFrontmatter(content);
            expect(result).toBe("Just some instructions");
        });
    });

    describe("discoverSkills", () => {
        // Without mocking fs, we can test that it doesn't throw on invalid paths
        it("should return empty array for invalid directories", async () => {
            const skills = await discoverSkills(["./non-existent-dir"]);
            expect(skills).toEqual([]);
        });

        it("discovers all chat skills (5 original + 3 diagnosis) with when_to_use", async () => {
            const skills = await discoverSkills(["../skills/ai-chat"]);
            expect(skills.length).toBe(8);
            expect(skills.map((s) => s.name).sort()).toEqual([
                "data-exploration",
                "data-visualization",
                "error-diagnosis",
                "parts-diagnosis",
                "query-optimization",
                "schema-diagnosis",
                "sql-generation",
                "system-troubleshooting",
            ]);
            for (const s of skills) {
                expect(Boolean(s.when_to_use && s.when_to_use.length > 0)).toBe(true);
            }
        });

        it("discovers optimizer skills with when_to_use", async () => {
            const skills = await discoverSkills(["../skills/ai-optimizer"]);
            expect(skills.map((s) => s.name).sort()).toEqual([
                "query-debugger",
                "query-evaluator",
                "query-optimizer",
            ]);
            for (const s of skills) expect(Boolean(s.when_to_use)).toBe(true);
        });
    });

    describe("frontmatter when_to_use", () => {
        it("strips the YAML block even with the extra when_to_use key", () => {
            const body = stripFrontmatter(
                "---\nname: x\ndescription: d\nwhen_to_use: w\n---\nBODY",
            );
            expect(body).toBe("BODY");
        });
    });

    describe("createLoadSkillTool", () => {
        it("should return a tool with execute function", () => {
            const tool = createLoadSkillTool([]);
            expect(tool).toBeDefined();
            expect(tool.description).toContain("load a skill");
        });
    });
});
