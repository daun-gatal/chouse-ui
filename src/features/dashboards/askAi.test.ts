import { describe, expect, it } from "vitest";

import type { DashboardDraft, DraftPanel, PanelInput } from "@/api/dashboards";
import type { Variable } from "@/lib/viz/spec";

import {
  MAX_HISTORY,
  defaultValues,
  fixCount,
  groupBySection,
  includedPanels,
  initialReview,
  mergeVariables,
  revisionOf,
  reviewReducer,
  roomProblem,
  sectionsOf,
  statusCounts,
  type ReviewState,
} from "./askAi";

const VIZ = { version: 2 as const, type: "line" as const, x: "t", y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null, links: [], baseline: null };
const PIE = { ...VIZ, type: "pie" as const };

function panel(title: string, overrides: Partial<DraftPanel> = {}): DraftPanel {
  const sql = overrides.sql ?? `SELECT 1 AS t, 2 AS v -- ${title}`;
  return {
    status: "ok", panel: { id: null, kind: "chart", title, sql, viz: VIZ, fleet: false }, title, sql, rationale: `${title} matters`,
    role: "trend", importance: "secondary", section: null, reasons: [], lint: [], ...overrides,
  };
}

const PIE_SQL = "SELECT d AS t, b AS v FROM x";
const ATTENTION = panel("By database", {
  status: "attention", sql: PIE_SQL, panel: { id: null, kind: "chart", title: "By database", sql: PIE_SQL, viz: PIE, fleet: false }, role: "breakdown", section: "Where",
  lint: [
    { code: "pie_without_limit", message: "Keep the top 12.", fixedSql: `${PIE_SQL}\nLIMIT 12` },
    { code: "too_many_slices", message: "Too many slices.", fixedViz: { ...PIE, type: "horizontal_bar" } },
    { code: "missing_unit", message: "Pick a unit." },
  ],
});
const BLOCKED = panel("Bad", { status: "blocked", panel: null, role: null, importance: null, reasons: ["Chart settings: type: invalid"] });

function draftOf(panels: DraftPanel[], overrides: Partial<DashboardDraft> = {}): DashboardDraft {
  return { title: "Orders pipeline", description: "Kafka to MergeTree", variables: [], problems: [], panels, ...overrides };
}

const variable = (name: string, label = name): Variable => ({ name, label, kind: "string", options: { source: "static", values: ["a"] }, default: "a" });

function start(): ReviewState {
  return initialReview(draftOf([panel("Insert rate", { importance: "primary", section: "Throughput" }), ATTENTION, BLOCKED]));
}

describe("initialReview", () => {
  it("gives each panel a stable id and includes everything that can be added", () => {
    const state = start();
    expect(state.draft.panels.map((p) => [p.id, p.include])).toEqual([["p1", true], ["p2", true], ["p3", false]]);
    expect(state).toMatchObject({ dirty: false, titleEdited: false, history: [], nextId: 4 });
  });
});

