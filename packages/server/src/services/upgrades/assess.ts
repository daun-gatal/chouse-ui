/**
 * Upgrade check (ADR 0029, amending ADR 0016 §9): what upgrading a connection
 * to a target version changes for its real workload, run when someone asks.
 *
 * - Exact: a connection on the target line is read too, and the two servers'
 *   system tables are diffed.
 * - Release notes: the breaking-change notes between the two versions,
 *   filtered to names the workload uses (Chouse AI reads them separately).
 *
 * Plus the workload replay on a canary. CHouse UI never performs the upgrade.
 */

import { randomUUID } from "crypto";

import type { ClickHouseClient } from "@clickhouse/client";

import { logger } from "../../utils/logger";
import { all, json, num, numOrNull, one, run, sql, str, strOrNull } from "../observe/db";
import { selectRows, stripFormat } from "../observe/clickhouse";
import { clientForConnection } from "../scheduledQueries/chClient";
import { upgradeCheckEnabled, UpgradeSourceError } from "./fetch";
import { matchFindings, nameKey, noteFindings, workloadNameList, type FindingDraft, type FindingEvidence, type Severity } from "./match";
import { notesBetween, type NotesResult } from "./notes";
import { getReleaseData } from "./releaseData";
import { diffSnapshots, readSnapshot, type SnapshotDiff } from "./snapshot";
import { compareVersions, lineOf, plainVersion } from "./versions";
import { gatherWorkload } from "./workload";

/** A check still "running" after this long was cut off (a restart) and is reported as failed. */
const STALE_MS = 15 * 60 * 1000;

export type Stage = "release" | "current" | "target" | "notes" | "workload" | "matching" | "done";

export interface CheckSummary {
  stage: Stage;
  mode: "exact" | "notes";
  target: { version: string; line: string };
  reference: { connectionId: string; name: string; version: string } | null;
  coverage?: {
    diff: SnapshotDiff["counts"] | null;
    removed: number;
    changedDefaults: number;
    changedMergeTree: number;
    newlyObsolete: number;
    notes: { count: number; lines: string[]; missingLines: string[]; errors: string[]; skipped: string | null };
    workload: { days: number; from: number | null; shapes: number; readable: boolean };
    generalNotes: number;
  };
  counts?: Record<Severity, number>;
  /** Names the workload uses, for Chouse AI to read the notes against. */
  workloadNames?: string[];
  ai?: { status: "done" | "failed"; model: string | null; at: number; dropped: number; error?: string };
  error?: string;
}

export interface Finding {
  id: string;
  key: string;
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: FindingEvidence;
}

export interface Assessment {
  id: string;
  connectionId: string;
  currentVersion: string | null;
  targetVersion: string;
  status: "running" | "done" | "failed";
  summary: CheckSummary;
  createdAt: number;
  finishedAt: number | null;
  findings: Finding[];
}

export class CheckInputError extends Error {}

function nextLine(line: string): string {
  const [major, minor] = line.split(".").map(Number);
  return minor >= 12 ? `${major + 1}.1` : `${major}.${minor + 1}`;
}

/** Lines strictly after `from` up to `to`, from the release list or, without it, by month. */
export function linesBetween(from: string, to: string, known: string[] | null): string[] {
  if (known?.length) return known.filter((l) => compareVersions(l, from) > 0 && compareVersions(l, to) <= 0).sort(compareVersions);
  const out: string[] = [];
  let l = from;
  for (let i = 0; i < 60 && compareVersions(l, to) < 0; i++) {
    l = nextLine(l);
    out.push(l);
  }
  return out;
}

function checkErrorText(error: unknown): string {
  if (error instanceof CheckInputError) return error.message;
  if (error instanceof UpgradeSourceError) return `Could not read ${error.source === "github" ? "GitHub" : "Docker Hub"}: ${error.message}`;
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function setSummary(id: string, summary: CheckSummary): Promise<void> {
  await run(sql`UPDATE upgrade_assessments SET summary = ${JSON.stringify(summary)} WHERE id = ${id}`);
}

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, warning: 1, info: 2, note: 3 };

