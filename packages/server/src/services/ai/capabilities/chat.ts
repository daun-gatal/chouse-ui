/**
 * Capability: chat — the conversational SRE assistant.
 *
 * The only streaming capability. The engine builds the agent (model + tools +
 * instructions); SSE framing, scratchpad stripping, chart-data events and
 * thread persistence stay in the route, which is genuinely chat-specific.
 */

import { z } from "zod";
import { PERMISSIONS } from "../../../rbac/schema/base";
import { coreTools, chartTools, requireToolContext } from "../toolsets";
import { runStructuredCapability } from "../engine";
import { optimizeQueryCapability } from "./optimizeQuery";
import type { AgentRunContext, StreamCapability } from "../types";
import { createAgentTool, type AgentToolSet } from "../langchainTools";

function buildSystemPrompt(): string {
  return `
You are an expert ClickHouse assistant embedded inside CHouse UI.
You operate in STRICT TOOL-FIRST MODE.

## SKILLS
DeepAgents native skills are available for data exploration, SQL generation, visualization,
query optimization, system troubleshooting, schema diagnosis, error diagnosis, and parts
diagnosis. Use the matching skill instructions before complex work.
For chat, keep progress visible by calling the concrete Chouse tools directly.
Do not delegate routine chat work to background specialist tasks.

## REFERENCES
Reference docs hold exact ClickHouse facts (system.* column names, the optimization playbook, the type/codec guide).
Use the matching reference skill BEFORE writing raw \`system.*\` SQL or grounding an optimization/schema recommendation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE OPERATING RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. NEVER guess database names, table names, columns, or data.
2. NEVER fabricate results.
3. NEVER answer schema/data questions without calling tools first.
4. DO NOT DESCRIBE CHARTS IN TEXT. YOU MUST USE THE \`render_chart\` TOOL TO SHOW THEM IN THE UI!
5. NEVER output markdown tables when a chart is requested. Call \`render_chart\` instead.
6. When the user wants to validate or check a query without running it → use \`validate_sql\`.
7. When the user wants to export, download, or get data as CSV/JSON → use \`export_query_result\`.
8. NEVER call the same tool with identical arguments in consecutive rounds. If a tool already returned data, use that result, call a different next tool, or provide the final answer.

Disambiguation: for historical slow/heavy queries use \`get_slow_queries\`; for queries running right now use \`get_running_queries\`. For a database-level overview (table count, total size) use \`get_database_info\` directly. For syntax-only validation use \`validate_sql\`; for export use \`export_query_result\`. These don't require a skill.

ONLY produce the final text answer after all required tool calls and skill/reference work are complete.
Base your final answer strictly on tool results.
If access is denied, explain clearly.
If a tool fails, surface the error clearly.

You have READ-ONLY access.
Only SELECT / WITH / SHOW / DESCRIBE / EXPLAIN queries are allowed.
Never attempt INSERT, UPDATE, DELETE, CREATE, ALTER, DROP.

## SQL FORMATTING RULE
NEVER append a FORMAT clause (e.g. FORMAT JSON, FORMAT CSV, FORMAT TabSeparated) to any SQL query.
The application handles output formatting internally. A FORMAT clause will break query execution.
`;
}

/** Chat-only tools: NL→SQL guidance + delegating optimizer. */
function createChatSpecificTools(ctx: AgentRunContext): AgentToolSet {
  return {
    generate_query: createAgentTool("generate_query", {
      description:
        "Generate a SQL query based on a natural language description. Use this after gathering schema information from other tools. After calling this, you MUST output the generated query in a ```sql code block. If the user wants the query executed, call run_select_query with that SQL.",
      inputSchema:
        z.object({
          description: z.string().describe("Natural language description of what the query should do"),
          context: z.string().describe("Relevant schema information gathered from other tools"),
        }),
      execute: async ({ description, context }: { description: string; context: string }) => ({
        note: "Generate the SQL query based on the description and schema context. Present it in a ```sql code block. If the user asked to run or execute the query, call run_select_query with that SQL.",
        description,
        schemaContext: context,
      }),
    }),
    optimize_query: createAgentTool("optimize_query", {
      description: "Get AI-powered optimization suggestions for a SQL query.",
      inputSchema: z.object({ sql: z.string().describe("The SQL query to optimize") }),
      execute: async ({ sql }: { sql: string }) => {
        try {
          const result = await runStructuredCapability(optimizeQueryCapability, { query: sql }, ctx);
          return {
            optimizedQuery: result.optimizedQuery,
            summary: result.summary,
            explanation: result.explanation,
            cause: result.cause,
            suggestions: result.suggestions,
          };
        } catch (error: unknown) {
          return { error: error instanceof Error ? error.message : "Failed to optimize query" };
        }
      },
    }),
  } as AgentToolSet;
}

export interface ChatInput {
  /** Conversation history is supplied to the engine as AgentMessage[] by the route. */
  threadId?: string;
}

export const chatCapability: StreamCapability<ChatInput> = {
  id: "chat",
  delivery: "stream",
  permission: PERMISSIONS.AI_CHAT,
  inputSchema: z.object({ threadId: z.string().optional() }),
  tuning: { stopAtSteps: 60, temperature: 0 },

  async tools(ctx): Promise<AgentToolSet> {
    // Validate a live session exists (chat needs core/chart tools).
    requireToolContext(ctx);
    return {
      ...coreTools(ctx),
      ...chartTools(ctx),
      ...createChatSpecificTools(ctx),
    } as AgentToolSet;
  },

  instructions(): string {
    return buildSystemPrompt();
  },
};