describe("reviewReducer", () => {
  it("includes and leaves out panels, never a blocked one, and only marks the review changed when something changed", () => {
    const state = start();
    const out = reviewReducer(state, { type: "include", ids: ["p1", "p3"], include: false });
    expect(out.draft.panels.map((p) => p.include)).toEqual([false, true, false]);
    expect(out.dirty).toBe(true);
    expect(reviewReducer(out, { type: "include", ids: ["p3"], include: true })).toBe(out);
    expect(reviewReducer(state, { type: "include", ids: ["p1"], include: true })).toBe(state);
  });

  it("keeps only the checked panels", () => {
    const out = reviewReducer(start(), { type: "onlyChecked" });
    expect(out.draft.panels.map((p) => p.include)).toEqual([true, false, false]);
  });

  it("applies a fix and keeps the others of a different part, without marking the panel checked while a finding is left", () => {
    const sqlFixed = reviewReducer(start(), { type: "applyFix", id: "p2", code: "pie_without_limit" });
    const p2 = sqlFixed.draft.panels[1].draft;
    expect(p2.sql).toBe(`${PIE_SQL}\nLIMIT 12`);
    expect(p2.panel?.sql).toBe(`${PIE_SQL}\nLIMIT 12`);
    expect(p2.lint.map((f) => f.code)).toEqual(["too_many_slices", "missing_unit"]);
    expect(p2.lint[0].fixedViz?.type).toBe("horizontal_bar");
    expect(p2.status).toBe("attention");
    expect(sqlFixed.dirty).toBe(true);
  });

  it("drops another finding's fix of the same part once one is applied: it was computed from the panel as drafted", () => {
    const twoSqlFixes = panel("Two", { status: "attention", lint: [{ code: "a", message: "A", fixedSql: "SELECT 1 -- a" }, { code: "b", message: "B", fixedSql: "SELECT 1 -- b" }] });
    const out = reviewReducer(initialReview(draftOf([twoSqlFixes])), { type: "applyFix", id: "p1", code: "a" });
    expect(out.draft.panels[0].draft.panel?.sql).toBe("SELECT 1 -- a");
    expect(out.draft.panels[0].draft.lint).toEqual([{ code: "b", message: "B" }]);
    expect(fixCount(out.draft.panels)).toBe(0);
  });

  it("marks a panel checked once its last finding is fixed", () => {
    const one = panel("One", { status: "attention", lint: [{ code: "a", message: "A", fixedSql: "SELECT 2" }] });
    const out = reviewReducer(initialReview(draftOf([one])), { type: "applyFix", id: "p1", code: "a" });
    expect(out.draft.panels[0].draft.status).toBe("ok");
  });

  it("ignores a fix that is not there", () => {
    const state = start();
    expect(reviewReducer(state, { type: "applyFix", id: "p2", code: "missing_unit" })).toBe(state);
    expect(reviewReducer(state, { type: "applyFix", id: "nope", code: "pie_without_limit" })).toBe(state);
  });

  it("applies every fix at once", () => {
    const state = start();
    expect(fixCount(state.draft.panels)).toBe(2);
    const out = reviewReducer(state, { type: "applyAllFixes" });
    const p2 = out.draft.panels[1].draft;
    expect(p2.panel?.sql).toBe(`${PIE_SQL}\nLIMIT 12`);
    expect(p2.panel?.viz.type).toBe("horizontal_bar");
    expect(p2.lint.map((f) => f.code)).toEqual(["missing_unit"]);
    expect(fixCount(out.draft.panels)).toBe(0);
    expect(reviewReducer(out, { type: "applyAllFixes" })).toBe(out);
  });

  it("renames the dashboard and keeps the new title through a refine", () => {
    const named = reviewReducer(start(), { type: "setTitle", title: "Orders" });
    expect(named).toMatchObject({ titleEdited: true, dirty: true });
    const refined = reviewReducer(named, { type: "refined", draft: draftOf([panel("Disk")], { title: "Model title" }) });
    expect(refined.draft.title).toBe("Orders");
    expect(reviewReducer(start(), { type: "refined", draft: draftOf([panel("Disk")], { title: "Model title" }) }).draft.title).toBe("Model title");
    expect(reviewReducer(named, { type: "setTitle", title: "Orders" })).toBe(named);
  });

  it("replaces the draft on refine with fresh ids, and undo brings back what the user had", () => {
    const changed = reviewReducer(start(), { type: "include", ids: ["p1"], include: false });
    const refined = reviewReducer(changed, { type: "refined", draft: draftOf([panel("Disk"), BLOCKED], { variables: [variable("db")], problems: ["x"] }) });
    expect(refined.draft.panels.map((p) => [p.id, p.draft.title, p.include])).toEqual([["p4", "Disk", true], ["p5", "Bad", false]]);
    expect(refined.draft).toMatchObject({ variables: [variable("db")], problems: ["x"], description: "Kafka to MergeTree" });
    expect(refined.history).toEqual([changed.draft]);
    const undone = reviewReducer(refined, { type: "undo" });
    expect(undone.draft).toBe(changed.draft);
    expect(undone.history).toEqual([]);
    expect(reviewReducer(undone, { type: "undo" })).toBe(undone);
  });

  it("keeps at most the last versions", () => {
    let state = start();
    for (let i = 0; i < MAX_HISTORY + 2; i += 1) state = reviewReducer(state, { type: "refined", draft: draftOf([panel(`Run ${i}`)]) });
    expect(state.history).toHaveLength(MAX_HISTORY);
    expect(state.history[0].panels[0].draft.title).toBe("Run 1");
  });

  it("regenerates one panel in place, keeping the rest, the draft's variables and its problems", () => {
    const base = initialReview(draftOf([panel("A"), panel("B")], { variables: [variable("db", "Mine")], problems: ["old"] }));
    const left = reviewReducer(base, { type: "include", ids: ["p1"], include: false });
    const out = reviewReducer(left, { type: "regenerated", id: "p2", draft: draftOf([panel("B2")], { variables: [variable("db", "Theirs"), variable("table")], problems: ["new", "old"] }) });
    expect(out.draft.panels.map((p) => [p.id, p.draft.title, p.include])).toEqual([["p1", "A", false], ["p2", "B2", true]]);
    expect(out.draft.variables.map((v) => v.label)).toEqual(["Mine", "table"]);
    expect(out.draft.problems).toEqual(["old", "new"]);
    expect(out.draft.title).toBe("Orders pipeline");
    expect(out.history).toEqual([left.draft]);
  });

  it("leaves a regenerated panel out when it came back blocked, and ignores a reply for a panel that is gone", () => {
    const base = initialReview(draftOf([panel("A")]));
    expect(reviewReducer(base, { type: "regenerated", id: "p1", draft: draftOf([BLOCKED]) }).draft.panels[0].include).toBe(false);
    expect(reviewReducer(base, { type: "regenerated", id: "p9", draft: draftOf([panel("X")]) })).toBe(base);
  });
});

