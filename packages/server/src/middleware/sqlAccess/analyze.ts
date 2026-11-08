/**
 * Walk a ClickHouse `EXPLAIN AST` tree under the ADR 0030 policy (§5–§7).
 *
 * Everything is an allow-list: known root kinds, known node names, known ALTER
 * commands, local engines, inline-data table functions. Whatever isn't listed
 * is refused. The lexer tokens fill the gaps the printout leaves: the object
 * kind after CREATE/DROP, CTE names, and the words a part of the statement the
 * printout omits (INSERT data, WINDOW bodies) could use to reach a table.
 */
import { PERMISSIONS } from "../../rbac/schema/base";
import { isLocalDatabaseEngine, isLocalTableEngine } from "../../utils/sqlIdentifier";
import { SAFE_TABLE_FUNCTIONS } from "../sqlParser";
import { preOrder, type AstNode } from "./explainTree";
import { keywordAt, type Token } from "./lexer";

export type DenyCode =
  | "SQL_SYNTAX"
  | "QUERY_PARAM_UNBOUND"
  | "AMBIGUOUS_NAME"
  | "UNSAFE_TABLE_FUNCTION"
  | "UNSAFE_FUNCTION"
  | "UNSAFE_ENGINE"
  | "UNSUPPORTED_SHAPE"
  | "INCOMPLETE_TREE"
  | "PERMISSION_DENIED"
  | "TABLE_DENIED"
  | "CHECK_UNAVAILABLE";

export type StatementType =
  | "select" | "insert" | "create" | "drop" | "truncate" | "alter" | "delete" | "update"
  | "show" | "describe" | "exists" | "check" | "explain" | "use" | "set" | "kill";

/** A table as written; `database` is absent when it resolves to the default database. */
export interface NameRef {
  database?: string;
  table: string;
}

export interface StatementAccess {
  type: StatementType;
  /** The RBAC permission the statement needs. */
  permission: string;
  /** Tables the statement creates, writes, alters or drops. */
  targets: NameRef[];
  /** Tables the statement reads (subqueries, sources, lookups). */
  reads: NameRef[];
  /** Databases checked as a whole; an empty string means the default database. */
  databases: string[];
}

export type AnalyzeResult = { ok: true; access: StatementAccess } | { ok: false; code: DenyCode; reason: string };

class Refusal extends Error {
  constructor(readonly code: DenyCode, message: string) {
    super(message);
  }
}

const UNSUPPORTED = "This kind of statement can't be checked against your data access rules. Ask an admin to run it.";

/** Node names seen in ClickHouse 23.8–26.5 printouts of the supported statement kinds. */
const KNOWN_NODES: ReadonlySet<string> = new Set([
  // statement roots handled below
  "SelectWithUnionQuery", "InsertQuery", "CreateQuery", "DropQuery", "TruncateQuery", "AlterQuery",
  "DeleteQuery", "UpdateQuery", "ShowTables", "ShowCreateTableQuery", "ShowCreateViewQuery",
  "DescribeQuery", "ExistsTableQuery", "CheckQuery", "Explain", "UseQuery", "Set", "KillQueryQuery",
  // query structure
  "SelectIntersectExceptQuery", "SelectQuery", "Subquery", "WithElement", "ExpressionList",
  "TablesInSelectQuery", "TablesInSelectQueryElement", "TableExpression", "TableJoin", "ArrayJoin",
  "TableIdentifier", "SampleRatio", "OrderByElement", "WindowDefinition", "WindowListElement",
  "InterpolateElement",
  // expressions
  "Identifier", "Literal", "Function", "Asterisk", "QualifiedAsterisk", "ColumnsRegexpMatcher",
  "ColumnsListMatcher", "QualifiedColumnsRegexpMatcher", "QualifiedColumnsListMatcher",
  "ColumnsTransformerList", "ColumnsApplyTransformer", "ColumnsExceptTransformer",
  "ColumnsReplaceTransformer", "ColumnsReplaceTransformer::Replacement",
  // DDL bodies
  "Columns", "ColumnDeclaration", "DataType", "Index", "Constraint", "Projection",
  "ProjectionSelectQuery", "TTLElement", "Storage", "ViewTargets", "Partition", "AlterCommand",
  "Assignment",
]);

const IN_FUNCTIONS: ReadonlySet<string> = new Set([
  "in", "notin", "globalin", "globalnotin", "nullin", "notnullin", "globalnullin", "globalnotnullin",
]);

