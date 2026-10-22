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

import { MAX_SQL_LENGTH, type ChartPanelInput, type Variable } from "./spec";

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
}).strict();
export type DraftRequest = z.infer<typeof draftRequestSchema>;

export const MAX_DRAFT_PANELS = 12;

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
