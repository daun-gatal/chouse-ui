import { generateText, Output } from "ai";
import { z } from "zod";
import { format } from "sql-formatter";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createHuggingFace } from "@ai-sdk/huggingface";
import type { TableDetails } from "../types";
import { AppError } from "../types";

// ============================================
// Types
// ============================================

export interface TableSchema {
    database: string;
    table: string;
    engine: string;
    columns: Array<{
        name: string;
        type: string;
        comment?: string;
    }>;
}

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

export type AIProvider = "openai" | "anthropic" | "google" | "huggingface" | "openai-compatible";

interface AIConfiguration {
    enabled: boolean;
    provider: AIProvider;
    apiKey: string | undefined;
    modelName: string | undefined;
    baseUrl: string | undefined;
    headers: Record<string, string> | undefined;
}

// ============================================
// Configuration
// ============================================

const OPTIMIZER_SYSTEM_PROMPT = `
You are an expert ClickHouse Database Administrator and Query Optimizer.
Your goal is to accept a SQL query (and optional schema/context) and output a strictly structured JSON response containing the optimized SQL and a detailed technical analysis.

## ROLE & PERSONA
- **Role**: Senior ClickHouse Performance Engineer.
- **Tone**: Professional, technical, concise, and authoritative. NO conversational filler (e.g., "Here is the optimized query").
- **Focus**: Latency reduction, resource usage (CPU/Memory/IO) minimization, and scalability.

## OUPUT FORMAT INSTRUCTIONS
You must strictly return a JSON object with the following fields:
1. **optimizedQuery**: The fully rewritten SQL query. Use standard formatting.
2. **explanation**: A Markdown-formatted technical report explaining *why* changes were made.
   - Use strict Markdown headers (e.g., \`### Analysis\`, \`### Changes\`).
   - Use bolding for key terms (e.g., **PREWHERE**).
   - Use bullet points for lists.
   - Reference specific ClickHouse concepts (e.g., "MergeTree index granularity", "partition pruning").
   - Compare the original vs. optimized approach (e.g., "Moving the filter to PREWHERE reduces data read by ~50% before joins").
   - **IMPORTANT**: If a specific issue was detected (e.g., "Missing PREWHERE"), explicitly address it in the explanation.
3. **summary**: A single, punchy sentence highlighting the primary gain (e.g., "Reduced scan volume by leveraging partition pruning and PREWHERE").
4. **tips**: An array of strings containing general best practices relevant to this *specific* query type (e.g., "Consider adding a generic index on 'user_id' if this query is frequent").

## OPTIMIZATION STRATEGIES (PRIORITY ORDER)
1. **Data Pruning**:
   - Move low-cardinality or indexed filters to **PREWHERE**.
   - Ensure partition keys are used in WHERE/PREWHERE.
2. **Index Usage**:
   - Verify usage of Primary Key and Sorting Keys.
   - Suggest Data Skipping Indices if pattern matching is heavy.
3. **Efficient Aggregation**:
   - Use **-If** combinators (e.g., \`countIf\`) instead of CASE WHEN inside aggregations.
   - Use \`uniqSketch\` or \`uniqCombined\` for approximate counting instead of \`COUNT(DISTINCT)\` on large sets.
4. **Join Optimization**:
   - prefer \`ANY LEFT JOIN\` or \`SEMI JOIN\` if multiplicity allows.
   - Ensure the smaller table is on the **RIGHT** side of the JOIN.
   - Use \`GLOBAL\` joins only when necessary for distributed tables.
5. **Column Handling**:
   - Remove unused columns (No \`SELECT *\`).
   - Use specialized functions (e.g., \`parseDateTimeBestEffort\`) over complex casting chains.

## CRITICAL RULES
- **Do NOT** change the semantic meaning of the result set, UNLESS the query is an unbounded \`SELECT *\` or full table scan. In that case:
  - Add \`LIMIT 100\` if missing.
  - Add a commented-out \`PREWHERE\` clause as an example (e.g. \`-- PREWHERE created_at >= now() - INTERVAL 1 DAY\`).
  - Replace \`SELECT *\` with explicit columns if known, or add a comment advising the user to specify columns.
- **Do NOT** hallucinate table names or columns not present in the context.
- If the query is already optimal, return it as-is but provide a confirmation in the summary.
- If the query uses non-optimized logic (e.g., \`LIKE '%term%'\`), suggest \`tokenbf_v1\` index or inverted index in the **tips** section.`;

