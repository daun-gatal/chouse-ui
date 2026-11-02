import { describe, expect, it } from "vitest";

import type { Assessment, Finding, UpgradeTarget, VersionStatus } from "@/api/upgrades";
import {
  agoText, checkMarkdown, checkVerdict, checkSteps, daysSince, findingCounts, formatDay, formatMonth, mainFindings, notesToJudge,
  stepState, supportWindowText, targetTag, versionStatusText, versionTone,
} from "./upgrades";

const status = (over: Partial<VersionStatus> = {}): VersionStatus => ({
  version: "25.8.33.6", line: "25.8", lts: true, supported: true, supportEnded: null, expectedEnd: { line: "26.8", month: "2026-08" },
  latestPatch: "25.8.33.6", latestDate: "2026-08-26", newerPatch: false, ...over,
});

const finding = (over: Partial<Finding>): Finding => ({
  id: over.key ?? "f", key: "f", category: "removed-type", severity: "blocker", title: "t", detail: "d",
  evidence: { source: {}, head: [], rows: [], totalRows: 0 }, ...over,
});

describe("dates", () => {
  it("formats days and months and counts days since", () => {
    expect(formatDay("2026-10-26")).toBe("26 Oct 2026");
    expect(formatDay("2026-10-26T10:00:00Z")).toBe("26 Oct 2026");
    expect(formatDay("soon")).toBe("soon");
    expect(formatDay(null)).toBe("");
    expect(formatMonth("2027-08")).toBe("Aug 2027");
    expect(daysSince("2026-10-26", Date.UTC(2026, 10, 2, 12))).toBe(7);
    expect(daysSince("bad")).toBeNull();
    expect(daysSince("2030-01-01", Date.UTC(2026, 0, 1))).toBe(0);
    expect([agoText(0), agoText(1), agoText(7), agoText(null)]).toEqual(["today", "1 day ago", "7 days ago", ""]);
  });
});

describe("version status", () => {
  it("colours out of support red, a newer patch amber, and up to date not at all", () => {
    expect(versionTone(status({ supported: false }))).toBe("bad");
    expect(versionTone(status({ newerPatch: true }))).toBe("warn");
    expect(versionTone(status())).toBeNull();
    expect(versionTone(status({ supported: null }))).toBeNull();
    expect(versionTone(null)).toBeNull();
  });

  it("says where the version stands", () => {
    expect(versionStatusText(status({ supported: false, supportEnded: { by: "26.8", date: "2026-08-30" } }))).toBe("Out of support since 26.8 shipped (30 Aug 2026)");
    expect(versionStatusText(status({ supported: false }))).toBe("Out of support");
    expect(versionStatusText(status({ newerPatch: true, latestPatch: "25.8.40.1", latestDate: "2026-10-26" }))).toBe("Newer patch: 25.8.40.1, released 26 Oct 2026");
    expect(versionStatusText(status())).toBe("Up to date · 25.8 LTS, newest patch");
    expect(versionStatusText(status({ supported: null }))).toBe("Not in ClickHouse's release list");
  });
});

describe("targets", () => {
  const t = (line: string, kind: UpgradeTarget["kind"], recommended = false, lts = kind !== "stable"): UpgradeTarget => ({ line, kind, recommended, lts, patch: `${line}.1.1`, releasedAt: null, expectedEnd: { line: "27.8", month: "2027-08" } });
  const all = [t("26.8", "lts", true), t("26.3", "lts"), t("26.10", "stable")];

  it("tags the recommended LTS, the smaller step and the newest line", () => {
    expect(all.map((x) => targetTag(x, all))).toEqual(["Recommended", "Smaller step", "Newest"]);
    expect(targetTag(t("26.3", "patch"), all)).toBe("Same line");
    expect(supportWindowText(all[0])).toBe("Supported until 27.8 ships (~Aug 2027)");
  });
});

describe("check steps", () => {
  it("adds the comparison server in exact mode and Chouse AI when it runs", () => {
    expect(checkSteps("notes", null, false).map((s) => s.key)).toEqual(["release", "current", "notes", "workload", "matching"]);
    expect(checkSteps("exact", "staging", true).map((s) => s.key)).toEqual(["release", "current", "target", "notes", "workload", "matching", "ai"]);
    expect(checkSteps("exact", "staging", false)[2].label).toContain("staging");
  });

  it("orders steps against the current stage", () => {
    expect(stepState("release", "notes")).toBe(1);
    expect(stepState("notes", "notes")).toBe(0);
    expect(stepState("workload", "notes")).toBe(-1);
    expect(stepState("matching", "done")).toBe(1);
    expect(stepState("ai", "ai")).toBe(0);
  });
});

