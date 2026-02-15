import { generateText, Output } from "ai";
import { z } from "zod";
import { format } from "sql-formatter";
import { createOpenAI } from "@ai-sdk/openai";
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

export type AIProvider = "openai" | "anthropic" | "google" | "huggingface";

interface AIConfiguration {
    enabled: boolean;
    provider: AIProvider;
    apiKey: string | undefined;
    modelName: string | undefined;
    baseUrl: string | undefined;
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
- **Do NOT** change the semantic meaning of the result set.
- **Do NOT**hallucinate table names or columns not present in the context.
- If the query is already optimal, return it as-is but provide a confirmation in the summary.
- If the query uses non-optimized logic (e.g., \`LIKE '%term%'\`), suggest \`tokenbf_v1\` index or inverted index in the **tips** section.
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
    const validProviders: AIProvider[] = ["openai", "anthropic", "google", "huggingface"];
    if (!validProviders.includes(config.provider)) {
        return {
            valid: false,
            error: `Invalid AI provider: ${config.provider}.Supported: ${validProviders.join(", ")}`,
        };
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
 * Parse AI response to extract JSON
 * Exported for testing
 */
// parseAIResponse removed as we use structured output now
