# 0030 — ClickHouse Parses the SQL That Data Access Rules Check

- **Status:** Accepted
- **Date:** 2026-11-08
- **Closes:** [ARCHITECTURE.md › Known issues](../../ARCHITECTURE.md#known-issues) #2
- **Scope:** `packages/server/src/middleware/sqlAccess/` (new), `middleware/dataAccess.ts`, every caller of `validateQueryAccess`, `.rules/SECURITY.md` §3, the middleware contract. One PR.

## Context

CHouse UI runs every user's SQL through one ClickHouse login per connection.
What a non-admin may touch is decided by CHouse UI's own data access rules, so
before a statement runs `validateQueryAccess` must find **every** table it reads
or writes. `.rules/SECURITY.md` says unknown shapes fail closed.

Until now the tables came from `node-sql-parser`, a MySQL-grammar parser. It
fails on most ClickHouse-only syntax (`FORMAT`, `SETTINGS`, `FINAL`, `PREWHERE`,
`SAMPLE`, `LIMIT BY`, `WITH FILL`, `ANY/GLOBAL JOIN`, array literals, parametric
aggregates, query parameters), and when it fails a keyword-and-regex fallback
guesses. A statement with no detected tables was allowed. Measured on
`preview` (2026-11-08), each of these let a user limited to `public` read
`secret.s`:

| Statement | What the check saw |
|---|---|
| `SELECT * FROM public.t, secret.s SETTINGS max_threads=1` | only `public.t` (regex fallback) |
| `SELECT 1 WHERE 1 IN secret.s` | no tables → allowed |
| `SELECT joinGet(secret.j, 'v', 1)` | no tables → allowed |
| `SELECT * FROM {t:Identifier}` with `t=secret.s` | no tables → allowed |
| `INSERT INTO public.t VALUES ((SELECT max(v) FROM secret.s))` | target only; ClickHouse evaluated the subquery and stored the value |
| `CREATE VIEW public.v AS SELECT …` | the source only; the target `public.v` never checked |
| `SELECT * FROM t /* FROM public.t */` | regex "repair" checked `public.t`; ClickHouse ran `<default>.t` |

Parsing ClickHouse SQL well enough to authorise it is ClickHouse's job, not a
MySQL parser's. A multi-lens review of the first idea (ask ClickHouse with
`EXPLAIN AST`) agreed on that direction and found that, done naively, it still
fails open: output can be truncated, identifiers can forge tree lines, some DDL
references and window definitions are never printed, and several callers check
different text from what they run. Probes against ClickHouse 23.8.16 and
26.5.7 confirmed each point.

## Decision

### 1. ClickHouse's parser is the only authority for non-admin access checks

For a non-admin, `validateQueryAccess` runs this pipeline on the exact text that
will execute, and denies on any failure:

1. **Lex** the text with a small ClickHouse-compatible lexer
   (`sqlAccess/lexer.ts`).
2. **Gate**: refuse names the tree printout can't carry safely (§3).
3. **Parse** with `EXPLAIN AST <text>` on the request's own connection, with the
   request's query parameters bound (§4).
4. **Read the tree** with a strict grammar and check that it is complete (§5).
5. **Walk** it under an allow-list policy (§6) to get the statement kind,
   targets, reads, table functions and engines.
6. **Decide**: permissions and data access rules, as before (§7).

`node-sql-parser` and the regex fallback leave the access path. Admins keep the
bypass (they have no rules to check), unchanged.

### 2. What is checked is what runs

Every caller passes the SQL and `query_params` it executes:

| Caller | Before | Now |
|---|---|---|
| SQL editor `/execute`, `/execute-stream`, `/explain`, MCP `query` (through `/api/query`) | request SQL | same text, the connection the route runs on |
| Dashboards (runner, AI draft) | `validationSql` (literals for params) | `compiled.sql` + `compiled.params` |
| Scheduled queries (run, save), data health promises | `toParseableSql` (macros → `0`) | `buildExecutableQuery` output + its params |
| Notebooks, optimize-query | statement / input | same; optimize-query also checks the AI's rewrite before `EXPLAIN ESTIMATE` |
| Agent tools | statement before `LIMIT` / `EXPLAIN` were added | the final text |

The whole text is parsed at once. ClickHouse HTTP rejects multi-statement
bodies on execution, and `EXPLAIN AST` rejects them the same way, so the JS
splitter is no longer part of the security boundary.

The default database is resolved from the connection: its configured database,
else `currentDatabase()` (cached per connection for 60 s). Caller-supplied
defaults are dropped, which fixes the dashboard draft and optimize-query
mismatches. No ClickHouse session is used (`session_id` is never sent), so
`USE` and `SET` cannot change how later requests resolve.

### 3. Lexical gate

