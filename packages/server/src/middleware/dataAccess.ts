/**
 * Data Access Middleware
 *
 * Filters databases/tables by RBAC data access rules, and decides whether a
 * non-admin may run a SQL statement (ADR 0030): ClickHouse parses the exact
 * text that will run, `sqlAccess/` walks the tree under an allow-list policy,
 * and every table and database it touches is checked here.
 */

import { Context, Next } from 'hono';
import { extractTokenFromHeader } from '../rbac/services/jwt';
import { verifyBearer } from '../rbac/services/patAuth';
import {
  checkUserAccess,
  filterDatabasesForUser,
  filterTablesForUser,
  type AccessType
} from '../rbac/services/dataAccess';
import { PERMISSIONS } from '../rbac/schema/base';
import { systemTablePermission, systemTableRefusal } from '../rbac/services/systemTables';
import { isMcpSubrequestFor } from '../mcp/inProcess';
import { mintCheckedStatement, type CheckedStatement, type ImpersonatedText } from '../services/chExecutor/checked';
import { boundUser, identityOfConnection, type ConnectionIdentity } from '../services/chExecutor/identity';
import { impersonate, WRAPPABLE_KINDS } from '../services/chExecutor/impersonate';
import { visibleKey, visibleTo, type Visible } from '../services/chExecutor/visibleTables';
import { all, sql as dbSql, str } from '../services/observe/db';
import { getConnectionById } from '../rbac/services/connections';
import { AppError } from '../types';
import {
  clickhouseParsePort,
  hasInlineData,
  parseStatementAccess,
  refuseImpersonation,
  type DenyCode,
  type ParsedAccess,
  type SqlParsePort,
  type StatementType,
} from './sqlAccess';

// ============================================
// Middleware
// ============================================

/**
 * Optional RBAC context middleware
 * Extracts RBAC user info if JWT is present (doesn't fail if missing)
 */
export async function optionalRbacMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = extractTokenFromHeader(authHeader);

  if (token) {
    try {
      const identity = await verifyBearer(token, { allowOAuth: isMcpSubrequestFor(token) });
      c.set('rbacUserId', identity.userId);
      c.set('rbacRoles', identity.roles);
      c.set('rbacPermissions', identity.permissions);
      c.set('isRbacAdmin', identity.roles.includes('super_admin') || identity.roles.includes('admin'));
      // Agent governance and log_comment attribution key off these; without them token
      // requests (MCP, CLI) skipped budgets, the pause switch and session counting.
      c.set('authMethod', identity.authMethod);
      if (identity.patId) {
        c.set('patId', identity.patId);
      }
    } catch {
      // Token invalid, continue without RBAC context
    }
  }

  await next();
}

// ============================================
// Data Access Helpers
// ============================================

/**
 * On a `personal` connection (ADR 0033 §7.3) data access policies do not
 * decide what a person reaches: their own ClickHouse user does. Reads are
 * answered from what that user can see; a change is left to ClickHouse, which
 * checks the user's grants when the statement runs. Null on any other kind.
 * A kind that cannot be read counts as not personal, so the rules apply.
 */
async function personalView(userId: string, connectionId: string | undefined, accessType: AccessType): Promise<Visible | 'clickhouse-decides' | null> {
  if (!connectionId) return null;
  let mode: string | undefined;
  try {
    const rows = await all(dbSql`SELECT identity_mode FROM rbac_clickhouse_connections WHERE id = ${connectionId}`);
    mode = rows.length > 0 ? str(rows[0].identity_mode) : undefined;
  } catch {
    return null;
  }
  if (mode !== 'personal') return null;
  if (accessType === 'write' || accessType === 'admin') return 'clickhouse-decides';
  return visibleTo(connectionId, userId);
}

/**
 * Check if user has access to a database
 */
