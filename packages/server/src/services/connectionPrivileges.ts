/**
 * What a connection's ClickHouse user must be able to do for every CHouse UI
 * feature to work, and a check that reports what is missing as copyable
 * GRANT statements. Saving a connection requires the check to pass.
 *
 * System tables are checked by reading them (`LIMIT 0`), which is exact for
 * grants inherited through roles and for partial revokes. Privileges that
 * cannot be tried safely (KILL QUERY, CREATE USER, CREATE TABLE …) are
 * checked against the user's own `SHOW GRANTS`, resolved through the
 * privilege tree in `system.privileges`.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { OBSERVED_SYSTEM_TABLES } from "./observe/systemTables";

// ============================================
// Catalog
// ============================================

export type PrivilegeFeatureId = "core" | "monitoring" | "observability" | "query_control" | "data_editing" | "access_admin";

/** A privilege the user must hold everywhere (`*.*`) or on the connection's default database (`db.*`). */
export interface RequiredPrivilege {
  privilege: string;
  scope: "global" | "database";
}

export interface PrivilegeFeature {
  id: PrivilegeFeatureId;
  name: string;
  description: string;
  systemTables: readonly string[];
  privileges: readonly RequiredPrivilege[];
}

const MONITORING_TABLES = [
  "query_log",
  "processes",
  "metrics",
  "events",
  "asynchronous_metrics",
  "metric_log",
  "asynchronous_metric_log",
  "parts",
  "parts_columns",
  "part_log",
  "merges",
  "mutations",
  "replicas",
  "replication_queue",
  "disks",
  "errors",
  "clusters",
  "macros",
  "distributed_ddl_queue",
  "distribution_queue",
  "crash_log",
] as const;

export const PRIVILEGE_FEATURES: readonly PrivilegeFeature[] = [
  {
    id: "core",
    name: "Core",
    description: "Connect, explorer, SQL editor",
    systemTables: ["databases", "tables", "columns", "functions", "keywords"],
    privileges: [],
  },
  {
    id: "monitoring",
    name: "Monitoring and fleet",
    description: "Metrics, live queries, dashboards",
    systemTables: MONITORING_TABLES,
    privileges: [],
  },
  {
    id: "observability",
    name: "Data health and observability",
    description: "Collectors, pipelines, Doctor, upgrades",
    systemTables: [...new Set([...OBSERVED_SYSTEM_TABLES, "server_settings", "merge_tree_settings", "settings_profile_elements"])],
    privileges: [],
  },
  {
    id: "query_control",
    name: "Query control",
    description: "Kill running queries",
    systemTables: [],
    privileges: [{ privilege: "KILL QUERY", scope: "global" }],
  },
  {
    id: "data_editing",
    name: "Data editing",
    description: "Create, import, alter and drop tables",
    systemTables: [],
    privileges: [
      { privilege: "CREATE TABLE", scope: "database" },
      { privilege: "INSERT", scope: "database" },
      { privilege: "ALTER TABLE", scope: "database" },
      { privilege: "DROP TABLE", scope: "database" },
    ],
  },
  {
    id: "access_admin",
    name: "ClickHouse access admin",
    description: "ClickHouse users and roles pages",
    systemTables: ["users", "roles", "grants", "role_grants"],
    privileges: [
      { privilege: "CREATE USER", scope: "global" },
      { privilege: "ALTER USER", scope: "global" },
      { privilege: "DROP USER", scope: "global" },
      { privilege: "CREATE ROLE", scope: "global" },
      { privilege: "ALTER ROLE", scope: "global" },
      { privilege: "DROP ROLE", scope: "global" },
      { privilege: "ROLE ADMIN", scope: "global" },
    ],
  },
];

/**
 * Log tables ClickHouse creates lazily (on the first flush) that every server
 * has by default. When one is not there yet, its grant is checked from
 * `SHOW GRANTS` instead, so a fresh server does not pass with it ungranted.
 */
const LAZY_DEFAULT_TABLES: ReadonlySet<string> = new Set(["query_log"]);

// ============================================
// Report
// ============================================

export type PrivilegeFeatureStatus = "granted" | "missing";

