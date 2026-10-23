/**
 * Skill-scoped tools (ADR 0024 §Phase 1): a skill lists catalog tools in its
 * SKILL.md front matter as `metadata.include_tools` (space-separated, the
 * DeepAgents format, or a YAML flow list). The agent sees them only after it
 * reads the skill.
 */

const FRONT_MATTER = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

/** Tool names a SKILL.md lists under `metadata.include_tools`, in order, without duplicates. */
export function skillIncludeTools(skillMd: string): string[] {
  const match = FRONT_MATTER.exec(skillMd);
  if (!match) return [];
  const lines = match[1].split("\n");
  const start = lines.findIndex((line) => /^metadata:\s*$/.test(line));
  if (start < 0) return [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const field = /^\s+include_tools:\s*(.*)$/.exec(line);
    if (!field) continue;
    const raw = field[1].trim().replace(/^\[|\]$/g, "");
    const names = raw.split(/[\s,]+/).map((name) => name.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    return [...new Set(names)];
  }
  return [];
}

/** Replace (or add, or remove when empty) `metadata.include_tools` in a SKILL.md, keeping everything else. */
export function withSkillIncludeTools(skillMd: string, tools: string[]): string {
  const match = FRONT_MATTER.exec(skillMd);
  const value = [...new Set(tools.map((t) => t.trim()).filter(Boolean))].join(" ");
  if (!match) return skillMd;
  const lines = match[1].split("\n");
  const start = lines.findIndex((line) => /^metadata:\s*$/.test(line));
  if (start < 0) {
    if (!value) return skillMd;
    lines.push("metadata:", `  include_tools: ${value}`);
  } else {
    let end = start + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end += 1;
    const block = lines.slice(start + 1, end).filter((line) => !/^\s+include_tools:/.test(line));
    if (value) block.push(`  include_tools: ${value}`);
    lines.splice(start, end - start, ...(block.length > 0 ? ["metadata:", ...block] : []));
  }
  return skillMd.replace(match[0], `---\n${lines.join("\n")}\n---\n`);
}
