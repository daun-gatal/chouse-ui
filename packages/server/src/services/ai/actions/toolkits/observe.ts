/**
 * Observe & Ops toolkit (ADR 0025 §2): alerting, observability incidents,
 * fixes, notebooks, Doctor, fleet and upgrades.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import { ACTION_TYPES } from "../../../remediation/catalog";
import type { ActionDefinition } from "../types";
import { needConnection, quote, record, str } from "./shared";

export const OBSERVE_ACTIONS: ActionDefinition[] = [
  {
    name: "propose_remediation",
    title: "Propose a fix",
    toolkit: "observe",
    category: "operations",
    // Only files a proposal; the remediation queue and its approval classes decide.
    tier: "t1",
    connectionScoped: false,
    proposalOnly: true,
    permissions: [PERMISSIONS.REMEDIATION_PROPOSE],
    description: `File a remediation proposal for approvers, under the remediation approval rules. params.type is one of: ${ACTION_TYPES.filter((t) => t !== "create_panel_rollup").join(", ")}.`,
    schema: z.object({
      title: z.string().min(1).max(200),
      rationale: z.string().min(1).max(4000).describe("Why this fixes the problem, with the evidence"),
      params: z.record(z.string(), z.unknown()).describe("The remediation action: { type, …its parameters }"),
    }),
    describe: (args) => `Propose ${quote(str(args.title))} (${str(record(args.params).type, "fix")}) for approval in Fixes`,
    execute: async (args, ctx) => ctx.api.post("/api/remediation/actions", {
      connectionId: needConnection(ctx),
      params: args.params,
      title: str(args.title),
      rationale: str(args.rationale),
    }),
  },
];
