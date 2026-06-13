/**
 * ClickHouse Privilege Model & Catalog
 *
 * Shared building blocks for managing native ClickHouse access control
 * (roles + users). Unlike the app's own RBAC permissions, these privileges
 * are real ClickHouse grants (SELECT, INSERT, ALTER ..., CREATE ..., SHOW ...,
 * ACCESS MANAGEMENT, etc.) scoped to *.*, db.*, db.table, optionally column
 * level, and optionally WITH GRANT OPTION.
 *
 * ClickHouse (via system.grants / system.role_grants) is the source of truth;
 * this module provides:
 *  - a curated privilege catalog used by the UI and as a validation allowlist,
 *  - SQL-safe escaping helpers,
 *  - a structured grant model (CHGrant) + atom-level diffing so edits only
 *    issue the GRANT/REVOKE statements that actually changed.
 */

// ============================================
// Types
// ============================================

/**
 * A single grant as expressed by the UI / API. One CHGrant can carry several
 * privileges over the same scope (and optionally the same column set).
 */
export interface CHGrant {
  /** Privilege names, validated against the catalog allowlist. */
  privileges: string[];
  /** Database name, or null for "all databases" (*). */
  database: string | null;
  /** Table name, or null for "all tables" within the database (*). */
  table: string | null;
  /** Optional column-level restriction (only for column-capable privileges). */
  columns?: string[];
  /** WITH GRANT OPTION. */
  grantOption: boolean;
}

export interface CHPrivilegeCatalogEntry {
  /** Canonical access_type name as it appears in system.grants. */
  name: string;
  /** UI grouping (top-level family label) — used for ordering and flat fallback. */
  group: string;
  /** Whether the privilege accepts column-level scoping (e.g. SELECT(col)). */
  supportsColumns: boolean;
  /** Short human description for the UI. */
  description?: string;
  /**
   * Immediate parent privilege in the ClickHouse hierarchy (system.privileges
   * parent_group). `null`/undefined means a top-level privilege under ALL.
   * Present only when served live from the server (enables the privilege tree).
   */
  parent?: string | null;
}

/**
 * Flattened grant unit used for diffing. Maps 1:1 to a row in system.grants
 * (one privilege, one optional column).
 */
export interface GrantAtom {
  privilege: string;
  database: string | null;
  table: string | null;
  column: string | null;
  grantOption: boolean;
}

// ============================================
// Privilege catalog
// ============================================

/**
 * Curated catalog of common ClickHouse privileges. Used by the UI to render the
 * privilege tree and as part of server-side validation. Not exhaustive — the
 * routes layer can union this with `SELECT privilege FROM system.privileges`
 * for forward compatibility. Validation never relies on this list alone (see
 * {@link assertValidPrivilege}).
 */