export interface PrivilegeFeatureReport {
  id: PrivilegeFeatureId;
  name: string;
  description: string;
  status: PrivilegeFeatureStatus;
  /** What is missing, e.g. "SELECT ON system.query_log", "KILL QUERY ON *.*". */
  missing: string[];
  /** System tables this server does not have; never counted as missing. */
  unavailable: string[];
  /** Checks that failed for another reason (timeout, server error), with that reason. */
  errors: string[];
  /** One GRANT statement per line, ready to run. */
  grants: string[];
}

export interface PrivilegeReport {
  ok: boolean;
  username: string;
  database: string;
  missingCount: number;
  features: PrivilegeFeatureReport[];
  /** Every feature's GRANT statements, joined by newlines. */
  grantScript: string;
}

// ============================================
// Quoting
// ============================================

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A ClickHouse user, role or database name for a GRANT statement. Plain names
 * stay bare; anything else is backquoted with `\` and `` ` `` escaped, since
 * ClickHouse treats `\` as an escape inside backquotes too.
 */
export function quoteGrantName(name: string): string {
  if (PLAIN_IDENTIFIER.test(name)) return name;
  return `\`${name.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

function scopeTarget(scope: RequiredPrivilege["scope"], database: string): string {
  return scope === "global" ? "*.*" : `${quoteGrantName(database)}.*`;
}

// ============================================
// SHOW GRANTS parsing
// ============================================

export interface ParsedGrant {
  kind: "GRANT" | "REVOKE";
  /** Upper-cased privilege names; column-scoped entries (`SELECT(a, b)`) are dropped. */
  privileges: string[];
  /** null = every database (`*.*` or `*`). A trailing `*` is a prefix wildcard (`db*`). */
  database: string | null;
  /** null = every table in the database. */
  table: string | null;
}

/** Split on commas outside parentheses and backquotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      current += ch;
      if (ch === "\\" && i + 1 < text.length) {
        current += text[i + 1];
        i += 1;
      } else if (ch === "`") {
        quoted = false;
      }
      continue;
    }
    if (ch === "`") quoted = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function unquoteName(raw: string): string {
  const name = raw.trim();
  if (name.startsWith("`") && name.endsWith("`") && name.length >= 2) {
    return name.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return name;
}

/** Split `db.table` on the first dot outside backquotes. */
function splitTarget(target: string): { database: string | null; table: string | null } {
  if (target === "*" || target === "*.*") return { database: null, table: null };
  let quoted = false;
  for (let i = 0; i < target.length; i += 1) {
    const ch = target[i];
    if (quoted && ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "`") quoted = !quoted;
    else if (ch === "." && !quoted) {
      const database = unquoteName(target.slice(0, i));
      const table = unquoteName(target.slice(i + 1));
      return { database: database === "*" ? null : database, table: table === "*" ? null : table };
    }
  }
  // A bare name is a non-table target (user name, engine, definer): it never covers a database.
  return { database: unquoteName(target), table: "" };
}

/**
 * Parse `SHOW GRANTS` output. Role grants (`GRANT r TO u`) carry no `ON` and
 * are skipped, since the caller expands roles itself.
 */
export function parseGrantLines(lines: readonly string[]): ParsedGrant[] {
  const parsed: ParsedGrant[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const match = /^(GRANT|REVOKE)\s+(.+?)\s+ON\s+(\S+)\s+(?:TO|FROM)\s+/i.exec(line);
    if (!match) continue;
    const kind = match[1].toUpperCase() === "GRANT" ? "GRANT" : "REVOKE";
    const privileges = splitTopLevel(match[2])
      .filter((p) => !p.includes("("))
      .map((p) => p.replace(/\s+/g, " ").trim().toUpperCase())
      .filter((p) => p.length > 0);
    if (privileges.length === 0) continue;
    parsed.push({ kind, privileges, ...splitTarget(match[3]) });
  }
  return parsed;
}

// ============================================
// Privilege tree
// ============================================

export interface PrivilegeTreeRow {
  privilege: string;
  aliases?: string[];
  level?: string | null;
  parent_group?: string | null;
}

export interface PrivilegeTree {
  parent: Map<string, string>;
  children: Map<string, string[]>;
  level: Map<string, string | null>;
  canonical: Map<string, string>;
}

export function buildPrivilegeTree(rows: readonly PrivilegeTreeRow[]): PrivilegeTree {
  const tree: PrivilegeTree = { parent: new Map(), children: new Map(), level: new Map(), canonical: new Map() };
  for (const row of rows) {
    const name = row.privilege.toUpperCase();
    tree.canonical.set(name, name);
    for (const alias of row.aliases ?? []) tree.canonical.set(alias.toUpperCase(), name);
    tree.level.set(name, row.level ?? null);
    if (row.parent_group) {
      const parent = row.parent_group.toUpperCase();
      tree.parent.set(name, parent);
      const siblings = tree.children.get(parent) ?? [];
      siblings.push(name);
      tree.children.set(parent, siblings);
    }
  }
  tree.canonical.set("ALL PRIVILEGES", "ALL");
  return tree;
}

function selfAndAncestors(tree: PrivilegeTree, privilege: string): Set<string> {
  const out = new Set<string>([privilege, "ALL"]);
  let current = tree.parent.get(privilege);
  while (current) {
    out.add(current);
    current = tree.parent.get(current);
  }
  return out;
}

function selfAndDescendants(tree: PrivilegeTree, privilege: string): Set<string> {
  const out = new Set<string>();
  const stack = [privilege];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || out.has(next)) continue;
    out.add(next);
    stack.push(...(tree.children.get(next) ?? []));
  }
  return out;
}