describe("findings and notes", () => {
  const note = (id: string): Finding => finding({ key: `note:${id}`, id: `n-${id}`, category: "release-note", severity: "note", title: `note ${id}`, evidence: { source: { notes: [{ id, line: "26.8", prs: [1] }] }, head: [], rows: [], totalRows: 0 } });
  const ai = finding({ key: "ai:26.8#2", id: "ai", category: "ai-note", severity: "warning", evidence: { source: { notes: [{ id: "26.8#2", line: "26.8", prs: [108091] }], ai: { model: "m" } }, head: [], rows: [], totalRows: 0 } });
  const all = [note("26.8#1"), note("26.8#2"), ai, finding({ key: "x", severity: "info" }), finding({ key: "y" })];

  it("hides notes an AI finding already cites, and counts the rest", () => {
    expect(notesToJudge(all).map((f) => f.key)).toEqual(["note:26.8#1"]);
    expect(findingCounts(all)).toEqual({ blocker: 1, warning: 1, info: 1, note: 1 });
  });

  it("orders findings worst first, CHouse's own before Chouse AI's at the same severity", () => {
    const sameSeverity = [finding({ key: "a", severity: "warning", category: "ai-note" }), finding({ key: "b", severity: "warning" })];
    expect(mainFindings(sameSeverity).map((f) => f.key)).toEqual(["b", "a"]);
    expect(mainFindings(all).map((f) => f.key)).toEqual(["y", "ai:26.8#2", "x"]);
  });

  it("writes a Markdown report with sources and the notes left to judge", () => {
    const a: Assessment = {
      id: "a", connectionId: "c", currentVersion: "25.8.33.6", targetVersion: "26.8.36.3", status: "done", createdAt: 0, finishedAt: 1, hiddenRows: 0,
      summary: {
        stage: "done", mode: "exact", target: { version: "26.8.36.3", line: "26.8" }, reference: { connectionId: "s", name: "staging", version: "26.8.36.3" },
        coverage: { diff: null, removed: 1, changedDefaults: 0, changedMergeTree: 0, newlyObsolete: 0, notes: { count: 2, lines: ["25.9", "26.8"], missingLines: [], errors: [], skipped: null }, workload: { days: 30, from: 1, shapes: 70, readable: true }, generalNotes: 0 },
      },
      findings: all,
    };
    const md = checkMarkdown(a, "billing");
    expect(md).toContain("# billing: 25.8.33.6 → 26.8.36.3");
    expect(md).toContain("Exact comparison with staging (26.8.36.3).");
    expect(md).toContain("- **Behaves differently** · t (https://github.com/ClickHouse/ClickHouse/pull/108091)");
    expect(md).toContain("- [ ] 26.8 · note 26.8#1 — https://github.com/ClickHouse/ClickHouse/pull/1");
    expect(md).not.toContain("note 26.8#2");
  });

  it("says so when nothing was found", () => {
    const a = { id: "a", connectionId: "c", currentVersion: "26.8.1.1", targetVersion: "26.8.36.3", status: "done" as const, createdAt: 0, finishedAt: 1, hiddenRows: 0, summary: { stage: "done" as const, mode: "notes" as const, target: { version: "26.8.36.3", line: "26.8" }, reference: null }, findings: [] };
    expect(checkMarkdown(a, "x")).toContain("- Nothing found that this workload uses.");
  });
});

describe("check verdict", () => {
  const counts = (blocker: number, warning: number, note: number) => ({ blocker, warning, info: 0, note });
  it("calls a check clear only when its answer is complete", () => {
    expect(checkVerdict({ mode: "exact", counts: counts(0, 0, 0) }).clear).toBe(true);
    expect(checkVerdict({ mode: "notes", counts: counts(0, 0, 0) }).clear).toBe(false);
    expect(checkVerdict({ mode: "notes", counts: counts(0, 0, 0), ai: { status: "done" } }).clear).toBe(true);
    expect(checkVerdict({ mode: "notes", counts: counts(0, 0, 14) })).toEqual({ breaks: 0, changes: 0, toJudge: 14, clear: false });
    expect(checkVerdict({ mode: "exact", counts: counts(2, 3, 0) })).toEqual({ breaks: 2, changes: 3, toJudge: 0, clear: false });
    expect(checkVerdict({ mode: "exact" }).clear).toBe(true);
  });
});
