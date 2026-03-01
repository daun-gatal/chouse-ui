/**
 * AI Optimizer & Debugger Service
 *
 * Uses ToolLoopAgent to autonomously gather schema context (DDL, EXPLAIN, etc.)
 * before producing a structured optimization or debug result.
 * This mirrors the AI Chat agent pattern for consistency.
 */

import { ToolLoopAgent, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { AppError } from "../types";
import {
    type AIProvider,
    getConfiguration,
    validateConfiguration,
    initializeAIModel,
    isAIEnabled,
} from "./aiConfig";
import { discoverSkills, createLoadSkillTool } from "./agentSkills";
import { type AgentToolContext, createCoreTools } from "./agentTools";
import { logger } from "../utils/logger";

// ============================================
// Types
// ============================================

export type { AIProvider };

export interface OptimizationResult {
    optimizedQuery: string;
    originalQuery: string;
    explanation: string;
    summary: string;
    tips: string[];
}

export interface DebugResult {
    fixedQuery: string;
    originalQuery: string;
    errorAnalysis: string;
    explanation: string;
    summary: string;
}

export interface OptimizationCheckResult {
    canOptimize: boolean;
    reason: string;
}

// ============================================
// Structured Output Schemas (for JSON extraction)
// ============================================

const OptimizationOutputSchema = z.object({
    optimizedQuery: z
        .string()
        .describe("The full optimized SQL query with explanatory comments"),
    explanation: z
        .string()
        .describe(
            "A detailed markdown explanation of the changes made and why they improve performance."
        ),
    summary: z
        .string()
        .describe(
            "A one-line summary of the main improvement (e.g., 'Replaced WHERE with PREWHERE')."
        ),
    tips: z
        .array(z.string())
        .describe(
            "A list of general performance tips relevant to this specific query pattern."
        ),
});

const DebugOutputSchema = z.object({
    fixedQuery: z.string().describe("The fully corrected SQL query"),
    errorAnalysis: z
        .string()
        .describe("Concise explanation of the error cause"),
    explanation: z
        .string()
        .describe("Detailed markdown explanation of the fix"),
    summary: z.string().describe("One-line summary of the fix"),
});

// ============================================
// JSON Extraction Utility
// ============================================

/**
 * Extracts and parses the first valid JSON object from text.
 * Handles cases where the agent wraps JSON in markdown code blocks or adds preamble text.
 */
function extractJson<T>(text: string, schema: z.ZodType<T>): T {
    const cleaned = text.trim();

    // Try the whole text first
    try {
        return schema.parse(JSON.parse(cleaned));
    } catch {
        // fall through
    }

    // Strip markdown code fences (```json ... ``` or ``` ... ```)
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch?.[1]) {
        try {
            return schema.parse(JSON.parse(fenceMatch[1].trim()));
        } catch {
            // fall through
        }
    }

    // Find the first { ... } span in the text
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
        try {
            return schema.parse(JSON.parse(cleaned.slice(start, end + 1)));
        } catch {
            // fall through
        }
    }

    throw new AppError(
        "AI agent returned an unstructured response. Please retry.",
        "AI_PARSE_ERROR",
        "validation",
        500
    );
}

// ============================================
// SQL Sanitization
// ============================================

/**
 * Remove any trailing FORMAT clause the AI may have appended.
 * The application passes FORMAT to ClickHouse internally — having it in
 * the query text causes a duplicate-format error at execution time.
 *
 * Matches: FORMAT JSON / FORMAT CSV / FORMAT TabSeparated / etc.
 * placed at the very end of the query (after optional semicolon/whitespace).
 */
export function stripFormatClause(sql: string): string {
    return sql
        .replace(/\s*;\s*$/, "")                          // strip trailing semicolon first
        .replace(/\s+FORMAT\s+\w+\s*$/i, "")              // strip trailing FORMAT clause
        .trimEnd();
}

