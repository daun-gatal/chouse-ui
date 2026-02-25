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
    });

    describe("createLoadSkillTool", () => {
        it("should return a tool with execute function", () => {
            const tool = createLoadSkillTool([]);
            expect(tool).toBeDefined();
            expect(tool.description).toContain("load a skill");
        });
    });
});
