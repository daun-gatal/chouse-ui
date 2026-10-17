/**
 * Dashboards › Ask AI (ADR 0021 §10): drafts a dashboard — or panels to add
 * to one — from a goal, for review. It never saves anything: the user accepts
 * the reviewed draft through the normal dashboards routes, which check it
 * again and check access to the dashboard it goes into.
 */

import type { z } from "zod";

import { PERMISSIONS } from "../../../rbac/schema/base";
import { AppError } from "../../../types";
import type { StructuredCapability } from "../types";
import { draftEvidence } from "../../dashboards/draftEvidence";
import { DashboardDraftSchema, draftRequestSchema, type DashboardDraft, type DraftRequest } from "../../dashboards/draftSchemas";

function requirePermission(ctx: { isAdmin?: boolean; permissions?: string[] }, permission: string): void {
  if (!ctx.isAdmin && !ctx.permissions?.includes(permission)) throw AppError.forbidden(`Permission '${permission}' required for this action`);
}

export const draftDashboardCapability: StructuredCapability<DraftRequest, DraftRequest, z.infer<typeof DashboardDraftSchema>, DashboardDraft> = {
  id: "draft-dashboard",
  title: "Draft a dashboard",
  description: "Dashboards › Ask AI: drafts a dashboard, or panels to add to one, from a goal; every panel is checked and dry-run before review.",
  surface: "dashboards",
  contexts: ["session"],
  variables: { evidence: { type: "json", description: "The goal, the dashboard being added to, and the panel rules (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: draftRequestSchema,
  outputSchema: DashboardDraftSchema,
  prepare(input, ctx) {
    requirePermission(ctx, PERMISSIONS.DASHBOARDS_EDIT);
    if (ctx.connectionId !== input.connectionId) throw AppError.badRequest("Select the dashboard's connection before drafting with AI");
    return input;
  },
  templateVariables: (prepared) => ({ evidence: JSON.stringify(draftEvidence(prepared)) }),
  finalize: async (parsed, prepared, ctx) => {
    // Imported lazily: the review reaches the runner and ClickHouse clients, which the capability list must not load eagerly.
    const { finalizeDraft } = await import("../../dashboards/draft");
    return finalizeDraft(parsed, prepared, ctx);
  },
};
