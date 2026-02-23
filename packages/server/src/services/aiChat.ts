/**
 * AI Chat Service
 * 
 * Conversational AI assistant for ClickHouse.
 * Uses AI SDK v6 streamText with 15 single-responsibility tools.
 * All schema/data tools are RBAC-aware via existing dataAccess middleware.
 */

import { streamText, tool, stepCountIs, zodSchema, type ModelMessage } from "ai";
import { z } from "zod";
import { getConfiguration, validateConfiguration, initializeAIModel } from "./aiConfig";
import { AppError } from "../types";
import { ClickHouseService } from "./clickhouse";
import {
    filterDatabases,
    filterTables,
    checkTableAccess,
    checkDatabaseAccess,
    validateQueryAccess,
} from "../middleware/dataAccess";
import { analyzeQuery } from "./queryAnalyzer";
import { optimizeQuery as aiOptimizeQuery } from "./aiOptimizer";

// ============================================
// Types
// ============================================

export interface ChatContext {
    /** RBAC user ID */
    userId: string;
    /** Whether user is an RBAC admin */
    isAdmin: boolean;
    /** User's RBAC permissions array */
    permissions: string[];
    /** ClickHouse connection ID */
    connectionId?: string;
    /** ClickHouse service for executing queries */
    clickhouseService: ClickHouseService;
    /** Default database from connection config */
    defaultDatabase?: string;
}

// ============================================
// System Prompt
// ============================================

const SYSTEM_PROMPT = `You are an expert ClickHouse database assistant embedded in the CHouse UI application.

## CRITICAL: Silent Tooling Protocol
- Do NOT produce ANY text output before or during tool calls.
- When you need data, call tools IMMEDIATELY without narrating what you're about to do.
- NEVER fabricate, guess, or hallucinate database names, table names, column names, or query results.
- Only produce your final response AFTER all tool calls have completed and returned results.
- If you need multiple tools, call them all before writing any response text.
- Your text response must be based EXCLUSIVELY on tool results. Never invent data.

## Core Behavior
- You help users explore their ClickHouse databases, understand schema, write queries, and analyze performance.
- ALWAYS use tools to gather real data before answering questions about the user's databases.
- NEVER guess table names, column names, or data — always use tools to look them up.
- Format SQL in \`\`\`sql code blocks.
- Keep responses concise but informative.

## Tool Usage Guidelines
- Use \`list_databases\` and \`list_tables\` to discover what the user has access to.
- Use \`get_table_schema\` and \`get_table_ddl\` to understand table structure before writing queries.
- Use \`get_table_sample\` to preview data and understand column content.
- Use \`run_select_query\` to execute read-only queries. Results are limited to 100 rows.
- Use \`explain_query\` to analyze query plans.
- Use \`analyze_query\` to get complexity scoring and performance recommendations.
- Use \`optimize_query\` to get AI-powered optimization suggestions.
- Chain tools as needed. For example: list_tables → get_table_schema → run_select_query.

## Constraints
- You can ONLY execute read-only operations (SELECT, SHOW, DESCRIBE, EXPLAIN).
- NEVER attempt DDL (CREATE, ALTER, DROP) or DML (INSERT, UPDATE, DELETE) operations.
- If the user asks you to modify data, explain that you only have read-only access and suggest they use the query editor.
- The databases and tables you can see are filtered by the user's access permissions.

## CRITICAL: Response Formatting Rules
- **ALL SQL MUST be wrapped in a fenced code block.** Always use \`\`\`sql ... \`\`\` — no exceptions.
- NEVER write SQL as plain text, never embed SQL inline in a sentence, and NEVER put SQL inside a markdown table cell.
- When you include a query example, always present it in its own \`\`\`sql\`\`\` block on its own line.
- Use markdown tables ONLY for tabular data (like query results or schema comparisons). Do NOT put queries inside table cells.
- Use proper markdown throughout: headers (\`##\`), bullet points, bold (\`**text**\`), and code blocks (\`\`\`sql or \`\`\`json).
- When showing query results, format them as markdown tables.
- Explain your reasoning and findings clearly.
- If a tool call fails, explain the error to the user helpfully.
`;


// ============================================
// Tool Definitions
// ============================================