export interface StartInput {
  connectionId: string;
  targetVersion: string;
  reference: { connectionId: string; name: string } | null;
  actorId: string | null;
}

/**
 * Start a check and return its id at once; the work runs in the background
 * and records each stage, so the page can show progress. One check per
 * connection runs at a time: asking again returns the running one.
 */
export async function startAssessment(input: StartInput): Promise<string> {
  const target = plainVersion(input.targetVersion);
  const targetLine = target ? lineOf(target) : null;
  if (!target || !targetLine) throw new CheckInputError("Use a version such as 26.8 or 26.8.36.3");
  if (!input.reference && !upgradeCheckEnabled()) {
    throw new CheckInputError("Release notes are off on this server (UPGRADE_CHECK_ENABLED). Pick a connection on the target line to compare with.");
  }
  const running = await one(sql`SELECT id, created_at FROM upgrade_assessments WHERE connection_id = ${input.connectionId} AND status = 'running' ORDER BY created_at DESC LIMIT 1`);
  if (running && Date.now() - num(running.created_at) < STALE_MS) return str(running.id);

  const id = randomUUID();
  const summary: CheckSummary = {
    stage: "release",
    mode: input.reference ? "exact" : "notes",
    target: { version: target, line: targetLine },
    reference: input.reference ? { ...input.reference, version: "" } : null,
  };
  await run(sql`INSERT INTO upgrade_assessments (id, connection_id, target_version, status, summary, created_by, created_at) VALUES (${id}, ${input.connectionId}, ${target}, 'running', ${JSON.stringify(summary)}, ${input.actorId}, ${Date.now()})`);
  void runCheck(id, input.connectionId, summary).catch((error: unknown) => {
    logger.error({ module: "Upgrades", assessmentId: id, err: checkErrorText(error) }, "Upgrade check crashed");
  });
  return id;
}