// ============================================
// Skill Loading
// ============================================

/**
 * Load raw skill content from SKILL.md and strip frontmatter.
 */
async function loadSkillContent(skillName: string): Promise<string> {
    try {
        const url = new URL(
            `../skills/ai-optimizer/${skillName}/SKILL.md`,
            import.meta.url
        );
        const content = await fs.readFile(url.pathname, "utf-8");
        const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
        return match ? content.slice(match[0].length).trim() : content.trim();
    } catch (error) {
        logger.error({ module: "AIOptimizer", skillName, err: error instanceof Error ? error.message : String(error) }, "Failed to load skill");
        return "";
    }
}

// ============================================
// Public API
// ============================================

/** Check if AI optimizer feature is enabled */
export async function isOptimizerEnabled(): Promise<boolean> {
    return await isAIEnabled();
}

/** Get the system prompt text for optimization (used by tests) */
export async function getSystemPrompt(): Promise<string> {
    return await loadSkillContent("optimizer");
}

// ============================================
// Prompt Builders (kept as utilities / for tests)
// ============================================

export function buildOptimizationPrompt(
    query: string,
    additionalPrompt?: string
): string {
    let prompt = `Optimize this ClickHouse SQL query:

\`\`\`sql
${query.trim()}
\`\`\`

Use your tools to:
1. Load the \`query-optimizer\` skill for detailed instructions.
2. Fetch the DDL for all tables referenced in the query using \`get_table_ddl\`.
3. Run \`explain_query\` to understand the current execution plan.
4. Produce the optimized query as a JSON response matching the exact schema specified in the optimizer skill.`;

    if (additionalPrompt?.trim()) {
        prompt += `\n\nAdditional instructions from the user:\n${additionalPrompt.trim()}`;
    }

    return prompt;
}

export function buildDebugPrompt(
    query: string,
    error: string,
    additionalPrompt?: string
): string {
    let prompt = `Debug this failed ClickHouse SQL query:

\`\`\`sql
${query.trim()}
\`\`\`

Error:
\`\`\`
${error.trim()}
\`\`\`

Use your tools to:
1. Load the \`query-debugger\` skill for detailed instructions.
2. Fetch the DDL for tables referenced in the query using \`get_table_ddl\`.
3. Validate the corrected query with \`validate_sql\`.
4. Produce the fixed query as a JSON response matching the exact schema specified in the debugger skill.`;

    if (additionalPrompt?.trim()) {
        prompt += `\n\nAdditional instructions from the user:\n${additionalPrompt.trim()}`;
    }

    return prompt;
}

// ============================================
// Error Handling
// ============================================

function handleAiError(error: unknown, context: string): never {
    if (error instanceof AppError) throw error;

    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ module: context }, msg);

    if (msg.includes("rate limit")) {
        throw AppError.badRequest(
            "AI service rate limit exceeded. Please try again later."
        );
    }
    if (msg.includes("API key") || msg.includes("authentication")) {
        throw AppError.internal(
            "AI service authentication failed. Please contact your administrator."
        );
    }
    if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) {
        throw AppError.internal(
            "AI service endpoint is not accessible. Please contact your administrator."
        );
    }

    throw AppError.internal(`AI provider error: ${msg}`);
}

// ============================================
// Optimize Query
// ============================================

/**
 * Optimize a SQL query using a ToolLoopAgent.
 *
 * The agent autonomously fetches table DDL and EXPLAIN plans via tools,
 * then returns a structured OptimizationResult JSON.
 *
 * @param query - The SQL query to optimize
 * @param context - Agent tool context (ClickHouseService + RBAC)
 * @param additionalPrompt - Optional user-provided instructions
 * @param modelId - Optional model ID override
 */
