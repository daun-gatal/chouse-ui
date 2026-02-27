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
import { parseStatement } from "../middleware/sqlParser";
import { analyzeQuery } from "./queryAnalyzer";
import { optimizeQuery as aiOptimizeQuery } from "./aiOptimizer";
import { discoverSkills, createLoadSkillTool, type SkillMetadata } from "./agentSkills";

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

function buildSystemPrompt(skills: SkillMetadata[]): string {
    const skillsList = skills
        .map(s => `- ${s.name}: ${s.description}`)
        .join("\n");

    return `
You are an expert ClickHouse assistant embedded inside CHouse UI.
You operate in STRICT TOOL-FIRST MODE.

## SKILLS
You have an arsenal of complex operating instructions saved as skills on the filesystem.
You MUST use the \`load_skill\` tool to retrieve these instructions BEFORE performing complex tasks!

Available skills:
${skillsList}

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
You MUST call \`load_skill\` depending on the user's intent BEFORE taking action:
- Intent: User wants to know what databases/tables exist, or wants to explore the schema → call \`load_skill\` with "data-exploration"
- Intent: User wants you to write or execute a SQL query → call \`load_skill\` with "sql-generation"
- Intent: User wants a chart, plot, graph, or visual distribution → call \`load_skill\` with "data-visualization"
- Intent: User asks about query performance, EXPLAIN, or wants to optimize a query → call \`load_skill\` with "query-optimization"
- Intent: User wants to know about server health, running queries, slow/heavy queries (historical or current), or system issues → call \`load_skill\` with "system-troubleshooting" (use \`get_slow_queries\` for historical slow queries, \`get_running_queries\` for currently running).

Other tools (use when appropriate without requiring a skill): For database-level overview (table count, total size), use \`get_database_info\`. For syntax-only validation use \`validate_sql\`; for export use \`export_query_result\`.

ONLY produce the final text answer after all required tool calls (and skill loads) are complete.
Base your final answer strictly on tool results.
If access is denied, explain clearly.
If a tool fails, surface the error clearly.

You have READ-ONLY access.
Only SELECT / WITH / SHOW / DESCRIBE / EXPLAIN queries are allowed.
Never attempt INSERT, UPDATE, DELETE, CREATE, ALTER, DROP.
`;
}



// ============================================
// search_columns pattern sanitization
// ============================================

const SEARCH_PATTERN_MAX_LENGTH = 200;

/**
 * Sanitize a LIKE pattern for system.columns name search.
 * Escapes single quote, backslash, % and _ to prevent injection and wildcard abuse.
 */