const OPTIMIZER_CHECK_SYSTEM_PROMPT = `You are an expert ClickHouse SQL optimizer.
Your goal is to quickly determine if a given SQL query has ANY potential for optimization.

## OUPUT FORMAT INSTRUCTIONS
You must strictly return a JSON object with the following fields:
1. "canOptimize": boolean (true or false).
2. "reason": string (a brief reason for the decision).

Set canOptimize to true if:
1. The query scans a large table without a partition key or primary key filter.
2. It uses SELECT * on a wide table WITHOUT a LIMIT.
3. It uses standard SQL functions where ClickHouse specialized functions exist (e.g. COUNT(DISTINCT) vs uniq).
4. It performs high-cardinality GROUP BYs without sampling.
5. It uses JOINs that could be optimized with IN or dictionaries.
6. It is missing FINAL on ReplacingMergeTree (if relevant).
7. It could benefit from PREWHERE.

Set canOptimize to false if:
1. The query is already highly optimized (e.g. uses PREWHERE, partition pruning keys).
2. The query is trivial (SELECT 1).
3. The query appears to be the result of a recent optimization (e.g. follows best practices strictly).
4. The query uses SELECT * BUT has a small LIMIT (e.g. LIMIT 100).

Be biased towards returning canOptimize as false if the query looks structured and deliberate. Return true only for obvious inefficiencies.`;

const DEBUGGER_SYSTEM_PROMPT = `
You are an expert ClickHouse Database Administrator and Query Debugger.
Your goal is to accept a failed SQL query, the error message, and optional schema / context, then output a strictly structured JSON response containing the fixed SQL and a detailed technical analysis of the error.

## ROLE & PERSONA
- **Role**: Senior ClickHouse Logic & Syntax Expert.
- **Tone**: Professional, technical, concise, and helpful.
- **Focus**: Correctness, syntax fixing, and logic correction.

## OUTPUT FORMAT INSTRUCTIONS
You must strictly return a JSON object with the following fields:
1. **fixedQuery**: The fully corrected SQL query. Use standard formatting.
2. **errorAnalysis**: A concise explanation of what caused the error (e.g., "Field 'x' does not exist in table 'y'").
3. **explanation**: A Markdown-formatted technical report explaining the fix.
   - Use strict Markdown headers (e.g., \`### Error\`, \`### Fix\`).
   - Use bolding for key terms.
   - clearly explain *why* the original query failed and *how* the fix resolves it.
4. **summary**: A single, punchy sentence summarizing the fix (e.g., "Corrected typo in column name and added missing GROUP BY clause").

## DEBUGGING STRATEGIES
1. **Syntax Errors**: Fix typos, missing keywords, incorrect punctuation.
2. **Logic Errors**: Fix incorrect JOIN conditions, missing GROUP BY, incorrect aggregations.
3. **Type Errors**: Fix type mismatches, add type casting if necessary.
4. **ClickHouse Specifics**: Ensure valid ClickHouse SQL functions and syntax are used.

## CRITICAL RULES
- **Do NOT** change the semantic meaning of the result set unless the original meaning was impossible due to the error.
- **Do NOT** hallucinate table names or columns not present in the context.
- - If the query cannot be fixed with the given context, allow **fixedQuery** to be the same but explain why in **explanation**.
`;

/**
 * Get AI optimizer configuration from environment variables
 */
function getConfiguration(): AIConfiguration {
    const provider = (process.env.AI_PROVIDER || "openai") as AIProvider;
    return {
        enabled: process.env.AI_OPTIMIZER_ENABLED === "true",
        provider,
        apiKey: process.env.AI_API_KEY,
        modelName: process.env.AI_MODEL_NAME,
        baseUrl: process.env.AI_BASE_URL,
        headers: process.env.AI_OPENAI_COMPATIBLE_HEADERS
            ? JSON.parse(process.env.AI_OPENAI_COMPATIBLE_HEADERS)
            : undefined,
    };
}

