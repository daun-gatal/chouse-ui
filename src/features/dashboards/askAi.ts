/**
 * Dashboards › Ask AI review (ADR 0021 §10, ADR 0023 §4): the draft under
 * review as a pure state machine — which panels are in, the fixes the user
 * applied, the title they gave it, Refine and Regenerate results, and the
 * versions before each so either can be undone — plus what the review derives
 * from it: sections for the layout engine, counts, and whether the panels
 * still fit the dashboard they go into.
 */

import { MAX_CHART_PANELS, MAX_PANELS, MAX_VARIABLES, type Variable, type VariableValues } from "@/lib/viz/spec";

import type { ArrangeSection, DashboardDraft, DraftPanel, DraftPanelStatus, DraftRevision, PanelInput } from "@/api/dashboards";

export interface ReviewPanel {
  /** Stable for the review: selection and the layout engine's keys use it. */
  id: string;
  draft: DraftPanel;
  include: boolean;
}

export interface ReviewDraft {
  title: string;
  description: string;
  variables: Variable[];
  problems: string[];
  panels: ReviewPanel[];
}

export interface ReviewState {
  draft: ReviewDraft;
  /** The user renamed the dashboard: a refined draft keeps their title. */
  titleEdited: boolean;
  /** The user changed something since the draft came back, so throwing it away asks first. */
  dirty: boolean;
  /** The drafts before each Refine or Regenerate, oldest first. */
  history: ReviewDraft[];
  nextId: number;
}

export const MAX_HISTORY = 5;

export type ReviewAction =
  | { type: "include"; ids: string[]; include: boolean }
  | { type: "onlyChecked" }
  | { type: "applyFix"; id: string; code: string }
  | { type: "applyAllFixes" }
  | { type: "setTitle"; title: string }
  | { type: "refined"; draft: DashboardDraft }
  | { type: "regenerated"; id: string; draft: DashboardDraft }
  | { type: "undo" };

/** A panel can be added when it passed its checks and its chart could be read. */
export function canInclude(draft: DraftPanel): boolean {
  return draft.status !== "blocked" && draft.panel !== null;
}

function reviewPanels(panels: DraftPanel[], nextId: number): { panels: ReviewPanel[]; nextId: number } {
  return {
    panels: panels.map((draft, i) => ({ id: `p${nextId + i}`, draft, include: canInclude(draft) })),
    nextId: nextId + panels.length,
  };
}

export function initialReview(draft: DashboardDraft): ReviewState {
  const { panels, nextId } = reviewPanels(draft.panels, 1);
  return {
    draft: { title: draft.title, description: draft.description, variables: draft.variables, problems: draft.problems, panels },
    titleEdited: false,
    dirty: false,
    history: [],
    nextId,
  };
}

/**
 * Apply one finding's fix. A fix was computed from the panel as drafted, so
 * once one changes the SQL (or the chart), the other findings' fixes of that
 * part are stale: they stay listed, without a fix to apply.
 */
function fixPanel(panel: ReviewPanel, code: string): ReviewPanel {
  const finding = panel.draft.lint.find((f) => f.code === code);
  const chart = panel.draft.panel;
  if (!finding || !chart || (finding.fixedSql === undefined && finding.fixedViz === undefined)) return panel;
  const fixed = { ...chart, ...(finding.fixedSql !== undefined ? { sql: finding.fixedSql } : {}), ...(finding.fixedViz !== undefined ? { viz: finding.fixedViz } : {}) };
  const lint = panel.draft.lint
    .filter((f) => f.code !== code)
    .map((f) => {
      const rest = { ...f };
      if (finding.fixedSql !== undefined) delete rest.fixedSql;
      if (finding.fixedViz !== undefined) delete rest.fixedViz;
      return rest;
    });
  const status: DraftPanelStatus = lint.length === 0 ? "ok" : panel.draft.status;
  return { ...panel, draft: { ...panel.draft, sql: fixed.sql, panel: fixed, lint, status } };
}

function hasFix(f: DraftPanel["lint"][number]): boolean {
  return f.fixedSql !== undefined || f.fixedViz !== undefined;
}

