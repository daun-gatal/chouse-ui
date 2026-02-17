import { describe, it, expect } from "bun:test";
import { parseStatement } from "./sqlParser";

describe("sqlParser CTE handling", () => {
    it("should extract tables from CTE definition but NOT the CTE name itself", () => {
        const sql = "WITH cte_user AS (SELECT * FROM users) SELECT * FROM cte_user";
        const result = parseStatement(sql);

        const tableNames = result.tables.map(t => t.table);
        expect(tableNames).toContain("users");
        expect(tableNames).not.toContain("cte_user");
    });

    it("should handle multiple CTEs", () => {
        const sql = "WITH cte1 AS (SELECT * FROM table1), cte2 AS (SELECT * FROM table2) SELECT * FROM cte1 JOIN cte2 ON cte1.id = cte2.id";
        const result = parseStatement(sql);

        const tableNames = result.tables.map(t => t.table);
        expect(tableNames).toContain("table1");
        expect(tableNames).toContain("table2");
        expect(tableNames).not.toContain("cte1");
        expect(tableNames).not.toContain("cte2");
    });

    it("should handle CTE referencing another CTE", () => {
        const sql = "WITH cte1 AS (SELECT * FROM table1), cte2 AS (SELECT * FROM cte1) SELECT * FROM cte2";
        const result = parseStatement(sql);

        const tableNames = result.tables.map(t => t.table);
        expect(tableNames).toContain("table1");
        expect(tableNames).not.toContain("cte1");
        expect(tableNames).not.toContain("cte2");
    });

    it("should handle CTE in subquery", () => {
        const sql = "SELECT * FROM (WITH cte AS (SELECT * FROM users) SELECT * FROM cte)";
        const result = parseStatement(sql);

        const tableNames = result.tables.map(t => t.table);
        expect(tableNames).toContain("users");
        expect(tableNames).not.toContain("cte");
    });

    it("should handle Join with CTE", () => {
        const sql = "WITH cte AS (SELECT * FROM users) SELECT * FROM cte JOIN orders ON cte.id = orders.user_id";
        const result = parseStatement(sql);

        const tableNames = result.tables.map(t => t.table);
        expect(tableNames).toContain("users");
        expect(tableNames).toContain("orders");
        expect(tableNames).not.toContain("cte");
    });

    it("should handle CTE with explicit columns", () => {
        const sql = "WITH cte(id, name) AS (SELECT user_id, user_name FROM users) SELECT * FROM cte";
        const result = parseStatement(sql);

        const tableNames = result.tables.map(t => t.table);
        expect(tableNames).toContain("users");
        expect(tableNames).not.toContain("cte");
    });

    it("should handle complex ClickHouse queries that might fail AST parsing (fallback test)", () => {
        const sql = `
WITH
recent_queries AS (
    SELECT
        query_id,
        user,
        query_kind,
        query_duration_ms,
        read_rows,
        result_rows,
        memory_usage,
        ProfileEvents.Names AS event_names,
        ProfileEvents.Values AS event_values,
        event_time
    FROM system.query_log
    WHERE type = 'QueryFinish'
      AND event_time >= now() - INTERVAL 1 DAY
),

expanded_events AS (
    SELECT
        query_id,
        user,
        query_kind,
        query_duration_ms,
        memory_usage,
        read_rows,
        result_rows,
        event_time,
        arrayJoin(arrayZip(event_names, event_values)) AS event_pair
    FROM recent_queries
),

per_query_metrics AS (
    SELECT
        query_id,
        any(user) AS user,
        any(query_kind) AS query_kind,
        max(query_duration_ms) AS duration_ms,
        max(memory_usage) AS memory_usage,
        max(read_rows) AS read_rows,
        max(result_rows) AS result_rows,
        sumIf(event_pair.2, event_pair.1 = 'SelectedRows') AS selected_rows,
        max(event_time) AS event_time
    FROM expanded_events
    GROUP BY query_id
),

user_stats AS (
    SELECT
        user,
        quantileExact(0.95)(duration_ms) AS p95_duration
    FROM per_query_metrics
    GROUP BY user
),

heavy_users AS (
    SELECT *
    FROM user_stats
    WHERE p95_duration >= (
        SELECT quantileExact(0.95)(p95_duration)
        FROM user_stats
    )
),

-- ✅ Aggregate FIRST
aggregated_stats AS (
    SELECT
        p.user,
        p.query_kind,
        count() AS queries,
        avg(p.duration_ms) AS avg_duration_ms,
        quantileExact(0.95)(p.duration_ms) AS p95_duration_ms,
        sum(p.read_rows) / NULLIF(sum(p.result_rows), 0) AS read_to_result_ratio
    FROM per_query_metrics p
    INNER JOIN heavy_users h
        ON p.user = h.user
    GROUP BY
        p.user,
        p.query_kind
    HAVING queries > 5
)

-- ✅ Apply window AFTER aggregation
SELECT
    *,
    rank() OVER (
        PARTITION BY user
        ORDER BY p95_duration_ms DESC
    ) AS duration_rank
FROM aggregated_stats
ORDER BY user, p95_duration_ms DESC;
`;
        const result = parseStatement(sql);

        const tableNames = result.tables.map(t => t.table);

        // Should contain real system tables
        expect(tableNames).toContain("query_log");

        // Should NOT contain CTE names
        expect(tableNames).not.toContain("recent_queries");
        expect(tableNames).not.toContain("expanded_events");
        expect(tableNames).not.toContain("per_query_metrics");
        expect(tableNames).not.toContain("user_stats");
        expect(tableNames).not.toContain("heavy_users");
        expect(tableNames).not.toContain("aggregated_stats");
    });
});
