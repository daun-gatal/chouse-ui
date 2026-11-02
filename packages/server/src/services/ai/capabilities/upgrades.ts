/**
 * match-upgrade-notes (ADR 0029 §5): Chouse AI reads the breaking-change notes
 * between two ClickHouse versions against the names one workload uses, and
 * says which ones matter. CHouse keeps the facts: every finding must cite a
 * note that is in the evidence and names from the workload, or it is dropped.
 * The model gets no tools and sees notes and names only, never rows or tables.
 */

import { randomUUID } from "crypto";

import { z } from "zod";

import { PERMISSIONS } from "../../../rbac/schema/base";
import { getUserConnections } from "../../../rbac/services/connections";
import { AppError } from "../../../types";
import { all, json, one, run, sql, str } from "../../observe/db";
import { getAssessment, linesBetween, type CheckSummary } from "../../upgrades/assess";
import { upgradeCheckEnabled } from "../../upgrades/fetch";
import { nameKey } from "../../upgrades/match";
import { notesBetween } from "../../upgrades/notes";
import { getReleaseData } from "../../upgrades/releaseData";
import { lineOf } from "../../upgrades/versions";
import type { AgentRunContext, StructuredCapability } from "../types";

/** Bounds on what one request sends: about 30k tokens of notes and names. */
const MAX_NOTE_CHARS = 110_000;
const MAX_NAMES = 1500;
const MAX_FINDINGS = 25;

const Parsed = z.object({
  findings: z.array(z.object({
    noteId: z.string(),
    severity: z.enum(["blocker", "warning", "info"]),
    title: z.string(),
    detail: z.string(),
    action: z.string(),
    matched: z.array(z.string()),
  })),
});

interface Prepared {
  assessmentId: string;
  evidence: {
    currentVersion: string;
    targetVersion: string;
    notes: Array<{ noteId: string; line: string; text: string }>;
    omittedNotes: number;
    workloadNames: string[];
    alreadyFound: Array<{ category: string; title: string }>;
  };
  prs: Record<string, { line: string; prs: number[]; text: string }>;
}

export interface UpgradeNotesResult {
  findings: number;
  dropped: number;
  model: string;
}

function can(ctx: AgentRunContext, permission: string): boolean {
  return Boolean(ctx.isAdmin) || (ctx.permissions ?? []).includes(permission);
}

