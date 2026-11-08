# SQL Access Check

## Overview
Decides what a non-admin's SQL statement touches, for
[`validateQueryAccess`](../dataAccess.ts) (ADR 0030,
[docs/adr/0030](../../../../../docs/adr/0030-clickhouse-parses-sql-access-checks.md)).
ClickHouse itself parses the statement (`EXPLAIN AST` on the request's
connection); this directory reads that printout strictly and walks it under an
allow-list policy. A small lexer covers what the printout can't show. Any doubt
is a refusal with a code.

## Interface
- `index.ts`: `[index.ts:parseStatementAccess]` - `(sql, params, port) → ParsedAccess` (`{ ok, access, defaultDatabase }` or `{ ok: false, code, reason }`); re-exports `clickhouseParsePort`, `resetDefaultDatabaseCache` and the types.
- `clickhouseParse.ts`: `[clickhouseParse.ts:SqlParsePort]` (`explainAst`, `defaultDatabase`), `[clickhouseParse.ts:clickhouseParsePort]`, `[clickhouseParse.ts:explainAstOn]`, `[clickhouseParse.ts:classifyParseError]`, `[clickhouseParse.ts:resetDefaultDatabaseCache]`.
- `explainTree.ts`: `[explainTree.ts:readExplainTree]`, `[explainTree.ts:preOrder]`, type `AstNode`.
- `analyze.ts`: `[analyze.ts:analyzeStatement]`, types `StatementAccess` (`type`, `permission`, `targets`, `reads`, `databases`), `NameRef`, `DenyCode`, `StatementType`.
- `lexer.ts`: `[lexer.ts:lex]`, `[lexer.ts:keywordAt]`, `[lexer.ts:isPlainName]`, type `Token`.
- `fixtures/`: `cases.ts` (statements and expected decisions, `caseKey`), `explain-ast.json` (real printouts per ClickHouse version), `fakeParser.ts` (test ports), `record.ts` (re-records the JSON).

## Invariants
- The pipeline order is fixed: lex → gate → `EXPLAIN AST` → strict tree → walk. A failure at any step is a refusal; nothing falls back to guessing `[index.ts:parseStatementAccess]`.
- Gate: quoted names, and the values of `{name:Identifier}` parameters, must be plain words (letters, digits, `_`, `-`, `$`; a parameter may be `db.table`), so the printout can't be forged or misread (`AMBIGUOUS_NAME`) `[index.ts:parseStatementAccess]`, `[lexer.ts:isPlainName]`.
- Raw `INSERT … FORMAT <name>` data (any format but `Values`) is not SQL: the lexer stops at it (`dataStart`) and only the header is parsed `[lexer.ts:lex]`, `[index.ts:parseStatementAccess]`.
- The lexer follows ClickHouse: `--` and `#` comments, nested `/* */`, `\` and doubled-quote escapes, `$tag$…$tag$` heredocs; anything unclosed is `SQL_SYNTAX` `[lexer.ts:lex]`.
- The parse runs with `default_format=JSONEachRow`, `max_result_rows=0`, `max_result_bytes=0`, `result_overflow_mode='throw'`, a 5 s timeout and `log_comment={"source":"access_check"}`, via `exec` so no `FORMAT` is appended. ClickHouse error 456 is `QUERY_PARAM_UNBOUND`; any other numeric ClickHouse code is `SQL_SYNTAX` (positions reported in the user's text) unless it is a server-side code in `UNAVAILABLE_CODES`; errors without a ClickHouse code (network, timeout) are `CHECK_UNAVAILABLE` `[clickhouseParse.ts:explainAstOn]`, `[clickhouseParse.ts:classifyParseError]`.
- The tree has one root, indentation steps of one space, and every `(children N)` must match. `Literal` is always a leaf (`INCOMPLETE_TREE`) `[explainTree.ts:readExplainTree]`.
- Every node name must be in `KNOWN_NODES`. The text may not hold more `SELECT`, `IN`-family or table-reaching function words than the tree has matching nodes; a surplus means an unprinted part, refused as `UNSUPPORTED_SHAPE` `[analyze.ts:analyzeStatement]`.
- References:
  - every `TableIdentifier`;
  - the second argument of `in`-family functions when it is an `Identifier`;
  - the first argument of `dictGet*`/`joinGet*`/`dictHas`/`dictIsIn`, which must be a string literal or an `Identifier`.

  `file()` and `hasColumnInTable()` are refused. Table functions must be in `SAFE_TABLE_FUNCTIONS`, and engines must be local. A name with more than one dot or a quote is `AMBIGUOUS_NAME` `[analyze.ts:analyzeStatement]`.
- An unqualified name is a CTE only inside the `SelectQuery` that declares it. CTE names come from the lexer and are paired with `WithElement` nodes in pre-order; a count mismatch is refused `[analyze.ts:analyzeStatement]`.
- Statement kinds are an allow-list (ADR 0030 §7), and the first lexer keyword must match the printed root (an `ATTACH` printed as `CreateQuery` is refused). Refused for non-admins: OPTIMIZE, RENAME, EXCHANGE, SYSTEM, GRANT, CREATE USER/FUNCTION/DICTIONARY, DETACH, SHOW COLUMNS/PROCESSLIST, EXISTS DATABASE, MV `TO`, `CREATE TABLE … AS table|func()`, `CLONE AS`, `INTO OUTFILE`, `INSERT INTO FUNCTION`, and ALTER commands off `ALTER_COMMANDS` `[analyze.ts:analyzeStatement]`.
- `defaultDatabase()` is the connection's configured database, else `currentDatabase()`, cached per connection for 60 s `[clickhouseParse.ts:clickhouseParsePort]`.

## Side Effects
- `clickhouseParsePort` opens (or reuses) the connection's pooled client and runs `EXPLAIN AST` and, when the connection has no database, `SELECT currentDatabase()`. It never caches a parse or a decision `[clickhouseParse.ts:clickhouseParsePort]`.
- `fixtures/record.ts` writes `fixtures/explain-ast.json` (run by hand) `[fixtures/record.ts]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/middleware/sqlAccess src/middleware/dataAccess.test.ts`
- Re-record printouts after adding a case or supporting a new ClickHouse version (needs real servers): `bun src/middleware/sqlAccess/fixtures/record.ts 26.5=http://user:pass@host:port 23.8=http://user:pass@host:port`, then review the JSON diff.
