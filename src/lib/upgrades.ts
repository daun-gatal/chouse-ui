/**
 * Pure helpers for Monitoring › Upgrades and the Fleet version colour
 * (ADR 0029): how a version's support reads, the steps of a check, which
 * release notes still need a person, and the Markdown report.
 */

import type { Assessment, CheckStage, Finding, Severity, UpgradeTarget, VersionStatus } from "@/api/upgrades";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-26" → "26 Oct 2026"; anything else is returned as is. */
export function formatDay(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return date ?? "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** "2027-08" → "Aug 2027". */
export function formatMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : month;
}

/** Whole days from a YYYY-MM-DD date to `now`, or null. */
export function daysSince(date: string | null | undefined, now = Date.now()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

export function agoText(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export type VersionTone = "bad" | "warn" | null;

/** Red when out of support, amber when a newer patch is out on the same line, otherwise no colour. */
export function versionTone(status: VersionStatus | null | undefined): VersionTone {
  if (!status) return null;
  if (status.supported === false) return "bad";
  if (status.newerPatch) return "warn";
  return null;
}

/** One line on where a version stands. */
export function versionStatusText(status: VersionStatus): string {
  if (status.supported === null) return "Not in ClickHouse's release list";
  if (status.supported === false) {
    return status.supportEnded ? `Out of support since ${status.supportEnded.by} shipped (${formatDay(status.supportEnded.date)})` : "Out of support";
  }
  if (status.newerPatch && status.latestPatch) return `Newer patch: ${status.latestPatch}${status.latestDate ? `, released ${formatDay(status.latestDate)}` : ""}`;
  return `Up to date · ${status.line}${status.lts ? " LTS" : ""}, newest patch`;
}

export function supportWindowText(target: { expectedEnd: { line: string; month: string } }): string {
  return `Supported until ${target.expectedEnd.line} ships (~${formatMonth(target.expectedEnd.month)})`;
}

export function targetKindLabel(t: UpgradeTarget): string {
  return t.kind === "patch" ? "Patch" : t.lts ? "LTS" : "Stable";
}

export function targetTag(t: UpgradeTarget, all: UpgradeTarget[]): string {
  if (t.kind === "patch") return "Same line";
  if (t.recommended) return "Recommended";
  const newest = all.filter((x) => x.kind !== "patch").reduce<UpgradeTarget | null>((best, x) => (!best || compareLines(x.line, best.line) > 0 ? x : best), null);
  if (newest && newest.line === t.line && !t.lts) return "Newest";
  return "Smaller step";
}

function compareLines(a: string, b: string): number {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am - bm || an - bn;
}

export interface CheckStep {
  key: CheckStage | "ai";
  label: string;
}

/** The steps a check goes through, in order, as the page shows them. */
export function checkSteps(mode: "exact" | "notes", referenceName: string | null, withAi: boolean, tryQueries = false, target = "the target"): CheckStep[] {
  const steps: CheckStep[] = [
    { key: "release", label: "Release data" },
    { key: "current", label: "This server: settings, functions, types, engines" },
  ];
  if (mode === "exact") steps.push({ key: "target", label: `${referenceName ?? "The comparison server"}: the same system tables` });
  steps.push({ key: "notes", label: "Breaking-change notes for the version range" });
  steps.push({ key: "workload", label: "Your workload: schema, profiles and 30 days of query_log" });
  if (tryQueries) steps.push({ key: "try", label: `Trying your top query shapes with ${target}'s settings on this server` });
  steps.push({ key: "matching", label: "Matching changes to what you use" });
  if (withAi) steps.push({ key: "ai", label: "Chouse AI: reading the notes against your workload" });
  return steps;
}

const STAGE_ORDER: Array<CheckStage | "ai"> = ["release", "current", "target", "notes", "workload", "try", "matching", "ai", "done"];

/** -1 before, 0 current, 1 done, for a step against the stage a check is at. */
export function stepState(step: CheckStep["key"], stage: CheckStage | "ai"): -1 | 0 | 1 {
  const a = STAGE_ORDER.indexOf(step);
  const b = STAGE_ORDER.indexOf(stage);
  if (a < b) return 1;
  if (a === b) return 0;
  return -1;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: "Breaks",
  warning: "Behaves differently",
  info: "Heads-up",
  note: "To judge",
};

/** Findings shown as findings (not notes to judge), worst first. */
export function mainFindings(findings: Finding[]): Finding[] {
  const order: Record<Severity, number> = { blocker: 0, warning: 1, info: 2, note: 3 };
  return findings.filter((f) => f.severity !== "note").sort((a, b) => order[a.severity] - order[b.severity] || Number(a.category === "ai-note") - Number(b.category === "ai-note"));
}

/** Release notes still waiting for a person: those no AI finding has cited. */
export function notesToJudge(findings: Finding[]): Finding[] {
  const cited = new Set(findings.filter((f) => f.category === "ai-note").flatMap((f) => f.evidence.source.notes?.map((n) => n.id) ?? []));
  return findings.filter((f) => f.severity === "note" && !(f.evidence.source.notes ?? []).some((n) => cited.has(n.id)));
}

export function findingCounts(findings: Finding[]): Record<Severity, number> {
  const c: Record<Severity, number> = { blocker: 0, warning: 0, info: 0, note: 0 };
  for (const f of mainFindings(findings)) c[f.severity]++;
  c.note = notesToJudge(findings).length;
  return c;
}

export function prUrl(pr: number): string {
  return `https://github.com/ClickHouse/ClickHouse/pull/${pr}`;
}

/** The check as a Markdown report to paste into a ticket or a change request. */
export function checkMarkdown(a: Assessment, connectionName: string): string {
  const s = a.summary;
  const lines = [`# ${connectionName}: ${a.currentVersion ?? "?"} → ${s.target.version}`, ""];
  lines.push(s.mode === "exact" && s.reference ? `Exact comparison with ${s.reference.name} (${s.reference.version}).` : "From release notes only: notes don't list most default changes.");
  if (s.coverage) {
    lines.push(`${s.coverage.notes.count} breaking-change notes${s.coverage.notes.lines.length ? ` from ${s.coverage.notes.lines[0]} to ${s.coverage.notes.lines[s.coverage.notes.lines.length - 1]}` : ""}; workload from ${s.coverage.workload.days} days of query_log (${s.coverage.workload.shapes} query shapes).`);
  }
  const t = s.coverage?.tried;
  if (t?.readable) lines.push(`Tried on this server: ${t.tried} read-only query shapes planned with ${s.target.version}'s settings (${t.skipped} skipped, failing today too); nothing was executed.`);
  const main = mainFindings(a.findings);
  lines.push("", "## Findings");
  if (!main.length) lines.push("- Nothing found that this workload uses.");
  for (const f of main) {
    const prs = (f.evidence.source.notes ?? []).flatMap((n) => n.prs).map(prUrl);
    lines.push(`- **${SEVERITY_LABEL[f.severity]}** · ${f.title}${prs.length ? ` (${[...new Set(prs)].join(", ")})` : ""}`);
  }
  const judge = notesToJudge(a.findings);
  if (judge.length) {
    lines.push("", "## Release notes to judge");
    for (const f of judge) {
      const n = f.evidence.source.notes?.[0];
      lines.push(`- [ ] ${n?.line ?? ""} · ${f.title}${n?.prs.length ? ` — ${prUrl(n.prs[0])}` : ""}`);
    }
  }
  return lines.join("\n");
}

/**
 * The short result a target card or the Fleet tooltip shows for a finished
 * check. "Nothing hits you" only when the answer is complete: an exact
 * comparison, or release notes that Chouse AI has read. Notes nobody has read
 * yet are a to-do, not an all-clear.
 */
export function checkVerdict(summary: { mode: "exact" | "notes"; counts?: Record<Severity, number>; ai?: { status: string } }): { breaks: number; changes: number; toJudge: number; clear: boolean } {
  const c = summary.counts ?? { blocker: 0, warning: 0, info: 0, note: 0 };
  const complete = summary.mode === "exact" || summary.ai?.status === "done";
  return { breaks: c.blocker, changes: c.warning, toJudge: c.note, clear: complete && c.blocker === 0 && c.warning === 0 && c.note === 0 };
}
