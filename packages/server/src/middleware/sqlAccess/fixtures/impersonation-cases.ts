/**
 * Statements whose printouts are recorded for the personal-connection check
 * (ADR 0033 §7.2). For each, `recordImpersonation.ts` asks a qualifying server
 * for the statement alone and for every text CHouse may build around it: the
 * wrapper, the wrapper with a new SETTINGS clause, and the wrapper with one
 * more entry in the statement's own clause. The bound user is always `alice`.
 */

export const IMPERSONATION_USER = "alice";

export const IMPERSONATION_CASES: readonly string[] = [
  // Reads, with and without their own settings.
  "SELECT 1",
  "SELECT count() FROM public.events",
  "SELECT * FROM events",
  "SELECT count() FROM system.parts",
  "SELECT 1 SETTINGS max_threads = 1",
  "SELECT 1 FROM (SELECT 2 SETTINGS max_threads = 1)",
  "SELECT 1 UNION ALL SELECT 2",
  "SELECT 1;",
  "SELECT 1 -- note",
  "WITH x AS (SELECT 1 AS a) SELECT a FROM x",
  "SELECT 1 FORMAT TabSeparated",
  "SELECT 1 FORMAT JSON SETTINGS max_threads = 1",
  "SELECT 1 SETTINGS max_threads = 1 FORMAT JSON",
  "SELECT 1 INTO OUTFILE 'x'",
  "EXPLAIN SELECT 1",
  "EXPLAIN AST SELECT 1",
  // Kinds that cannot carry the clause.
  "SHOW TABLES FROM public",
  "SHOW DATABASES",
  "SHOW CREATE TABLE public.events",
  "DESCRIBE TABLE public.events",
  "EXISTS TABLE public.events",
  "CHECK TABLE public.events",
  // Writes and DDL.
  "INSERT INTO public.events SELECT 1, 'a'",
  "INSERT INTO public.events VALUES (1, 'a')",
  "INSERT INTO public.events FORMAT JSONEachRow",
  "ALTER TABLE public.events UPDATE name = 'x' WHERE 1",
  "ALTER TABLE public.events DELETE WHERE 1",
  "DELETE FROM public.events WHERE 1",
  "ALTER TABLE public.events ADD COLUMN x UInt8",
  "CREATE TABLE public.made (id UInt32) ENGINE = MergeTree ORDER BY id",
  "CREATE DATABASE made_db",
  "DROP TABLE public.events",
  "DROP DATABASE public",
  "TRUNCATE TABLE public.events",
  "KILL QUERY WHERE query_id = 'x'",
  // Refused before or by the wrapper.
  "SET max_threads = 1",
  "USE public",
  "EXECUTE AS bob SELECT 1",
  "/* hidden */ EXECUTE AS bob SELECT 1",
  "SELECT 1; SELECT 2",
  "SYSTEM FLUSH LOGS",
  "GRANT SELECT ON public.* TO bob",
  "SELEC 1",
];