describe("revisionOf", () => {
  it("sends the draft as the user has it, with their fixes and the panels they left out", () => {
    let state = reviewReducer(start(), { type: "applyFix", id: "p2", code: "pie_without_limit" });
    state = reviewReducer(state, { type: "include", ids: ["p1"], include: false });
    const revision = revisionOf(state.draft, "  add disk usage ", null);
    expect(revision.feedback).toBe("add disk usage");
    expect(revision.panelIndex).toBeNull();
    expect(revision.previous.panels.map((p) => [p.title, p.included, p.viz?.type ?? null])).toEqual([["Insert rate", false, "line"], ["By database", true, "pie"], ["Bad", false, null]]);
    expect(revision.previous.panels[1].sql).toBe(`${PIE_SQL}\nLIMIT 12`);
    expect(revisionOf(state.draft, "", "p3").panelIndex).toBe(2);
    expect(() => revisionOf(state.draft, "", "p9")).toThrow("no longer in the draft");
  });
});

describe("grouping and counts", () => {
  it("groups panels by section in the order the model gave them", () => {
    const panels = initialReview(draftOf([panel("A", { section: "S" }), panel("B"), panel("C", { section: "S" })])).draft.panels;
    expect(groupBySection(panels).map((g) => [g.section, g.panels.map((p) => p.draft.title)])).toEqual([["S", ["A", "C"]], [null, ["B"]]]);
  });

  it("counts statuses and lists the included panels", () => {
    const state = start();
    expect(statusCounts(state.draft.panels)).toEqual({ ok: 1, attention: 1, blocked: 1 });
    expect(includedPanels(state.draft.panels).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("sectionsOf", () => {
  it("groups the included panels by section for the layout engine, keyed by review id", () => {
    const state = reviewReducer(initialReview(draftOf([panel("A", { section: "Where" }), ATTENTION, BLOCKED, panel("D", { section: null })])), { type: "include", ids: ["p2"], include: false });
    expect(sectionsOf(state.draft.panels)).toEqual([
      { heading: { title: "Where", description: "" }, panels: [{ key: "p1", kind: "chart", chartType: "line", role: "trend", importance: "secondary", size: null }] },
      { heading: null, panels: [{ key: "p4", kind: "chart", chartType: "line", role: "trend", importance: "secondary", size: null }] },
    ]);
  });
});

describe("mergeVariables", () => {
  it("adds new variables and keeps the dashboard's own definition of a name it has", () => {
    const own = { name: "db", label: "DB", kind: "identifier" as const, options: { source: "static" as const, values: ["a"] }, default: "a" };
    const drafted = [{ ...own, label: "Other" }, { ...own, name: "table", label: "Table" }];
    expect(mergeVariables([own], drafted)).toEqual({ variables: [own, drafted[1]], skipped: ["db"] });
  });
});

describe("roomProblem", () => {
  const chart = (i: number): PanelInput => ({ id: `c${i}`, kind: "chart", title: "", sql: "SELECT 1", viz: VIZ, fleet: false, layout: { x: 0, y: i, w: 1, h: 1 } });
  const text = (i: number): PanelInput => ({ id: `t${i}`, kind: "text", title: "", markdown: "", layout: { x: 0, y: i, w: 1, h: 1 } });
  const sections = (charts: number, headed: boolean) => [{ heading: headed ? { title: "S", description: "" } : null, panels: Array.from({ length: charts }, (_, i) => ({ key: `p${i}`, kind: "chart" as const, chartType: "line" as const, role: "trend" as const, importance: "secondary" as const, size: null })) }];

  it("lets panels in that fit, headings included", () => {
    expect(roomProblem({ panels: [], variables: [] }, sections(12, true), [])).toBeNull();
    expect(roomProblem({ panels: Array.from({ length: 58 }, (_, i) => text(i)), variables: [] }, sections(1, true), [])).toBeNull();
  });

  it("counts the section heading the layout engine adds against the panel limit", () => {
    expect(roomProblem({ panels: Array.from({ length: 59 }, (_, i) => text(i)), variables: [] }, sections(1, true), [])).toBe("This dashboard has room for 1 more panel, section headings included; leave 1 out");
    expect(roomProblem({ panels: Array.from({ length: 60 }, (_, i) => text(i)), variables: [] }, sections(1, false), [])).toBe("This dashboard already has 60 panels, the most it can hold");
  });

  it("keeps the chart limit", () => {
    expect(roomProblem({ panels: Array.from({ length: 38 }, (_, i) => chart(i)), variables: [] }, sections(3, false), [])).toBe("This dashboard has room for 2 more charts; leave 1 out");
    expect(roomProblem({ panels: Array.from({ length: 40 }, (_, i) => chart(i)), variables: [] }, sections(1, false), [])).toBe("This dashboard already has 40 charts, the most it can hold");
  });

  it("keeps the variable limit, counting a reused name once", () => {
    const own = Array.from({ length: 9 }, (_, i) => variable(`v${i}`));
    expect(roomProblem({ panels: [], variables: own }, sections(1, false), [variable("v0"), variable("x")])).toBeNull();
    expect(roomProblem({ panels: [], variables: own }, sections(1, false), [variable("x"), variable("y")])).toBe("A dashboard has at most 10 variables, and these panels would bring it to 11");
  });
});

describe("defaultValues", () => {
  it("runs each variable with its default", () => {
    const multi: Variable = { name: "tables", label: "Tables", kind: "multi", options: { source: "static", values: ["a", "b"] }, default: ["a"] };
    expect(defaultValues([variable("db"), multi])).toEqual({ db: "a", tables: ["a"] });
  });
});