async function runCheck(id: string, connectionId: string, summary: CheckSummary): Promise<void> {
  const s = summary;
  try {
    const enabled = upgradeCheckEnabled();
    const release = enabled ? await getReleaseData([s.target.line]) : null;

    s.stage = "current";
    await setSummary(id, s);
    const comment = JSON.stringify({ source: "observe", collector: "upgrades" });
    const client = await clientForConnection(connectionId, comment);
    const current = await readSnapshot(client);
    const currentVersion = plainVersion(current.version) ?? current.version;
    const currentLine = lineOf(currentVersion);
    await run(sql`UPDATE upgrade_assessments SET current_version = ${currentVersion} WHERE id = ${id}`);
    if (!currentLine) throw new CheckInputError(`Can't read the version this server runs (${current.version.slice(0, 40)})`);
    const lineCmp = compareVersions(s.target.line, currentLine);
    if (lineCmp < 0) throw new CheckInputError(`${s.target.version} is older than ${currentVersion}. Pick a newer version.`);
    if (lineCmp === 0 && (s.target.version === s.target.line || compareVersions(s.target.version, currentVersion) <= 0)) {
      throw new CheckInputError(`This server already runs ${currentVersion}. Pick a newer line or patch.`);
    }

    let diff: SnapshotDiff | null = null;
    if (s.reference) {
      s.stage = "target";
      await setSummary(id, s);
      const refClient = await clientForConnection(s.reference.connectionId, comment);
      const target = await readSnapshot(refClient);
      const refVersion = plainVersion(target.version) ?? target.version;
      s.reference.version = refVersion;
      if (lineOf(refVersion) !== s.target.line) {
        throw new CheckInputError(`${s.reference.name} runs ${refVersion}, not ${s.target.line}. Pick a connection on the target line.`);
      }
      diff = diffSnapshots(current, target);
    }

    s.stage = "notes";
    await setSummary(id, s);
    let notes: NotesResult = { notes: [], lines: [], missingLines: [], errors: [] };
    let skipped: string | null = null;
    if (!enabled) skipped = "Release notes are off on this server (UPGRADE_CHECK_ENABLED).";
    else if (s.target.line === currentLine) skipped = "A patch inside one line has no breaking-change notes.";
    else notes = await notesBetween(currentLine, s.target.line, linesBetween(currentLine, s.target.line, release?.lines.map((l) => l.line) ?? null));

    s.stage = "workload";
    await setSummary(id, s);
    const facts = await gatherWorkload(client);

    s.stage = "matching";
    await setSummary(id, s);
    const findings: FindingDraft[] = matchFindings({ diff, current, targetVersion: s.target.version, facts, notes: notes.notes });
    findings.push(...await regressionFindings(connectionId));
    const nameList = workloadNameList(facts, current);
    const fromNotes = noteFindings(notes.notes, new Set(nameList.map(nameKey)), findings);
    findings.push(...fromNotes.findings);

    for (const f of findings) {
      await run(sql`INSERT INTO upgrade_findings (id, assessment_id, category, severity, title, detail, evidence) VALUES (${randomUUID()}, ${id}, ${f.category}, ${f.severity}, ${f.title}, ${f.detail}, ${JSON.stringify({ ...f.evidence, key: f.key })})`);
    }
    const counts: Record<Severity, number> = { blocker: 0, warning: 0, info: 0, note: 0 };
    for (const f of findings) counts[f.severity]++;
    s.stage = "done";
    s.counts = counts;
    s.workloadNames = nameList.slice(0, 3000);
    s.coverage = {
      diff: diff?.counts ?? null,
      removed: diff ? Object.values(diff.removed).reduce((n, xs) => n + xs.length, 0) : 0,
      changedDefaults: diff?.changedSettings.length ?? 0,
      changedMergeTree: diff?.changedMergeTree.length ?? 0,
      newlyObsolete: diff?.newlyObsolete.length ?? 0,
      notes: { count: notes.notes.length, lines: notes.lines, missingLines: notes.missingLines, errors: notes.errors, skipped },
      workload: facts.window,
      generalNotes: fromNotes.general,
    };
    await run(sql`UPDATE upgrade_assessments SET status = 'done', summary = ${JSON.stringify(s)}, finished_at = ${Date.now()} WHERE id = ${id}`);
  } catch (error) {
    const message = checkErrorText(error);
    if (!(error instanceof CheckInputError)) logger.warn({ module: "Upgrades", assessmentId: id, err: message }, "Upgrade check failed");
    s.error = message;
    await run(sql`UPDATE upgrade_assessments SET status = 'failed', summary = ${JSON.stringify(s)}, finished_at = ${Date.now()} WHERE id = ${id}`);
  }
}

/** Regressions already open on replicas that were upgraded: the strongest evidence there is. */
async function regressionFindings(connectionId: string): Promise<FindingDraft[]> {
  const regressions = await all(sql`SELECT * FROM obs_regressions WHERE connection_id = ${connectionId} AND status = 'open'`);
  const out: FindingDraft[] = [];
  for (const r of regressions) {
    const linked = json<Array<{ kind: string; summary: string }>>(r.linked_changes, []);
    const version = linked.find((c) => c.kind === "version");
    if (!version) continue;
    out.push({
      key: `regression:${str(r.fingerprint)}:${str(r.replica)}`,
      category: "regression",
      severity: "blocker",
      title: `A query shape got ${num(r.ratio).toFixed(1)}× slower on ${str(r.replica)} after its version changed`,
      detail: `${str(r.metric)} rose from ${num(r.baseline_value)} to ${num(r.current_value)} (${version.summary}). Look at it in Performance before upgrading more replicas.`,
      evidence: { source: { check: "open regressions linked to a version change" }, head: ["Shape", "Replica", "Change"], rows: [{ cells: [str(r.fingerprint), str(r.replica), version.summary] }], totalRows: 1 },
    });
  }
  return out;
}