The printout does not quote identifiers: `` `secret.s` `` prints like
`secret.s`, and a backticked name containing a newline prints a forged
`TableIdentifier` line (probed). For non-admins, a quoted identifier, and the
value of an `Identifier`-typed query parameter, may contain letters, digits,
`_`, `-` and `$` only. Unbalanced quotes or comments are refused. `INTO OUTFILE`
is refused.

### 4. Parse channel

`EXPLAIN AST` runs on the connection's own pooled client with
`default_format=JSONEachRow` (one row per line, escaped), `max_result_rows=0`,
`max_result_bytes=0`, `result_overflow_mode='throw'` (so output can't be cut
short silently), `max_execution_time=5`, a 5 s abort, and
`log_comment={"source":"access_check"}`. No result cache in this phase.

`INSERT … FORMAT <name>` data in any format but `Values` is never evaluated as
SQL, so the lexer stops at it and only the header is parsed (ClickHouse 26.5's
`EXPLAIN` would otherwise try to lex CSV data). A failed parse with a
ClickHouse error code is the statement's problem (400, with ClickHouse's
message; positions are shifted back past the `EXPLAIN AST ` prefix). Only
errors with no ClickHouse code (network, timeout) or a server-side code (auth,
overload, cancellation) are `CHECK_UNAVAILABLE`.

### 5. Strict tree, completeness checks

- One root; indentation grows by one space; every `(children N)` matches the
  lines beneath it; `Literal` nodes are leaves. Anything else is
  `INCOMPLETE_TREE`.
- Every node name must be on a known list (collected from a corpus run on 23.8
  and 26.5). An unknown node is `UNSUPPORTED_SHAPE` and its name is logged,
  never the SQL.
- **The lexer and the tree must agree.** Some parts of a statement are never
  printed: `INSERT … VALUES` data, named `WINDOW` bodies, inline `OVER (…)` on
  23.8, and an MV's `TO` target on 23.8. So the count of `SELECT` keywords must
  equal the number of `SelectQuery` nodes, every `IN`-family word needs an
  `in`-family function node, and every table-reaching function word needs a
  matching function node. A mismatch means part of the statement wasn't
  printed, and it's `UNSUPPORTED_SHAPE`.

### 6. Walk policy

- **References.** Every `TableIdentifier` anywhere is a table. The second
  argument of `in`, `notIn`, `globalIn`, `globalNotIn`, `nullIn`, `notNullIn`,
  `globalNullIn` and `globalNotNullIn` is a table when it's an `Identifier`. The
  first argument of the table-reaching functions (`dictGet*`, `dictHas`,
  `dictIsIn`, `joinGet*`, `hasColumnInTable`) is a table when it's a string
  literal or an `Identifier`, and anything else is refused. Names resolve as
  `db.table` or `<default>.table`; more than one dot or a backtick is
  `AMBIGUOUS_NAME`. The old `SYSTEM_TABLES` remap goes: an unqualified `parts`
  is `<default>.parts`, which is what ClickHouse runs.
- **CTEs.** The printout omits CTE names. The lexer finds
  `(WITH|RECURSIVE|,) name AS ( SELECT|WITH`. The Nth name pairs with the Nth
  `WithElement` in pre-order, and the counts must match. An unqualified table
  name is a CTE reference only inside the `SelectQuery` that declares it (and
  below). `SELECT * FROM (WITH s AS (SELECT 1) SELECT * FROM s), s` therefore
  checks the outer `s`.
- **Table functions** (under `TableExpression`) must be in
  `SAFE_TABLE_FUNCTIONS`. The scalar `file()` is refused.
  `INSERT INTO FUNCTION` and `CREATE TABLE … AS func()` are refused.
- **Engines.** A table or MV engine must be in `LOCAL_TABLE_ENGINES`, and a
  database engine in `LOCAL_DATABASE_ENGINES` (the lists `/explorer` already
  enforces).

### 7. Statement kinds

Everything not listed here is refused (`UNSUPPORTED_SHAPE`), including
OPTIMIZE, RENAME, EXCHANGE, SYSTEM, GRANT, CREATE USER/FUNCTION/DICTIONARY,
DETACH/ATTACH, SHOW COLUMNS/PROCESSLIST and EXISTS DATABASE. Admins can still
run all of them.