export const CH_PRIVILEGES: CHPrivilegeCatalogEntry[] = [
  // Read / write
  { name: 'SELECT', group: 'Read/Write', supportsColumns: true, description: 'Read data' },
  { name: 'INSERT', group: 'Read/Write', supportsColumns: true, description: 'Write data' },
  { name: 'OPTIMIZE', group: 'Read/Write', supportsColumns: false, description: 'Run OPTIMIZE' },
  { name: 'TRUNCATE', group: 'Read/Write', supportsColumns: false, description: 'TRUNCATE TABLE' },

  // ALTER
  { name: 'ALTER', group: 'Alter', supportsColumns: false, description: 'All ALTER operations' },
  { name: 'ALTER UPDATE', group: 'Alter', supportsColumns: true },
  { name: 'ALTER DELETE', group: 'Alter', supportsColumns: false },
  { name: 'ALTER COLUMN', group: 'Alter', supportsColumns: true },
  { name: 'ALTER ADD COLUMN', group: 'Alter', supportsColumns: true },
  { name: 'ALTER DROP COLUMN', group: 'Alter', supportsColumns: true },
  { name: 'ALTER MODIFY COLUMN', group: 'Alter', supportsColumns: true },
  { name: 'ALTER INDEX', group: 'Alter', supportsColumns: false },
  { name: 'ALTER TTL', group: 'Alter', supportsColumns: false },
  { name: 'ALTER SETTINGS', group: 'Alter', supportsColumns: false },
  { name: 'ALTER VIEW', group: 'Alter', supportsColumns: false },

  // CREATE
  { name: 'CREATE', group: 'Create', supportsColumns: false, description: 'All CREATE operations' },
  { name: 'CREATE DATABASE', group: 'Create', supportsColumns: false },
  { name: 'CREATE TABLE', group: 'Create', supportsColumns: false },
  { name: 'CREATE VIEW', group: 'Create', supportsColumns: false },
  { name: 'CREATE DICTIONARY', group: 'Create', supportsColumns: false },
  { name: 'CREATE TEMPORARY TABLE', group: 'Create', supportsColumns: false },

  // DROP
  { name: 'DROP', group: 'Drop', supportsColumns: false, description: 'All DROP operations' },
  { name: 'DROP DATABASE', group: 'Drop', supportsColumns: false },
  { name: 'DROP TABLE', group: 'Drop', supportsColumns: false },
  { name: 'DROP VIEW', group: 'Drop', supportsColumns: false },
  { name: 'DROP DICTIONARY', group: 'Drop', supportsColumns: false },

  // SHOW
  { name: 'SHOW', group: 'Show', supportsColumns: false, description: 'All SHOW operations' },
  { name: 'SHOW DATABASES', group: 'Show', supportsColumns: false },
  { name: 'SHOW TABLES', group: 'Show', supportsColumns: false },
  { name: 'SHOW COLUMNS', group: 'Show', supportsColumns: false },
  { name: 'SHOW DICTIONARIES', group: 'Show', supportsColumns: false },

  // Dictionaries / introspection
  { name: 'dictGet', group: 'Dictionaries', supportsColumns: false, description: 'Read dictionaries' },
  { name: 'INTROSPECTION', group: 'Introspection', supportsColumns: false },

  // Access management
  { name: 'ACCESS MANAGEMENT', group: 'Access Management', supportsColumns: false, description: 'All access-management operations' },
  { name: 'CREATE USER', group: 'Access Management', supportsColumns: false },
  { name: 'ALTER USER', group: 'Access Management', supportsColumns: false },
  { name: 'DROP USER', group: 'Access Management', supportsColumns: false },
  { name: 'CREATE ROLE', group: 'Access Management', supportsColumns: false },
  { name: 'ALTER ROLE', group: 'Access Management', supportsColumns: false },
  { name: 'DROP ROLE', group: 'Access Management', supportsColumns: false },
  { name: 'ROLE ADMIN', group: 'Access Management', supportsColumns: false },
  { name: 'CREATE ROW POLICY', group: 'Access Management', supportsColumns: false },
  { name: 'CREATE QUOTA', group: 'Access Management', supportsColumns: false },
  { name: 'CREATE SETTINGS PROFILE', group: 'Access Management', supportsColumns: false },
  { name: 'SHOW USERS', group: 'Access Management', supportsColumns: false },
  { name: 'SHOW ROLES', group: 'Access Management', supportsColumns: false },

  // Sources
  { name: 'SOURCES', group: 'Sources', supportsColumns: false, description: 'All table-function sources' },
  { name: 'FILE', group: 'Sources', supportsColumns: false },
  { name: 'URL', group: 'Sources', supportsColumns: false },
  { name: 'REMOTE', group: 'Sources', supportsColumns: false },
  { name: 'MYSQL', group: 'Sources', supportsColumns: false },
  { name: 'S3', group: 'Sources', supportsColumns: false },

  // System
  { name: 'SYSTEM', group: 'System', supportsColumns: false, description: 'All SYSTEM operations' },
  { name: 'KILL QUERY', group: 'System', supportsColumns: false },

  // Everything
  { name: 'ALL', group: 'All', supportsColumns: false, description: 'All privileges' },
];