export async function checkDatabaseAccess(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  database: string,
  connectionId?: string,
  accessType: AccessType = 'read'
): Promise<boolean> {
  // Admins have full access
  if (isAdmin) return true;

  // RBAC user is required
  if (!userId) {
    throw new Error('RBAC user is required for database access checks');
  }

  const personal = await personalView(userId, connectionId, accessType);
  if (personal) return personal === 'clickhouse-decides' || personal.databases.has(database);

  const result = await checkUserAccess(userId, database, null, accessType, connectionId);
  return result.allowed;
}

/**
 * Check if user has access to a table
 */
export async function checkTableAccess(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  database: string,
  table: string,
  connectionId?: string,
  accessType: AccessType = 'read'
): Promise<boolean> {
  // Admins have full access
  if (isAdmin) return true;

  // RBAC user is required
  if (!userId) {
    throw new Error('RBAC user is required for table access checks');
  }

  const personal = await personalView(userId, connectionId, accessType);
  if (personal) return personal === 'clickhouse-decides' || personal.tables.has(visibleKey(database, table));

  const result = await checkUserAccess(userId, database, table, accessType, connectionId);
  return result.allowed;
}

// System databases that should be hidden from non-admin users
const SYSTEM_DATABASES = ['system', 'information_schema', 'INFORMATION_SCHEMA'];

/**
 * Filter databases based on user access
 * System databases are hidden from non-admin users
 */
export async function filterDatabases(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  databases: string[],
  connectionId?: string,
  _accessType: AccessType = 'read' // Access type is now determined by role permissions
): Promise<string[]> {
  // Admins see all (including system databases)
  if (isAdmin) return databases;

  // RBAC user is required
  if (!userId) {
    throw new Error('RBAC user is required for database filtering');
  }

  const personal = await personalView(userId, connectionId, 'read');
  if (personal && personal !== 'clickhouse-decides') return databases.filter((db) => personal.databases.has(db));

  // Filter out system databases for non-admin users
  const filtered = await filterDatabasesForUser(userId, databases, connectionId);
  return filtered.filter(db => !SYSTEM_DATABASES.includes(db));
}

/**
 * Filter tables based on user access
 * System tables are hidden from non-admin users
 */
export async function filterTables(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  database: string,
  tables: string[],
  connectionId?: string,
  _accessType: AccessType = 'read' // Access type is now determined by role permissions
): Promise<string[]> {
  // Admins see all (including system tables)
  if (isAdmin) return tables;

  // RBAC user is required
  if (!userId) {
    throw new Error('RBAC user is required for table filtering');
  }

  const personal = await personalView(userId, connectionId, 'read');
  if (personal && personal !== 'clickhouse-decides') return tables.filter((table) => personal.tables.has(visibleKey(database, table)));

  // For system database, hide all tables from non-admin users
  if (SYSTEM_DATABASES.includes(database)) {
    return [];
  }

  return filterTablesForUser(userId, database, tables, connectionId);
}

// ============================================
// Statement access (ADR 0030)
// ============================================

export interface QueryAccessInput {
  userId: string | undefined;
  isAdmin: boolean | undefined;
  permissions: string[] | undefined;
  /** The exact text that will run. */
  sql: string;
  /** The query parameters it runs with (`{name:Type}`). */
  params?: Record<string, unknown>;
  /** The connection it runs on: the parse and the rules are both per connection. */
  connectionId: string | undefined;
  /** Test seam; defaults to `EXPLAIN AST` on the connection. */
  parser?: SqlParsePort;
  /** Test seam: the connection's kind. Read from the connection when no `parser` is given. */
  identity?: ConnectionIdentity;
}

export interface QueryAccessResult {
  allowed: boolean;
  reason?: string;
  code?: DenyCode;
  /** HTTP status for a refusal: 400 for bad SQL, 503 when the check couldn't run, else 403. */
  status?: 400 | 403 | 503;
  statementType?: StatementType;
  /** The statement to hand to the executor. Present exactly when `allowed` is true. */
  statement?: CheckedStatement;
}

