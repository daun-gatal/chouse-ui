/**
 * Capability: chat — the conversational SRE assistant.
 *
 * The only streaming capability. The engine builds the agent (model + tools +
 * instructions); SSE framing, scratchpad stripping, chart-data events and
 * thread persistence stay in the route, which is genuinely chat-specific.
 */

import { tool, zodSchema, type ToolSet } from "ai";
import { z } from "zod";
import { PERMISSIONS } from "../../../rbac/schema/base";
import {
  discoverSkills,
  createLoadSkillTool,
  type SkillMetadata,
} from "../../agentSkills";
import {
  discoverReferences,
  createLoadReferenceTool,
  type ReferenceMetadata,
} from "../../agentReferences";
import { coreTools, chartTools, requireToolContext } from "../toolsets";
import { runStructuredCapability } from "../engine";
import { optimizeQueryCapability } from "./optimizeQuery";
import type { AgentRunContext, StreamCapability } from "../types";

const CHAT_SKILL_DIR = "../skills/ai-chat";
const REFERENCES_DIR = "../references";

function buildSystemPrompt(skills: SkillMetadata[], references: ReferenceMetadata[]): string {
  const skillsList = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  const referencesList = references.map((r) => `- ${r.name}: ${r.description}`).join("\n");
  // Decision framework is generated from each skill's `when_to_use` (falling back
  // to its description), so adding a skill dir automatically extends routing.
  const decisionFramework = skills
    .map((s) => `- ${s.when_to_use ?? s.description} → call \`load_skill\` with "${s.name}"`)
    .join("\n");

  return `
You are an expert ClickHouse assistant embedded inside CHouse UI.
You operate in STRICT TOOL-FIRST MODE.

## SKILLS
You have an arsenal of complex operating instructions saved as skills on the filesystem.
You MUST use the \`load_skill\` tool to retrieve these instructions BEFORE performing complex tasks!

Available skills:
${skillsList}

## REFERENCES
Reference docs hold exact ClickHouse facts (system.* column names, the optimization playbook, the type/codec guide).
Use the \`load_reference\` tool to pull one into context BEFORE writing raw \`system.*\` SQL or grounding an optimization/schema recommendation.

Available references:
${referencesList}

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

## DECISION FRAMEWORK: WHEN TO LOAD SKILLS
Identify the user's intent, then call \`load_skill\` for the matching skill BEFORE taking action:
${decisionFramework}

Disambiguation: for historical slow/heavy queries use \`get_slow_queries\`; for queries running right now use \`get_running_queries\`. For a database-level overview (table count, total size) use \`get_database_info\` directly. For syntax-only validation use \`validate_sql\`; for export use \`export_query_result\`. These don't require a skill.

When a skill's instructions tell you to load a reference, call \`load_reference\` before running the relevant \`system.*\` SQL or proposing the fix.

ONLY produce the final text answer after all required tool calls (and skill/reference loads) are complete.
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
function createChatSpecificTools(ctx: AgentRunContext): ToolSet {
  return {
    generate_query: tool({
      description:
        "Generate a SQL query based on a natural language description. Use this after gathering schema information from other tools. After calling this, you MUST output the generated query in a ```sql code block. If the user wants the query executed, call run_select_query with that SQL.",
      inputSchema: zodSchema(
        z.object({
          description: z.string().describe("Natural language description of what the query should do"),
          context: z.string().describe("Relevant schema information gathered from other tools"),
        }),
      ),
      execute: async ({ description, context }: { description: string; context: string }) => ({
        note: "Generate the SQL query based on the description and schema context. Present it in a ```sql code block. If the user asked to run or execute the query, call run_select_query with that SQL.",
        description,
        schemaContext: context,
      }),
    }),
    optimize_query: tool({
      description: "Get AI-powered optimization suggestions for a SQL query.",
      inputSchema: zodSchema(z.object({ sql: z.string().describe("The SQL query to optimize") })),
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
  } as ToolSet;
}

export interface ChatInput {
  /** Conversation history is supplied to the engine as ModelMessage[] by the route. */
  threadId?: string;
}

export const chatCapability: StreamCapability<ChatInput> = {
  id: "chat",
  delivery: "stream",
  permission: PERMISSIONS.AI_CHAT,
  inputSchema: z.object({ threadId: z.string().optional() }),
  tuning: { stopAtSteps: 30, temperature: 0 },

  async tools(ctx): Promise<ToolSet> {
    // Validate a live session exists (chat needs core/chart tools).
    requireToolContext(ctx);
    const [skills, references] = await Promise.all([
      discoverSkills([CHAT_SKILL_DIR]),
      discoverReferences([REFERENCES_DIR]),
    ]);
    return {
      load_skill: createLoadSkillTool(skills),
      load_reference: createLoadReferenceTool(references),
      ...coreTools(ctx),
      ...chartTools(ctx),
      ...createChatSpecificTools(ctx),
    } as ToolSet;
  },

  async instructions(): Promise<string> {
    const [skills, references] = await Promise.all([
      discoverSkills([CHAT_SKILL_DIR]),
      discoverReferences([REFERENCES_DIR]),
    ]);
    return buildSystemPrompt(skills, references);
  },
};