/** Case-insensitive lookup map: lowercased name to canonical catalog name. */
const CANONICAL_BY_LOWER = new Map<string, string>(
  CH_PRIVILEGES.map((p) => [p.name.toLowerCase(), p.name]),
);

const COLUMN_CAPABLE = new Set<string>(
  CH_PRIVILEGES.filter((p) => p.supportsColumns).map((p) => p.name),
);

/**
 * Normalize a privilege name to its canonical catalog casing/spacing when known,
 * otherwise return the collapsed/trimmed input (forward compat for privileges
 * not in the curated catalog).
 */
export function normalizePrivilege(name: string): string {
  const collapsed = name.trim().replace(/\s+/g, ' ');
  return CANONICAL_BY_LOWER.get(collapsed.toLowerCase()) ?? collapsed;
}

/**
 * Validate a privilege name. Privileges are SQL keywords (not identifiers) and
 * are emitted into DDL unquoted, so they must be validated rather than escaped.
 * We allow only letters, digits and single internal spaces — this rejects
 * quotes, backticks, semicolons, parentheses and any other injection vector
 * while still permitting every real ClickHouse privilege keyword, including
 * camelCase (dictGet) and digit-bearing source names (S3, HDFS).
 *
 * @throws Error when the privilege is empty or contains illegal characters.
 */
export function assertValidPrivilege(name: string): void {
  const normalized = normalizePrivilege(name);
  if (!normalized) {
    throw new Error('Privilege name must not be empty');
  }
  if (!/^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/.test(normalized)) {
    throw new Error(`Invalid privilege name: ${name}`);
  }
}

export function privilegeSupportsColumns(name: string): boolean {
  return COLUMN_CAPABLE.has(normalizePrivilege(name));
}

// ============================================
// SQL escaping helpers
// ============================================