/** The statement of an allowed check, for the executor. A refusal has none, so callers return before this. */
export function checkedOf(result: QueryAccessResult): CheckedStatement {
  if (!result.allowed || !result.statement) throw AppError.internal('The statement was not checked');
  return result.statement;
}

/** HTTP status for a refusal code. */
export function accessDeniedStatus(code: DenyCode | undefined): 400 | 403 | 503 {
  if (code === 'SQL_SYNTAX' || code === 'QUERY_PARAM_UNBOUND') return 400;
  if (code === 'CHECK_UNAVAILABLE') return 503;
  return 403;
}

/** The AppError to throw for a refusal, with its status (400 / 403 / 503). */
export function accessDeniedError(result: QueryAccessResult, fallback = 'Access denied to one or more tables in query'): AppError {
  const message = result.reason || fallback;
  if (result.status === 400) return AppError.badRequest(message);
  if (result.status === 503) return AppError.unavailable(message);
  return AppError.forbidden(message);
}

function refuse(code: DenyCode, reason: string): QueryAccessResult {
  return { allowed: false, code, reason, status: accessDeniedStatus(code) };
}

const ACCESS_TYPE: Record<StatementType, AccessType> = {
  select: 'read', show: 'misc', describe: 'misc', exists: 'misc', check: 'misc', explain: 'misc',
  use: 'misc', set: 'misc', kill: 'misc',
  insert: 'write', update: 'write', delete: 'write',
  create: 'admin', drop: 'admin', alter: 'admin', truncate: 'admin',
};

/** Statement kinds that only read, as ClickHouse parsed them. */
const READ_KINDS: ReadonlySet<StatementType> = new Set(['select', 'show', 'describe', 'exists', 'check', 'explain']);

/** Permissions that let a person change something through typed text. Holding none means every statement is sent read-only. */
const WRITE_PERMISSIONS: readonly string[] = [
  PERMISSIONS.QUERY_EXECUTE_DML, PERMISSIONS.QUERY_EXECUTE_DDL, PERMISSIONS.QUERY_EXECUTE_MISC,
  PERMISSIONS.TABLE_INSERT, PERMISSIONS.TABLE_UPDATE, PERMISSIONS.TABLE_DELETE,
  PERMISSIONS.TABLE_CREATE, PERMISSIONS.TABLE_ALTER, PERMISSIONS.TABLE_DROP,
  PERMISSIONS.DB_CREATE, PERMISSIONS.DB_DROP, PERMISSIONS.LIVE_QUERIES_KILL_ALL,
];

/** Which check a test may force to allow. */
export type AccessCheckStage = 'permission' | 'table';

let accessOverride: ((stage: AccessCheckStage) => boolean) | null = null;

/**
 * Force a stage of the access check to allow, so a real-server test can prove
 * that ClickHouse itself refuses what CHouse would have refused first
 * (ADR 0033 §10.5). Throws outside `bun test`; nothing the server starts
 * imports a caller of it.
 */
export function setAccessOverrideForTests(fn: ((stage: AccessCheckStage) => boolean) | null): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('setAccessOverrideForTests is only available under test');
  accessOverride = fn;
}

function forced(stage: AccessCheckStage): boolean {
  return accessOverride !== null && accessOverride(stage);
}

/** One `EXPLAIN AST` answers both the impersonation check and the statement's kind. */
function rememberingPort(port: SqlParsePort): SqlParsePort {
  const answers = new Map<string, ReturnType<SqlParsePort['explainAst']>>();
  return {
    explainAst(sql, params) {
      const key = `${JSON.stringify(params ?? null)}\u0000${sql}`;
      let answer = answers.get(key);
      if (!answer) {
        answer = port.explainAst(sql, params);
        answers.set(key, answer);
      }
      return answer;
    },
    defaultDatabase: () => port.defaultDatabase(),
  };
}

