/**
 * AI Chat Service
 *
 * Conversational AI assistant for ClickHouse.
 * Uses AI SDK v6 ToolLoopAgent with 16 single-responsibility tools.
 * The agent manages the tool loop automatically — calling tools in sequence
 * until it has enough data to produce a final text response.
 * All schema/data tools are RBAC-aware via existing dataAccess middleware.
 */

import { ToolLoopAgent, tool, stepCountIs, zodSchema, type ModelMessage } from "ai";
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

/**
 * Chart specification returned by the render_chart tool.
 * Consumed by the browser's AiChartRenderer component.
 */
export interface ChartSpec {
    /** Chart type identifier */
    chartType: string;
    /** Optional display title */
    title?: string;
    /** Column metadata from the query result */
    columns: { name: string; type: string }[];
    /** Row data from the query result (max 500) */
    rows: Record<string, unknown>[];
    /** Column name mapped to the X axis */
    xAxis: string;
    /** Column name(s) mapped to the Y axis */
    yAxis: string | string[];
    /** Color palette key */
    colorScheme: string;
}

// ============================================
// System Prompt
// ============================================

const SYSTEM_PROMPT = `
You are an expert ClickHouse assistant embedded inside CHouse UI.

You operate in STRICT TOOL-FIRST MODE.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE OPERATING RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. NEVER guess database names, table names, columns, or data.
2. NEVER fabricate results.
3. NEVER answer schema/data questions without calling tools first.
4. NEVER output text before finishing all required tool calls.
5. NEVER narrate tool usage.
6. ONLY produce the final answer after all tool calls are complete.
7. Base your final answer strictly on tool results.

If you lack enough information → call more tools.
If access is denied → explain clearly.
If tool fails → surface the error clearly.

You have READ-ONLY access.
Only SELECT / WITH / SHOW / DESCRIBE / EXPLAIN queries are allowed.
Never attempt INSERT, UPDATE, DELETE, CREATE, ALTER, DROP.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECISION FRAMEWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When a user asks:

• About databases → use list_databases
• About tables → use list_tables
• About schema → use get_table_schema
• About table structure → use get_table_ddl
• About table size → use get_table_size
• To preview data → use get_table_sample
• To execute a query → use run_select_query
• About query performance → use explain_query or analyze_query
• To improve a query → use optimize_query
• To search columns → use search_columns
• To generate SQL → gather schema first, then use generate_query
• To visualize data → ALWAYS use render_chart

Chain tools as needed:
Example:
list_tables → get_table_schema → run_select_query

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHART RULES (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If the user says:
"visualize", "chart", "plot", "graph", "trend", "distribution", "show over time"

You MUST:
1. Call get_table_schema first (never guess columns)
2. Then call render_chart with a valid SELECT query
3. Use fully qualified table names (database.table)
4. Let axis inference happen unless necessary
5. Never render markdown tables when a chart is requested
6. Never describe a chart without calling render_chart

Chart type selection:
• Time-based trend → line / multi_line
• Category comparison → bar / horizontal_bar
• Group comparison → grouped_bar
• Stacked contribution → stacked_bar / stacked_area
• Proportion → pie / donut
• Distribution → histogram
• Correlation → scatter
• Hierarchy → treemap
• Conversion steps → funnel
• Matrix-style → heatmap

After render_chart:
Write 1–2 concise insight sentences only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SQL OUTPUT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALL SQL must be inside:

\`\`\`sql
SELECT ...
\`\`\`

Never inline SQL.
Never put SQL in markdown tables.
Never output raw SQL without fencing.

Query results must be formatted as markdown tables.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE STYLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Concise
• Technical
• No fluff
• Clear headers
• Structured formatting
• Use markdown properly

Explain findings clearly.
Explain performance insights when relevant.
Surface RBAC denial clearly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FAIL-SAFE BEHAVIOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If the user request is ambiguous:
→ gather schema first.

If multiple interpretations are possible:
→ choose the safest read-only interpretation.

If insufficient permissions:
→ explain what is inaccessible.

If no data returned:
→ clearly state that the query returned zero rows.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Operate deterministically.
Be precise.
Be tool-driven.
Be accurate.
`;


// ============================================
// Chart Axis Inference Helpers
// ============================================

/** ClickHouse type prefixes considered numeric (suitable for Y axis) */
const NUMERIC_TYPE_PREFIXES = [
    "UInt", "Int", "Float", "Decimal", "Nullable(UInt", "Nullable(Int", "Nullable(Float", "Nullable(Decimal",
];

/**
 * Returns true when the column type looks like a number.
 */
