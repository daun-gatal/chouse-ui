/**
 * Draft with AI for dashboards (ADR 0021 §10, ADR 0023 §4): the request and the
 * shape the model fills. Dependency-free on purpose (zod and spec.ts only): the
 * capability list imports this at load time.
 *
 * The model says what each panel is — its role, importance and section — and
 * never where it goes: CHouse's layout engine places the panels. Its output is
 * deliberately loose per panel — a panel the model got wrong is reported as
 * blocked with the reason, not allowed to fail the whole draft — and every
 * field is validated strictly in draft.ts before the user sees it.
 */

import { z } from "zod";

import { MAX_SQL_LENGTH, MAX_VARIABLES, type ChartPanelInput, type Variable } from "./spec";

export const MAX_DRAFT_PANELS = 12;
export const MAX_FEEDBACK_LENGTH = 2_000;

/**
 * Refine and Regenerate: the draft under review as the user has it now (their
 * fixes applied, the panels they left out marked), and what to change. With a
 * panel index, only that panel is drafted again.
 */
const revisionSchema = z.object({
  previous: z.object({
    title: z.string().max(200),
    description: z.string().max(2_000),
    variables: z.array(z.unknown()).max(MAX_VARIABLES),
    panels: z.array(z.object({
      title: z.string().max(200),
      sql: z.string().max(MAX_SQL_LENGTH),
      viz: z.unknown(),
      role: z.unknown(),
      importance: z.unknown(),
      section: z.string().max(80).nullable(),
      rationale: z.string().max(500),
      /** False when the user left the panel out. */
      included: z.boolean(),
    }).strict()).min(1).max(MAX_DRAFT_PANELS),
  }).strict(),
  feedback: z.string().trim().max(MAX_FEEDBACK_LENGTH),
  panelIndex: z.number().int().min(0).max(MAX_DRAFT_PANELS - 1).nullable(),
}).strict();
export type DraftRevision = z.infer<typeof revisionSchema>;

export const draftRequestSchema = z.object({
  /** What the dashboard should show, in the user's words. */
  goal: z.string().trim().min(8).max(4_000),
  connectionId: z.string().min(1),
  /** The dashboard the panels are for, when adding to one: titles, variables and panel SQL, as context. */
  existing: z.object({
    title: z.string().max(200),
    variables: z.array(z.unknown()).max(10),
    panels: z.array(z.object({ title: z.string().max(200), sql: z.string().max(MAX_SQL_LENGTH) }).strict()).max(60),
  }).strict().nullable(),
  revision: revisionSchema.optional(),
}).strict();
export type DraftRequest = z.infer<typeof draftRequestSchema>;

/** What the schema cannot check about a revision (null when it is usable). */
export function revisionProblem(revision: DraftRevision): string | null {
  if (revision.panelIndex !== null && revision.panelIndex >= revision.previous.panels.length) return "The panel to regenerate is not in the draft";
  if (revision.panelIndex === null && revision.feedback.length < 3) return "Say what to change in the draft";
  return null;
}

export const DashboardDraftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2_000),
  variables: z.array(z.unknown()).max(10),
  panels: z.array(z.object({
    title: z.string().min(1).max(200),
    sql: z.string().min(1).max(MAX_SQL_LENGTH),
    viz: z.unknown(),
    role: z.unknown(),
    importance: z.unknown(),
    /** The section the panel belongs to (its heading), or null for the top. */
    section: z.string().max(80).nullable(),
    rationale: z.string().max(500),
  })).min(1).max(MAX_DRAFT_PANELS),
});
export type DashboardDraftOutput = z.infer<typeof DashboardDraftSchema>;

export type DraftPanelStatus = "ok" | "attention" | "blocked";

/** A chart panel as drafted: everything but its place, which the layout engine decides. */
export type DraftedChart = Omit<ChartPanelInput, "layout">;

export interface DraftPanel {
  status: DraftPanelStatus;
  /** The panel to add; null when its chart settings, role or importance could not be read. */
  panel: DraftedChart | null;
  title: string;
  sql: string;
  rationale: string;
  /** What the panel is for (null when the model's value could not be read). */
  role: string | null;
  importance: "primary" | "secondary" | null;
  section: string | null;
  /** Why it is blocked (status blocked). */
  reasons: string[];
  /** Lint and chart-fit findings, each with a fix when it is mechanical (status attention). */
  lint: Array<{ code: string; message: string; fixedSql?: string; fixedViz?: ChartPanelInput["viz"] }>;
}

export interface DashboardDraft {
  title: string;
  description: string;
  variables: Variable[];
  /** Problems with the draft as a whole (a variable that was dropped, and why). */
  problems: string[];
  panels: DraftPanel[];
}
