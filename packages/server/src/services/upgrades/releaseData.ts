/**
 * Release data for the upgrade check (ADR 0029 §2): lines, dates and LTS from
 * ClickHouse's `version_date.tsv`, and the newest patch per line from Docker
 * Hub, which is fresher. Cached per process for 24 hours; a failed refresh
 * keeps the last good copy and is not retried for ten minutes.
 */

import { z } from "zod";

import { logger } from "../../utils/logger";
import { fetchSource, UpgradeSourceError } from "./fetch";
import {
  compareVersions,
  expectedSupportEnd,
  isLts,
  lineOf,
  plainVersion,
  sortLines,
  supportedLines,
  supportEndedBy,
  type ReleaseLine,
} from "./versions";

const VERSION_DATE_PATH = "/ClickHouse/ClickHouse/master/utils/list-versions/version_date.tsv";
const TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
/** Docker Hub requests per refresh: the supported lines plus the lines connections run. */
const MAX_HUB_LINES = 12;

const TSV_ROW = /^v(\d{1,3})\.(\d{1,2})\.(\d{1,4})\.(\d{1,6})-[a-z]+\t(\d{4}-\d{2}-\d{2})\s*$/;

/** Pure: parse `version_date.tsv` into release lines. Unknown rows are skipped. */
export function parseVersionDates(tsv: string): ReleaseLine[] {
  const lines = new Map<string, ReleaseLine>();
  for (const row of tsv.split("\n")) {
    const m = TSV_ROW.exec(row);
    if (!m) continue;
    const line = `${Number(m[1])}.${Number(m[2])}`;
    const version = `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}.${Number(m[4])}`;
    const date = m[5];
    const existing = lines.get(line);
    if (!existing) {
      lines.set(line, { line, lts: isLts(line), firstDate: date, latestPatch: version, latestDate: date });
      continue;
    }
    if (date < existing.firstDate) existing.firstDate = date;
    if (compareVersions(version, existing.latestPatch) > 0) {
      existing.latestPatch = version;
      existing.latestDate = date;
    }
  }
  return sortLines([...lines.values()]);
}

const hubSchema = z.object({
  results: z.array(z.object({
    name: z.string().max(200),
    tag_status: z.string().max(40).nullish(),
    tag_last_pushed: z.string().max(40).nullish(),
  })).max(200),
});

const HUB_TAG = /^\d{1,3}\.\d{1,2}\.\d{1,4}\.\d{1,6}$/;

/** Pure: the newest active `x.y.z.w` tag of `line` in a Docker Hub tags page. */
export function newestHubPatch(body: unknown, line: string): { version: string; pushed: string | null } | null {
  const parsed = hubSchema.safeParse(body);
  if (!parsed.success) return null;
  let best: { version: string; pushed: string | null } | null = null;
  for (const tag of parsed.data.results) {
    if (!HUB_TAG.test(tag.name) || !tag.name.startsWith(`${line}.`)) continue;
    if (tag.tag_status && tag.tag_status !== "active") continue;
    if (!best || compareVersions(tag.name, best.version) > 0) {
      const pushed = tag.tag_last_pushed && /^\d{4}-\d{2}-\d{2}/.test(tag.tag_last_pushed) ? tag.tag_last_pushed.slice(0, 10) : null;
      best = { version: tag.name, pushed };
    }
  }
  return best;
}

export interface ReleaseData {
  lines: ReleaseLine[];
  supported: string[];
  fetchedAt: number;
  /** Lines whose newest patch came from Docker Hub. */
  hubLines: string[];
  /** Lines Docker Hub was asked about, so a failed line is not re-asked on every call. */
  requestedLines: string[];
  errors: string[];
}

let cache: ReleaseData | null = null;
let lastFailureAt = Number.NEGATIVE_INFINITY;
let inflight: Promise<ReleaseData | null> | null = null;

/** For tests. */
export function resetReleaseDataCache(): void {
  cache = null;
  lastFailureAt = Number.NEGATIVE_INFINITY;
  inflight = null;
}