// getDefaultModelName removed as we mandate model name in config or env


/**
 * Validate AI optimizer configuration
 */
function validateConfiguration(): { valid: boolean; error?: string } {
    const config = getConfiguration();

    if (!config.enabled) {
        return {
            valid: false,
            error: "AI optimizer is not enabled. Please contact your administrator.",
        };
    }

    if (!config.apiKey) {
        return {
            valid: false,
            error: "AI optimizer is not configured. Missing AI_API_KEY.",
        };
    }

    // Validate provider
    const validProviders: AIProvider[] = ["openai", "anthropic", "google", "huggingface", "openai-compatible"];
    if (!validProviders.includes(config.provider)) {
        return {
            valid: false,
            error: `Invalid AI provider: ${config.provider}.Supported: ${validProviders.join(", ")}`,
        };
    }

    // Validate baseUrl protocol for openai-compatible
    if (config.provider === "openai-compatible") {
        if (!config.baseUrl) {
            return {
                valid: false,
                error: "AI_BASE_URL is required when using the openai-compatible provider",
            };
        }
    }

    if (config.baseUrl) {
        try {
            const url = new URL(config.baseUrl);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
                return {
                    valid: false,
                    error: "AI_BASE_URL must be a valid HTTP/HTTPS URL",
                };
            }
        } catch (e) {
            return {
                valid: false,
                error: "AI_BASE_URL must be a valid URL",
            };
        }
    }

    return { valid: true };
}

/**
 * Initialize AI model based on provider configuration
 */
function initializeAIModel(config: AIConfiguration) {
    // Model name must be provided via env or config
    const modelName = config.modelName;

    if (!modelName) {
        throw new AppError("AI model name is not configured. Please set AI_MODEL_NAME environment variable.", "AI_CONFIGURATION_ERROR", "validation", 500);
    }

    switch (config.provider) {
        case "openai": {
            const provider = createOpenAI({
                apiKey: config.apiKey,
                baseURL: config.baseUrl,
            });
            return provider(modelName);
        }
        case "anthropic": {
            const provider = createAnthropic({
                apiKey: config.apiKey,
                baseURL: config.baseUrl,
            });
            return provider(modelName);
        }
        case "google": {
            const provider = createGoogleGenerativeAI({
                apiKey: config.apiKey,
                baseURL: config.baseUrl,
            });
            return provider(modelName);
        }
        case "huggingface": {
            const provider = createHuggingFace({
                apiKey: config.apiKey,
                baseURL: config.baseUrl,
            });
            return provider(modelName);
        }
        case "openai-compatible": {
            if (!config.baseUrl) {
                // Should be caught by validation, but TS requires it for createOpenAICompatible
                throw new AppError("AI_BASE_URL is required for openai-compatible", "AI_CONFIGURATION_ERROR", "validation", 500);
            }
            const provider = createOpenAICompatible({
                name: "openai-compatible",
                baseURL: config.baseUrl,
                apiKey: config.apiKey,
                headers: config.headers,
            });
            return provider(modelName);
        }
        default:
            throw new AppError(
                `Unsupported AI provider: ${config.provider} `,
                "CONFIGURATION_ERROR",
                "unknown",
                500
            );
    }
}

// ============================================
// Public API
// ============================================

/**
 * Check if AI optimizer is enabled
 */
export function isOptimizerEnabled(): boolean {
    return getConfiguration().enabled;
}

/**
 * Get system prompt for optimization
 */
export function getSystemPrompt(): string {
    return OPTIMIZER_SYSTEM_PROMPT;
}

export function buildOptimizationPrompt(
    query: string,
    tableDetails: TableDetails[],
    additionalPrompt?: string
): string {
    const schemasText = tableDetails
        .map((details) => {
            const prettyDdl = format(details.create_table_query, {
                language: "mariadb",
                tabWidth: 2,
                keywordCase: "upper",
                linesBetweenQueries: 2,
            });
            return `-- - TABLE: ${details.database}.${details.table} ---
    ${prettyDdl.trim()} `;
        })
        .join("\n\n");

    let prompt = `
Original Query:
===============
\`\`\`sql
${query.trim()}
\`\`\`

Table Definitions (DDL):
========================
${schemasText}`;

    if (additionalPrompt && additionalPrompt.trim()) {
        prompt += `

Additional Instructions:
========================
${additionalPrompt.trim()}`;
    }

    return prompt;
}