/** Levels that can never be granted on `db.*`, so they don't count against a database-scoped check. */
const NON_DATABASE_LEVELS: ReadonlySet<string> = new Set(["GLOBAL", "USER_NAME", "NAMED_COLLECTION", "TABLE_ENGINE", "DEFINER", "SOURCE"]);

/** null database = everywhere (`*.*`); a table narrows the target to that one table. */
export interface PrivilegeTarget {
  database: string | null;
  table?: string;
}

function databaseMatches(pattern: string, database: string): boolean {
  return pattern.endsWith("*") ? database.startsWith(pattern.slice(0, -1)) : pattern === database;
}

/** Does a grant on this line reach all of the target? */
function covers(grant: ParsedGrant, target: PrivilegeTarget): boolean {
  if (grant.database === null) return true;
  if (target.database === null || grant.table === "") return false;
  if (!databaseMatches(grant.database, target.database)) return false;
  return grant.table === null || (target.table !== undefined && grant.table === target.table);
}

/** Does a revoke on this line take anything away inside the target? */
function overlaps(revoke: ParsedGrant, target: PrivilegeTarget): boolean {
  if (revoke.database === null || target.database === null) return true;
  if (revoke.table === "") return false;
  const sameDatabase = databaseMatches(revoke.database, target.database) || databaseMatches(target.database, revoke.database);
  if (!sameDatabase) return false;
  return revoke.table === null || target.table === undefined || revoke.table === target.table;
}

function canonical(tree: PrivilegeTree, name: string): string {
  return tree.canonical.get(name) ?? name;
}

function heldDirectly(grants: readonly ParsedGrant[], tree: PrivilegeTree, privilege: string, target: PrivilegeTarget): boolean {
  const granting = selfAndAncestors(tree, privilege);
  const granted = grants.some((g) => g.kind === "GRANT" && covers(g, target) && g.privileges.some((p) => granting.has(canonical(tree, p))));
  if (!granted) return false;
  const revoking = new Set([...granting, ...selfAndDescendants(tree, privilege)]);
  return !grants.some((g) => g.kind === "REVOKE" && overlaps(g, target) && g.privileges.some((p) => revoking.has(canonical(tree, p))));
}

/**
 * Whether the grantee holds `privilege` on `target`, given one grant list per
 * grantee (the user, then each enabled role). ClickHouse expands partial
 * grants into the remaining children (`ALTER TABLE` minus `ALTER DELETE`
 * prints as the other ALTER privileges), so a privilege also counts as held
 * when every child that applies to the target is held.
 */
