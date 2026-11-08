/**
 * Statements the access check is tested against, with the decision expected
 * on every recorded ClickHouse version (ADR 0030). `record.ts` stores each
 * one's real `EXPLAIN AST` printout in `explain-ast.json`.
 *
 * Names: `db` is the default database in the tests, `public` holds what a
 * limited user may read, `secret` what they may not.
 */
import type { DenyCode, StatementType } from "../analyze";

export interface Expected {
  type: StatementType;
  permission: string;
  targets?: string[];
  reads?: string[];
  databases?: string[];
}

export interface Case {
  sql: string;
  params?: Record<string, string>;
  /** The decision, or the refusal code. Names print as `db.table`, or `·.table` for the default database. */
  expect: Expected | DenyCode;
  /** Versions whose parser rejects the statement outright (it is then a SQL_SYNTAX refusal there). */
  syntaxErrorOn?: string[];
}

/** Fixture key: the SQL, plus its parameters when it has any (they change the printout). */
export function caseKey(c: Pick<Case, "sql" | "params">): string {
  return c.params ? `${c.sql}\u0000${JSON.stringify(c.params)}` : c.sql;
}

const SELECT = "table:select";
const MISC = "query:execute:misc";

export const CASES: Case[] = [
  // --- the bypasses ADR 0030 closes -------------------------------------
  { sql: "SELECT * FROM public.t, secret.s SETTINGS max_threads=1", expect: { type: "select", permission: SELECT, reads: ["public.t", "secret.s"] } },
  { sql: "SELECT 1 WHERE 1 IN secret.s", expect: { type: "select", permission: SELECT, reads: ["secret.s"] } },
  { sql: "SELECT joinGet(secret.j, 'v', 1)", expect: { type: "select", permission: SELECT, reads: ["secret.j"] } },
  { sql: "SELECT dictGet('secret.d', 'v', toUInt64(1))", expect: { type: "select", permission: SELECT, reads: ["secret.d"] } },
  { sql: "SELECT * FROM {t:Identifier}", params: { t: "secret.s" }, expect: { type: "select", permission: SELECT, reads: ["secret.s"] } },
  { sql: "INSERT INTO public.t VALUES ((SELECT max(v) FROM secret.s))", expect: "UNSUPPORTED_SHAPE" },
  { sql: "INSERT INTO public.t VALUES (dictGet('secret.d', 'v', 1))", expect: "UNSUPPORTED_SHAPE" },
  { sql: "CREATE VIEW public.v AS SELECT * FROM public.t", expect: { type: "create", permission: "table:create", targets: ["public.v"], reads: ["public.t"] } },
  { sql: "SELECT * FROM t /* FROM public.t */", expect: { type: "select", permission: SELECT, reads: ["·.t"] } },
  { sql: "SELECT * FROM (WITH s AS (SELECT 1) SELECT * FROM s), s", expect: { type: "select", permission: SELECT, reads: ["·.s"] } },
  { sql: "SELECT x FROM public.t WINDOW w AS (PARTITION BY x IN (SELECT y FROM secret.s)) ORDER BY count() OVER w", expect: "UNSUPPORTED_SHAPE" },
  { sql: "SELECT * FROM `a\n      TableIdentifier secret.s`", expect: "AMBIGUOUS_NAME" },
  { sql: "SELECT * FROM `secret.s`", expect: "AMBIGUOUS_NAME" },
  { sql: "SELECT * FROM {t:Identifier}", params: { t: "a.b.c" }, expect: "AMBIGUOUS_NAME" },
  { sql: "CREATE MATERIALIZED VIEW public.mv TO secret.s AS SELECT * FROM public.t", expect: "UNSUPPORTED_SHAPE" },
  { sql: "ALTER TABLE public.t ATTACH PARTITION 1 FROM secret.s", expect: "UNSUPPORTED_SHAPE" },
  { sql: "CREATE TABLE public.x AS secret.s", expect: "UNSUPPORTED_SHAPE" },
  { sql: "SELECT * FROM remote('h', secret.s)", expect: "UNSAFE_TABLE_FUNCTION" },
  { sql: "SELECT * FROM view(SELECT * FROM secret.s)", expect: "UNSAFE_TABLE_FUNCTION" },
  { sql: "DESC remote('h', secret.s)", expect: "UNSAFE_TABLE_FUNCTION" },
  { sql: "INSERT INTO TABLE FUNCTION remote('h', public.t) VALUES (1)", expect: "UNSAFE_TABLE_FUNCTION" },
  { sql: "CREATE TABLE public.x AS remote('h', secret.s)", expect: "UNSAFE_TABLE_FUNCTION" },
  { sql: "CREATE TABLE public.x (a UInt64) ENGINE = Merge(secret, '^s')", expect: "UNSAFE_ENGINE" },
  { sql: "CREATE DATABASE d3 ENGINE = MySQL('h:3306', 'd', 'u', 'p')", expect: "UNSAFE_ENGINE" },
  { sql: "SELECT file('a.txt')", expect: "UNSAFE_FUNCTION" },
  { sql: "SELECT * FROM public.t INTO OUTFILE 'x.csv'", expect: "UNSUPPORTED_SHAPE" },
  { sql: "SELECT 1; SELECT 2", expect: "SQL_SYNTAX" },
  { sql: "SELECT * FROM public.t WHERE x = {p:String}", expect: "QUERY_PARAM_UNBOUND" },

  // --- ordinary ClickHouse SQL keeps working -----------------------------
  { sql: "SELECT 1", expect: { type: "select", permission: SELECT } },
  { sql: "SELECT 'a\nb (children 3)', 'x\\ny'", expect: { type: "select", permission: SELECT } },
  { sql: "SELECT * FROM public.t AS a, secret.s SETTINGS max_threads=1 FORMAT JSON", expect: { type: "select", permission: SELECT, reads: ["public.t", "secret.s"] } },
  { sql: "SELECT count() FROM public.t FINAL PREWHERE x=1 WHERE y>2 GROUP BY z WITH TOTALS HAVING count()>1 ORDER BY z DESC LIMIT 1 BY z LIMIT 10", expect: { type: "select", permission: SELECT, reads: ["public.t"] } },
  { sql: "SELECT toStartOfHour(ts) AS h, count() FROM public.t GROUP BY h ORDER BY h WITH FILL STEP 3600", expect: { type: "select", permission: SELECT, reads: ["public.t"] } },
  { sql: "SELECT * FROM public.t SAMPLE 0.1 ARRAY JOIN arr AS a", expect: { type: "select", permission: SELECT, reads: ["public.t"] } },
  { sql: "SELECT arrayMap(x -> x * 2, arr), [1,2], (1,'a'), CAST(x AS String), x::Int32, CASE WHEN x THEN 1 ELSE 2 END FROM public.t", expect: { type: "select", permission: SELECT, reads: ["public.t"] } },
  { sql: "SELECT quantile(0.9)(x), uniqExact(x) OVER (PARTITION BY y ORDER BY z) FROM public.t", expect: { type: "select", permission: SELECT, reads: ["public.t"] } },
  { sql: "SELECT * FROM public.t a ANY LEFT JOIN public.u b ON a.id = b.id GLOBAL INNER JOIN public.v c USING (id)", expect: { type: "select", permission: SELECT, reads: ["public.t", "public.u", "public.v"] } },
  { sql: "SELECT * FROM public.t WHERE x GLOBAL IN (SELECT y FROM public.s) AND z NOT IN (1,2) AND w IN public.q", expect: { type: "select", permission: SELECT, reads: ["public.t", "public.s", "public.q"] } },
  { sql: "SELECT * FROM public.t WHERE x = ANY (SELECT y FROM public.s)", expect: { type: "select", permission: SELECT, reads: ["public.t", "public.s"] } },
  { sql: "WITH c AS (SELECT * FROM secret.s) SELECT * FROM c", expect: { type: "select", permission: SELECT, reads: ["secret.s"] } },
  { sql: "WITH c AS ((SELECT * FROM public.s)) SELECT * FROM c", expect: { type: "select", permission: SELECT, reads: ["public.s"] } },
  { sql: "WITH c AS (SELECT * FROM public.s), 1 AS one SELECT *, one FROM c", expect: { type: "select", permission: SELECT, reads: ["public.s"] } },
  { sql: "WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM r WHERE n<3) SELECT * FROM r", expect: { type: "select", permission: SELECT }, syntaxErrorOn: ["23.8"] },
  { sql: "SELECT * FROM (SELECT * FROM public.s) AS sub UNION ALL SELECT * FROM public.u INTERSECT SELECT * FROM public.w", expect: { type: "select", permission: SELECT, reads: ["public.s", "public.u", "public.w"] } },
  { sql: "SELECT COLUMNS('^a'), * EXCEPT (b), t.* FROM public.t AS t", expect: { type: "select", permission: SELECT, reads: ["public.t"] } },
  { sql: "SELECT * FROM numbers(10) n, generateRandom('a UInt8') LIMIT 1", expect: { type: "select", permission: SELECT } },
  { sql: "SELECT * FROM `my-db`.`ev-ents` LIMIT 100", expect: { type: "select", permission: SELECT, reads: ["my-db.ev-ents"] } },
  { sql: "SELECT * FROM public.t -- trailing comment", expect: { type: "select", permission: SELECT, reads: ["public.t"] } },
  { sql: "SELECT * FROM public.t WHERE ts >= {from:DateTime64(3)}", params: { from: "2026-01-01 00:00:00.000" }, expect: { type: "select", permission: SELECT, reads: ["public.t"] } },
  { sql: "INSERT INTO public.t (a, b) VALUES (1, 'x'), (2, now())", expect: { type: "insert", permission: "table:insert", targets: ["public.t"] } },
  { sql: "INSERT INTO public.t SELECT * FROM secret.s", expect: { type: "insert", permission: "table:insert", targets: ["public.t"], reads: ["secret.s"] } },
  { sql: "INSERT INTO t FORMAT CSV", expect: { type: "insert", permission: "table:insert", targets: ["·.t"] } },
  { sql: "CREATE TABLE public.x (a UInt64 DEFAULT 1 COMMENT 'c', b Nullable(String) CODEC(ZSTD)) ENGINE = ReplacingMergeTree(a) PARTITION BY a ORDER BY a TTL now() + INTERVAL 1 DAY COMMENT 'x'", expect: { type: "create", permission: "table:create", targets: ["public.x"] } },
  { sql: "CREATE TABLE public.x ENGINE = MergeTree ORDER BY a AS SELECT * FROM public.s", expect: { type: "create", permission: "table:create", targets: ["public.x"], reads: ["public.s"] } },
  { sql: "CREATE MATERIALIZED VIEW public.mv ENGINE = MergeTree ORDER BY a AS SELECT * FROM public.s", expect: { type: "create", permission: "table:create", targets: ["public.mv"], reads: ["public.s"] } },
  { sql: "CREATE DATABASE d2 ENGINE = Atomic", expect: { type: "create", permission: "database:create", databases: ["d2"] } },
  { sql: "ALTER TABLE public.t ADD COLUMN c UInt8 AFTER a, DROP COLUMN d, MODIFY COLUMN e String, RENAME COLUMN f TO g, COMMENT COLUMN a 'x'", expect: { type: "alter", permission: "table:alter", targets: ["public.t"] } },
  { sql: "ALTER TABLE public.t DELETE WHERE x IN (SELECT y FROM secret.s)", expect: { type: "alter", permission: "table:alter", targets: ["public.t"], reads: ["secret.s"] } },
  { sql: "ALTER TABLE public.t MOVE PARTITION 4 TO TABLE secret.s", expect: "UNSUPPORTED_SHAPE" },
  { sql: "DELETE FROM public.t WHERE x = 1", expect: { type: "delete", permission: "table:delete", targets: ["public.t"] } },
  { sql: "UPDATE public.t SET x = 1 WHERE y = 2", expect: { type: "update", permission: "table:update", targets: ["public.t"] }, syntaxErrorOn: ["23.8"] },
  { sql: "DROP TABLE IF EXISTS public.t SYNC", expect: { type: "drop", permission: "table:drop", targets: ["public.t"] } },
  { sql: "DROP DATABASE d2", expect: { type: "drop", permission: "database:drop", databases: ["d2"] } },
  { sql: "DROP DICTIONARY public.d", expect: "UNSUPPORTED_SHAPE" },
  { sql: "TRUNCATE TABLE IF EXISTS public.t", expect: { type: "truncate", permission: "table:delete", targets: ["public.t"] } },
  { sql: "SHOW TABLES", expect: { type: "show", permission: "table:view", databases: [""] } },
  { sql: "SHOW TABLES FROM public LIKE '%a%'", expect: { type: "show", permission: "table:view", databases: ["public"] } },
  { sql: "SHOW DATABASES", expect: { type: "show", permission: "table:view" } },
  { sql: "SHOW CREATE TABLE secret.s", expect: { type: "show", permission: "table:view", reads: ["secret.s"] } },
  { sql: "DESCRIBE TABLE public.t", expect: { type: "describe", permission: "table:view", reads: ["public.t"] } },
  { sql: "EXISTS TABLE public.t", expect: { type: "exists", permission: MISC, reads: ["public.t"] } },
  { sql: "EXPLAIN SELECT * FROM secret.s", expect: { type: "explain", permission: MISC, reads: ["secret.s"] } },
  { sql: "EXPLAIN ESTIMATE SELECT * FROM public.t", expect: { type: "explain", permission: MISC, reads: ["public.t"] } },
  { sql: "CHECK TABLE public.t", expect: { type: "check", permission: MISC, reads: ["public.t"] } },
  { sql: "KILL QUERY WHERE query_id = 'x'", expect: { type: "kill", permission: MISC } },
  { sql: "SET max_threads = 1", expect: { type: "set", permission: MISC } },
  { sql: "USE public", expect: { type: "use", permission: MISC, databases: ["public"] } },

  // --- refused for non-admins (admins still run them) ---------------------
  { sql: "OPTIMIZE TABLE public.t FINAL", expect: "UNSUPPORTED_SHAPE" },
  { sql: "RENAME TABLE public.a TO secret.b", expect: "UNSUPPORTED_SHAPE" },
  { sql: "SYSTEM FLUSH LOGS", expect: "UNSUPPORTED_SHAPE" },
  { sql: "GRANT SELECT ON secret.* TO u", expect: "UNSUPPORTED_SHAPE" },
  { sql: "SHOW COLUMNS FROM secret.s", expect: "UNSUPPORTED_SHAPE" },
  { sql: "SHOW PROCESSLIST", expect: "UNSUPPORTED_SHAPE" },
  { sql: "CREATE USER u IDENTIFIED BY 'p'", expect: "UNSUPPORTED_SHAPE" },
];
