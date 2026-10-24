/**
 * The write tools an agent can use (ADR 0024 §Phase 2, ADR 0025). Each one
 * calls a CHouse route in-process as the caller, so the route's permission
 * checks, validation and audit entry apply exactly as in the UI. Chat, MCP
 * and the CLI are all generated from this list.
 */

import type { ActionDefinition } from "./types";
import { DATA_ACTIONS } from "./toolkits/data";
import { SCHEDULING_ACTIONS } from "./toolkits/scheduling";
import { HEALTH_ACTIONS } from "./toolkits/health";
import { DASHBOARD_ACTIONS } from "./toolkits/dashboards";
import { OBSERVE_ACTIONS } from "./toolkits/observe";

export type { ActionDefinition } from "./types";
export { dashboardDocument } from "./toolkits/shared";

export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  ...DATA_ACTIONS,
  ...SCHEDULING_ACTIONS,
  ...HEALTH_ACTIONS,
  ...OBSERVE_ACTIONS,
  ...DASHBOARD_ACTIONS,
];

const BY_NAME = new Map(ACTION_DEFINITIONS.map((d) => [d.name, d]));

export function actionDefinition(name: string): ActionDefinition | undefined {
  return BY_NAME.get(name);
}

/** Validates arguments a person edited on an approval, in words the approval card can show. */
export function parseEditedArgs(definition: ActionDefinition, args: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; message: string } {
  const parsed = definition.schema.safeParse(args ?? {});
  if (parsed.success) return { ok: true, args: parsed.data };
  const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ");
  return { ok: false, message: `The edited "${definition.title}" action is not valid: ${problems}` };
}