function sanitizeLikePattern(pattern: string): string {
    const truncated = pattern.slice(0, SEARCH_PATTERN_MAX_LENGTH);
    return truncated
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "''")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");
}

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
            description: "Execute a read-only SELECT query. Only SELECT and WITH queries are allowed. LIMIT 100 is added automatically if the query has no LIMIT. Results limited to 100 rows.",
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
                pattern: z.string().max(SEARCH_PATTERN_MAX_LENGTH).describe("Column name pattern to search for (case-insensitive)"),
            })),
            execute: async ({ pattern }: { pattern: string }): Promise<Record<string, unknown>> => {
                try {
                    const safePattern = sanitizeLikePattern(pattern);
                    const result = await ctx.clickhouseService.executeQuery<{
                        database: string;
                        table: string;
                        name: string;
                        type: string;
                    }>(
                        `SELECT database, table, name, type 
                         FROM system.columns 
                         WHERE name ILIKE '%${safePattern}%' 
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
            description: "Generate a SQL query based on a natural language description. Use this after gathering schema information from other tools. After calling this, you MUST output the generated query in a ```sql code block. If the user wants the query executed, call run_select_query with that SQL.",
            inputSchema: zodSchema(z.object({
                description: z.string().describe("Natural language description of what the query should do"),
                context: z.string().describe("Relevant schema information gathered from other tools"),
            })),
            execute: async ({ description: desc, context: schemaCtx }: { description: string; context: string }): Promise<Record<string, unknown>> => {
                return {
                    note: "Generate the SQL query based on the description and schema context. Present it in a ```sql code block. If the user asked to run or execute the query, call run_select_query with that SQL.",
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

        // 16. Get slow queries from query_log (RBAC-safe: non-admin sees only own user)
        get_slow_queries: tool({
            description: "List recently executed queries that were slow (by duration). Useful for troubleshooting and finding heavy queries. Non-admin users see only their own queries.",
            inputSchema: zodSchema(z.object({
                limit: z.number().min(1).max(50).optional().describe("Max number of queries to return (default 20)"),
                minDurationMs: z.number().min(0).optional().describe("Minimum query duration in ms to include (default 1000)"),
            })),
            execute: async ({ limit = 20, minDurationMs = 1000 }: { limit?: number; minDurationMs?: number }): Promise<Record<string, unknown>> => {
                try {
                    const filter = ctx.isAdmin ? "" : "AND user = currentUser()";
                    const result = await ctx.clickhouseService.executeQuery(
                        `SELECT
                            query_id,
                            user,
                            query,
                            query_duration_ms,
                            read_rows,
                            formatReadableSize(memory_usage) AS memory
                         FROM system.query_log
                         WHERE type = 'QueryFinish' AND query_duration_ms >= ${minDurationMs} ${filter}
                         ORDER BY query_duration_ms DESC
                         LIMIT ${limit}`,
                        "JSON"
                    );
                    return { queries: result.data, count: result.rows };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Failed to get slow queries" };
                }
            },
        }),

        // 17. Validate SQL syntax (no execution)
        validate_sql: tool({
            description: "Check if a SQL string is valid syntax. Does not execute the query. Use when the user wants to check syntax or validate a query before running.",
            inputSchema: zodSchema(z.object({
                sql: z.string().describe("The SQL query to validate"),
            })),
            execute: async ({ sql }: { sql: string }): Promise<Record<string, unknown>> => {
                try {
                    parseStatement(sql.trim());
                    return { valid: true };
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    return { valid: false, error: message };
                }
            },
        }),

        // 18. Export query result as CSV or JSON string (for download/copy)
        export_query_result: tool({
            description: "Run a read-only SELECT query and return the result as a CSV or JSON string. Use when the user explicitly asks to export, download, or get data as CSV/JSON. Limited to 1000 rows.",
            inputSchema: zodSchema(z.object({
                sql: z.string().describe("The SQL SELECT query to execute"),
                format: z.enum(["csv", "json"]).optional().describe("Output format (default: csv)"),
            })),
            execute: async ({ sql: actualSql, format = "csv" }: { sql: string; format?: "csv" | "json" }): Promise<Record<string, unknown>> => {
                if (!actualSql?.trim()) {
                    return { error: "No SQL query provided." };
                }
                const normalized = actualSql.trim().toUpperCase();
                if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH")) {
                    return { error: "Only SELECT and WITH queries are allowed." };
                }
                const accessCheck = await validateQueryAccess(
                    ctx.userId, ctx.isAdmin, ctx.permissions,
                    actualSql, ctx.defaultDatabase, ctx.connectionId
                );
                if (!accessCheck.allowed) {
                    return { error: accessCheck.reason || "Access denied" };
                }
                try {
                    let limitedSql = actualSql.replace(/;\s*$/, "");
                    if (!normalized.includes("LIMIT")) {
                        limitedSql = `${limitedSql} LIMIT 1000`;
                    }
                    const result = await ctx.clickhouseService.executeQuery(limitedSql, "JSON");
                    const rows = result.data as Record<string, unknown>[];
                    if (format === "json") {
                        return { format: "json", data: rows, rowCount: rows.length };
                    }
                    const headers = result.meta?.map((m: { name: string }) => m.name) ?? (rows[0] ? Object.keys(rows[0]) : []);
                    const csvLines = [headers.join(","), ...rows.map((r) => headers.map((h) => {
                        const v = r[h];
                        const s = v === null || v === undefined ? "" : String(v);
                        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
                    }).join(","))];
                    return { format: "csv", data: csvLines.join("\n"), rowCount: rows.length };
                } catch (error: unknown) {
                    return { error: error instanceof Error ? error.message : "Export failed" };
                }
            },
        }),

        // 19. Render chart — executes a SELECT query and returns a ChartSpec for the browser
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
                    // Add LIMIT when not present: pie/donut use 20 for readability; others use 500
                    let chartSql = sql;
                    if (!normalized.includes("LIMIT")) {
                        const limit =
                            chartType === "pie" || chartType === "donut" ? 20 : 500;
                        chartSql = `${sql.replace(/;\s*$/, "")} LIMIT ${limit}`;
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
    context: ChatContext,
    modelId?: string
) {
    const config = await getConfiguration(modelId);

    // Validate configuration
    const validation = validateConfiguration(config);
    if (!validation.valid) {
        throw new AppError(
            validation.error || "AI chat is not configured",
            "AI_CONFIGURATION_ERROR",
            "validation",
            503
        );
    }

    // Since validation passed, we know config is not null
    const model = initializeAIModel(config!);

    // Discover available skills for the chat agent
    const skills = await discoverSkills(["../skills/ai-chat"]);

    // Combine base tools with the dynamic load_skill tool
    const tools = {
        load_skill: createLoadSkillTool(skills),
        ...createTools(context),
    };

    // Create a ToolLoopAgent that manages the tool loop natively.
    // Unlike streamText + prepareStep, the agent will automatically
    // keep calling tools until it has enough data for a final response.
    const agent = new ToolLoopAgent({
        model,
        instructions: buildSystemPrompt(skills),
        tools,
        stopWhen: stepCountIs(30),
        temperature: 0.0,
    });

    // agent.stream() returns a StreamTextResult — same interface as streamText(),
    // so the route handler's fullStream consumption works unchanged.
    const result = agent.stream({ messages });

    return result;
}
