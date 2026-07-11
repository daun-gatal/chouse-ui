/**
 * Tool-set assembly — maps the context-derivable tool families to their
 * factories. The `query_node` family depends on a capability's resolved node
 * list (prepared data, not context), so fleet capabilities build it themselves
 * via `queryNodeTool` in capabilities/fleetShared.ts.
 */

import { AppError } from "../../types";
import {
  type AgentToolContext,
  createCoreTools,
  createChartTool,
} from "../agentTools";
import type { AgentRunContext } from "./types";
import type { AgentToolSet } from "./langchainTools";

/**
 * Narrow an AgentRunContext to the session-based AgentToolContext the core/chart
 * tools require. Throws if the run isn't carrying a live ClickHouse service
 * (i.e. a fleet capability was misconfigured to request `core` tools).
 */
export function requireToolContext(ctx: AgentRunContext): AgentToolContext {
  if (!ctx.clickhouseService) {
    throw AppError.internal(
      "This AI capability requires an active ClickHouse session connection.",
    );
  }
  return {
    userId: ctx.userId ?? "",
    isAdmin: ctx.isAdmin ?? false,
    permissions: ctx.permissions ?? [],
    connectionId: ctx.connectionId,
    clickhouseService: ctx.clickhouseService,
    defaultDatabase: ctx.defaultDatabase,
  };
}

/** Shared read-only schema/query tools (list/describe/ddl/explain/sample/…). */
export function coreTools(ctx: AgentRunContext): AgentToolSet {
  return createCoreTools(requireToolContext(ctx)) as AgentToolSet;
}

/** Chart-rendering tool (chat). */
export function chartTools(ctx: AgentRunContext): AgentToolSet {
  return createChartTool(requireToolContext(ctx)) as AgentToolSet;
}