/** How many findings across the draft have a fix to apply. */
export function fixCount(panels: ReviewPanel[]): number {
  return panels.reduce((n, p) => n + (p.draft.panel ? p.draft.lint.filter(hasFix).length : 0), 0);
}

function withHistory(state: ReviewState): ReviewDraft[] {
  return [...state.history, state.draft].slice(-MAX_HISTORY);
}

/** The draft's variables plus the new ones in `added`; a name it has keeps its definition. */
function unionVariables(kept: Variable[], added: Variable[]): Variable[] {
  return [...kept, ...added.filter((v) => !kept.some((k) => k.name === v.name))];
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  const panels = state.draft.panels;
  switch (action.type) {
    case "include": {
      const ids = new Set(action.ids);
      const next = panels.map((p) => (ids.has(p.id) && canInclude(p.draft) && p.include !== action.include ? { ...p, include: action.include } : p));
      if (next.every((p, i) => p === panels[i])) return state;
      return { ...state, dirty: true, draft: { ...state.draft, panels: next } };
    }
    case "onlyChecked": {
      const next = panels.map((p) => {
        const include = canInclude(p.draft) && p.draft.status === "ok";
        return p.include === include ? p : { ...p, include };
      });
      if (next.every((p, i) => p === panels[i])) return state;
      return { ...state, dirty: true, draft: { ...state.draft, panels: next } };
    }
    case "applyFix": {
      const next = panels.map((p) => (p.id === action.id ? fixPanel(p, action.code) : p));
      if (next.every((p, i) => p === panels[i])) return state;
      return { ...state, dirty: true, draft: { ...state.draft, panels: next } };
    }
    case "applyAllFixes": {
      const next = panels.map((p) => {
        let fixed = p;
        // Re-read the findings after each fix: an applied fix can leave another without one.
        for (let f = fixed.draft.lint.find(hasFix); f && fixed.draft.panel; f = fixed.draft.lint.find(hasFix)) fixed = fixPanel(fixed, f.code);
        return fixed;
      });
      if (next.every((p, i) => p === panels[i])) return state;
      return { ...state, dirty: true, draft: { ...state.draft, panels: next } };
    }
    case "setTitle":
      if (action.title === state.draft.title) return state;
      return { ...state, titleEdited: true, dirty: true, draft: { ...state.draft, title: action.title } };
    case "refined": {
      const { panels: next, nextId } = reviewPanels(action.draft.panels, state.nextId);
      return {
        ...state,
        dirty: true,
        history: withHistory(state),
        nextId,
        draft: {
          title: state.titleEdited ? state.draft.title : action.draft.title,
          description: action.draft.description,
          variables: action.draft.variables,
          problems: action.draft.problems,
          panels: next,
        },
      };
    }
    case "regenerated": {
      const replacement = action.draft.panels[0];
      const index = panels.findIndex((p) => p.id === action.id);
      if (!replacement || index < 0) return state;
      const next = panels.map((p, i) => (i === index ? { id: p.id, draft: replacement, include: canInclude(replacement) } : p));
      return {
        ...state,
        dirty: true,
        history: withHistory(state),
        draft: {
          ...state.draft,
          variables: unionVariables(state.draft.variables, action.draft.variables),
          problems: [...new Set([...state.draft.problems, ...action.draft.problems])],
          panels: next,
        },
      };
    }
    case "undo": {
      const previous = state.history[state.history.length - 1];
      if (!previous) return state;
      return { ...state, dirty: true, history: state.history.slice(0, -1), draft: previous };
    }
  }
}

/** What Refine and Regenerate send: the draft as the user has it now. */
export function revisionOf(draft: ReviewDraft, feedback: string, panelId: string | null): DraftRevision {
  const panelIndex = panelId === null ? null : draft.panels.findIndex((p) => p.id === panelId);
  if (panelIndex === -1) throw new Error("That panel is no longer in the draft");
  return {
    previous: {
      title: draft.title,
      description: draft.description,
      variables: draft.variables,
      panels: draft.panels.map((p) => ({
        title: p.draft.title,
        sql: p.draft.panel?.sql ?? p.draft.sql,
        viz: p.draft.panel?.viz ?? null,
        role: p.draft.role,
        importance: p.draft.importance,
        section: p.draft.section,
        rationale: p.draft.rationale,
        included: p.include,
      })),
    },
    feedback: feedback.trim(),
    panelIndex,
  };
}

