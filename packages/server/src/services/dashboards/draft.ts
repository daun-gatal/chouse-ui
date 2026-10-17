/**
 * Draft with AI for dashboards (ADR 0021 §10): the review every drafted
 * panel goes through before the user sees it —
 * the same checks a save and a run apply, as the requester:
 *
 *   1. the chart settings and size parse strictly (vizSpecSchema);
 *   2. the SQL compiles with the drafted variables and is one read-only
 *      SELECT without FORMAT (validate.ts);
 *   3. the requester's data access allows every table it reads;
 *   4. a dry run (the query wrapped in LIMIT 1, with the dashboard caps)
 *      succeeds and returns every column the chart names;
 *   5. lint.
 *
 * 1–4 failing make a panel `blocked` with the reasons; lint findings make it
 * `attention`. Nothing is saved here and nothing is repaired: a fix is offered
 * to the user only when lint has a mechanical one.
 */

import { z } from "zod";

import { validateQueryAccess } from "../../middleware/dataAccess";
import type { AgentRunContext } from "../ai/types";
import { lintPanel } from "./lint";
import { compileSql, defaultValues, resolveWindow } from "./macros";
import { execute } from "./runner";
import { PANEL_HEIGHTS, variableSchema, vizSpecSchema, type PanelInput, type Variable } from "./spec";
import { panelProblems } from "./validate";
import type { DashboardDraft, DashboardDraftOutput, DraftPanel, DraftRequest } from "./draftSchemas";

const WIDTH = z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]);
const HEIGHT = z.enum(PANEL_HEIGHTS);

function readVariables(raw: unknown[]): { variables: Variable[]; problems: string[] } {
  const variables: Variable[] = [];
  const problems: string[] = [];
  raw.forEach((value, i) => {
    const parsed = variableSchema.safeParse(value);
    if (!parsed.success) {
      problems.push(`Variable ${i + 1} was left out: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      return;
    }
    if (variables.some((v) => v.name === parsed.data.name)) {
      problems.push(`Variable ${parsed.data.name} was left out: the name is used twice`);
      return;
    }
    variables.push(parsed.data);
  });
  return { variables, problems };
}

function columnsNamed(viz: PanelInput["viz"]): string[] {
  return [viz.x, ...viz.y, viz.series].filter((c): c is string => c !== null);
}

async function reviewPanel(raw: DashboardDraftOutput["panels"][number], variables: Variable[], request: DraftRequest, ctx: AgentRunContext): Promise<DraftPanel> {
  const base = { title: raw.title, sql: raw.sql, rationale: raw.rationale };
  const viz = vizSpecSchema.safeParse(raw.viz);
  const width = WIDTH.safeParse(raw.width);
  const height = HEIGHT.safeParse(raw.height);
  const unreadable = [
    ...(viz.success ? [] : [`Chart settings: ${viz.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ")}`]),
    ...(width.success ? [] : [`Width must be 3, 4, 6, 8 or 12, not ${JSON.stringify(raw.width)}`]),
    ...(height.success ? [] : [`Height must be s, m or l, not ${JSON.stringify(raw.height)}`]),
  ];
  if (!viz.success || !width.success || !height.success) return { ...base, status: "blocked", panel: null, reasons: unreadable, lint: [] };

  const panel: PanelInput = { id: null, title: raw.title, sql: raw.sql, viz: viz.data, width: width.data, height: height.data, fleet: false };
  const problems = panelProblems(panel, variables);
  if (problems.length > 0) return { ...base, status: "blocked", panel, reasons: problems, lint: [] };

  const compiled = compileSql(panel.sql, variables, defaultValues(variables), resolveWindow({ kind: "relative", value: "1h" }, Date.now()));
  if (!compiled.ok) return { ...base, status: "blocked", panel, reasons: [compiled.error], lint: [] };
  const access = await validateQueryAccess(ctx.userId, ctx.isAdmin, ctx.permissions, compiled.compiled.validationSql, ctx.defaultDatabase, request.connectionId);
  if (!access.allowed) return { ...base, status: "blocked", panel, reasons: [access.reason ?? "You do not have access to a table this panel reads"], lint: [] };

  try {
    const dry = await execute(
      request.connectionId,
      { ...compiled.compiled, sql: `SELECT * FROM (\n${compiled.compiled.sql}\n) LIMIT 1` },
      { dashboardId: null, panelId: "ai-draft" },
      1,
    );
    const have = new Set(dry.columns.map((c) => c.name));
    const absent = columnsNamed(panel.viz).filter((c) => !have.has(c));
    if (absent.length > 0) {
      return { ...base, status: "blocked", panel, reasons: [`The chart names ${absent.join(", ")}, which the query does not return (it returns ${[...have].join(", ")})`], lint: [] };
    }
  } catch (error) {
    return { ...base, status: "blocked", panel, reasons: [`The dry run failed: ${error instanceof Error ? error.message : String(error)}`], lint: [] };
  }

  const lint = lintPanel(panel.sql, panel.viz);
  return { ...base, status: lint.length > 0 ? "attention" : "ok", panel, reasons: [], lint };
}

/** Review the model's draft (see the module comment). */
export async function finalizeDraft(output: DashboardDraftOutput, request: DraftRequest, ctx: AgentRunContext): Promise<DashboardDraft> {
  const { variables, problems } = readVariables(output.variables);
  const panels: DraftPanel[] = [];
  for (const raw of output.panels) panels.push(await reviewPanel(raw, variables, request, ctx));
  return { title: output.title, description: output.description, variables, problems, panels };
}