async function refresh(extraLines: string[]): Promise<ReleaseData | null> {
  const errors: string[] = [];
  let lines: ReleaseLine[];
  try {
    lines = parseVersionDates(await fetchSource("github", VERSION_DATE_PATH, 1_000_000));
  } catch (error) {
    const reason = error instanceof UpgradeSourceError ? error.message : "Read failed";
    logger.warn({ module: "Upgrades", source: "github", reason }, "Release list could not be read");
    return null;
  }
  if (lines.length === 0) {
    logger.warn({ module: "Upgrades" }, "Release list had no recognisable rows");
    return null;
  }
  const supported = supportedLines(lines);
  const asked = [...new Set([...supported, ...extraLines.filter((l) => lines.some((x) => x.line === l))])];
  const wanted = asked.slice(0, MAX_HUB_LINES);
  const hubLines: string[] = [];
  await Promise.all(wanted.map(async (line) => {
    try {
      const text = await fetchSource("dockerHub", `/v2/repositories/clickhouse/clickhouse-server/tags?page_size=100&ordering=last_updated&name=${line}.`, 1_000_000);
      const newest = newestHubPatch(JSON.parse(text), line);
      const entry = lines.find((l) => l.line === line);
      if (newest && entry && compareVersions(newest.version, entry.latestPatch) >= 0) {
        entry.latestPatch = newest.version;
        entry.latestDate = newest.pushed ?? entry.latestDate;
        hubLines.push(line);
      }
    } catch (error) {
      errors.push(`Docker Hub ${line}: ${error instanceof UpgradeSourceError ? error.message : "unreadable response"}`);
    }
  }));
  if (errors.length) logger.warn({ module: "Upgrades", errors }, "Some newest patches could not be read; using the release list");
  return { lines, supported: [...supported], fetchedAt: Date.now(), hubLines: hubLines.sort(compareVersions), requestedLines: asked, errors };
}

/**
 * Cached release data, refreshed when older than a day. `extraLines` asks for
 * Docker Hub patches of lines connections run, beyond the supported ones.
 * Returns null when nothing could ever be read.
 */
export async function getReleaseData(extraLines: string[] = [], now = Date.now()): Promise<ReleaseData | null> {
  const missingExtra = extraLines.some((l) => cache && !cache.requestedLines.includes(l) && cache.lines.some((x) => x.line === l));
  const fresh = cache && now - cache.fetchedAt < TTL_MS && !missingExtra;
  if (fresh) return cache;
  if (now - lastFailureAt < RETRY_MS) return cache;
  if (!inflight) {
    inflight = refresh(extraLines).then((data) => {
      if (data) cache = { ...data, fetchedAt: now };
      else lastFailureAt = now;
      return cache;
    }).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export interface VersionStatus {
  version: string;
  line: string;
  lts: boolean;
  /** null when the line is not in the release list (a custom or very new build). */
  supported: boolean | null;
  supportEnded: { by: string; date: string } | null;
  expectedEnd: { line: string; month: string } | null;
  latestPatch: string | null;
  latestDate: string | null;
  newerPatch: boolean;
}

/** Pure: where `rawVersion` stands against the release data. */
export function versionStatus(rawVersion: string, data: ReleaseData): VersionStatus | null {
  const version = plainVersion(rawVersion);
  const line = version ? lineOf(version) : null;
  if (!version || !line) return null;
  const entry = data.lines.find((l) => l.line === line);
  if (!entry) {
    return { version, line, lts: isLts(line), supported: null, supportEnded: null, expectedEnd: null, latestPatch: null, latestDate: null, newerPatch: false };
  }
  const supported = data.supported.includes(line);
  const ended = supported ? null : supportEndedBy(line, data.lines);
  return {
    version,
    line,
    lts: entry.lts,
    supported,
    supportEnded: ended ? { by: ended.line, date: ended.firstDate } : null,
    expectedEnd: supported ? expectedSupportEnd(line) : null,
    latestPatch: entry.latestPatch,
    latestDate: entry.latestDate,
    newerPatch: compareVersions(entry.latestPatch, version) > 0,
  };
}

export interface UpgradeTarget {
  line: string;
  lts: boolean;
  kind: "patch" | "lts" | "stable";
  recommended: boolean;
  patch: string;
  releasedAt: string | null;
  expectedEnd: { line: string; month: string };
}

/**
 * Pure: the targets offered for `rawVersion`: a newer patch on the same
 * supported line first, then the two newest LTS lines and the newest line,
 * each newer than the current line. The newest LTS is recommended.
 */
export function upgradeTargets(rawVersion: string, data: ReleaseData): UpgradeTarget[] {
  const status = versionStatus(rawVersion, data);
  if (!status) return [];
  const byLine = new Map(data.lines.map((l) => [l.line, l]));
  const out: UpgradeTarget[] = [];
  if (status.supported && status.newerPatch && status.latestPatch) {
    out.push({ line: status.line, lts: status.lts, kind: "patch", recommended: false, patch: status.latestPatch, releasedAt: status.latestDate, expectedEnd: expectedSupportEnd(status.line) });
  }
  const newer = sortLines(data.lines).filter((l) => data.supported.includes(l.line) && compareVersions(l.line, status.line) > 0);
  const lts = newer.filter((l) => l.lts).slice(0, 2);
  const newest = newer[0];
  const picked = [...lts];
  if (newest && !picked.some((l) => l.line === newest.line)) picked.push(newest);
  for (const l of picked) {
    const entry = byLine.get(l.line)!;
    out.push({
      line: l.line,
      lts: l.lts,
      kind: l.lts ? "lts" : "stable",
      recommended: l.line === lts[0]?.line,
      patch: entry.latestPatch,
      releasedAt: entry.latestDate,
      expectedEnd: expectedSupportEnd(l.line),
    });
  }
  return out;
}