function isNumericType(type: string): boolean {
    return NUMERIC_TYPE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * Infer the best X-axis column: prefer DateTime/Date/String columns, else the first column.
 */
function inferXAxis(columns: { name: string; type: string }[]): string {
    const dateCol = columns.find(
        (c) => c.type.startsWith("DateTime") || c.type.startsWith("Date") || c.type.startsWith("Nullable(DateTime") || c.type.startsWith("Nullable(Date")
    );
    if (dateCol) return dateCol.name;

    const stringCol = columns.find(
        (c) => c.type.startsWith("String") || c.type.startsWith("Nullable(String") || c.type.startsWith("LowCardinality")
    );
    if (stringCol) return stringCol.name;

    // Fallback: use first column
    return columns[0]?.name ?? "";
}

/**
 * Infer Y-axis column(s): all numeric columns that are NOT the X axis.
 * Returns a single string when only one numeric column exists, else an array.
 */
function inferYAxes(
    columns: { name: string; type: string }[],
    xAxis: string
): string | string[] {
    const numericCols = columns
        .filter((c) => c.name !== xAxis && isNumericType(c.type))
        .map((c) => c.name);

    if (numericCols.length === 1) return numericCols[0];
    if (numericCols.length > 1) return numericCols;

    // Fallback: use the second column if nothing is clearly numeric
    const fallback = columns.find((c) => c.name !== xAxis);
    return fallback ? fallback.name : columns[0]?.name ?? "";
}

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

        // 16. Render chart — executes a SELECT query and returns a ChartSpec for the browser
        render_chart: tool({
            description: [
                "MANDATORY: Use this whenever the user asks to visualize, chart, plot, graph, or show trends.",
                "Execute a SELECT query and return an interactive chart specification.",
                "Available chartType values: bar, horizontal_bar, grouped_bar, stacked_bar, line, multi_line, area, stacked_area, pie, donut, scatter, radar, treemap, funnel, histogram, heatmap.",
                "xAxis and yAxis can be omitted — they will be inferred from the query result columns.",
            ].join(" "),
            inputSchema: zodSchema(z.object({
                sql: z.string().describe("SELECT query whose result will be charted. Must be read-only."),
                chartType: z.string().describe(
                    "Chart type: bar | horizontal_bar | grouped_bar | stacked_bar | line | multi_line | area | stacked_area | pie | donut | scatter | radar | treemap | funnel | histogram | heatmap"
                ),
                xAxis: z.string().optional().describe("Column name for the X axis (inferred if omitted)"),
                yAxis: z.union([z.string(), z.array(z.string())]).optional().describe("Column name(s) for the Y axis (inferred if omitted)"),
                title: z.string().optional().describe("Optional chart title shown above the chart"),
                colorScheme: z.enum(["violet", "blue", "green", "orange", "rainbow"]).optional().describe("Color palette (default: violet)"),
            })),
            execute: async ({
                sql,
                chartType,
                xAxis,
                yAxis,
                title,
                colorScheme = "violet",
            }: {
                sql: string;
                chartType: string;
                xAxis?: string;
                yAxis?: string | string[];
                title?: string;
                colorScheme?: string;
            }): Promise<Record<string, unknown>> => {
                if (!sql?.trim()) {
                    return { error: "No SQL query provided." };
                }

                // Validate read-only
                const normalized = sql.trim().toUpperCase();
                if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH")) {
                    return { error: "Only SELECT and WITH queries are allowed for charting." };
                }

                // RBAC access check
                const accessCheck = await validateQueryAccess(
                    ctx.userId, ctx.isAdmin, ctx.permissions,
                    sql, ctx.defaultDatabase, ctx.connectionId
                );
                if (!accessCheck.allowed) {
                    return { error: accessCheck.reason || "Access denied" };
                }

                try {
                    // Add LIMIT 500 if not already present (charts don't need more than that)
                    let chartSql = sql;
                    if (!normalized.includes("LIMIT")) {
                        chartSql = `${sql.replace(/;\s*$/, "")} LIMIT 500`;
                    }

                    const result = await ctx.clickhouseService.executeQuery(chartSql, "JSON");

                    const columns: { name: string; type: string }[] = (result.meta ?? []).map(
                        (col: { name: string; type: string }) => ({ name: col.name, type: col.type })
                    );
                    const rows = result.data as Record<string, unknown>[];

                    if (columns.length === 0 || rows.length === 0) {
                        return { error: "Query returned no data to chart." };
                    }

                    // Infer axes from column types when not provided
                    const resolvedXAxis = xAxis ?? inferXAxis(columns);
                    const resolvedYAxis = yAxis ?? inferYAxes(columns, resolvedXAxis);

                    if (!resolvedXAxis) {
                        return { error: "Could not infer X axis column. Please specify xAxis explicitly." };
                    }
                    if (!resolvedYAxis || (Array.isArray(resolvedYAxis) && resolvedYAxis.length === 0)) {
                        return { error: "Could not infer Y axis column. Please specify yAxis explicitly." };
                    }

                    const chartSpec: ChartSpec = {
                        chartType,
                        title,
                        columns,
                        rows,
                        xAxis: resolvedXAxis,
                        yAxis: resolvedYAxis,
                        colorScheme: colorScheme ?? "violet",
                    };

                    return chartSpec as unknown as Record<string, unknown>;
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to execute chart query" };
                }
            },
        }),
    };
}

// ============================================
// Main Chat Function
// ============================================

/**
 * Stream a chat response using AI SDK v6 ToolLoopAgent.
 * 
 * The agent manages the tool loop automatically — it will keep calling tools
 * until it has gathered enough data to produce a final text response,
 * or until the step limit (10) is reached.
 * 
 * @param messages - Conversation history (ModelMessage[])
 * @param context - RBAC context with user info and ClickHouse service
 * @returns StreamTextResult with fullStream for SSE consumption
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

    // Create a ToolLoopAgent that manages the tool loop natively.
    // Unlike streamText + prepareStep, the agent will automatically
    // keep calling tools until it has enough data for a final response.
    const agent = new ToolLoopAgent({
        model,
        instructions: SYSTEM_PROMPT,
        tools,
        stopWhen: stepCountIs(30),
        temperature: 0.0,
    });

    // agent.stream() returns a StreamTextResult — same interface as streamText(),
    // so the route handler's fullStream consumption works unchanged.
    const result = agent.stream({ messages });

    return result;
}
