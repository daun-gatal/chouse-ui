/**
 * Read-only DeepAgents backend that serves registry skills (ADR 0019 §6).
 *
 * Mounted at `/skills/` through a CompositeBackend, so paths here are relative
 * to the mount: `/ai-chat/data-exploration/SKILL.md`. It mirrors the in-memory
 * semantics of DeepAgents' StateBackend (literal grep, glob relative to the
 * search path, offset/limit line reads) and rejects every write.
 */

import type {
  BackendProtocolV2,
  EditResult,
  FileData,
  FileDownloadResponse,
  FileInfo,
  GlobResult,
  GrepMatch,
  GrepResult,
  LsResult,
  ReadRawResult,
  ReadResult,
  WriteResult,
} from "deepagents";

import type { SkillDef } from "./types";

const READ_ONLY_ERROR = "Skills are read-only. Edit them in AI Governance › Assistant.";
const EMPTY_CONTENT_WARNING = "System reminder: File exists but has empty contents";

/** The virtual files for a set of skills, keyed by mount-relative path. */
export function skillFiles(skills: SkillDef[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const skill of skills) {
    const dir = `/${skill.path}`;
    files[`${dir}/SKILL.md`] = skill.skillMd;
    for (const [relative, content] of Object.entries(skill.files)) {
      files[`${dir}/${relative}`] = content;
    }
  }
  return files;
}

function normalizeDir(path: string | null | undefined): string {
  if (!path || path === "/") return "/";
  const withLead = path.startsWith("/") ? path : `/${path}`;
  return withLead.endsWith("/") ? withLead : `${withLead}/`;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export class RegistrySkillsBackend implements BackendProtocolV2 {
  private readonly files: Map<string, string>;
  private readonly stamp: string;

  constructor(files: Record<string, string>, modifiedAt = new Date(0).toISOString()) {
    this.files = new Map(Object.entries(files));
    this.stamp = modifiedAt;
  }

  ls(path: string): LsResult {
    const dir = normalizeDir(path);
    const infos: FileInfo[] = [];
    const subdirs = new Set<string>();
    for (const [key, content] of this.files) {
      if (!key.startsWith(dir)) continue;
      const relative = key.slice(dir.length);
      if (relative.includes("/")) {
        subdirs.add(`${dir}${relative.split("/")[0]}/`);
        continue;
      }
      infos.push({ path: key, is_dir: false, size: content.length, modified_at: this.stamp });
    }
    for (const subdir of subdirs) infos.push({ path: subdir, is_dir: true, size: 0, modified_at: this.stamp });
    infos.sort((a, b) => a.path.localeCompare(b.path));
    return { files: infos };
  }

  read(filePath: string, offset = 0, limit = 500): ReadResult {
    const content = this.files.get(filePath);
    if (content === undefined) return { error: `File '${filePath}' not found` };
    if (content.trim() === "") return { content: EMPTY_CONTENT_WARNING, mimeType: "text/markdown" };
    const lines = content.split("\n");
    if (offset >= lines.length) return { error: `Line offset ${offset} exceeds file length (${lines.length} lines)` };
    return { content: lines.slice(offset, offset + limit).join("\n"), mimeType: "text/markdown" };
  }

  readRaw(filePath: string): ReadRawResult {
    const content = this.files.get(filePath);
    if (content === undefined) return { error: `File '${filePath}' not found` };
    const data: FileData = { content, mimeType: "text/markdown", created_at: this.stamp, modified_at: this.stamp };
    return { data };
  }

  grep(pattern: string, path?: string | null, glob?: string | null): GrepResult {
    const dir = normalizeDir(path);
    const matcher = glob ? new Bun.Glob(glob) : null;
    const matches: GrepMatch[] = [];
    for (const [key, content] of this.files) {
      if (!key.startsWith(dir)) continue;
      if (matcher && !matcher.match(basename(key))) continue;
      content.split("\n").forEach((text, index) => {
        if (text.includes(pattern)) matches.push({ path: key, line: index + 1, text });
      });
    }
    return { matches };
  }

  glob(pattern: string, path = "/"): GlobResult {
    const dir = normalizeDir(path);
    const matcher = new Bun.Glob(pattern);
    const files: FileInfo[] = [];
    for (const [key, content] of this.files) {
      if (!key.startsWith(dir)) continue;
      const relative = key.slice(dir.length) || basename(key);
      if (matcher.match(relative)) files.push({ path: key, is_dir: false, size: content.length, modified_at: this.stamp });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files };
  }

  write(): WriteResult {
    return { error: READ_ONLY_ERROR };
  }

  edit(): EditResult {
    return { error: READ_ONLY_ERROR };
  }

  downloadFiles(paths: string[]): FileDownloadResponse[] {
    const encoder = new TextEncoder();
    return paths.map((path) => {
      const content = this.files.get(path);
      return content === undefined
        ? { path, content: null, error: "file_not_found" }
        : { path, content: encoder.encode(content), error: null };
    });
  }
}