/** Scalar functions that read a dictionary or Join table named by their first argument. */
function isLookupFunction(lowerName: string): boolean {
  return lowerName.startsWith("dictget") || lowerName.startsWith("joinget") || lowerName === "dicthas" || lowerName === "dictisin";
}

/** Scalar functions that reach data outside the rules altogether. */
const UNSAFE_SCALAR_FUNCTIONS: ReadonlySet<string> = new Set(["file", "hascolumnintable"]);

/** Every word the printout must account for with a node (§5). */
function isTableReachingWord(lowerName: string): boolean {
  return isLookupFunction(lowerName) || UNSAFE_SCALAR_FUNCTIONS.has(lowerName);
}

const ALTER_COMMANDS: ReadonlySet<string> = new Set([
  "ADD_COLUMN", "DROP_COLUMN", "MODIFY_COLUMN", "COMMENT_COLUMN", "RENAME_COLUMN", "MATERIALIZE_COLUMN",
  "ADD_INDEX", "DROP_INDEX", "MATERIALIZE_INDEX",
  "ADD_CONSTRAINT", "DROP_CONSTRAINT",
  "ADD_PROJECTION", "DROP_PROJECTION", "MATERIALIZE_PROJECTION",
  "MODIFY_TTL", "REMOVE_TTL", "MATERIALIZE_TTL",
  "MODIFY_SETTING", "RESET_SETTING", "MODIFY_COMMENT", "MODIFY_ORDER_BY",
  "DELETE", "UPDATE", "DROP_PARTITION",
]);

function functionName(node: AstNode): string {
  return node.args.split(" ")[0].toLowerCase();
}

/** `db.t` or `t` from printed text; anything else can't be split safely. */
function parseName(text: string): NameRef {
  if (/[`"'\s]/.test(text) || text === "") throw new Refusal("AMBIGUOUS_NAME", `The name ${JSON.stringify(text)} can't be checked safely. Use plain names without dots, spaces or quotes.`);
  const parts = text.split(".");
  if (parts.length === 1) return { table: parts[0] };
  if (parts.length === 2 && parts[0] && parts[1]) return { database: parts[0], table: parts[1] };
  throw new Refusal("AMBIGUOUS_NAME", `The name ${JSON.stringify(text)} can't be checked safely. Use plain names without dots, spaces or quotes.`);
}

/** The value of a printed string literal (`'db.d'`), or null when the literal isn't a string. */
function stringLiteral(node: AstNode): string | null {
  if (node.name !== "Literal") return null;
  const match = /^'((?:[^'\\]|\\.)*)'$/.exec(node.args);
  return match ? match[1].replace(/\\(.)/g, "$1") : null;
}

function args(node: AstNode): AstNode[] {
  const list = node.children[0];
  return list && list.name === "ExpressionList" ? list.children : [];
}

/** The statement's own target: the root's direct Identifier children (`t` or `db`, `t`). */
function directTarget(root: AstNode): NameRef {
  const ids = root.children.filter((c) => c.name === "Identifier").map((c) => c.args);
  if (ids.length === 1) return parseName(ids[0]);
  if (ids.length === 2) return { database: parseName(ids[0]).table, table: parseName(ids[1]).table };
  throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
}

// ---------------------------------------------------------------------------
// Lexer facts
// ---------------------------------------------------------------------------

function firstWord(tokens: Token[], from = 0): number {
  for (let i = from; i < tokens.length; i++) if (tokens[i].kind === "word") return i;
  return -1;
}

function hasWord(tokens: Token[], word: string): boolean {
  return tokens.some((t) => t.kind === "word" && t.value.toUpperCase() === word);
}

/** CREATE / DROP object kind: the first keyword after the verb and its modifiers. */
function objectKind(tokens: Token[], verbIndex: number): string {
  for (let i = verbIndex + 1; i < tokens.length; i++) {
    const word = keywordAt(tokens, i);
    if (word === "OR" || word === "REPLACE" || word === "TEMPORARY") continue;
    if (word === "MATERIALIZED" && keywordAt(tokens, i + 1) === "VIEW") return "MATERIALIZED VIEW";
    return word;
  }
  return "";
}

