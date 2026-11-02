/**
 * Upgrades API (ADR 0029): version status and targets, the upgrade check
 * (exact against a connection on the target line, or from release notes),
 * the Fleet version colour, and the workload replay on a canary.
 */

import { api } from "./client";

export type Severity = "blocker" | "warning" | "info" | "note";
export type CheckStage = "release" | "current" | "target" | "notes" | "workload" | "matching" | "done";

export interface VersionStatus {
  version: string;
  line: string;
  lts: boolean;
  /** null when the line isn't in the release list (a custom or very new build). */
  supported: boolean | null;
  supportEnded: { by: string; date: string } | null;
  expectedEnd: { line: string; month: string } | null;
  latestPatch: string | null;
  latestDate: string | null;
  newerPatch: boolean;
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

export interface UpgradeStatus {
  /** UPGRADE_CHECK_ENABLED: release data and notes can be fetched. */
  enabled: boolean;
  version: string | null;
  release: { fetchedAt: number; hubLines: string[]; supported: string[]; partial: boolean } | null;
  current: VersionStatus | null;
  targets: UpgradeTarget[];
}

export interface Reference {
  connectionId: string;
  name: string;
  version: string;
}

export interface EvidenceRow {
  cells: string[];
  table?: string;
}

export interface FindingEvidence {
  source: {
    diff?: string;
    notes?: Array<{ id: string; line: string; prs: number[] }>;
    check?: string;
    ai?: { model: string };
  };
  head: string[];
  rows: EvidenceRow[];
  totalRows: number;
  hiddenRows?: number;
  noteText?: string;
  matched?: string[];
  action?: string;
  fix?: { title: string; sql?: string };
  keep?: { title: string; sql: string };
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

export interface CheckSummary {
  stage: CheckStage;
  mode: "exact" | "notes";
  target: { version: string; line: string };
  reference: { connectionId: string; name: string; version: string } | null;
  coverage?: {
    diff: Record<"settings" | "mergeTree" | "functions" | "types" | "engines" | "formats" | "dbEngines", [number, number]> | null;
    removed: number;
    changedDefaults: number;
    changedMergeTree: number;
    newlyObsolete: number;
    notes: { count: number; lines: string[]; missingLines: string[]; errors: string[]; skipped: string | null };
    workload: { days: number; from: number | null; shapes: number; readable: boolean };
    generalNotes: number;
  };
  counts?: Record<Severity, number>;
  ai?: { status: "done" | "failed"; model: string | null; at: number; dropped: number; error?: string };
  error?: string;
}

export interface AssessmentSummary {
  id: string;
  connectionId: string;
  currentVersion: string | null;
  targetVersion: string;
  status: "running" | "done" | "failed";
  summary: CheckSummary;
  createdAt: number;
  finishedAt: number | null;
}

export interface Assessment extends AssessmentSummary {
  findings: Finding[];
  hiddenRows: number;
}

export interface ReplaySummary {
  id: string;
  canaryConnectionId: string;
  status: string;
  total: number;
  same: number;
  differs: number;
  slower: number;
  errors: number;
  startedAt: number;
}

/** `missing`: the table/column exists only on the baseline. `skipped`: the baseline itself can no longer run the shape. */
export type ReplayOutcome = "same" | "differs" | "slower" | "missing" | "error" | "skipped";

export interface Replay extends ReplaySummary {
  connectionId: string;
  finishedAt: number | null;
  missing: number;
  skipped: number;
  results: Array<{ fingerprint: string; outcome: ReplayOutcome; baselineMs: number | null; canaryMs: number | null; error: string | null; sampleQuery: string | null }>;
}

export interface FleetUpgradeNode {
  connectionId: string;
  name: string;
  version: string | null;
  status: VersionStatus | null;
  lastCheck: { id: string; targetVersion: string; mode: string; counts: Record<Severity, number> | null; at: number } | null;
}

export function getUpgradeStatus(connectionId?: string): Promise<UpgradeStatus> {
  return api.get<UpgradeStatus>("/upgrades/status", { params: { connectionId } });
}

export async function getReferences(target: string, connectionId?: string): Promise<Reference[]> {
  const res = await api.get<{ references: Reference[] }>("/upgrades/references", { params: { connectionId, target } });
  return res.references;
}

export async function getFleetUpgrades(): Promise<{ enabled: boolean; nodes: FleetUpgradeNode[] }> {
  return api.get<{ enabled: boolean; nodes: FleetUpgradeNode[] }>("/upgrades/fleet");
}

export function listAssessments(connectionId?: string): Promise<{ assessments: AssessmentSummary[]; replays: ReplaySummary[] }> {
  return api.get("/upgrades/assessments", { params: { connectionId } });
}

export function getAssessment(id: string): Promise<Assessment> {
  return api.get<Assessment>(`/upgrades/assessments/${encodeURIComponent(id)}`);
}

/** Starts a check; it runs in the background, so poll getAssessment until it is no longer running. */
export function startCheck(targetVersion: string, referenceConnectionId: string | null, connectionId?: string): Promise<{ id: string; status: "running" }> {
  return api.post("/upgrades/assessments", { targetVersion, ...(referenceConnectionId ? { referenceConnectionId } : {}) }, { params: { connectionId } });
}

export function startReplay(canaryConnectionId: string, assessmentId: string | null, connectionId?: string): Promise<{ id: string }> {
  return api.post("/upgrades/replays", { canaryConnectionId, assessmentId }, { params: { connectionId } });
}

export function getReplay(id: string): Promise<Replay> {
  return api.get<Replay>(`/upgrades/replays/${encodeURIComponent(id)}`);
}
