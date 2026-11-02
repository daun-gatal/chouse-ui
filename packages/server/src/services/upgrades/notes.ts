/**
 * Breaking-change notes for the upgrade check (ADR 0029 §3): the "Backward
 * Incompatible Change" entries of each release line, from ClickHouse's
 * CHANGELOG.md (current year) and the clickhouse-docs yearly changelogs
 * (earlier years). Cached per file for 24 hours.
 */

import { logger } from "../../utils/logger";
import { fetchSource, UpgradeSourceError } from "./fetch";
import { compareVersions } from "./versions";

const CHANGELOG_PATH = "/ClickHouse/ClickHouse/master/CHANGELOG.md";
const yearPath = (year: number): string => `/ClickHouse/clickhouse-docs/main/docs/whats-new/changelog/${year}.md`;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_NOTE_CHARS = 1500;

export interface ReleaseNote {
  /** Stable within a check: `<line>#<n>`. */
  id: string;
  line: string;
  date: string;
  text: string;
  prs: number[];
  /** Names written in backticks: settings, functions, types, engines, formats. */
  names: string[];
}

const RELEASE_HEADING = /^###\s+(?:<a id="[^"]*"><\/a>\s*)?ClickHouse release (?:v)?(\d{1,3}\.\d{1,2})(?: LTS)?,\s*(\d{4}-\d{2}-\d{2})/;
const BIC_HEADING = /^####\s+Backward Incompatible Change\s*$/;

/** Markdown links to plain text, PR links to `#123`, author credits removed. */
export function cleanNoteText(raw: string): string {
  return raw
    .replace(/\s*\(\[[^\]]*\]\(https:\/\/github\.com\/[^)\s]*\)(?:,\s*\[[^\]]*\]\(https:\/\/github\.com\/[^)\s]*\))*\)/g, "")
    .replace(/\[#(\d+)\]\([^)]*\)/g, "#$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NOTE_CHARS);
}

function prNumbers(raw: string): number[] {
  const out = new Set<number>();
  for (const m of raw.matchAll(/github\.com\/ClickHouse\/ClickHouse\/pull\/(\d{1,7})/g)) out.add(Number(m[1]));
  return [...out];
}

function backtickNames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]{1,80})`/g)) out.add(m[1].trim());
  return [...out];
}

/** Pure: every release line's breaking-change entries in one changelog file. */
export function parseChangelog(markdown: string): Map<string, { date: string; notes: ReleaseNote[] }> {
  const out = new Map<string, { date: string; notes: ReleaseNote[] }>();
  let release: { line: string; date: string; notes: ReleaseNote[] } | null = null;
  let inBic = false;
  let current: string[] | null = null;
  const flush = (): void => {
    if (release && current) {
      const raw = current.join(" ");
      const text = cleanNoteText(raw);
      if (text) {
        release.notes.push({ id: `${release.line}#${release.notes.length + 1}`, line: release.line, date: release.date, text, prs: prNumbers(raw), names: backtickNames(text) });
      }
    }
    current = null;
  };
  for (const row of markdown.split("\n")) {
    const heading = RELEASE_HEADING.exec(row);
    if (heading) {
      flush();
      const line = heading[1];
      release = out.has(line) ? null : { line, date: heading[2], notes: [] };
      if (release) out.set(line, release);
      inBic = false;
      continue;
    }
    if (/^#{1,4}\s/.test(row)) {
      flush();
      inBic = BIC_HEADING.test(row);
      continue;
    }
    if (!inBic || !release) continue;
    if (/^\* /.test(row)) {
      flush();
      current = [row.slice(2)];
    } else if (current && /^\s+\S/.test(row)) {
      current.push(row.trim());
    } else if (current && row.trim() === "") {
      flush();
    }
  }
  flush();
  return out;
}

const fileCache = new Map<string, { at: number; releases: Map<string, { date: string; notes: ReleaseNote[] }> }>();

/** For tests. */
export function resetNotesCache(): void {
  fileCache.clear();
}

async function loadFile(path: string, now: number): Promise<Map<string, { date: string; notes: ReleaseNote[] }>> {
  const hit = fileCache.get(path);
  if (hit && now - hit.at < TTL_MS) return hit.releases;
  const releases = parseChangelog(await fetchSource("github", path, 8_000_000));
  fileCache.set(path, { at: now, releases });
  return releases;
}

export interface NotesResult {
  notes: ReleaseNote[];
  /** Lines in the range: those with notes and those whose notes could not be read. */
  lines: string[];
  missingLines: string[];
  errors: string[];
}

/**
 * The breaking-change notes of every line after `fromLine` up to and
 * including `toLine`. `rangeLines` lists the lines expected in that range
 * (from the release data), so a line the changelogs lack is reported.
 */
export async function notesBetween(fromLine: string, toLine: string, rangeLines: string[], now = Date.now()): Promise<NotesResult> {
  const lines = rangeLines.filter((l) => compareVersions(l, fromLine) > 0 && compareVersions(l, toLine) <= 0).sort(compareVersions);
  const found = new Map<string, ReleaseNote[]>();
  const errors: string[] = [];
  const take = (releases: Map<string, { date: string; notes: ReleaseNote[] }>): void => {
    for (const l of lines) {
      const r = releases.get(l);
      if (r && !found.has(l)) found.set(l, r.notes);
    }
  };
  if (lines.length === 0) return { notes: [], lines, missingLines: [], errors };
  try {
    take(await loadFile(CHANGELOG_PATH, now));
  } catch (error) {
    errors.push(`CHANGELOG.md: ${error instanceof UpgradeSourceError ? error.message : "unreadable"}`);
  }
  const years = [...new Set(lines.filter((l) => !found.has(l)).map((l) => 2000 + Number(l.split(".")[0])))];
  for (const year of years) {
    try {
      take(await loadFile(yearPath(year), now));
    } catch (error) {
      errors.push(`${year} changelog: ${error instanceof UpgradeSourceError ? error.message : "unreadable"}`);
    }
  }
  const missingLines = lines.filter((l) => !found.has(l));
  if (errors.length || missingLines.length) logger.warn({ module: "Upgrades", errors, missingLines }, "Some release notes could not be read");
  const notes = lines.flatMap((l) => found.get(l) ?? []);
  return { notes, lines, missingLines, errors };
}
