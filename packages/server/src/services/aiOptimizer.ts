import { generateText, Output } from "ai";
import { z } from "zod";
import { formatDialect, clickhouse } from "sql-formatter";
import { promises as fs } from "node:fs";
import type { TableDetails } from "../types";
import { AppError } from "../types";
import {
    type AIProvider,
    getConfiguration,
    validateConfiguration,
    initializeAIModel,
    isAIEnabled,
} from "./aiConfig";

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

// AIProvider and AIConfiguration types are now imported from aiConfig.ts

// ============================================
// Configuration & Skills Loading
// ============================================

/**
 * Load skill content from SKILL.md and strip frontmatter
 */
async function loadSkillContent(skillName: string): Promise<string> {
    try {
        const url = new URL(`../skills/ai-optimizer/${skillName}/SKILL.md`, import.meta.url);
        const content = await fs.readFile(url.pathname, "utf-8");
        const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
        return match ? content.slice(match[0].length).trim() : content.trim();
    } catch (error) {
        console.error(`[AIOptimizer] Failed to load skill ${skillName}:`, error);
        return "";
    }
}

// Configuration functions (getConfiguration, validateConfiguration, initializeAIModel)
// are now imported from aiConfig.ts

// ============================================
// Public API
// ============================================

/**
 * Check if AI optimizer is enabled
 */
export async function isOptimizerEnabled(): Promise<boolean> {
    return await isAIEnabled();
}

/**
 * Get system prompt for optimization
 */
export async function getSystemPrompt(): Promise<string> {
    return await loadSkillContent('optimizer');
}

export function buildOptimizationPrompt(
    query: string,
    tableDetails: TableDetails[],
    additionalPrompt?: string
): string {
    const schemasText = tableDetails
        .map((details) => {
            const prettyDdl = formatDialect(details.create_table_query, {
                dialect: clickhouse,
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
            const prettyDdl = formatDialect(details.create_table_query, {
                dialect: clickhouse,
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
    additionalPrompt?: string,
    modelId?: string
): Promise<OptimizationResult> {
    const config = await getConfiguration(modelId);

    // Validate configuration
    const validation = validateConfiguration(config);
    if (!validation.valid) {
        throw AppError.badRequest(validation.error || "AI optimizer is not available");
    }

    try {
        // Build the user prompt
        const userPrompt = buildOptimizationPrompt(query, tableDetails, additionalPrompt);

        // Initialize AI model based on provider
        const model = initializeAIModel(config!);

        // Generate optimization using structured output via generateText
        const systemPrompt = await loadSkillContent('optimizer');

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
            system: systemPrompt,
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
    additionalPrompt?: string,
    modelId?: string
): Promise<DebugResult> {
    const config = await getConfiguration(modelId);

    // Validate configuration
    const validation = validateConfiguration(config);
    if (!validation.valid) {
        throw AppError.badRequest(validation.error || "AI service is not available");
    }

    try {
        // Build the user prompt
        const userPrompt = buildDebugPrompt(query, error, tableDetails, additionalPrompt);

        // Initialize AI model based on provider
        const model = initializeAIModel(config!);

        // Generate debugging fix using structured output via generateText
        const systemPrompt = await loadSkillContent('debugger');

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
            system: systemPrompt,
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
    tableDetails: TableDetails[],
    modelId?: string
): Promise<OptimizationCheckResult> {
    const config = await getConfiguration(modelId);

    const validation = validateConfiguration(config);
    if (!validation.valid) {
        // silently fail or return false if not configured, but strictly we might throw
        // For check, let's just return false to avoid noise
        return { canOptimize: false, reason: validation.error || "AI not configured" };
    }

    try {
        const userPrompt = buildOptimizationPrompt(query, tableDetails); // We can reuse the builder
        const model = initializeAIModel(config!);

        const systemPrompt = await loadSkillContent('evaluator');

        const result = await generateText({
            model,
            output: Output.object({
                schema: z.object({
                    canOptimize: z.boolean().describe("Whether significant optimization is possible"),
                    reason: z.string().describe("Brief reason for the decision"),
                }),
            }),
            system: systemPrompt,
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