export interface SectionGroup {
  section: string | null;
  panels: ReviewPanel[];
}

/** Panels by section, in the order the model gave them. */
export function groupBySection(panels: ReviewPanel[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  for (const panel of panels) {
    const group = groups.find((g) => g.section === panel.draft.section);
    if (group) group.panels.push(panel);
    else groups.push({ section: panel.draft.section, panels: [panel] });
  }
  return groups;
}

export type StatusCounts = Record<DraftPanelStatus, number>;

export function statusCounts(panels: ReviewPanel[]): StatusCounts {
  const counts: StatusCounts = { ok: 0, attention: 0, blocked: 0 };
  for (const p of panels) counts[p.draft.status] += 1;
  return counts;
}

export function includedPanels(panels: ReviewPanel[]): ReviewPanel[] {
  return panels.filter((p) => p.include && canInclude(p.draft));
}

/**
 * The included panels, grouped by section in the order the model gave them,
 * as the layout engine takes them. Keys are the panels' review ids.
 */
export function sectionsOf(panels: ReviewPanel[]): ArrangeSection[] {
  const sections: ArrangeSection[] = [];
  for (const { id, draft } of includedPanels(panels)) {
    if (!draft.panel || draft.role === null || draft.importance === null) continue;
    const title = draft.section;
    let section = sections.find((s) => (s.heading?.title ?? null) === title);
    if (!section) {
      section = { heading: title === null ? null : { title, description: "" }, panels: [] };
      sections.push(section);
    }
    section.panels.push({ key: id, kind: "chart", chartType: draft.panel.viz.type, role: draft.role, importance: draft.importance, size: null });
  }
  return sections;
}

/** Variables for an existing dashboard plus the draft's new ones; a name it already has keeps its definition. */
export function mergeVariables(existing: Variable[], drafted: Variable[]): { variables: Variable[]; skipped: string[] } {
  const names = new Set(existing.map((v) => v.name));
  const added = drafted.filter((v) => !names.has(v.name));
  const skipped = drafted.filter((v) => names.has(v.name)).map((v) => v.name);
  return { variables: [...existing, ...added], skipped };
}

/**
 * Why the included panels cannot be saved into the dashboard (null when they
 * fit): the same limits a save checks, counting the section headings the
 * layout engine adds.
 */
export function roomProblem(existing: { panels: PanelInput[]; variables: Variable[] }, sections: ArrangeSection[], drafted: Variable[]): string | null {
  const charts = sections.reduce((n, s) => n + s.panels.length, 0);
  const headings = sections.filter((s) => s.heading !== null).length;
  const haveCharts = existing.panels.filter((p) => p.kind === "chart").length;
  const panelRoom = MAX_PANELS - existing.panels.length;
  const chartRoom = MAX_CHART_PANELS - haveCharts;
  if (charts > chartRoom) {
    return chartRoom <= 0
      ? `This dashboard already has ${MAX_CHART_PANELS} charts, the most it can hold`
      : `This dashboard has room for ${chartRoom} more chart${chartRoom === 1 ? "" : "s"}; leave ${charts - chartRoom} out`;
  }
  if (charts + headings > panelRoom) {
    return panelRoom <= 0
      ? `This dashboard already has ${MAX_PANELS} panels, the most it can hold`
      : `This dashboard has room for ${panelRoom} more panel${panelRoom === 1 ? "" : "s"}, section headings included; leave ${charts + headings - panelRoom} out`;
  }
  const variables = mergeVariables(existing.variables, drafted).variables.length;
  if (variables > MAX_VARIABLES) return `A dashboard has at most ${MAX_VARIABLES} variables, and these panels would bring it to ${variables}`;
  return null;
}

/** Each variable's default: what the new panels run with until the user picks. */
export function defaultValues(variables: Variable[]): VariableValues {
  return Object.fromEntries(variables.map((v) => [v.name, v.default]));
}