function allow(input: QueryAccessInput, accountId: string, type: StatementType | undefined, mayWrite: boolean, impersonated?: ImpersonatedText): QueryAccessResult {
  const statement = mintCheckedStatement({
    impersonated,
    sql: input.sql,
    params: input.params,
    connectionId: input.connectionId,
    accountId,
    isRead: type !== undefined && READ_KINDS.has(type),
    mayWrite,
  });
  return { allowed: true, statementType: type, statement };
}

/**
 * An admin's statement (ADR 0033 §3). Admins keep their bypass of permissions
 * and data access rules, but ClickHouse must be able to parse the statement and
 * the parsed tree must hold no `EXECUTE AS`: CHouse alone decides which
 * ClickHouse user a statement runs as. When the parse cannot run, the statement
 * is refused, as it is for everyone else. The statement's kind is read from the
 * same parse when it is one the policy knows, so an admin's read is sent
 * read-only too; any other shape is sent as a possible write.
 */
async function validateAdminStatement(input: QueryAccessInput): Promise<QueryAccessResult> {
  if (!input.userId) {
    return refuse('PERMISSION_DENIED', 'RBAC authentication is required. Please login with RBAC credentials.');
  }
  if (!input.sql.trim()) return allow(input, input.userId, undefined, true);
  if (!input.connectionId && !input.parser) {
    return refuse('CHECK_UNAVAILABLE', 'No ClickHouse connection is selected, so the statement can\'t be checked.');
  }
  const parser = rememberingPort(input.parser ?? clickhouseParsePort(input.connectionId as string));
  const checked = await refuseImpersonation(input.sql, input.params, parser);
  if (!checked.ok) return refuse(checked.code, checked.reason);
  let parsed: ParsedAccess | null = null;
  try {
    parsed = await parseStatementAccess(input.sql, input.params, parser);
  } catch {
    parsed = null;
  }
  return allow(input, input.userId, parsed?.ok ? parsed.access.type : undefined, true);
}

const SYSTEM_ONLY = new Set(['system', 'information_schema']);

/** The connection's identity when it is a `personal` one, else null. */
async function personalIdentity(input: QueryAccessInput): Promise<ConnectionIdentity | null> {
  let identity = input.identity;
  if (!identity && input.connectionId && !input.parser) {
    const connection = await getConnectionById(input.connectionId);
    identity = connection ? identityOfConnection(connection) : undefined;
  }
  return identity && identity.mode === 'personal' ? identity : null;
}

const INLINE_ROWS = 'An INSERT that carries its rows can\'t run on a personal connection. Import the rows as a file from the explorer, or use INSERT … SELECT.';
const NO_SESSION = 'runs in a session, and a personal connection has none: every statement is sent on its own as your ClickHouse user.';

/**
 * A statement on a `personal` connection (ADR 0033 §7.2, §7.3). The person's
 * own ClickHouse user decides which data it reaches, so data access rules do
 * not apply and no table is checked here. CHouse still decides three things,
 * for admins too: the text is one statement of a kind that may be wrapped,
 * the person holds the CHouse permission for that kind, and ClickHouse
 * confirms the wrapped text runs as the bound user and nothing else.
 */