/** CTE names in text order: `(WITH|RECURSIVE|,) name AS ( SELECT|WITH|(`. */
function cteNames(tokens: Token[]): string[] {
  const names: string[] = [];
  for (let i = 0; i + 4 < tokens.length; i++) {
    const lead = tokens[i];
    const leads = (lead.kind === "word" && /^(WITH|RECURSIVE)$/i.test(lead.value)) || (lead.kind === "symbol" && lead.value === ",");
    const name = tokens[i + 1];
    if (!leads || (name.kind !== "word" && name.kind !== "quotedName")) continue;
    if (keywordAt(tokens, i + 2) !== "AS") continue;
    if (!(tokens[i + 3].kind === "symbol" && tokens[i + 3].value === "(")) continue;
    const body = keywordAt(tokens, i + 4);
    const nested = tokens[i + 4].kind === "symbol" && tokens[i + 4].value === "(";
    if (body === "SELECT" || body === "WITH" || nested) names.push(name.value);
  }
  return names;
}

/** §5: everything the text can use to reach a table must appear in the printout. */
function checkCompleteness(root: AstNode, tokens: Token[]): void {
  let selectWords = 0;
  let inWords = 0;
  let reachWords = 0;
  tokens.forEach((token, i) => {
    if (token.kind !== "word") return;
    const lower = token.value.toLowerCase();
    if (lower === "select") selectWords++;
    if (IN_FUNCTIONS.has(lower)) inWords++;
    const next = tokens[i + 1];
    if (isTableReachingWord(lower) && next && next.kind === "symbol" && next.value === "(") reachWords++;
  });

  let selectNodes = 0;
  let inNodes = 0;
  let reachNodes = 0;
  for (const node of preOrder(root)) {
    if (!KNOWN_NODES.has(node.name)) {
      throw new Refusal("UNSUPPORTED_SHAPE", `${UNSUPPORTED} (unrecognised part: ${node.name})`);
    }
    if (node.name === "SelectQuery" || node.name === "ProjectionSelectQuery") selectNodes++;
    if (node.name === "Function") {
      const name = functionName(node);
      if (IN_FUNCTIONS.has(name)) inNodes++;
      if (isTableReachingWord(name)) reachNodes++;
    }
  }

  // A word with no node means part of the text wasn't printed, so it wasn't
  // walked. Extra nodes are fine: they are printed and walked (`x = ANY (…)`
  // prints as an `in` node with no IN word).
  if (selectWords > selectNodes || inWords > inNodes || reachWords > reachNodes) {
    throw new Refusal(
      "UNSUPPORTED_SHAPE",
      "Part of this statement can't be checked against your data access rules (for example a subquery or lookup inside INSERT … VALUES data or a WINDOW definition). Ask an admin to run it.",
    );
  }
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

interface WalkState {
  /** CTE name per WithElement node, paired in pre-order. */
  cteOf: Map<AstNode, string>;
  reads: NameRef[];
}

/** Pair the lexer's CTE names with the printout's WithElement nodes (same pre-order). */
function pairCtes(root: AstNode, tokens: Token[]): Map<AstNode, string> {
  const elements = [...preOrder(root)].filter((n) => n.name === "WithElement");
  const names = cteNames(tokens);
  if (elements.length !== names.length) {
    throw new Refusal("UNSUPPORTED_SHAPE", "The WITH clauses in this statement can't be matched up for checking. Ask an admin to run it.");
  }
  return new Map(elements.map((el, i) => [el, names[i]]));
}

/** Read every table reference under `node`, honouring CTE scope. */
function collectReads(node: AstNode, state: WalkState, scope: ReadonlyArray<ReadonlySet<string>>): void {
  let inner = scope;
  if (node.name === "SelectQuery") {
    const declared = new Set<string>();
    for (const child of node.children) {
      if (child.name !== "ExpressionList") continue;
      for (const el of child.children) {
        const name = state.cteOf.get(el);
        if (name !== undefined) declared.add(name);
      }
    }
    if (declared.size > 0) inner = [...scope, declared];
  }

  const addRef = (ref: NameRef): void => {
    if (!ref.database && inner.some((names) => names.has(ref.table))) return; // a CTE in scope
    state.reads.push(ref);
  };

  switch (node.name) {
    case "TableIdentifier":
      addRef(parseName(node.args));
      break;
    case "TableExpression": {
      const fn = node.children.find((c) => c.name === "Function");
      if (fn) {
        const name = functionName(fn);
        if (!SAFE_TABLE_FUNCTIONS.has(name)) {
          throw new Refusal("UNSAFE_TABLE_FUNCTION", `Table function '${name}' is not allowed by your data access rules`);
        }
      }
      break;
    }
    case "Function": {
      const name = functionName(node);
      if (UNSAFE_SCALAR_FUNCTIONS.has(name)) {
        throw new Refusal("UNSAFE_FUNCTION", `Function '${name}' is not allowed by your data access rules`);
      }
      if (IN_FUNCTIONS.has(name)) {
        const rhs = args(node)[1];
        if (rhs && rhs.name === "Identifier") addRef(parseName(rhs.args));
      }
      if (isLookupFunction(name)) {
        const first = args(node)[0];
        const named = first?.name === "Identifier" ? first.args : first ? stringLiteral(first) : null;
        if (named === null) {
          throw new Refusal("UNSUPPORTED_SHAPE", `The first argument of ${name}() must be a plain dictionary or table name so it can be checked`);
        }
        addRef(parseName(named));
      }
      break;
    }
    default:
      break;
  }

  for (const child of node.children) collectReads(child, state, inner);
}

function readsUnder(nodes: AstNode[], cteOf: Map<AstNode, string>): NameRef[] {
  const state: WalkState = { cteOf, reads: [] };
  for (const node of nodes) collectReads(node, state, []);
  return state.reads;
}

/** The engine named in a `Storage definition` node, if any. */
function storageEngine(storage: AstNode): string | null {
  const fn = storage.children[0];
  return fn && fn.name === "Function" ? fn.args.split(" ")[0] : null;
}

function checkTableEngines(nodes: AstNode[]): void {
  for (const node of nodes) {
    for (const storage of [...preOrder(node)].filter((n) => n.name === "Storage")) {
      const engine = storageEngine(storage);
      if (engine && !isLocalTableEngine(engine)) {
        throw new Refusal("UNSAFE_ENGINE", `Table engine '${engine}' is not allowed by your data access rules`);
      }
    }
  }
}

function only(root: AstNode, allowed: string[]): void {
  if (root.children.some((c) => !allowed.includes(c.name))) throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
}

// ---------------------------------------------------------------------------
// Statement kinds (§7)
// ---------------------------------------------------------------------------

function expectVerb(tokens: Token[], verbs: string[]): number {
  const index = firstWord(tokens);
  if (index === -1 || !verbs.includes(keywordAt(tokens, index))) throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
  return index;
}

function analyzeRoot(root: AstNode, tokens: Token[], cteOf: Map<AstNode, string>, insideExplain: boolean): StatementAccess {
  const base = { targets: [] as NameRef[], reads: [] as NameRef[], databases: [] as string[] };
  const rest = (exclude: (n: AstNode) => boolean): NameRef[] => readsUnder(root.children.filter((c) => !exclude(c)), cteOf);

  switch (root.name) {
    case "SelectWithUnionQuery": {
      if (!insideExplain) {
        const first = tokens[0];
        if (!first || !(first.kind === "symbol" ? first.value === "(" : ["SELECT", "WITH"].includes(keywordAt(tokens, 0)))) {
          throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
        }
      }
      if (tokens.some((t, i) => t.kind === "word" && t.value.toUpperCase() === "INTO" && keywordAt(tokens, i + 1) === "OUTFILE")) {
        throw new Refusal("UNSUPPORTED_SHAPE", "INTO OUTFILE is not allowed");
      }
      return { ...base, type: "select", permission: PERMISSIONS.TABLE_SELECT, reads: readsUnder([root], cteOf) };
    }

    case "InsertQuery": {
      if (!insideExplain) expectVerb(tokens, ["INSERT"]);
      if (root.children.some((c) => c.name === "Function")) {
        throw new Refusal("UNSAFE_TABLE_FUNCTION", "INSERT INTO FUNCTION is not allowed by your data access rules");
      }
      only(root, ["Identifier", "ExpressionList", "SelectWithUnionQuery", "Set"]);
      return {
        ...base,
        type: "insert",
        permission: PERMISSIONS.TABLE_INSERT,
        targets: [directTarget(root)],
        reads: rest((c) => c.name === "Identifier"),
      };
    }

    case "CreateQuery": {
      const verb = expectVerb(tokens, ["CREATE"]);
      const kind = objectKind(tokens, verb);
      if (hasWord(tokens, "CLONE")) throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
      if (kind === "DATABASE") {
        only(root, ["Identifier", "Storage", "Literal"]);
        const storage = root.children.find((c) => c.name === "Storage");
        const engine = storage ? storageEngine(storage) : null;
        if (engine && !isLocalDatabaseEngine(engine)) {
          throw new Refusal("UNSAFE_ENGINE", `Database engine '${engine}' is not allowed by your data access rules`);
        }
        return { ...base, type: "create", permission: PERMISSIONS.DB_CREATE, databases: [directTarget(root).table] };
      }
      if (kind === "TABLE" || kind === "VIEW" || kind === "MATERIALIZED VIEW") {
        if (root.children.some((c) => c.name === "Function")) {
          throw new Refusal("UNSAFE_TABLE_FUNCTION", "CREATE TABLE … AS a table function is not allowed by your data access rules");
        }
        only(root, ["Identifier", "Columns", "Storage", "SelectWithUnionQuery", "ViewTargets", "Literal", "Set"]);
        const hasColumns = root.children.some((c) => c.name === "Columns");
        const hasSelect = root.children.some((c) => c.name === "SelectWithUnionQuery");
        if (kind === "TABLE" && !hasColumns && !hasSelect) {
          // `CREATE TABLE x AS other_table`: the source isn't printed, so it can't be checked.
          throw new Refusal("UNSUPPORTED_SHAPE", "CREATE TABLE … AS another table can't be checked. List the columns instead.");
        }
        if (kind !== "TABLE" && !hasSelect) throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
        if (kind === "MATERIALIZED VIEW") {
          // The TO target isn't printed (26.5 shows an empty ViewTargets, 23.8 nothing).
          const asIndex = tokens.findIndex((t, i) => keywordAt(tokens, i) === "AS" && (keywordAt(tokens, i + 1) === "SELECT" || keywordAt(tokens, i + 1) === "WITH" || (tokens[i + 1]?.kind === "symbol" && tokens[i + 1].value === "(")));
          const head = asIndex === -1 ? tokens : tokens.slice(0, asIndex);
          if (head.some((t) => t.kind === "word" && t.value.toUpperCase() === "TO")) {
            throw new Refusal("UNSUPPORTED_SHAPE", "A materialized view with TO can't be checked. Ask an admin to create it.");
          }
          if (root.children.some((c) => c.name === "ViewTargets" && c.children.length === 0)) throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
        }
        checkTableEngines(root.children);
        return {
          ...base,
          type: "create",
          permission: PERMISSIONS.TABLE_CREATE,
          targets: [directTarget(root)],
          reads: rest((c) => c.name === "Identifier"),
        };
      }
      throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
    }

    case "DropQuery": {
      const verb = expectVerb(tokens, ["DROP"]);
      const kind = objectKind(tokens, verb);
      if (kind === "DATABASE") {
        only(root, ["Identifier"]);
        return { ...base, type: "drop", permission: PERMISSIONS.DB_DROP, databases: [directTarget(root).table] };
      }
      if (kind === "TABLE" || kind === "VIEW") {
        const list = root.children.find((c) => c.name === "ExpressionList");
        only(root, ["Identifier", "ExpressionList"]);
        const targets = list
          ? list.children.map((c) => {
              if (c.name !== "TableIdentifier") throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
              return parseName(c.args);
            })
          : [directTarget(root)];
        return { ...base, type: "drop", permission: PERMISSIONS.TABLE_DROP, targets };
      }
      throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
    }

    case "TruncateQuery": {
      expectVerb(tokens, ["TRUNCATE"]);
      if (hasWord(tokens, "ALL") || hasWord(tokens, "DATABASE")) throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
      only(root, ["Identifier"]);
      return { ...base, type: "truncate", permission: PERMISSIONS.TABLE_DELETE, targets: [directTarget(root)] };
    }

    case "AlterQuery": {
      const verb = expectVerb(tokens, ["ALTER"]);
      if (keywordAt(tokens, verb + 1) !== "TABLE") throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
      only(root, ["Identifier", "ExpressionList"]);
      const commands = root.children.filter((c) => c.name === "ExpressionList").flatMap((l) => l.children);
      for (const command of commands) {
        const kind = command.args.split(" ")[0];
        if (command.name !== "AlterCommand" || !ALTER_COMMANDS.has(kind)) {
          throw new Refusal("UNSUPPORTED_SHAPE", `ALTER ${kind.replace(/_/g, " ")} can't be checked against your data access rules. Ask an admin to run it.`);
        }
      }
      checkTableEngines(commands);
      return {
        ...base,
        type: "alter",
        permission: PERMISSIONS.TABLE_ALTER,
        targets: [directTarget(root)],
        reads: rest((c) => c.name === "Identifier"),
      };
    }

    case "DeleteQuery":
    case "UpdateQuery": {
      const isDelete = root.name === "DeleteQuery";
      expectVerb(tokens, [isDelete ? "DELETE" : "UPDATE"]);
      return {
        ...base,
        type: isDelete ? "delete" : "update",
        permission: isDelete ? PERMISSIONS.TABLE_DELETE : PERMISSIONS.TABLE_UPDATE,
        targets: [directTarget(root)],
        reads: rest((c) => c.name === "Identifier"),
      };
    }

    case "ShowTables": {
      const verb = expectVerb(tokens, ["SHOW"]);
      const what = keywordAt(tokens, verb + 1);
      only(root, ["Identifier"]);
      if (what === "DATABASES") return { ...base, type: "show", permission: PERMISSIONS.TABLE_VIEW };
      if (what !== "TABLES") throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
      const db = root.children.find((c) => c.name === "Identifier");
      return { ...base, type: "show", permission: PERMISSIONS.TABLE_VIEW, databases: [db ? parseName(db.args).table : ""] };
    }

    case "ShowCreateTableQuery":
    case "ShowCreateViewQuery": {
      expectVerb(tokens, ["SHOW"]);
      only(root, ["Identifier"]);
      return { ...base, type: "show", permission: PERMISSIONS.TABLE_VIEW, reads: [directTarget(root)] };
    }

    case "DescribeQuery": {
      expectVerb(tokens, ["DESCRIBE", "DESC"]);
      only(root, ["TableExpression"]);
      return { ...base, type: "describe", permission: PERMISSIONS.TABLE_VIEW, reads: readsUnder(root.children, cteOf) };
    }

    case "ExistsTableQuery":
    case "CheckQuery": {
      const isExists = root.name === "ExistsTableQuery";
      expectVerb(tokens, [isExists ? "EXISTS" : "CHECK"]);
      only(root, ["Identifier", "Partition"]);
      return { ...base, type: isExists ? "exists" : "check", permission: PERMISSIONS.QUERY_EXECUTE_MISC, reads: [directTarget(root)] };
    }

    case "Explain": {
      expectVerb(tokens, ["EXPLAIN"]);
      only(root, ["SelectWithUnionQuery", "InsertQuery", "Set"]);
      const inner = root.children.find((c) => c.name !== "Set");
      if (!inner) throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
      const access = analyzeRoot(inner, tokens, cteOf, true);
      // EXPLAIN runs nothing: whatever the statement would touch is checked as a read.
      return { ...base, type: "explain", permission: PERMISSIONS.QUERY_EXECUTE_MISC, reads: [...access.targets, ...access.reads] };
    }

    case "UseQuery": {
      expectVerb(tokens, ["USE"]);
      only(root, ["Identifier"]);
      return { ...base, type: "use", permission: PERMISSIONS.QUERY_EXECUTE_MISC, databases: [directTarget(root).table] };
    }

    case "Set": {
      expectVerb(tokens, ["SET"]);
      return { ...base, type: "set", permission: PERMISSIONS.QUERY_EXECUTE_MISC };
    }

    case "KillQueryQuery": {
      expectVerb(tokens, ["KILL"]);
      return { ...base, type: "kill", permission: PERMISSIONS.QUERY_EXECUTE_MISC, reads: readsUnder(root.children, cteOf) };
    }

    default:
      throw new Refusal("UNSUPPORTED_SHAPE", UNSUPPORTED);
  }
}

/** Apply the ADR 0030 policy to one parsed statement. */
export function analyzeStatement(root: AstNode, tokens: Token[]): AnalyzeResult {
  try {
    checkCompleteness(root, tokens);
    const cteOf = pairCtes(root, tokens);
    return { ok: true, access: analyzeRoot(root, tokens, cteOf, false) };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, code: error.code, reason: error.message };
    throw error;
  }
}