function createTools(ctx: ChatContext) {
    return {
        // 1. List databases (RBAC-filtered)
        list_databases: tool({
            description: "List all available database names. Results are filtered by user permissions.",
            inputSchema: zodSchema(z.object({})),
            execute: async (): Promise<Record<string, unknown>> => {
                try {
                    const result = await ctx.clickhouseService.executeQuery<{ name: string }>(
                        "SHOW DATABASES", "JSON"
                    );
                    const allDbs = result.data.map((r: Record<string, unknown>) => (r as { name: string }).name);
                    const filtered = await filterDatabases(
                        ctx.userId, ctx.isAdmin, allDbs, ctx.connectionId
                    );
                    return { databases: filtered };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to list databases" };
                }
            },
        }),

        // 2. List tables (RBAC-filtered)
        list_tables: tool({
            description: "List all tables in a specific database. Results are filtered by user permissions.",
            inputSchema: zodSchema(z.object({
                database: z.string().describe("Database name to list tables from"),
            })),
            execute: async ({ database }: { database: string }): Promise<Record<string, unknown>> => {
                try {
                    const hasAccess = await checkDatabaseAccess(
                        ctx.userId, ctx.isAdmin, database, ctx.connectionId
                    );
                    if (!hasAccess) {
                        return { error: `Access denied to database '${database}'` };
                    }
                    const result = await ctx.clickhouseService.executeQuery<{ name: string }>(
                        `SHOW TABLES FROM ${database}`, "JSON"
                    );
                    const allTables = result.data.map((r: Record<string, unknown>) => (r as { name: string }).name);
                    const filtered = await filterTables(
                        ctx.userId, ctx.isAdmin, database, allTables, ctx.connectionId
                    );
                    return { database, tables: filtered };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to list tables" };
                }
            },
        }),

        // 3. Get table schema
        get_table_schema: tool({
            description: "Get column names and types for a specific table.",
            inputSchema: zodSchema(z.object({
                database: z.string().describe("Database name"),
                table: z.string().describe("Table name"),
            })),
            execute: async ({ database, table }: { database: string; table: string }): Promise<Record<string, unknown>> => {
                try {
                    const hasAccess = await checkTableAccess(
                        ctx.userId, ctx.isAdmin, database, table, ctx.connectionId
                    );
                    if (!hasAccess) {
                        return { error: `Access denied to table '${database}.${table}'` };
                    }
                    const result = await ctx.clickhouseService.executeQuery(
                        `DESCRIBE TABLE ${database}.${table}`, "JSON"
                    );
                    return { database, table, columns: result.data };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to get table schema" };
                }
            },
        }),

        // 4. Get table DDL
        get_table_ddl: tool({
            description: "Get the CREATE TABLE statement for a specific table.",
            inputSchema: zodSchema(z.object({
                database: z.string().describe("Database name"),
                table: z.string().describe("Table name"),
            })),
            execute: async ({ database, table }: { database: string; table: string }): Promise<Record<string, unknown>> => {
                try {
                    const hasAccess = await checkTableAccess(
                        ctx.userId, ctx.isAdmin, database, table, ctx.connectionId
                    );
                    if (!hasAccess) {
                        return { error: `Access denied to table '${database}.${table}'` };
                    }
                    const result = await ctx.clickhouseService.executeQuery<Record<string, string>>(
                        `SHOW CREATE TABLE ${database}.${table}`, "JSON"
                    );
                    const row = result.data[0] || {};
                    const ddl = row.statement || row['CREATE TABLE'] || JSON.stringify(row);
                    return { database, table, ddl };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to get table DDL" };
                }
            },
        }),

        // 5. Get table size
        get_table_size: tool({
            description: "Get row count and disk size for a specific table.",
            inputSchema: zodSchema(z.object({
                database: z.string().describe("Database name"),
                table: z.string().describe("Table name"),
            })),
            execute: async ({ database, table }: { database: string; table: string }): Promise<Record<string, unknown>> => {
                try {
                    const hasAccess = await checkTableAccess(
                        ctx.userId, ctx.isAdmin, database, table, ctx.connectionId
                    );
                    if (!hasAccess) {
                        return { error: `Access denied to table '${database}.${table}'` };
                    }
                    const result = await ctx.clickhouseService.executeQuery(
                        `
                        SELECT
                            total_rows,
                            formatReadableSize(bytes_on_disk) AS disk_size,
                            bytes_on_disk,
                            parts_count
                        FROM (
                            SELECT 
                                sum(rows) as total_rows,
                                sum(bytes_on_disk) as bytes_on_disk,
                                count() as parts_count
                            FROM system.parts 
                            WHERE database = '${database}' AND table = '${table}' AND active
                         )`,
                        "JSON"
                    );
                    return { database, table, ...(result.data[0] || {}) };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to get table size" };
                }
            },
        }),

        // 6. Get table sample
        get_table_sample: tool({
            description: "Get first 5 rows of a table to preview the data.",
            inputSchema: zodSchema(z.object({
                database: z.string().describe("Database name"),
                table: z.string().describe("Table name"),
            })),
            execute: async ({ database, table }: { database: string; table: string }): Promise<Record<string, unknown>> => {
                try {
                    const hasAccess = await checkTableAccess(
                        ctx.userId, ctx.isAdmin, database, table, ctx.connectionId
                    );
                    if (!hasAccess) {
                        return { error: `Access denied to table '${database}.${table}'` };
                    }
                    const result = await ctx.clickhouseService.executeQuery(
                        `SELECT * FROM ${database}.${table} LIMIT 5`, "JSON"
                    );
                    return { database, table, columns: result.meta, rows: result.data, totalRows: result.rows };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to get table sample" };
                }
            },
        }),

        // 7. Run SELECT query (RBAC-validated)
        run_select_query: tool({
            description: "Execute a read-only SELECT query. Only SELECT and WITH queries are allowed. Results limited to 100 rows.",
            inputSchema: zodSchema(z.object({
                sql: z.string().describe("The SQL SELECT query to execute").optional(),
                query: z.string().describe("Alias for sql — the SQL SELECT query to execute").optional(),
            })),
            execute: async ({ sql, query }: { sql?: string; query?: string }): Promise<Record<string, unknown>> => {
                const actualSql = sql ?? query ?? '';
                if (!actualSql.trim()) {
                    return { error: "No SQL query provided. Pass the query in the 'sql' parameter." };
                }
                try {
                    // Validate it's a read-only query
                    const normalized = actualSql.trim().toUpperCase();
                    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
                        return { error: "Only SELECT and WITH queries are allowed. DDL/DML operations are not permitted." };
                    }

                    // Validate RBAC access
                    const accessCheck = await validateQueryAccess(
                        ctx.userId, ctx.isAdmin, ctx.permissions,
                        actualSql, ctx.defaultDatabase, ctx.connectionId
                    );
                    if (!accessCheck.allowed) {
                        return { error: accessCheck.reason || "Access denied" };
                    }

                    // Add LIMIT if not present
                    let limitedSql = actualSql;
                    if (!normalized.includes('LIMIT')) {
                        limitedSql = `${actualSql.replace(/;\s*$/, '')} LIMIT 100`;
                    }

                    const result = await ctx.clickhouseService.executeQuery(limitedSql, "JSON");
                    return {
                        columns: result.meta,
                        rows: result.data,
                        rowCount: result.rows,
                        statistics: result.statistics,
                    };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Query execution failed" };
                }
            },
        }),

        // 8. Explain query
        explain_query: tool({
            description: "Get the EXPLAIN plan for a query to understand how ClickHouse will execute it.",
            inputSchema: zodSchema(z.object({
                sql: z.string().describe("The SQL query to explain"),
            })),
            execute: async ({ sql }: { sql: string }): Promise<Record<string, unknown>> => {
                try {
                    const accessCheck = await validateQueryAccess(
                        ctx.userId, ctx.isAdmin, ctx.permissions,
                        sql, ctx.defaultDatabase, ctx.connectionId
                    );
                    if (!accessCheck.allowed) {
                        return { error: accessCheck.reason || "Access denied" };
                    }

                    const result = await ctx.clickhouseService.executeQuery(
                        `EXPLAIN ${sql}`, "JSON"
                    );
                    return { plan: result.data };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to explain query" };
                }
            },
        }),

        // 9. Get database info
        get_database_info: tool({
            description: "Get table count and total size for a specific database.",
            inputSchema: zodSchema(z.object({
                database: z.string().describe("Database name"),
            })),
            execute: async ({ database }: { database: string }): Promise<Record<string, unknown>> => {
                try {
                    const hasAccess = await checkDatabaseAccess(
                        ctx.userId, ctx.isAdmin, database, ctx.connectionId
                    );
                    if (!hasAccess) {
                        return { error: `Access denied to database '${database}'` };
                    }
                    const result = await ctx.clickhouseService.executeQuery(
                        `SELECT 
                            count() as table_count,
                            sum(total_rows) as total_rows,
                            formatReadableSize(sum(total_bytes)) as total_size
                         FROM system.tables 
                         WHERE database = '${database}'`,
                        "JSON"
                    );
                    return { database, ...(result.data[0] || {}) };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to get database info" };
                }
            },
        }),

        // 10. Get running queries
        get_running_queries: tool({
            description: "List currently running queries on the ClickHouse server.",
            inputSchema: zodSchema(z.object({})),
            execute: async (): Promise<Record<string, unknown>> => {
                try {
                    const filter = ctx.isAdmin ? '' : `WHERE user = currentUser()`;
                    const result = await ctx.clickhouseService.executeQuery(
                        `SELECT 
                            query_id, user, query, elapsed, read_rows, 
                            formatReadableSize(memory_usage) as memory
                         FROM system.processes ${filter} 
                         ORDER BY elapsed DESC LIMIT 20`,
                        "JSON"
                    );
                    return { queries: result.data };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to get running queries" };
                }
            },
        }),

        // 11. Get server info
        get_server_info: tool({
            description: "Get ClickHouse server version and uptime.",
            inputSchema: zodSchema(z.object({})),
            execute: async (): Promise<Record<string, unknown>> => {
                try {
                    const result = await ctx.clickhouseService.executeQuery(
                        `SELECT 
                            version() as version,
                            uptime() as uptime_seconds,
                            formatReadableTimeDelta(uptime()) as uptime_human`,
                        "JSON"
                    );
                    return result.data[0] || { error: "No data returned" };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to get server info" };
                }
            },
        }),

        // 12. Search columns
        search_columns: tool({
            description: "Search for columns by name pattern across all accessible tables.",
            inputSchema: zodSchema(z.object({
                pattern: z.string().describe("Column name pattern to search for (case-insensitive)"),
            })),
            execute: async ({ pattern }: { pattern: string }): Promise<Record<string, unknown>> => {
                try {
                    const result = await ctx.clickhouseService.executeQuery<{
                        database: string;
                        table: string;
                        name: string;
                        type: string;
                    }>(
                        `SELECT database, table, name, type 
                         FROM system.columns 
                         WHERE name ILIKE '%${pattern.replace(/'/g, "''")}%' 
                         ORDER BY database, table, position 
                         LIMIT 50`,
                        "JSON"
                    );

                    const accessible: { database: string; table: string; name: string; type: string }[] = [];
                    for (const col of result.data as Array<{ database: string; table: string; name: string; type: string }>) {
                        const hasAccess = await checkTableAccess(
                            ctx.userId, ctx.isAdmin, col.database, col.table, ctx.connectionId
                        );
                        if (hasAccess) {
                            accessible.push(col);
                        }
                    }
                    return { columns: accessible, totalFound: accessible.length };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to search columns" };
                }
            },
        }),

        // 13. Generate query (LLM-based via tool)
        generate_query: tool({
            description: "Generate a SQL query based on a natural language description. Use this after gathering schema information from other tools.",
            inputSchema: zodSchema(z.object({
                description: z.string().describe("Natural language description of what the query should do"),
                context: z.string().describe("Relevant schema information gathered from other tools"),
            })),
            execute: async ({ description: desc, context: schemaCtx }: { description: string; context: string }): Promise<Record<string, unknown>> => {
                return {
                    note: "Generate the SQL query based on the description and schema context. Present it in a ```sql code block.",
                    description: desc,
                    schemaContext: schemaCtx,
                };
            },
        }),

        // 14. Analyze query
        analyze_query: tool({
            description: "Analyze a SQL query for complexity, performance characteristics, and get optimization recommendations.",
            inputSchema: zodSchema(z.object({
                sql: z.string().describe("The SQL query to analyze"),
            })),
            execute: async ({ sql }: { sql: string }): Promise<Record<string, unknown>> => {
                try {
                    const analysis = analyzeQuery(sql);
                    return {
                        complexity: analysis.complexity,
                        recommendations: analysis.recommendations,
                    };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to analyze query" };
                }
            },
        }),

        // 15. Optimize query (AI-powered)
        optimize_query: tool({
            description: "Get AI-powered optimization suggestions for a SQL query.",
            inputSchema: zodSchema(z.object({
                sql: z.string().describe("The SQL query to optimize"),
            })),
            execute: async ({ sql }: { sql: string }): Promise<Record<string, unknown>> => {
                try {
                    const result = await aiOptimizeQuery(sql, []);
                    return {
                        optimizedQuery: result.optimizedQuery,
                        explanation: result.explanation,
                        summary: result.summary,
                        tips: result.tips,
                    };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to optimize query" };
                }
            },
        }),
    };
}