async function validatePersonalStatement(input: QueryAccessInput, identity: ConnectionIdentity, skipPermission = false, systemOnly = false): Promise<QueryAccessResult> {
  if (!input.userId) {
    return refuse('PERMISSION_DENIED', 'RBAC authentication is required. Please login with RBAC credentials.');
  }
  if (!input.sql.trim()) return refuse('SQL_SYNTAX', 'No SQL statement found');
  if (!input.connectionId && !input.parser) {
    return refuse('CHECK_UNAVAILABLE', 'No ClickHouse connection is selected, so the statement can\'t be checked.');
  }
  // Throws the refusal that names the binding's state when there is no active one.
  const bound = await boundUser(identity, input.userId);
  const base = input.parser ?? clickhouseParsePort(input.connectionId as string);
  // Unqualified names resolve against the person's own default database, not the connection's (observed).
  const parser = rememberingPort({ explainAst: (sql, params) => base.explainAst(sql, params), defaultDatabase: async () => bound.defaultDatabase ?? 'default' });

  if (hasInlineData(input.sql)) {
    return refuse('UNSUPPORTED_SHAPE', INLINE_ROWS);
  }
  const parsed = await parseStatementAccess(input.sql, input.params, parser);
  if (!parsed.ok) return refuse(parsed.code, parsed.reason);
  const { access } = parsed;
  if (access.type === 'set') return { ...refuse('UNSUPPORTED_SHAPE', `SET ${NO_SESSION} Put the setting in the statement's own SETTINGS clause.`), statementType: access.type };
  if (access.type === 'use') return { ...refuse('UNSUPPORTED_SHAPE', `USE ${NO_SESSION} Write the database in front of the table name.`), statementType: access.type };
  if (!WRAPPABLE_KINDS.has(access.type)) {
    return { ...refuse('UNSUPPORTED_SHAPE', `A ${access.type} statement can't run on a personal connection.`), statementType: access.type };
  }

  if (systemOnly) {
    // The tool's own limit, kept here: it reads system tables, whatever else the person's ClickHouse user may read.
    if (access.targets.length > 0 || access.databases.length > 0) return refuse('UNSUPPORTED_SHAPE', 'Only a single SELECT on system tables is allowed here.');
    for (const ref of access.reads) {
      const database = ref.database ?? parsed.defaultDatabase;
      if (!SYSTEM_ONLY.has(database.toLowerCase())) return refuse('TABLE_DENIED', `Only system tables can be read here, not ${database}.${ref.table}.`);
    }
  }

  const permissions = input.permissions ?? [];
  if (!input.isAdmin && !skipPermission && !permissions.includes(access.permission) && !forced('permission')) {
    return { ...refuse('PERMISSION_DENIED', `Permission '${access.permission}' required for this ${access.type} statement`), statementType: access.type };
  }

  const alone = await parser.explainAst(input.sql, input.params);
  if (!alone.ok) return refuse('CHECK_UNAVAILABLE', 'The statement couldn\'t be checked because ClickHouse didn\'t answer. Try again.');
  const wrapped = await impersonate(input.sql, input.params, access.type, alone.lines, bound.user, parser);
  if (!wrapped.ok) {
    // ClickHouse parses `INSERT … VALUES` alone but not under the wrapper: its rows are data, not SQL.
    const reason = !wrapped.unavailable && access.type === 'insert' ? INLINE_ROWS : wrapped.reason;
    return { ...refuse(wrapped.unavailable ? 'CHECK_UNAVAILABLE' : 'UNSUPPORTED_SHAPE', reason), statementType: access.type };
  }

  const mayWrite = !skipPermission && (input.isAdmin === true || WRITE_PERMISSIONS.some((p) => permissions.includes(p)));
  return allow(input, input.userId, access.type, mayWrite, wrapped.value);
}

/**
 * May this user run this statement? Admins skip the permission and table
 * checks (see `validateAdminStatement`). Everyone else needs the
 * statement's permission and data access to every table and database it
 * touches, as ClickHouse itself parses it. Any doubt is a refusal.
 */