export function buildDebugPrompt(
    query: string,
    error: string,
    tableDetails: TableDetails[] = [],
    additionalPrompt?: string
): string {
    const schemasText = tableDetails
        .map((details) => {
            const prettyDdl = format(details.create_table_query, {
                language: "mariadb",
                tabWidth: 2,
                keywordCase: "upper",
                linesBetweenQueries: 2,
            });
            return `-- - TABLE: ${details.database}.${details.table} ---
    ${prettyDdl.trim()} `;
        })
        .join("\n\n");

    let prompt = `
Failed Query:
=============
\`\`\`sql
${query.trim()}
\`\`\`

Error Message:
==============
${error.trim()}

Table Definitions (DDL):
========================
${schemasText || "No schema provided."}`;

    if (additionalPrompt && additionalPrompt.trim()) {
        prompt += `

Additional Instructions:
========================
${additionalPrompt.trim()}`;
    }

    return prompt;
}

/**
 * Optimize a SQL query using AI
 * @param query - The SQL query to optimize
 * @param tableDetails - Array of table details for tables used in the query
 * @param additionalPrompt - Optional additional instructions for the AI
 * @returns Optimized query with explanation
 */
export async function optimizeQuery(
    query: string,
    tableDetails: TableDetails[],
    additionalPrompt?: string
): Promise<OptimizationResult> {
    // Validate configuration
    const validation = validateConfiguration();
    if (!validation.valid) {
        throw AppError.badRequest(validation.error || "AI optimizer is not available");
    }

    const config = getConfiguration();

    try {
        // Build the user prompt
        const userPrompt = buildOptimizationPrompt(query, tableDetails, additionalPrompt);

        // Initialize AI model based on provider
        const model = initializeAIModel(config);

        // Generate optimization using structured output via generateText
        const result = await generateText({
            model,
            output: Output.object({
                schema: z.object({
                    optimizedQuery: z.string().describe("The full optimized SQL query with explanatory comments"),
                    explanation: z.string().describe("A detailed markdown explanation of the changes made and why they improve performance."),
                    summary: z.string().describe("A one-line summary of the main improvement (e.g., 'Replaced WHERE with PREWHERE')."),
                    tips: z.array(z.string()).describe("A list of general performance tips relevant to this specific query pattern."),
                }),
            }),
            system: OPTIMIZER_SYSTEM_PROMPT,
            prompt: userPrompt,
            temperature: 0.0,
        });

        // result.output is the structured object
        let optimizedQuery = result.output.optimizedQuery.trim();

        // Strip markdown code blocks if present
        if (optimizedQuery.startsWith("```")) {
            optimizedQuery = optimizedQuery.replace(/^```(?:sql)?\s*/i, "").replace(/\s*```$/, "");
        }

        return {
            originalQuery: query,
            optimizedQuery: optimizedQuery,
            explanation: result.output.explanation,
            summary: result.output.summary,
            tips: result.output.tips,
        };
    } catch (error) {
        // Handle specific error types
        if (error instanceof AppError) {
            throw error;
        }

        // Log error for debugging (server-side only)
        console.error("[AIOptimizer] Optimization failed:", error instanceof Error ? error.message : String(error));

        // Check for rate limiting
        if (error instanceof Error && error.message.includes("rate limit")) {
            throw AppError.badRequest("AI service rate limit exceeded. Please try again later.");
        }

        // Check for invalid API key
        if (error instanceof Error && (error.message.includes("API key") || error.message.includes("authentication"))) {
            throw AppError.internal("AI service authentication failed. Please contact your administrator.");
        }

        // Check for network errors
        if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("ETIMEDOUT"))) {
            throw AppError.internal("AI service endpoint is not accessible. Please contact your administrator.");
        }

        // Generic error
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        throw AppError.internal(`AI provider error: ${errorMessage} `);
    }
}