// ============================================
// Main Chat Function
// ============================================

/**
 * Stream a chat response using AI SDK v6 streamText.
 * 
 * @param messages - Conversation history (ModelMessage[])
 * @param context - RBAC context with user info and ClickHouse service
 * @returns ReadableStream of SSE-formatted text chunks
 */
export async function streamChat(
    messages: ModelMessage[],
    context: ChatContext
) {
    // Validate configuration
    const validation = validateConfiguration();
    if (!validation.valid) {
        throw new AppError(
            validation.error || "AI chat is not configured",
            "AI_CONFIGURATION_ERROR",
            "validation",
            503
        );
    }

    const config = getConfiguration();
    const model = initializeAIModel(config);
    const tools = createTools(context);

    const result = streamText({
        model: model,
        system: SYSTEM_PROMPT,
        messages:messages,
        tools: tools,
        stopWhen: stepCountIs(10),
        temperature: 0.0,
        prepareStep: ({ stepNumber, steps }) => {
            const wasToolCalled = (toolName: string): boolean => {
                return steps.some(step => 
                    step.content.some(part => 
                        part.type === 'tool-call' && 
                        'toolName' in part && 
                        part.toolName === toolName
                    )
                );
            };
        
            // Define tool execution phases with proper typing
            const PHASE_1_DISCOVERY = ["list_databases"] as const;
            const PHASE_2_EXPLORATION = ["list_tables", "get_database_info"] as const;
            const PHASE_3_SCHEMA = [
                "get_table_schema", 
                "get_table_ddl", 
                "get_table_size", 
                "search_columns"
            ] as const;
            const PHASE_4_DATA = [
                "get_table_sample", 
                "run_select_query", 
                "explain_query"
            ] as const;
            const PHASE_5_ADVANCED = [
                "generate_query", 
                "analyze_query", 
                "optimize_query"
            ] as const;
            const PHASE_6_MONITORING = [
                "get_running_queries", 
                "get_server_info"
            ] as const;
        
            // Check prerequisites
            const hasListDatabases = wasToolCalled('list_databases');
            const hasListTables = wasToolCalled('list_tables');
            const hasAnySchema = wasToolCalled('get_table_schema') || wasToolCalled('get_table_ddl');
        
            // Phase 1: Discovery (Step 0)
            if (stepNumber === 0 && !hasListDatabases) {
                return {
                    toolChoice: { type: 'tool', toolName: 'list_databases' } as const,
                    activeTools: [...PHASE_1_DISCOVERY],
                };
            }
        
            // Phase 2: Exploration (Step 1)
            if (stepNumber === 1 && hasListDatabases && !hasListTables) {
                return {
                    activeTools: [...PHASE_2_EXPLORATION],
                };
            }
        
            // Phase 3: Schema Analysis (Steps 2-3)
            if (stepNumber >= 2 && stepNumber <= 3 && hasListTables && !hasAnySchema) {
                return {
                    activeTools: [...PHASE_2_EXPLORATION, ...PHASE_3_SCHEMA],
                };
            }
        
            // Phase 4: Data Access (Steps 4+)
            if (stepNumber >= 4 && hasAnySchema) {
                return {
                    activeTools: [
                        ...PHASE_3_SCHEMA,
                        ...PHASE_4_DATA,
                        ...PHASE_5_ADVANCED,
                        ...PHASE_6_MONITORING,
                    ],
                };
            }
        
            // Default: Allow discovery and exploration tools
            return {
                activeTools: [...PHASE_1_DISCOVERY, ...PHASE_2_EXPLORATION],
            };
        }
    });

    return result;
}