export async function optimizeQuery(
    query: string,
    context: AgentToolContext,
    additionalPrompt?: string,
    modelId?: string
): Promise<OptimizationResult> {
    const config = await getConfiguration(modelId);

    const validation = validateConfiguration(config);
    if (!validation.valid) {
        throw AppError.badRequest(
            validation.error || "AI optimizer is not available"
        );
    }

    try {
        const model = initializeAIModel(config!);

        // Discover optimizer skills (optimizer, evaluator, etc.)
        const skills = await discoverSkills(["../skills/ai-optimizer"]);

        const agent = new ToolLoopAgent({
            model,
            instructions: `You are an expert ClickHouse Query Optimizer agent.
Your job is to analyze and optimize SQL queries using the available tools.

WORKFLOW (follow this order strictly):
1. Call \`load_skill\` with name "query-optimizer" to load your detailed instructions.
2. Use \`get_table_ddl\` for every table referenced in the query.
3. Use \`explain_query\` to understand the current execution plan.
4. Produce ONLY a JSON object (no markdown, no extra text) matching this exact schema:
   {
     "optimizedQuery": "<full optimized SQL>",
     "explanation": "<detailed markdown explanation>",
     "summary": "<one-line summary of improvement>",
     "tips": ["<tip1>", "<tip2>"]
   }`,
            tools: {
                load_skill: createLoadSkillTool(skills),
                ...createCoreTools(context),
            },
            stopWhen: stepCountIs(10),
            temperature: 0.0,
        });

        const messages: ModelMessage[] = [
            {
                role: "user",
                content: buildOptimizationPrompt(query, additionalPrompt),
            },
        ];

        const streamResult = await agent.stream({ messages });
        const rawText = await streamResult.text;

        const parsed = extractJson(rawText, OptimizationOutputSchema);

        // Strip markdown code fences and any trailing FORMAT clause
        let optimizedQuery = parsed.optimizedQuery.trim();
        if (optimizedQuery.startsWith("```")) {
            optimizedQuery = optimizedQuery
                .replace(/^```(?:sql)?\s*/i, "")
                .replace(/\s*```$/, "");
        }
        optimizedQuery = stripFormatClause(optimizedQuery);

        return {
            originalQuery: query,
            optimizedQuery,
            explanation: parsed.explanation,
            summary: parsed.summary,
            tips: parsed.tips,
        };
    } catch (error) {
        handleAiError(error, "AIOptimizer");
    }
}

// ============================================
// Debug Query
// ============================================

/**
 * Debug a failed SQL query using a ToolLoopAgent.
 *
 * The agent fetches table schema / DDL via tools to understand context,
 * then returns a structured DebugResult JSON.
 *
 * @param query - The failed SQL query
 * @param error - The ClickHouse error message
 * @param context - Agent tool context (ClickHouseService + RBAC)
 * @param additionalPrompt - Optional user-provided instructions
 * @param modelId - Optional model ID override
 */