| Root (object kind from the lexer) | Type | Permission | Checked |
|---|---|---|---|
| `SelectWithUnionQuery` | select | `table:select` | every reference |
| `InsertQuery` with a named target | insert | `table:insert` | target + `SELECT` source; inline data via §5 |
| `CreateQuery` DATABASE | create | `database:create` | the database; local engine |
| `CreateQuery` TABLE / TEMPORARY TABLE | create | `table:create` | target; needs a column list or `AS SELECT`; local engine. `AS other_table`, `AS func()` and `CLONE AS` are refused |
| `CreateQuery` VIEW | create | `table:create` | target + source |
| `CreateQuery` MATERIALIZED VIEW | create | `table:create` | target + source; local inner engine; `TO …` refused |
| `DropQuery` TABLE / VIEW | drop | `table:drop` | every target |
| `DropQuery` DATABASE | drop | `database:drop` | the database |
| `TruncateQuery` | truncate | `table:delete` | target |
| `AlterQuery` TABLE | alter | `table:alter` | target + expression reads; commands on an allow-list (column, index, TTL, comment, settings, `DELETE`/`UPDATE`, `DROP PARTITION`); `ATTACH/REPLACE/MOVE/FETCH PARTITION`, `FREEZE`, `MODIFY QUERY` refused |
| `DeleteQuery` | delete | `table:delete` | target + reads |
| `UpdateQuery` | update | `table:update` | target + reads |
| `ShowTables` (SHOW TABLES [FROM db] / SHOW DATABASES) | show | `table:view` | the database for SHOW TABLES |
| `ShowCreateTableQuery` | show | `table:view` | target |
| `DescribeQuery` | describe | `table:view` | the table expression |
| `ExistsTableQuery`, `CheckQuery` | exists / check | `query:execute:misc` | target |
| `Explain` | explain | `query:execute:misc` | the inner statement, walked with this same table |
| `UseQuery` | use | `query:execute:misc` | the database |
| `Set`, `KillQueryQuery` | set / kill | `query:execute:misc` | expression reads |

### 8. Outcomes

`validateQueryAccess` returns a `code` with each denial, and routes map it to a
status:

| Code | Meaning | Status |
|---|---|---|
| `SQL_SYNTAX` | ClickHouse could not parse it (its message is passed through) | 400 |
| `QUERY_PARAM_UNBOUND` | a parameter has no value | 400 |
| `AMBIGUOUS_NAME` | a name can't be checked safely; rename or quote differently | 403 |
| `UNSAFE_TABLE_FUNCTION`, `UNSAFE_FUNCTION`, `UNSAFE_ENGINE` | reaches data outside the rules | 403 |
| `UNSUPPORTED_SHAPE`, `INCOMPLETE_TREE` | the statement can't be fully checked | 403 |
| `PERMISSION_DENIED`, `TABLE_DENIED` | as before | 403 |
| `CHECK_UNAVAILABLE` | ClickHouse unreachable or the parse timed out; never phrased as "access denied" | 503 |

### 9. Rollout

The new check enforces from the first release. A shadow phase would keep
today's bypasses open while it collects data. Statements that worked before and
are now refused fall into three groups: the "Refused shapes" above (admins
still run them), names with dots or spaces in backticks, and `INSERT … VALUES`
rows that contain subqueries or dictionary lookups. Each refusal tells the user
which group it was. An admin dry-run over stored SQL is a follow-up.

## Consequences

- The bypasses in the Context table close. Unknown shapes now fail closed.
- Each non-admin statement costs one extra `EXPLAIN AST` round trip (parse
  only, milliseconds) on the shared ClickHouse user. Each dashboard panel
  refresh and each scheduled run adds one. If this matters it can be measured,
  and a cache of parse results (never decisions) added later.
- A ClickHouse outage now fails the check with 503 instead of "access denied".
  Saving a scheduled query or data health promise needs ClickHouse reachable,
  as running one always did.
- `node-sql-parser` stays only for hints that don't decide access by
  themselves: the read-only checks for dashboards, notebooks, scheduled jobs and
  MCP, AI guardrails, and `classifySqlChange`. All of these run in addition to
  this check. Moving them onto the new result is a follow-up, and so is removing
  the dependency.
- **Residual risks.**
  - A new ClickHouse scalar function that reads table data, and that isn't in
    the registry, is the one fail-open seam. The registry sits next to
    `SAFE_TABLE_FUNCTIONS` with a test per entry.
  - Existing tables whose engines point at other data (Distributed, Merge,
    Buffer, Dictionary over `secret.*`) are not seen by any parse.
  - Replicas behind a load balancer on different versions are covered only by
    the strict grammar.

## Alternatives considered

- **Keep node-sql-parser and patch it, or deny whenever it fails.** It can't
  parse most real ClickHouse SQL, so deny-on-failure would break the product.
  The AST path also missed the `IN`, `joinGet` and parameter cases above.
- **`EXPLAIN QUERY TREE`.** It resolves CTEs and defaults, but needs the new
  analyzer and existing tables, covers only SELECT, and its "Unknown table"
  errors leak whether a table exists.
- **An in-process ClickHouse parser (chDB / WASM).** A heavy native dependency
  whose version would drift from the server's.
- **ClickHouse-native enforcement**: data access rules synced to ClickHouse
  roles and a per-request `role`. ClickHouse would then enforce everything,
  including shapes no one listed. This is the long-term direction, but it
  changes how connections and grants work and needs its own ADR.
- **Check at execution in one guarded helper.** This is the cleanest way to make
  "checked = executed" structural. It is deferred: §2 fixes each caller, and the
  options-object API makes the later move small.