function rowToAssessment(a: Record<string, unknown>, findings: Finding[]): Assessment {
  let status = str(a.status) as Assessment["status"];
  const summary = json<CheckSummary>(a.summary, { stage: "release", mode: "notes", target: { version: str(a.target_version), line: lineOf(str(a.target_version)) ?? "" }, reference: null });
  if (status === "running" && Date.now() - num(a.created_at) > STALE_MS) {
    status = "failed";
    summary.error = summary.error ?? "The check was interrupted. Run it again.";
  }
  return {
    id: str(a.id), connectionId: str(a.connection_id), currentVersion: strOrNull(a.current_version), targetVersion: str(a.target_version),
    status, summary, createdAt: num(a.created_at), finishedAt: numOrNull(a.finished_at), findings,
  };
}

export async function getAssessment(id: string): Promise<Assessment | null> {
  const a = await one(sql`SELECT * FROM upgrade_assessments WHERE id = ${id}`);
  if (!a) return null;
  const findings = (await all(sql`SELECT * FROM upgrade_findings WHERE assessment_id = ${id}`)).map((f) => {
    const evidence = json<FindingEvidence & { key?: string }>(f.evidence, { source: {}, head: [], rows: [], totalRows: 0 });
    return { id: str(f.id), key: evidence.key ?? str(f.id), category: str(f.category), severity: str(f.severity) as Severity, title: str(f.title), detail: str(f.detail), evidence };
  });
  findings.sort((x, y) => (SEVERITY_ORDER[x.severity] ?? 9) - (SEVERITY_ORDER[y.severity] ?? 9));
  return rowToAssessment(a, findings);
}

export async function listAssessments(connectionId: string): Promise<Array<Omit<Assessment, "findings">>> {
  return (await all(sql`SELECT * FROM upgrade_assessments WHERE connection_id = ${connectionId} ORDER BY created_at DESC LIMIT 50`)).map((a) => {
    const { findings: _ignored, ...rest } = rowToAssessment(a, []);
    void _ignored;
    return rest;
  });
}

/** The newest finished check per connection, for the Fleet tooltip. */
export async function latestChecks(connectionIds: string[]): Promise<Record<string, { id: string; targetVersion: string; mode: string; counts: Record<Severity, number> | null; at: number }>> {
  const out: Record<string, { id: string; targetVersion: string; mode: string; counts: Record<Severity, number> | null; at: number }> = {};
  for (const connectionId of connectionIds) {
    const a = await one(sql`SELECT * FROM upgrade_assessments WHERE connection_id = ${connectionId} AND status = 'done' ORDER BY created_at DESC LIMIT 1`);
    if (!a) continue;
    const summary = json<CheckSummary | null>(a.summary, null);
    out[connectionId] = { id: str(a.id), targetVersion: str(a.target_version), mode: summary?.mode ?? "notes", counts: summary?.counts ?? null, at: numOrNull(a.finished_at) ?? num(a.created_at) };
  }
  return out;
}

// --- workload replay -----------------------------------------------------------

/** Queries whose results legitimately differ between runs are not replayed. */
export function replayable(query: string): boolean {
  const q = query.toLowerCase();
  if (!/^\s*(with|select)\b/.test(q)) return false;
  if (/\bsystem\./.test(q)) return false;
  if (/\b(now|now64|today|yesterday|rand|rand64|randcanonical|generateuuidv4|currentuser|hostname|uptime|version)\s*\(/.test(q)) return false;
  return true;
}


export function replayQuery(query: string): string {
  return `SELECT count() AS c, sum(cityHash64(*)) AS h FROM (${stripFormat(query)})`;
}

async function timed(client: ClickHouseClient, query: string): Promise<ReplayTiming> {
  const started = Date.now();
  const rows = await selectRows<{ c: number; h: string | number }>(client, query, { maxExecutionTime: 60 });
  return { hash: `${rows[0]?.c ?? 0}:${rows[0]?.h ?? 0}`, ms: Date.now() - started };
}

/** UNKNOWN_IDENTIFIER, UNKNOWN_TABLE, UNKNOWN_DATABASE. */
const MISSING_OBJECT_CODES = new Set(["47", "60", "81"]);

/** True when ClickHouse refused a query because a table, database or column does not exist there. */
export function isMissingObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  if (MISSING_OBJECT_CODES.has(code)) return true;
  const message = "message" in error ? String(error.message) : "";
  return /Unknown table expression identifier|\b(Table|Database) \S+ does not exist/i.test(message);
}

