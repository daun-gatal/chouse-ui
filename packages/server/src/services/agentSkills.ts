import { promises as fs } from "node:fs";
import { tool } from "ai";
import { z } from "zod";

export interface SkillMetadata {
    name: string;
    description: string;
    path: string;
}

export async function discoverSkills(directories: string[]): Promise<SkillMetadata[]> {
    const skills: SkillMetadata[] = [];

    for (const dirUrl of directories) {
        try {
            const url = new URL(dirUrl, import.meta.url);
            const entries = await fs.readdir(url.pathname, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const skillDir = `${url.pathname}/${entry.name}`;
                const skillFile = `${skillDir}/SKILL.md`;

                try {
                    const content = await fs.readFile(skillFile, "utf-8");
                    const frontmatter = parseFrontmatter(content);

                    skills.push({
                        name: frontmatter.name,
                        description: frontmatter.description,
                        path: skillDir,
                    });
                } catch (e) {
                    continue; // Skip if no valid SKILL.md
                }
            }
        } catch (e) {
            continue; // Skip if directory doesn't exist
        }
    }

    return skills;
}

function parseFrontmatter(content: string): { name: string; description: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match?.[1]) throw new Error("No frontmatter found");

    const yamlContent = match[1];
    const nameMatch = yamlContent.match(/name:\s*(.+)/);
    const descMatch = yamlContent.match(/description:\s*(.+)/);

    if (!nameMatch || !descMatch) {
        throw new Error("Missing name or description in SKILL.md");
    }

    return { name: nameMatch[1].trim(), description: descMatch[1].trim() };
}

export function stripFrontmatter(content: string): string {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? content.slice(match[0].length).trim() : content.trim();
}

/**
 * Creates a tool for the agent to use to dynamically load complex instructions.
 */
export function createLoadSkillTool(skills: SkillMetadata[]) {
    return tool({
        description: "MANDATORY: Use this tool to load a skill from the filesystem to pull specialized instructions into your context before performing complex actions (like charting or analyzing).",
        inputSchema: z.object({
            name: z.string().describe("The name of the skill to load (e.g. 'data-visualization')"),
        }),
        execute: async ({ name }) => {
            const skill = skills.find(s => s.name.toLowerCase() === name.toLowerCase());
            if (!skill) {
                return { error: `Skill '${name}' not found. Available skills: ${skills.map(s => s.name).join(", ")}` };
            }

            const skillFile = `${skill.path}/SKILL.md`;
            try {
                const content = await fs.readFile(skillFile, "utf-8");
                return {
                    skillLoaded: skill.name,
                    instructions: stripFrontmatter(content),
                };
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return { error: `Failed to load skill: ${errorMessage}` };
            }
        },
    });
}