export async function debugQuery(
    query: string,
    error: string,
    context: AgentToolContext,
    additionalPrompt?: string,
    modelId?: string
): Promise<DebugResult> {
    const config = await getConfiguration(modelId);

    const validation = validateConfiguration(config);
    if (!validation.valid) {
        throw AppError.badRequest(
            validation.error || "AI service is not available"
        );
    }

    try {
        const model = initializeAIModel(config!);

        // Discover skills from the shared ai-optimizer directory (includes debugger skill)
        const skills = await discoverSkills(["../skills/ai-optimizer"]);

        const agent = new ToolLoopAgent({
            model,
            instructions: `You are an expert ClickHouse Query Debugger agent.
Your job is to diagnose and fix failed SQL queries using the available tools.

WORKFLOW (follow this order strictly):
1. Call \`load_skill\` with name "query-debugger" to load your detailed instructions.
2. Use \`get_table_ddl\` or \`get_table_schema\` for tables referenced in the query.
3. Use \`validate_sql\` to verify the corrected query is syntactically valid.
4. Produce ONLY a JSON object (no markdown, no extra text) matching this exact schema:
   {
     "fixedQuery": "<fully corrected SQL>",
     "errorAnalysis": "<concise cause of error>",
     "explanation": "<detailed markdown explanation of the fix>",
     "summary": "<one-line summary of the fix>"
   }`,
            tools: {
                load_skill: createLoadSkillTool(skills),
                ...createCoreTools(context),
            },
            stopWhen: stepCountIs(10),
            temperature: 0.0,
        });

        const messages: ModelMessage[] = [
            {
                role: "user",
                content: buildDebugPrompt(query, error, additionalPrompt),
            },
        ];

        const streamResult = await agent.stream({ messages });
        const rawText = await streamResult.text;

        const parsed = extractJson(rawText, DebugOutputSchema);

        let fixedQuery = parsed.fixedQuery.trim();
        if (fixedQuery.startsWith("```")) {
            fixedQuery = fixedQuery
                .replace(/^```(?:sql)?\s*/i, "")
                .replace(/\s*```$/, "");
        }
        fixedQuery = stripFormatClause(fixedQuery);

        return {
            originalQuery: query,
            fixedQuery,
            errorAnalysis: parsed.errorAnalysis,
            explanation: parsed.explanation,
            summary: parsed.summary,
        };
    } catch (error) {
        handleAiError(error, "AIDebugger");
    }
}

// ============================================
// Check Query Optimization (ToolLoopAgent, capped at 4 steps for speed)
// ============================================

const EvaluatorOutputSchema = z.object({
    canOptimize: z
        .boolean()
        .describe("Whether significant optimization is possible"),
    reason: z.string().describe("Brief reason for the decision"),
});

/**
 * Lightweight pre-check to determine if a query is worth optimizing.
 * Uses a ToolLoopAgent capped at 4 steps so it can call `analyze_query`
 * and `get_table_ddl` when needed — consistent with the optimizer/debugger pattern.
 *
 * @param query - The SQL query to evaluate
 * @param modelId - Optional model ID override
 * @param context - Optional agent context; when provided the agent can call schema tools
 */
export async function checkQueryOptimization(
    query: string,
    modelId?: string,
    context?: AgentToolContext
): Promise<OptimizationCheckResult> {
    const config = await getConfiguration(modelId);

    const validation = validateConfiguration(config);
    if (!validation.valid) {
        return {
            canOptimize: false,
            reason: validation.error || "AI not configured",
        };
    }

    try {
        const model = initializeAIModel(config!);
        const skills = await discoverSkills(["../skills/ai-optimizer"]);

        // Always include load_skill; add schema tools when context is available
        const coreTools = context
            ? (({ analyze_query, get_table_ddl, get_table_schema }) => ({
                  analyze_query,
                  get_table_ddl,
                  get_table_schema,
              }))(createCoreTools(context))
            : {};

        const agent = new ToolLoopAgent({
            model,
            instructions: `You are a ClickHouse query evaluator performing a rapid pre-screening check.
Load the "query-evaluator" skill for detailed instructions, then evaluate the query.
Produce ONLY a JSON object (no markdown, no extra text):
{ "canOptimize": true|false, "reason": "<one sentence>" }`,
            tools: {
                load_skill: createLoadSkillTool(skills),
                ...coreTools,
            },
            stopWhen: stepCountIs(4),
            temperature: 0.0,
        });

        const messages: ModelMessage[] = [
            {
                role: "user",
                content: `Evaluate this query:\n\`\`\`sql\n${query.trim()}\n\`\`\``,
            },
        ];

        const streamResult = await agent.stream({ messages });
        const rawText = await streamResult.text;

        return extractJson(rawText, EvaluatorOutputSchema);
    } catch (error) {
        logger.error(
            { module: "IOCheck", err: error instanceof Error ? error.message : String(error) },
            "Optimization check failed"
        );
        return { canOptimize: false, reason: "Analysis failed" };
    }
}
