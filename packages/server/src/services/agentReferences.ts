/**
 * Agent References — loadable ClickHouse reference docs (system-table column
 * reference, optimization playbook, type/codec guide).
 *
 * References are plain markdown under `packages/server/src/references/` (the
 * single source of truth). They are consumed two ways:
 *   1. On demand by the chat agent via the `load_reference` tool.
 *   2. As plain strings by the structured capabilities (diagnose/optimize-log/
 *      fleet-scan), which concatenate them into prompts — see `readReferenceSync`.
 *
 * Mirrors agentSkills.ts (discoverSkills / createLoadSkillTool).
 */

import { promises as fs, readFileSync } from "node:fs";
import { tool } from "ai";
import { z } from "zod";

export interface ReferenceMetadata {
  /** Stable id, derived from the filename without extension (e.g. "clickhouse-playbook"). */
  name: string;
  /** One-line description for the model — the doc's first non-empty line, truncated. */
  description: string;
  /** Absolute path to the .md file. */
  path: string;
}

/** Resolve the references directory relative to this module. */
function referencesUrl(dir: string): URL {
  return new URL(dir, import.meta.url);
}

/** Derive a one-line description from the first non-empty line of a doc. */
function deriveDescription(content: string): string {
  const firstLine = content.split("\n").find((l) => l.trim().length > 0) ?? "";
  const cleaned = firstLine.replace(/^#+\s*/, "").trim();
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}…` : cleaned;
}

/**
 * Discover reference docs in one or more directories (paths relative to this
 * module, e.g. "../references"). Graceful: skips unreadable files/dirs.
 */
export async function discoverReferences(directories: string[]): Promise<ReferenceMetadata[]> {
  const refs: ReferenceMetadata[] = [];

  for (const dirUrl of directories) {
    try {
      const url = referencesUrl(dirUrl);
      const entries = await fs.readdir(url.pathname, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const filePath = `${url.pathname}/${entry.name}`;
        try {
          const content = await fs.readFile(filePath, "utf-8");
          refs.push({
            name: entry.name.replace(/\.md$/, ""),
            description: deriveDescription(content),
            path: filePath,
          });
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return refs;
}

/**
 * Synchronously read a reference file by filename (e.g. "clickhouse-playbook.md")
 * relative to `packages/server/src/references/`. Returns "" on any error so a
 * missing file never crashes module load. Trimmed so prompt concatenation is
 * stable regardless of trailing newline in the file.
 */
export function readReferenceSync(filename: string): string {
  try {
    const url = referencesUrl(`../references/${filename}`);
    return readFileSync(url.pathname, "utf-8").trim();
  } catch {
    return "";
  }
}

/**
 * Build the `load_reference` tool over a set of discovered references — mirrors
 * createLoadSkillTool. Returns the doc body, or an error + the available names.
 */
export function createLoadReferenceTool(refs: ReferenceMetadata[]) {
  return tool({
    description:
      "Load a ClickHouse reference document (exact system.* column names, the optimization playbook, the type/codec guide) into your context before writing raw system.* SQL or grounding an optimization/schema recommendation.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("The reference to load (e.g. 'system-table-reference', 'clickhouse-playbook')."),
    }),
    execute: async ({ name }) => {
      const ref = refs.find((r) => r.name.toLowerCase() === name.toLowerCase());
      if (!ref) {
        return { error: `Reference '${name}' not found. Available: ${refs.map((r) => r.name).join(", ")}` };
      }
      try {
        const content = await fs.readFile(ref.path, "utf-8");
        return { referenceLoaded: ref.name, content: content.trim() };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { error: `Failed to load reference: ${msg}` };
      }
    },
  });
}