export const matchUpgradeNotesCapability: StructuredCapability<{ assessmentId: string }, Prepared, z.infer<typeof Parsed>, UpgradeNotesResult> = {
  id: "match-upgrade-notes",
  title: "Read upgrade release notes",
  description: "Monitoring › Upgrades › Check: reads the breaking-change notes between two versions against the names the workload uses.",
  surface: "observe",
  contexts: [],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({ assessmentId: z.string().min(1).max(64) }),
  outputSchema: Parsed,
  async prepare(input, ctx) {
    if (!can(ctx, PERMISSIONS.UPGRADES_RUN)) throw AppError.forbidden(`Reading the notes needs ${PERMISSIONS.UPGRADES_RUN}`);
    const a = await getAssessment(input.assessmentId);
    if (!a) throw AppError.notFound("Check not found");
    if (!ctx.isAdmin) {
      if (!ctx.userId || !(await getUserConnections(ctx.userId)).some((c) => c.id === a.connectionId)) throw AppError.forbidden("You do not have access to this connection");
    }
    if (a.status !== "done") throw AppError.badRequest("Wait for the check to finish");
    if (!upgradeCheckEnabled()) throw AppError.badRequest("Release notes are off on this server (UPGRADE_CHECK_ENABLED)");
    const fromLine = a.currentVersion ? lineOf(a.currentVersion) : null;
    if (!fromLine || fromLine === a.summary.target.line) throw AppError.badRequest("A patch inside one line has no breaking-change notes to read");
    const release = await getReleaseData([a.summary.target.line]);
    const result = await notesBetween(fromLine, a.summary.target.line, linesBetween(fromLine, a.summary.target.line, release?.lines.map((l) => l.line) ?? null));
    if (!result.notes.length) throw AppError.badRequest("No release notes could be read for this range");
    const notes: Prepared["evidence"]["notes"] = [];
    let size = 0;
    for (const n of result.notes) {
      if (size + n.text.length > MAX_NOTE_CHARS) break;
      size += n.text.length;
      notes.push({ noteId: n.id, line: n.line, text: n.text });
    }
    return {
      assessmentId: a.id,
      evidence: {
        currentVersion: a.currentVersion ?? "",
        targetVersion: a.targetVersion,
        notes,
        omittedNotes: result.notes.length - notes.length,
        workloadNames: (a.summary.workloadNames ?? []).slice(0, MAX_NAMES),
        alreadyFound: a.findings.filter((f) => f.severity !== "note" && f.category !== "ai-note").map((f) => ({ category: f.category, title: f.title })),
      },
      prs: Object.fromEntries(result.notes.map((n) => [n.id, { line: n.line, prs: n.prs, text: n.text }])),
    };
  },
  templateVariables: (prepared) => ({ evidence: JSON.stringify(prepared.evidence) }),
  async finalize(parsed, prepared, _ctx, meta) {
    const names = new Map(prepared.evidence.workloadNames.map((n) => [nameKey(n), n]));
    const sent = new Set(prepared.evidence.notes.map((n) => n.noteId));
    const seen = new Set<string>();
    const kept: Array<z.infer<typeof Parsed>["findings"][number] & { matched: string[] }> = [];
    let dropped = 0;
    for (const f of parsed.findings) {
      const matched = [...new Set(f.matched.map((m) => names.get(nameKey(m))).filter((m): m is string => Boolean(m)))];
      if (!sent.has(f.noteId) || seen.has(f.noteId) || !matched.length || !f.title.trim() || kept.length >= MAX_FINDINGS) {
        dropped++;
        continue;
      }
      seen.add(f.noteId);
      kept.push({ ...f, matched });
    }
    await run(sql`DELETE FROM upgrade_findings WHERE assessment_id = ${prepared.assessmentId} AND category = 'ai-note'`);
    for (const f of kept) {
      const note = prepared.prs[f.noteId];
      const evidence = {
        key: `ai:${f.noteId}`,
        source: { notes: [{ id: f.noteId, line: note.line, prs: note.prs }], ai: { model: meta.modelLabel } },
        head: [],
        rows: [],
        totalRows: 0,
        noteText: note.text,
        matched: f.matched,
        action: f.action.trim().slice(0, 500),
      };
      await run(sql`INSERT INTO upgrade_findings (id, assessment_id, category, severity, title, detail, evidence) VALUES (${randomUUID()}, ${prepared.assessmentId}, 'ai-note', ${f.severity}, ${f.title.trim().slice(0, 300)}, ${f.detail.trim().slice(0, 1000)}, ${JSON.stringify(evidence)})`);
    }
    const row = await one(sql`SELECT summary FROM upgrade_assessments WHERE id = ${prepared.assessmentId}`);
    const summary = json<CheckSummary | null>(row?.summary, null);
    if (summary) {
      // A note an AI finding now cites is no longer waiting for a person, so it leaves the to-judge count.
      const cited = new Set(kept.map((f) => f.noteId));
      const counts = { blocker: 0, warning: 0, info: 0, note: 0 };
      for (const r of await all(sql`SELECT severity, evidence FROM upgrade_findings WHERE assessment_id = ${prepared.assessmentId}`)) {
        const sev = str(r.severity) as keyof typeof counts;
        if (!(sev in counts)) continue;
        if (sev === "note" && json<{ source?: { notes?: Array<{ id: string }> } }>(r.evidence, {}).source?.notes?.some((n) => cited.has(n.id))) continue;
        counts[sev]++;
      }
      summary.counts = counts;
      summary.ai = { status: "done", model: meta.modelLabel, at: Date.now(), dropped };
      await run(sql`UPDATE upgrade_assessments SET summary = ${JSON.stringify(summary)} WHERE id = ${prepared.assessmentId}`);
    }
    return { findings: kept.length, dropped, model: meta.modelLabel };
  },
};