export async function validateQueryAccess(input: QueryAccessInput): Promise<QueryAccessResult> {
  const personal = await personalIdentity(input);
  if (personal) return validatePersonalStatement(input, personal);
  if (input.isAdmin) return validateAdminStatement(input);

  if (!input.userId) {
    return refuse('PERMISSION_DENIED', 'RBAC authentication is required. Please login with RBAC credentials.');
  }
  if (!input.sql.trim()) return refuse('SQL_SYNTAX', 'No SQL statement found');
  if (!input.connectionId && !input.parser) {
    return refuse('CHECK_UNAVAILABLE', 'No ClickHouse connection is selected, so the query can\'t be checked against your data access rules.');
  }

  const parser = input.parser ?? clickhouseParsePort(input.connectionId as string);
  const parsed = await parseStatementAccess(input.sql, input.params, parser);
  if (!parsed.ok) return refuse(parsed.code, parsed.reason);

  const { access, defaultDatabase } = parsed;
  const permissions = input.permissions ?? [];
  if (!permissions.includes(access.permission) && !forced('permission')) {
    return { ...refuse('PERMISSION_DENIED', `Permission '${access.permission}' required for this ${access.type} statement`), statementType: access.type };
  }

  const accessType = ACCESS_TYPE[access.type];
  const seen = new Set<string>();
  for (const ref of [...access.targets, ...access.reads]) {
    const database = ref.database ?? defaultDatabase;
    const key = `${database}\u0000${ref.table}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (forced('table')) continue;
    const needed = systemTablePermission(database, ref.table);
    if (needed && !permissions.includes(needed)) {
      return { ...refuse('TABLE_DENIED', systemTableRefusal(ref.table, needed)), statementType: access.type };
    }
    const result = await checkUserAccess(input.userId, database, ref.table, accessType, input.connectionId);
    if (!result.allowed) {
      return { ...refuse('TABLE_DENIED', `Access denied to ${database}.${ref.table} (requires ${accessType} permission)`), statementType: access.type };
    }
  }
  for (const name of access.databases) {
    const database = name || defaultDatabase;
    if (forced('table')) continue;
    const result = await checkUserAccess(input.userId, database, null, accessType, input.connectionId);
    if (!result.allowed) {
      return { ...refuse('TABLE_DENIED', `Access denied to database ${database}`), statementType: access.type };
    }
  }

  return allow(input, input.userId, access.type, WRITE_PERMISSIONS.some((p) => permissions.includes(p)));
}


/**
 * May this person run this read of system tables? For tools that let a model
 * write SQL against `system.*` on a person's behalf (the fleet AI's
 * `query_node`). It asks for no table permission and no data access rule,
 * since those tools are gated by their own feature permission, but the
 * statement must parse as a single SELECT that reads nothing outside the
 * system databases, and the tables that show other people's work need their
 * permission as everywhere else (ADR 0033 §4). Admins keep their bypass.
 */
export async function validateSystemRead(input: QueryAccessInput): Promise<QueryAccessResult> {
  const personal = await personalIdentity(input);
  if (personal) {
    // The person's own ClickHouse user decides which system tables it reads.
    const result = await validatePersonalStatement(input, personal, true, true);
    if (result.allowed && result.statementType !== 'select') return refuse('UNSUPPORTED_SHAPE', 'Only a single SELECT on system tables is allowed here.');
    return result;
  }
  if (input.isAdmin) return validateAdminStatement(input);
  if (!input.userId) return refuse('PERMISSION_DENIED', 'RBAC authentication is required. Please login with RBAC credentials.');
  if (!input.connectionId && !input.parser) {
    return refuse('CHECK_UNAVAILABLE', 'No ClickHouse connection is selected, so the query can\'t be checked.');
  }
  const parser = input.parser ?? clickhouseParsePort(input.connectionId as string);
  const parsed = await parseStatementAccess(input.sql, input.params, parser);
  if (!parsed.ok) return refuse(parsed.code, parsed.reason);
  const { access, defaultDatabase } = parsed;
  if (access.type !== 'select' || access.targets.length > 0 || access.databases.length > 0) {
    return refuse('UNSUPPORTED_SHAPE', 'Only a single SELECT on system tables is allowed here.');
  }
  const permissions = input.permissions ?? [];
  for (const ref of access.reads) {
    const database = ref.database ?? defaultDatabase;
    if (!SYSTEM_ONLY.has(database.toLowerCase())) {
      return refuse('TABLE_DENIED', `Only system tables can be read here, not ${database}.${ref.table}.`);
    }
    const needed = systemTablePermission(database, ref.table);
    if (needed && !permissions.includes(needed)) return refuse('TABLE_DENIED', systemTableRefusal(ref.table, needed));
  }
  return allow(input, input.userId, access.type, false);
}