export function holdsPrivilege(grantSets: readonly (readonly ParsedGrant[])[], tree: PrivilegeTree, privilege: string, target: PrivilegeTarget): boolean {
  const name = canonical(tree, privilege.toUpperCase());
  if (grantSets.some((grants) => heldDirectly(grants, tree, name, target))) return true;
  const children = (tree.children.get(name) ?? []).filter(
    (child) => target.database === null || !NON_DATABASE_LEVELS.has(tree.level.get(child) ?? ""),
  );
  return children.length > 0 && children.every((child) => holdsPrivilege(grantSets, tree, child, target));
}

// ============================================
// Probing
// ============================================

/** "…necessary to have the grant SELECT(a, b) ON system.metric_log. (ACCESS_DENIED)" → "SELECT ON system.metric_log". */
export function requiredGrantFromError(message: string): string | null {
  const match = /necessary to have the grant (.+?)\.\s*\(ACCESS_DENIED\)/s.exec(message);
  if (!match) return null;
  return match[1].replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

interface ErrorInfo {
  message: string;
  type: string;
}

/** The client's ClickHouseError carries the server's error name in `type` (e.g. "ACCESS_DENIED"). */
function errorInfo(error: unknown): ErrorInfo {
  const message = error instanceof Error ? error.message : String(error);
  const type = typeof error === "object" && error !== null && "type" in error && typeof error.type === "string" ? error.type : "";
  return { message, type };
}

function isAccessDenied({ type, message }: ErrorInfo): boolean {
  return type === "ACCESS_DENIED" || /Not enough privileges/i.test(message);
}

/** The table is not on this server, or needs config it doesn't have (distributed_ddl_queue without Keeper). */
const UNAVAILABLE_TYPES: ReadonlySet<string> = new Set(["UNKNOWN_TABLE", "NO_ELEMENTS_IN_CONFIG", "NO_ZOOKEEPER", "UNKNOWN_DATABASE"]);

type TableProbe = { kind: "ok" } | { kind: "denied"; grant: string } | { kind: "unavailable" } | { kind: "error"; reason: string };

async function textRows(client: ClickHouseClient, query: string): Promise<string[]> {
  const result = await client.query({ query, format: "TabSeparatedRaw" });
  const text = await result.text();
  return text.split("\n").filter((line) => line.trim().length > 0);
}

async function probeTable(client: ClickHouseClient, table: string): Promise<TableProbe> {
  try {
    const result = await client.query({ query: `SELECT * FROM system.${table} LIMIT 0`, format: "JSONEachRow" });
    await result.json();
    return { kind: "ok" };
  } catch (error) {
    const info = errorInfo(error);
    if (isAccessDenied(info)) return { kind: "denied", grant: requiredGrantFromError(info.message) ?? `SELECT ON system.${table}` };
    if (UNAVAILABLE_TYPES.has(info.type)) return { kind: "unavailable" };
    return { kind: "error", reason: info.message.split("\n")[0].trim().slice(0, 200) };
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * The user's grants, one list per grantee. `SHOW GRANTS FINAL` already folds
 * in every role; servers without it (24.8 and older) get the user's own
 * grants plus `SHOW GRANTS FOR` each enabled role.
 */
async function loadGrantSets(client: ClickHouseClient): Promise<ParsedGrant[][]> {
  try {
    return [parseGrantLines(await textRows(client, "SHOW GRANTS FINAL"))];
  } catch (error) {
    if (errorInfo(error).type !== "SYNTAX_ERROR") throw error;
  }
  const sets = [parseGrantLines(await textRows(client, "SHOW GRANTS"))];
  const roles = await textRows(client, "SELECT role_name FROM system.enabled_roles");
  for (const role of roles) {
    sets.push(parseGrantLines(await textRows(client, `SHOW GRANTS FOR ${quoteGrantName(role)}`)));
  }
  return sets;
}

async function loadPrivilegeTree(client: ClickHouseClient): Promise<PrivilegeTree> {
  try {
    const result = await client.query({ query: "SELECT privilege, aliases, level, parent_group FROM system.privileges", format: "JSONEachRow" });
    return buildPrivilegeTree((await result.json()) as PrivilegeTreeRow[]);
  } catch {
    // Without the tree only exact grants (and ALL) count, which can only over-report.
    return buildPrivilegeTree([]);
  }
}

/**
 * GRANT statements for what is missing: privileges on the same target share
 * one statement, SELECT grants stay one per table so each line can be copied
 * on its own.
 */
function grantStatements(missing: readonly string[], username: string): string[] {
  const grantee = quoteGrantName(username);
  const groups = new Map<string, { target: string; privileges: string[] }>();
  for (const item of missing) {
    const at = item.lastIndexOf(" ON ");
    const privilege = item.slice(0, at);
    const target = item.slice(at + 4);
    const key = privilege === "SELECT" ? item : target;
    const group = groups.get(key) ?? { target, privileges: [] };
    group.privileges.push(privilege);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => `GRANT ${g.privileges.join(", ")} ON ${g.target} TO ${grantee};`);
}

export interface PrivilegeCheckInput {
  username: string;
  /** The connection's default database; data editing is checked there. */
  database?: string | null;
}

/**
 * Check the connected user against every feature. Connection and login
 * failures are thrown (the caller reports them as such); a single check
 * that fails for another reason is reported in that feature's `errors`,
 * and still fails the feature.
 */
export async function checkConnectionPrivileges(client: ClickHouseClient, input: PrivilegeCheckInput): Promise<PrivilegeReport> {
  const database = input.database?.trim() || "default";
  const tables = [...new Set(PRIVILEGE_FEATURES.flatMap((f) => f.systemTables))];
  const [probes, grantSets, tree] = await Promise.all([
    mapLimit(tables, 8, (table) => probeTable(client, table)),
    loadGrantSets(client),
    loadPrivilegeTree(client),
  ]);
  const probeOf = new Map(tables.map((table, i) => [table, probes[i]]));

  const features = PRIVILEGE_FEATURES.map((feature): PrivilegeFeatureReport => {
    const missing: string[] = [];
    const unavailable: string[] = [];
    const errors: string[] = [];
    for (const table of feature.systemTables) {
      const probe = probeOf.get(table);
      if (!probe || probe.kind === "ok") continue;
      if (probe.kind === "denied") missing.push(probe.grant);
      else if (probe.kind === "error") errors.push(`system.${table}: ${probe.reason}`);
      else if (LAZY_DEFAULT_TABLES.has(table) && !holdsPrivilege(grantSets, tree, "SELECT", { database: "system", table })) {
        missing.push(`SELECT ON system.${table}`);
      } else {
        unavailable.push(`system.${table}`);
      }
    }
    for (const required of feature.privileges) {
      const target = { database: required.scope === "global" ? null : database };
      if (!holdsPrivilege(grantSets, tree, required.privilege, target)) {
        missing.push(`${required.privilege} ON ${scopeTarget(required.scope, database)}`);
      }
    }
    const failed = missing.length > 0 || errors.length > 0;
    return {
      id: feature.id,
      name: feature.name,
      description: feature.description,
      status: failed ? "missing" : "granted",
      missing,
      unavailable,
      errors,
      grants: grantStatements(missing, input.username),
    };
  });

  const missingCount = new Set(features.flatMap((f) => f.missing)).size;
  return {
    ok: features.every((f) => f.status === "granted"),
    username: input.username,
    database,
    missingCount,
    features,
    grantScript: [...new Set(features.flatMap((f) => f.grants))].join("\n"),
  };
}

/** One readable line for API clients that only show `error.message`. */
export function privilegeReportMessage(report: PrivilegeReport): string {
  const failing = report.features.filter((f) => f.status === "missing").length;
  const errors = [...new Set(report.features.flatMap((f) => f.errors))];
  if (report.missingCount === 0 && errors.length > 0) {
    return `Couldn't check every privilege for ${report.username}: ${errors.join("; ")}. Try again.`;
  }
  const summary = `${report.username} is missing ${report.missingCount} ${report.missingCount === 1 ? "privilege" : "privileges"} across ${failing} ${failing === 1 ? "feature" : "features"}.`;
  return report.grantScript ? `${summary} Run as an admin, then save again:\n${report.grantScript}` : summary;
}