/** Escape a ClickHouse identifier (database/table/user/role/column) for use inside backticks. */
export function escapeIdentifier(value: string): string {
  return value.replace(/`/g, '``');
}

/** Quote an identifier in backticks (escaping any embedded backticks). */
export function quoteIdent(value: string): string {
  return `\`${escapeIdentifier(value)}\``;
}

/** Escape a string literal for use inside single quotes. */
export function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * ClickHouse access storages that accept SQL DDL (CREATE/ALTER/DROP USER|ROLE).
 * Anything else — most importantly `users.xml`, plus ldap/kerberos — is
 * read-only: users/roles defined there can't be modified via SQL.
 */
const WRITABLE_ACCESS_STORAGES = new Set(['local directory', 'local_directory', 'replicated', 'memory']);

/** Whether a user/role from this `storage` is read-only (config-managed). */
export function isReadonlyAccessStorage(storage?: string | null): boolean {
  if (!storage) return false;
  return !WRITABLE_ACCESS_STORAGES.has(storage.trim().toLowerCase());
}

/** Build the `ON <target>` scope token for a grant: `*.*`, `` `db`.* `` or `` `db`.`tbl` ``. */
export function formatGrantTarget(database: string | null, table: string | null): string {
  if (!database) {
    return '*.*';
  }
  if (!table) {
    return `${quoteIdent(database)}.*`;
  }
  return `${quoteIdent(database)}.${quoteIdent(table)}`;
}

/** Build an optional ` ON CLUSTER \`name\`` token. */
export function clusterClause(cluster?: string | null): string {
  return cluster && cluster.trim() ? ` ON CLUSTER ${quoteIdent(cluster.trim())}` : '';
}

// ============================================
// Grant atoms & diffing
// ============================================

/** Stable key uniquely identifying a grant atom (for set membership / diffing). */
export function atomKey(atom: GrantAtom): string {
  return [
    atom.grantOption ? 'GO' : '_',
    normalizePrivilege(atom.privilege),
    atom.database ?? '*',
    atom.table ?? '*',
    atom.column ?? '*',
  ].join(' ');
}

/** Expand a structured CHGrant into its constituent atoms (privileges x columns). */
export function grantToAtoms(grant: CHGrant): GrantAtom[] {
  const columns = grant.columns && grant.columns.length > 0 ? grant.columns : [null];
  const atoms: GrantAtom[] = [];
  for (const rawPriv of grant.privileges) {
    const privilege = normalizePrivilege(rawPriv);
    const cols = privilegeSupportsColumns(privilege) ? columns : [null];
    for (const column of cols) {
      atoms.push({
        privilege,
        database: grant.database,
        table: grant.table,
        column,
        grantOption: grant.grantOption,
      });
    }
  }
  return atoms;
}

export function grantsToAtoms(grants: CHGrant[]): GrantAtom[] {
  return grants.flatMap(grantToAtoms);
}

/**
 * Compute the atoms to GRANT (in desired but not current) and to REVOKE
 * (in current but not desired).
 */
export function diffAtoms(
  current: GrantAtom[],
  desired: GrantAtom[],
): { toGrant: GrantAtom[]; toRevoke: GrantAtom[] } {
  const currentMap = new Map(current.map((a) => [atomKey(a), a]));
  const desiredMap = new Map(desired.map((a) => [atomKey(a), a]));

  const toGrant: GrantAtom[] = [];
  for (const [key, atom] of desiredMap) {
    if (!currentMap.has(key)) toGrant.push(atom);
  }
  const toRevoke: GrantAtom[] = [];
  for (const [key, atom] of currentMap) {
    if (!desiredMap.has(key)) toRevoke.push(atom);
  }
  return { toGrant, toRevoke };
}

interface BuildStatementOptions {
  /** `GRANT` or `REVOKE`. */
  verb: 'GRANT' | 'REVOKE';
  /** Already-quoted grantee token(s), e.g. `` `alice` `` or `` `r1`, `r2` ``. */
  grantee: string;
  cluster?: string | null;
}

/**
 * Group atoms into the minimal set of GRANT/REVOKE statements. Atoms are grouped
 * by (database, table, grantOption); within a group, column-capable privileges
 * with specific columns are rendered as `PRIV(col1, col2)`.
 *
 * Returns an empty array when there are no atoms. Validates every privilege name.
 */
export function atomsToStatements(atoms: GrantAtom[], opts: BuildStatementOptions): string[] {
  if (atoms.length === 0) return [];

  const groups = new Map<string, GrantAtom[]>();
  for (const atom of atoms) {
    assertValidPrivilege(atom.privilege);
    const gk = [atom.database ?? '*', atom.table ?? '*', atom.grantOption ? 'GO' : '_'].join(' ');
    const list = groups.get(gk);
    if (list) list.push(atom);
    else groups.set(gk, [atom]);
  }

  const statements: string[] = [];
  for (const groupAtoms of groups.values()) {
    const first = groupAtoms[0];
    const target = formatGrantTarget(first.database, first.table);

    // privilege -> set of columns (null = table-level)
    const byPriv = new Map<string, Set<string | null>>();
    for (const atom of groupAtoms) {
      const set = byPriv.get(atom.privilege) ?? new Set<string | null>();
      set.add(atom.column);
      byPriv.set(atom.privilege, set);
    }

    const clauses: string[] = [];
    for (const [privilege, columns] of byPriv) {
      const specificCols = [...columns].filter((c): c is string => c !== null).sort();
      if (columns.has(null)) {
        clauses.push(privilege);
      }
      if (specificCols.length > 0) {
        clauses.push(`${privilege}(${specificCols.map(quoteIdent).join(', ')})`);
      }
    }

    const cluster = clusterClause(opts.cluster);
    const grantOption = opts.verb === 'GRANT' && first.grantOption ? ' WITH GRANT OPTION' : '';
    const connector = opts.verb === 'GRANT' ? 'TO' : 'FROM';
    statements.push(
      `${opts.verb}${cluster} ${clauses.join(', ')} ON ${target} ${connector} ${opts.grantee}${grantOption}`,
    );
  }

  return statements;
}

/** Build full GRANT/REVOKE DDL for a desired vs current grant set (diff-based). */
export function buildGrantDiffStatements(
  current: CHGrant[],
  desired: CHGrant[],
  opts: Omit<BuildStatementOptions, 'verb'>,
): string[] {
  const { toGrant, toRevoke } = diffAtoms(grantsToAtoms(current), grantsToAtoms(desired));
  // Revoke first, then grant — keeps the resulting state minimal and avoids
  // transient over-permissioning when a scope narrows.
  return [
    ...atomsToStatements(toRevoke, { ...opts, verb: 'REVOKE' }),
    ...atomsToStatements(toGrant, { ...opts, verb: 'GRANT' }),
  ];
}

/** Build GRANT DDL for a fresh grant set (no diff — used on create). */
export function buildGrantStatements(grants: CHGrant[], opts: Omit<BuildStatementOptions, 'verb'>): string[] {
  return atomsToStatements(grantsToAtoms(grants), { ...opts, verb: 'GRANT' });
}

// ============================================
// Parsing system.grants rows -> CHGrant[]
// ============================================

export interface SystemGrantRow {
  access_type: string;
  database: string | null;
  table: string | null;
  column: string | null;
  is_partial_revoke: number | boolean;
  grant_option: number | boolean;
}

function truthy(value: number | boolean | undefined): boolean {
  return value === true || value === 1;
}

/**
 * Convert raw system.grants rows into atoms. Partial revokes are skipped — they
 * represent carve-outs from a broader grant and are not expressible in the
 * structured editor; surfacing them would corrupt the diff.
 */
export function systemGrantRowsToAtoms(rows: SystemGrantRow[]): GrantAtom[] {
  const atoms: GrantAtom[] = [];
  for (const row of rows) {
    if (truthy(row.is_partial_revoke)) continue;
    atoms.push({
      privilege: normalizePrivilege(row.access_type),
      database: row.database ?? null,
      table: row.table ?? null,
      column: row.column ?? null,
      grantOption: truthy(row.grant_option),
    });
  }
  return atoms;
}

/**
 * Collapse atoms into structured CHGrant[]. Privileges are grouped by scope
 * (database, table, grantOption) AND by their exact column signature, so a
 * column-level SELECT(a,b) and a table-level INSERT over the same table become
 * two distinct grants instead of being wrongly merged.
 */
export function atomsToGrants(atoms: GrantAtom[]): CHGrant[] {
  const scopes = new Map<string, { database: string | null; table: string | null; grantOption: boolean; byPriv: Map<string, Set<string | null>> }>();
  for (const atom of atoms) {
    const key = [atom.database ?? '*', atom.table ?? '*', atom.grantOption ? 'GO' : '_'].join(' ');
    let scope = scopes.get(key);
    if (!scope) {
      scope = { database: atom.database, table: atom.table, grantOption: atom.grantOption, byPriv: new Map() };
      scopes.set(key, scope);
    }
    const cols = scope.byPriv.get(atom.privilege) ?? new Set<string | null>();
    cols.add(atom.column);
    scope.byPriv.set(atom.privilege, cols);
  }

  // Within each scope, group privileges that share the same column signature
  // ("" = table-level). A table-level grant (null column) supersedes columns.
  const grants: CHGrant[] = [];
  for (const scope of scopes.values()) {
    const bySignature = new Map<string, { privileges: string[]; columns: string[] }>();
    for (const [privilege, colSet] of scope.byPriv) {
      const specific = colSet.has(null) ? [] : [...colSet].filter((c): c is string => c !== null).sort();
      const signature = specific.join(',');
      const bucket = bySignature.get(signature) ?? { privileges: [], columns: specific };
      bucket.privileges.push(privilege);
      bySignature.set(signature, bucket);
    }
    for (const bucket of bySignature.values()) {
      grants.push({
        privileges: bucket.privileges.sort(),
        database: scope.database,
        table: scope.table,
        columns: bucket.columns.length > 0 ? bucket.columns : undefined,
        grantOption: scope.grantOption,
      });
    }
  }
  return grants;
}

export function systemGrantRowsToGrants(rows: SystemGrantRow[]): CHGrant[] {
  return atomsToGrants(systemGrantRowsToAtoms(rows));
}