/**
 * Debug a failed SQL query using AI
 * @param query - The failed SQL query
 * @param error - The error message
 * @param tableDetails - Array of table details for tables used in the query
 * @param additionalPrompt - Optional additional instructions for the AI
 * @returns Debug result with fixed query and explanation
 */
export async function debugQuery(
    query: string,
    error: string,
    tableDetails: TableDetails[] = [],
    additionalPrompt?: string
): Promise<DebugResult> {
    // Validate configuration
    const validation = validateConfiguration();
    if (!validation.valid) {
        throw AppError.badRequest(validation.error || "AI service is not available");
    }

    const config = getConfiguration();

    try {
        // Build the user prompt
        const userPrompt = buildDebugPrompt(query, error, tableDetails, additionalPrompt);

        // Initialize AI model based on provider
        const model = initializeAIModel(config);

        // Generate optimization using structured output via generateText
        const result = await generateText({
            model,
            output: Output.object({
                schema: z.object({
                    fixedQuery: z.string().describe("The fully corrected SQL query"),
                    errorAnalysis: z.string().describe("Concise explanation of the error cause"),
                    explanation: z.string().describe("Detailed markdown explanation of the fix"),
                    summary: z.string().describe("One-line summary of the fix"),
                }),
            }),
            system: DEBUGGER_SYSTEM_PROMPT,
            prompt: userPrompt,
            temperature: 0.0,
        });

        // result.output is the structured object
        let fixedQuery = result.output.fixedQuery.trim();

        // Strip markdown code blocks if present
        if (fixedQuery.startsWith("```")) {
            fixedQuery = fixedQuery.replace(/^```(?:sql)?\s*/i, "").replace(/\s*```$/, "");
        }

        return {
            originalQuery: query,
            fixedQuery: fixedQuery,
            errorAnalysis: result.output.errorAnalysis,
            explanation: result.output.explanation,
            summary: result.output.summary,
        };
    } catch (error) {
        // Handle specific error types
        if (error instanceof AppError) {
            throw error;
        }

        // Log error for debugging (server-side only)
        console.error("[AIDebugger] Debugging failed:", error instanceof Error ? error.message : String(error));

        // Check for rate limiting
        if (error instanceof Error && error.message.includes("rate limit")) {
            throw AppError.badRequest("AI service rate limit exceeded. Please try again later.");
        }

        // Check for invalid API key
        if (error instanceof Error && (error.message.includes("API key") || error.message.includes("authentication"))) {
            throw AppError.internal("AI service authentication failed. Please contact your administrator.");
        }

        // Check for network errors
        if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("ETIMEDOUT"))) {
            throw AppError.internal("AI service endpoint is not accessible. Please contact your administrator.");
        }

        // Generic error
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        throw AppError.internal(`AI provider error: ${errorMessage}`);
    }
}

/**
 * Check if a query can be optimized (Lightweight check)
 * @param query - The SQL query to check
 * @param tableDetails - Array of table details
 */
export async function checkQueryOptimization(
    query: string,
    tableDetails: TableDetails[]
): Promise<OptimizationCheckResult> {
    const validation = validateConfiguration();
    if (!validation.valid) {
        // silently fail or return false if not configured, but strictly we might throw
        // For check, let's just return false to avoid noise
        return { canOptimize: false, reason: "AI not configured" };
    }

    const config = getConfiguration();

    try {
        const userPrompt = buildOptimizationPrompt(query, tableDetails); // We can reuse the builder
        const model = initializeAIModel(config);

        const result = await generateText({
            model,
            output: Output.object({
                schema: z.object({
                    canOptimize: z.boolean().describe("Whether significant optimization is possible"),
                    reason: z.string().describe("Brief reason for the decision"),
                }),
            }),
            system: OPTIMIZER_CHECK_SYSTEM_PROMPT,
            prompt: userPrompt,
            temperature: 0.0,
        });

        return result.output;
    } catch (error) {
        // Return false on error for background check to be non-intrusive
        console.error("[IOCheck] Optimization check failed:", error);
        return { canOptimize: false, reason: "Analysis failed" };
    }
}
