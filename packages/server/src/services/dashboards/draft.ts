/**
 * Draft with AI for dashboards (ADR 0021 §10, ADR 0023 §4): the review every
 * drafted panel goes through before the user sees it — the same checks a save
 * and a run apply, as the requester:
 *
 *   1. the chart settings, role and importance parse strictly, and the chart
 *      type is one the role may use (layout.ts);
 *   2. the SQL compiles with the drafted variables and is one read-only
 *      SELECT without FORMAT (validate.ts);
 *   3. the requester's data access allows every table it reads;
 *   4. a dry run — the panel query in full, with the dashboard caps —
 *      succeeds and returns every column the chart names;
 *   5. lint, and the chart-fit check on the dry run's result.
 *
 * 1–4 failing make a panel `blocked` with the reasons; findings make it
 * `attention`. Nothing is saved here and nothing is repaired: a fix is offered
 * to the user only when it is mechanical. Where panels go is not the model's
 * call: the UI asks the layout engine when the user adds them.
 */

import { z } from "zod";

import { validateQueryAccess } from "../../middleware/dataAccess";
import type { AgentRunContext } from "../ai/types";
import { IMPORTANCES, ROLES, roleProblem } from "./layout";
import { chartFit, lintPanel } from "./lint";
import { compileSql, defaultValues, resolveWindow } from "./macros";
import { execute } from "./runner";
import { variableSchema, vizSpecSchema, type Variable } from "./spec";
import { panelProblems } from "./validate";
import type { DashboardDraft, DashboardDraftOutput, DraftedChart, DraftPanel, DraftRequest } from "./draftSchemas";

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

function columnsNamed(viz: DraftedChart["viz"]): string[] {
  return [viz.x, ...viz.y, viz.series].filter((c): c is string => c !== null);
}

async function reviewPanel(raw: DashboardDraftOutput["panels"][number], variables: Variable[], request: DraftRequest, ctx: AgentRunContext): Promise<DraftPanel> {
  const viz = vizSpecSchema.safeParse(raw.viz);
  const role = z.enum(ROLES).safeParse(raw.role);
  const importance = z.enum(IMPORTANCES).safeParse(raw.importance);
  const base = {
    title: raw.title,
    sql: raw.sql,
    rationale: raw.rationale,
    role: role.success ? role.data : null,
    importance: importance.success ? importance.data : null,
    section: raw.section === null || raw.section.trim() === "" ? null : raw.section.trim(),
  };
  const unreadable = [
    ...(viz.success ? [] : [`Chart settings: ${viz.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ")}`]),
    ...(role.success ? [] : [`Role must be one of ${ROLES.join(", ")}, not ${JSON.stringify(raw.role)}`]),
    ...(importance.success ? [] : [`Importance must be primary or secondary, not ${JSON.stringify(raw.importance)}`]),
  ];
  if (!viz.success || !role.success || !importance.success) return { ...base, status: "blocked", panel: null, reasons: unreadable, lint: [] };

  const panel: DraftedChart = { id: null, kind: "chart", title: raw.title, sql: raw.sql, viz: viz.data, fleet: false };
  const misfit = roleProblem(role.data, viz.data.type);
  if (misfit) return { ...base, status: "blocked", panel, reasons: [`The role does not fit the chart: ${misfit}`], lint: [] };
  const problems = panelProblems(panel, variables);
  if (problems.length > 0) return { ...base, status: "blocked", panel, reasons: problems, lint: [] };

  const compiled = compileSql(panel.sql, variables, defaultValues(variables), resolveWindow({ kind: "relative", value: "1h" }, Date.now()));
  if (!compiled.ok) return { ...base, status: "blocked", panel, reasons: [compiled.error], lint: [] };
  const access = await validateQueryAccess(ctx.userId, ctx.isAdmin, ctx.permissions, compiled.compiled.validationSql, ctx.defaultDatabase, request.connectionId);
  if (!access.allowed) return { ...base, status: "blocked", panel, reasons: [access.reason ?? "You do not have access to a table this panel reads"], lint: [] };

  let fit: DraftPanel["lint"];
  try {
    const dry = await execute(request.connectionId, compiled.compiled, { dashboardId: null, panelId: "ai-draft" });
    const have = new Set(dry.columns.map((c) => c.name));
    const absent = columnsNamed(panel.viz).filter((c) => !have.has(c));
    if (absent.length > 0) {
      return { ...base, status: "blocked", panel, reasons: [`The chart names ${absent.join(", ")}, which the query does not return (it returns ${[...have].join(", ")})`], lint: [] };
    }
    fit = chartFit(panel.viz, dry);
  } catch (error) {
    return { ...base, status: "blocked", panel, reasons: [`The dry run failed: ${error instanceof Error ? error.message : String(error)}`], lint: [] };
  }

  const lint = [...lintPanel(panel.sql, panel.viz), ...fit];
  return { ...base, status: lint.length > 0 ? "attention" : "ok", panel, reasons: [], lint };
}

/** Review the model's draft (see the module comment). */
export async function finalizeDraft(output: DashboardDraftOutput, request: DraftRequest, ctx: AgentRunContext): Promise<DashboardDraft> {
  const { variables, problems } = readVariables(output.variables);
  const panels: DraftPanel[] = [];
  for (const raw of output.panels) panels.push(await reviewPanel(raw, variables, request, ctx));
  return { title: output.title, description: output.description, variables, problems, panels };
}