export interface ReplayTiming {
  hash: string;
  ms: number;
}

export type ReplayOutcome = "same" | "differs" | "slower" | "missing" | "error" | "skipped";

export interface ReplayShapeResult {
  outcome: ReplayOutcome;
  baseline: ReplayTiming | null;
  canary: ReplayTiming | null;
  error: string | null;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Replay one shape on the baseline, then the canary. A shape the baseline
 * itself can no longer run (its table was dropped since it was logged) says
 * nothing about the canary, so it is skipped rather than reported as an error;
 * an object missing only on the canary is a schema gap, not an upgrade regression.
 */
export async function replayShape(runBaseline: () => Promise<ReplayTiming>, runCanary: () => Promise<ReplayTiming>): Promise<ReplayShapeResult> {
  let baseline: ReplayTiming;
  try {
    baseline = await runBaseline();
  } catch (e) {
    return { outcome: "skipped", baseline: null, canary: null, error: errorText(e) };
  }
  let canary: ReplayTiming;
  try {
    canary = await runCanary();
  } catch (e) {
    return { outcome: isMissingObject(e) ? "missing" : "error", baseline, canary: null, error: errorText(e) };
  }
  if (baseline.hash !== canary.hash) return { outcome: "differs", baseline, canary, error: null };
  if (canary.ms >= Math.max(50, baseline.ms * 1.5)) return { outcome: "slower", baseline, canary, error: null };
  return { outcome: "same", baseline, canary, error: null };
}

export async function runReplay(connectionId: string, canaryConnectionId: string, assessmentId: string | null, actorId: string | null, limit = 500): Promise<string> {
  const id = randomUUID();
  await run(sql`INSERT INTO replay_runs (id, assessment_id, connection_id, canary_connection_id, status, requested_by, started_at) VALUES (${id}, ${assessmentId}, ${connectionId}, ${canaryConnectionId}, 'running', ${actorId}, ${Date.now()})`);
  void (async () => {
    // Skipped shapes stay out of total; missing and skipped are counted from replay_results on read.
    const counts = { total: 0, same: 0, differs: 0, slower: 0, errors: 0 };
    let attempts = 0;
    try {
      const comment = JSON.stringify({ source: "observe", collector: "replay", run_id: id });
      const base = await clientForConnection(connectionId, comment);
      const canary = await clientForConnection(canaryConnectionId, comment);
      const shapes = await all(sql`
        SELECT fingerprint, MAX(sample_query) AS sample_query, SUM(total_ms) AS total FROM obs_query_fingerprints
        WHERE connection_id = ${connectionId} AND query_kind = 'Select' GROUP BY fingerprint ORDER BY total DESC LIMIT ${limit * 2}`);
      for (const s of shapes) {
        // Skipped shapes do not use up the limit, but stale history must not stretch the run either.
        if (counts.total >= limit || attempts >= limit * 2) break;
        const query = str(s.sample_query);
        if (!replayable(query)) continue;
        attempts++;
        const wrapped = replayQuery(query);
        const result = await replayShape(() => timed(base, wrapped), () => timed(canary, wrapped));
        if (result.outcome !== "skipped") counts.total++;
        if (result.outcome === "same") counts.same++;
        if (result.outcome === "differs") counts.differs++;
        if (result.outcome === "slower") counts.slower++;
        if (result.outcome === "error") counts.errors++;
        await run(sql`
          INSERT INTO replay_results (run_id, fingerprint, outcome, baseline_ms, canary_ms, baseline_hash, canary_hash, error)
          VALUES (${id}, ${str(s.fingerprint)}, ${result.outcome}, ${result.baseline?.ms ?? null}, ${result.canary?.ms ?? null}, ${result.baseline?.hash ?? null}, ${result.canary?.hash ?? null}, ${result.error})
          ON CONFLICT (run_id, fingerprint) DO NOTHING`);
      }
      await run(sql`UPDATE replay_runs SET status = 'done', total = ${counts.total}, same = ${counts.same}, differs = ${counts.differs}, slower = ${counts.slower}, errors = ${counts.errors}, finished_at = ${Date.now()} WHERE id = ${id}`);
    } catch (error) {
      logger.warn({ module: "Upgrades", replayId: id, err: error instanceof Error ? error.message : String(error) }, "Workload replay failed");
      await run(sql`UPDATE replay_runs SET status = 'failed', total = ${counts.total}, same = ${counts.same}, differs = ${counts.differs}, slower = ${counts.slower}, errors = ${counts.errors}, finished_at = ${Date.now()} WHERE id = ${id}`);
    }
  })();
  return id;
}

/** Most actionable first, so the row cap never hides a real error behind skipped history. */
const OUTCOME_ORDER = sql`CASE rr.outcome WHEN 'error' THEN 0 WHEN 'differs' THEN 1 WHEN 'missing' THEN 2 WHEN 'slower' THEN 3 ELSE 4 END`;

export async function getReplay(id: string, canSeeQueryText: boolean): Promise<Record<string, unknown> | null> {
  const r = await one(sql`SELECT * FROM replay_runs WHERE id = ${id}`);
  if (!r) return null;
  const byOutcome = new Map((await all(sql`SELECT outcome, COUNT(*) AS n FROM replay_results WHERE run_id = ${id} GROUP BY outcome`)).map((x) => [str(x.outcome), num(x.n)]));
  const results = await all(sql`
    SELECT rr.*, f.sample_query FROM replay_results rr
    LEFT JOIN (SELECT fingerprint, MAX(sample_query) AS sample_query FROM obs_query_fingerprints GROUP BY fingerprint) f ON f.fingerprint = rr.fingerprint
    WHERE rr.run_id = ${id} AND rr.outcome <> 'same' ORDER BY ${OUTCOME_ORDER}, rr.fingerprint LIMIT 200`);
  return {
    id, connectionId: str(r.connection_id), canaryConnectionId: str(r.canary_connection_id), status: str(r.status),
    total: num(r.total), same: num(r.same), differs: num(r.differs), slower: num(r.slower), errors: num(r.errors),
    missing: byOutcome.get("missing") ?? 0, skipped: byOutcome.get("skipped") ?? 0,
    startedAt: num(r.started_at), finishedAt: numOrNull(r.finished_at),
    results: results.map((x) => {
      const sample = strOrNull(x.sample_query);
      // Show the text that was replayed: the logged FORMAT clause is stripped before running.
      return { fingerprint: str(x.fingerprint), outcome: str(x.outcome), baselineMs: numOrNull(x.baseline_ms), canaryMs: numOrNull(x.canary_ms), error: strOrNull(x.error), sampleQuery: canSeeQueryText && sample ? stripFormat(sample) : null };
    }),
  };
}

export async function listReplays(connectionId: string): Promise<Array<Record<string, unknown>>> {
  return (await all(sql`SELECT * FROM replay_runs WHERE connection_id = ${connectionId} ORDER BY started_at DESC LIMIT 20`)).map((r) => ({
    id: str(r.id), canaryConnectionId: str(r.canary_connection_id), status: str(r.status), total: num(r.total), same: num(r.same), differs: num(r.differs), slower: num(r.slower), errors: num(r.errors), startedAt: num(r.started_at),
  }));
}
