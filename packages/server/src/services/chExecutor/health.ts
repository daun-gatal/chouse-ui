/**
 * The identity checks of a connection that is not `shared` (ADR 0033 §5).
 *
 * On such a connection the stored login must be empty: no direct grant and no
 * default role, so a request that forgets to name a role reaches no data. That
 * protects against an old replica, an older CHouse version and a code path
 * that forgets the identity, so it is checked, not assumed: before a switch,
 * on every edit of the login, and every five minutes. The verdict is stored on
 * the connection row, so every replica reads the same one, and the executor
 * refuses while it is failing or stale.
 *
 * Every statement here is built by CHouse and sent with the purpose
 * `health-check`. Nothing a person types can change a verdict.
 */

import { randomUUID } from "node:crypto";

import { all, run, sql, str, strOrNull } from "../observe/db";
import { acquireLease } from "../observe/lease";
import type { ConnectionConfig } from "../../types";
import { logger } from "../../utils/logger";
import { clickhouseErrorCode } from "./errors";
import { executorForConfig } from "./executor";
import { isBindableUserName, isKnownMode, isRoleName } from "./identity";
import { runSelfTest, type SelfTestCheck } from "./selfTest";
import { serviceActor, type ChExecutor } from "./types";

export interface IdentityCheck {
  id: "version" | "empty_login" | "roles" | "bare_reads" | "system_role" | "login_reuse" | "remediation_login" | "impersonation_role" | SelfTestCheck["id"];
  label: string;
  ok: boolean;
  /** What was found, in words a ClickHouse administrator can act on. */
  detail: string;
}

export interface IdentityVerdict {
  ok: boolean;
  /** The first failing check's detail, or null. */
  reason: string | null;
  checks: IdentityCheck[];
  serverVersion: string | null;
  /** On a `personal` connection: the users the impersonation role may run statements as. */
  impersonationTargets?: string[];
}

export interface IdentityCheckInput {
  /** The login to check. */
  config: ConnectionConfig;
  mode: string;
  systemRole: string | null;
  /** For a `personal` connection: the role that holds the IMPERSONATE grants. */
  impersonationRole?: string | null;
  host: string;
  port: number;
  /** The connection being checked, left out of the login-reuse check. Absent for a new one. */
  connectionId?: string;
  /** The connection's remediation login, when it has one. */
  remediation?: ConnectionConfig;
}

const CHECK_SECONDS = 15;
const UNKNOWN_SETTING = 115;
const UNKNOWN_TABLE = 60;
const ACCESS_DENIED = 497;

/** Privileges that let a role create or change users, roles, policies, quotas or profiles. */
const ACCESS_MANAGEMENT = /\b(ACCESS MANAGEMENT|CREATE USER|ALTER USER|DROP USER|CREATE ROLE|ALTER ROLE|DROP ROLE|ROLE ADMIN|CREATE ROW POLICY|ALTER ROW POLICY|DROP ROW POLICY|CREATE POLICY|ALTER POLICY|DROP POLICY|CREATE QUOTA|ALTER QUOTA|DROP QUOTA|CREATE SETTINGS PROFILE|ALTER SETTINGS PROFILE|DROP SETTINGS PROFILE|CREATE PROFILE|ALTER PROFILE|DROP PROFILE)\b/i;

/**
 * Privileges that let a role act with another user's grants, or read stored
 * credentials: becoming a user, creating a view that runs as someone else or
 * skips access checks, reaching the server again through `remote` as a user
 * with an empty password, and reading named-collection secrets.
 */
const ACT_AS_ANOTHER = /\b(IMPERSONATE|SET DEFINER|ALLOW SQL SECURITY NONE|REMOTE|SOURCES|NAMED COLLECTION ADMIN|NAMED COLLECTION CONTROL|SHOW NAMED COLLECTIONS SECRETS|displaySecretsInShowAndSelect)\b/i;

const EVERYTHING = /^\*(\.\*)?$/;

function handle(config: ConnectionConfig, role: string | null): ChExecutor {
  // `roleOverride` also means "do not refuse for the connection's health": the checks must run on a refusing connection.
  return executorForConfig({ ...config, identity: undefined }, serviceActor("health-check"), { roleOverride: role, context: { source: "identity_check" } }).onServiceLane();
}

async function lines(client: ChExecutor, query: string): Promise<string[]> {
  const result = await client.query({ query, format: "TabSeparatedRaw", abort_signal: AbortSignal.timeout(CHECK_SECONDS * 1000), clickhouse_settings: { max_execution_time: CHECK_SECONDS } });
  return (await result.text()).split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0].trim().slice(0, 240);
}

export interface GrantLine {
  /** Roles a `GRANT a, b TO x` line grants; empty for a privilege grant. */
  roles: string[];
  /** The privilege part of a `GRANT … ON …` line, upper-cased; null for a role grant. */
  privileges: string | null;
  target: string | null;
  withGrantOption: boolean;
  withAdminOption: boolean;
}

/** One line of `SHOW GRANTS`. A line that is neither form is returned as a privilege grant, so it can never pass as "only roles". */
export function parseGrantLine(raw: string): GrantLine {
  const line = raw.trim();
  const withGrantOption = /\bWITH GRANT OPTION\b/i.test(line);
  const withAdminOption = /\bWITH ADMIN OPTION\b/i.test(line);
  const privilege = /^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s+/i.exec(line);
  if (privilege) return { roles: [], privileges: privilege[1].toUpperCase(), target: privilege[2], withGrantOption, withAdminOption };
  // A role grant has no ON. Names are kept as written, without their backticks:
  // one CHouse cannot name on a request is for the caller to refuse, never to skip.
  const role = /^GRANT\s+(.+?)\s+TO\s+\S+(?:\s+WITH ADMIN OPTION)?$/i.exec(line);
  if (role && !/\sON\s/i.test(role[1])) {
    const roles = role[1].split(",").map((name) => name.trim().replace(/^`|`$/g, "")).filter((name) => name.length > 0);
    if (roles.length > 0) return { roles, privileges: null, target: null, withGrantOption, withAdminOption };
  }
  return { roles: [], privileges: line.toUpperCase(), target: null, withGrantOption, withAdminOption };
}

/** Why a grant a role holds is not allowed on an empty-login connection, or null. */
export function forbiddenGrant(grant: GrantLine): string | null {
  if (grant.withGrantOption) return "a grant WITH GRANT OPTION";
  if (grant.withAdminOption) return "a role WITH ADMIN OPTION";
  if (grant.privileges === null) return null;
  // Column lists are names, not privileges: `SELECT(all, remote)` grants neither.
  const privileges = grant.privileges.replace(/\([^)]*\)/g, "");
  if (ACT_AS_ANOTHER.test(privileges)) return "a privilege that lets it act as another user or read stored credentials";
  if (ACCESS_MANAGEMENT.test(privileges)) return "a privilege that manages users, roles, policies, quotas or profiles";
  // ALL on one database is how a role owns its data; ALL on everything includes user management.
  if (/\bALL\b/i.test(privileges) && (grant.target === null || EVERYTHING.test(grant.target))) return "ALL on every database, which includes managing users";
  return null;
}

/** Bare request: must be refused (497) or not see the table at all (60). Returns null when it was, else what happened. */
async function bareReadLeak(bare: ChExecutor, table: string): Promise<string | null> {
  try {
    await lines(bare, `SELECT 1 FROM ${table} LIMIT 1`);
    return `a request that names no role can read ${table}`;
  } catch (error) {
    const code = clickhouseErrorCode(error);
    if (code === ACCESS_DENIED || code === UNKNOWN_TABLE) return null;
    return `could not confirm that ${table} is closed to a request that names no role: ${firstLine(error)}`;
  }
}

/**
 * The impersonation role of a `personal` connection holds one kind of grant:
 * `IMPERSONATE ON <user>`, one user per line, never on every user and never
 * with a grant option. Returns the users, or why a line is not allowed.
 */
export function impersonationTarget(grant: GrantLine): { user: string } | { problem: string } {
  if (grant.withGrantOption || grant.withAdminOption) return { problem: "a grant it can pass on" };
  if (grant.privileges === null) return { problem: "another role" };
  if (grant.privileges !== "IMPERSONATE") return { problem: "a privilege other than IMPERSONATE" };
  const user = (grant.target ?? "").replace(/^`|`$/g, "");
  if (!isBindableUserName(user)) return { problem: "IMPERSONATE on something other than one user with a plain name (letters, digits and underscores)" };
  return { user };
}

async function checkImpersonationRole(config: ConnectionConfig, role: string): Promise<{ check: IdentityCheck; targets: string[] }> {
  const label = "The impersonation role holds only IMPERSONATE on named users";
  const targets: string[] = [];
  try {
    for (const raw of await lines(handle(config, role), `SHOW GRANTS FOR ${role}`)) {
      const target = impersonationTarget(parseGrantLine(raw));
      if ("problem" in target) return { check: { id: "impersonation_role", label, ok: false, detail: `Role ${role} holds ${target.problem}: ${raw.slice(0, 160)}` }, targets: [] };
      targets.push(target.user);
    }
  } catch (error) {
    return { check: { id: "impersonation_role", label, ok: false, detail: `Could not read the grants of ${role}: ${firstLine(error)}` }, targets: [] };
  }
  if (targets.includes("default")) return { check: { id: "impersonation_role", label, ok: false, detail: `Role ${role} may run statements as the user default. Run: REVOKE IMPERSONATE ON default FROM ${role}` }, targets: [] };
  return { check: { id: "impersonation_role", label, ok: true, detail: `${targets.length} user${targets.length === 1 ? "" : "s"}.` }, targets };
}

async function checkRoles(config: ConnectionConfig, granted: readonly string[], impersonationRole: string | null = null): Promise<IdentityCheck> {
  const label = "Its roles hold nothing that manages or becomes other users";
  const seen = new Set<string>();
  const queue = granted.map((role) => ({ role, via: role }));
  try {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || seen.has(next.role)) continue;
      seen.add(next.role);
      // Checked on its own: it must hold IMPERSONATE, which no other role may.
      if (next.role === impersonationRole) continue;
      if (seen.size > 200) return { id: "roles", label, ok: false, detail: "The login reaches more than 200 roles; too many to check." };
      // Named with the top-level role, which enables the roles granted to it.
      for (const raw of await lines(handle(config, next.via), `SHOW GRANTS FOR ${next.role}`)) {
        const grant = parseGrantLine(raw);
        const problem = forbiddenGrant(grant);
        if (problem) return { id: "roles", label, ok: false, detail: `Role ${next.role} holds ${problem}: ${raw.slice(0, 160)}` };
        for (const nested of grant.roles) {
          // Its grants cannot be read by name, so it cannot be shown to be harmless.
          if (!isRoleName(nested)) return { id: "roles", label, ok: false, detail: `Role ${next.role} holds a role whose name CHouse cannot check (letters, digits and underscores only): ${raw.slice(0, 160)}` };
          queue.push({ role: nested, via: next.via });
        }
      }
    }
  } catch (error) {
    if (clickhouseErrorCode(error) === UNKNOWN_SETTING) {
      return { id: "roles", label, ok: false, detail: "This server does not take a role on a request. The role ceiling needs ClickHouse 24.4 or newer." };
    }
    return { id: "roles", label, ok: false, detail: `Could not read the grants of the login's roles: ${firstLine(error)}` };
  }
  return { id: "roles", label, ok: true, detail: `${seen.size} role${seen.size === 1 ? "" : "s"} checked.` };
}

async function checkReuse(input: IdentityCheckInput): Promise<IdentityCheck> {
  const label = "No connection of another kind uses the same login";
  const rows = await all(sql`
    SELECT name, identity_mode FROM rbac_clickhouse_connections
    WHERE host = ${input.host} AND port = ${input.port} AND username = ${input.config.username}
      AND identity_mode <> ${input.mode} AND id <> ${input.connectionId ?? ""}`);
  if (rows.length === 0) return { id: "login_reuse", label, ok: true, detail: "No other connection uses this login." };
  return { id: "login_reuse", label, ok: false, detail: `Connection "${str(rows[0].name)}" (${str(rows[0].identity_mode)}) uses the same host, port and user. Each kind needs its own ClickHouse user.` };
}

async function checkRemediation(remediation: ConnectionConfig): Promise<IdentityCheck> {
  const label = "The remediation login cannot manage or become other users";
  try {
    for (const raw of await lines(handle(remediation, null), "SHOW GRANTS")) {
      const grant = parseGrantLine(raw);
      const problem = forbiddenGrant(grant);
      if (problem) return { id: "remediation_login", label, ok: false, detail: `The remediation login ${remediation.username} holds ${problem}: ${raw.slice(0, 160)}` };
    }
  } catch (error) {
    return { id: "remediation_login", label, ok: false, detail: `Could not read the remediation login's grants: ${firstLine(error)}` };
  }
  return { id: "remediation_login", label, ok: true, detail: "Checked." };
}

function verdictOf(checks: IdentityCheck[], serverVersion: string | null): IdentityVerdict {
  const failed = checks.find((check) => !check.ok);
  return { ok: !failed, reason: failed ? failed.detail : null, checks, serverVersion };
}

/**
 * Run every check for a login and the kind it is meant for. A `shared` login
 * has only the reuse check: it is allowed to hold grants. An unknown kind
 * fails.
 */
export async function runIdentityChecks(input: IdentityCheckInput): Promise<IdentityVerdict> {
  if (!isKnownMode(input.mode)) {
    return verdictOf([{ id: "version", label: "The kind is one this version knows", ok: false, detail: `This version of CHouse does not know the kind "${input.mode.slice(0, 40)}".` }], null);
  }
  const reuse = await checkReuse(input);
  if (input.mode === "shared") return verdictOf([reuse], null);

  const checks: IdentityCheck[] = [];
  const bare = handle(input.config, null);
  let serverVersion: string | null = null;
  try {
    serverVersion = (await lines(bare, "SELECT version()"))[0] ?? null;
    checks.push({ id: "version", label: "The login can connect", ok: true, detail: `ClickHouse ${serverVersion ?? "unknown"}.` });
  } catch (error) {
    checks.push({ id: "version", label: "The login can connect", ok: false, detail: `Could not connect as ${input.config.username}: ${firstLine(error)}` });
    return verdictOf([...checks, reuse], null);
  }

  // 1. The login itself holds nothing: only role grants, none of them default.
  let granted: string[] = [];
  try {
    const grants = (await lines(bare, "SHOW GRANTS")).map(parseGrantLine);
    const direct = grants.find((grant) => grant.privileges !== null);
    const unnamed = grants.flatMap((grant) => grant.roles).find((name) => !isRoleName(name));
    const admin = grants.find((grant) => grant.withAdminOption || grant.withGrantOption);
    const defaults = (await lines(bare, "SELECT arrayJoin(currentRoles())"));
    granted = [...new Set(grants.flatMap((grant) => grant.roles))];
    if (direct) checks.push({ id: "empty_login", label: "The login holds no grant of its own", ok: false, detail: `${input.config.username} holds a direct grant (${direct.privileges?.slice(0, 80)}${direct.target ? ` ON ${direct.target}` : ""}). Revoke it and grant it to a role instead.` });
    else if (admin) checks.push({ id: "empty_login", label: "The login holds no grant of its own", ok: false, detail: `${input.config.username} holds a role WITH ADMIN OPTION. Grant the role without it.` });
    else if (unnamed !== undefined) checks.push({ id: "empty_login", label: "The login holds no grant of its own", ok: false, detail: `${input.config.username} holds a role whose name CHouse cannot put on a request (letters, digits and underscores only).` });
    else if (defaults.length > 0) checks.push({ id: "empty_login", label: "The login holds no grant of its own", ok: false, detail: `${input.config.username} has default roles (${defaults.slice(0, 5).join(", ")}). Run: ALTER USER ${input.config.username} DEFAULT ROLE NONE` });
    else checks.push({ id: "empty_login", label: "The login holds no grant of its own", ok: true, detail: `Only roles, none of them default: ${granted.join(", ") || "none"}.` });
  } catch (error) {
    checks.push({ id: "empty_login", label: "The login holds no grant of its own", ok: false, detail: `Could not read the login's grants: ${firstLine(error)}` });
  }

  // 2. Its roles.
  const personal = input.mode === "personal";
  const impersonationRole = personal && isRoleName(input.impersonationRole) ? input.impersonationRole : null;
  checks.push(await checkRoles(input.config, granted, impersonationRole));

  // 3 and 4. The system role works, and a request that names no role reads nothing.
  const systemLabel = "The system role can read system tables";
  let userTable: string | null = null;
  if (!isRoleName(input.systemRole)) {
    checks.push({ id: "system_role", label: systemLabel, ok: false, detail: "No system role is set. It is a name of letters, digits and underscores." });
  } else if (!granted.includes(input.systemRole)) {
    checks.push({ id: "system_role", label: systemLabel, ok: false, detail: `The role ${input.systemRole} is not granted to ${input.config.username}. Run: GRANT ${input.systemRole} TO ${input.config.username}` });
  } else {
    const system = handle(input.config, input.systemRole);
    try {
      await lines(system, "SELECT 1 FROM system.processes LIMIT 1");
      checks.push({ id: "system_role", label: systemLabel, ok: true, detail: `Requests that name ${input.systemRole} can read system.processes.` });
      const found = await lines(system, "SELECT concat(database, '.', name) FROM system.tables WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA') AND match(database, '^[A-Za-z_][A-Za-z0-9_]*$') AND match(name, '^[A-Za-z_][A-Za-z0-9_]*$') LIMIT 1").catch(() => []);
      userTable = found[0] ?? null;
    } catch (error) {
      const detail = clickhouseErrorCode(error) === UNKNOWN_SETTING
        ? "This server does not take a role on a request. The role ceiling needs ClickHouse 24.4 or newer."
        : `A request that names ${input.systemRole} could not read system.processes: ${firstLine(error)}`;
      checks.push({ id: "system_role", label: systemLabel, ok: false, detail });
    }
  }

  const leaks: string[] = [];
  for (const table of ["system.processes", "system.query_log", ...(userTable ? [userTable] : [])]) {
    const leak = await bareReadLeak(bare, table);
    if (leak) leaks.push(leak);
  }
  checks.push(leaks.length > 0
    ? { id: "bare_reads", label: "A request that names no role reads no data", ok: false, detail: `${leaks[0]}. If the login holds no grant, the server setting select_from_system_db_requires_grant is off.` }
    : { id: "bare_reads", label: "A request that names no role reads no data", ok: true, detail: "Refused, as it should be." });

  // 5. A personal connection: the impersonation role, and the server's self-test (§7.1).
  let impersonationTargets: string[] | undefined;
  if (personal) {
    const label = "The impersonation role holds only IMPERSONATE on named users";
    if (impersonationRole === null) {
      checks.push({ id: "impersonation_role", label, ok: false, detail: "No impersonation role is set. It is a name of letters, digits and underscores." });
    } else if (impersonationRole === input.systemRole) {
      checks.push({ id: "impersonation_role", label, ok: false, detail: "The impersonation role and the system role must be two roles." });
    } else if (!granted.includes(impersonationRole)) {
      checks.push({ id: "impersonation_role", label, ok: false, detail: `The role ${impersonationRole} is not granted to ${input.config.username}. Run: GRANT ${impersonationRole} TO ${input.config.username}` });
    } else {
      const role = await checkImpersonationRole(input.config, impersonationRole);
      checks.push(role.check);
      impersonationTargets = role.targets;
      const impersonating = handle(input.config, impersonationRole);
      const send = async (query: string): Promise<string> => {
        const result = await impersonating.exec({ query, abort_signal: AbortSignal.timeout(CHECK_SECONDS * 1000), clickhouse_settings: { max_execution_time: CHECK_SECONDS, default_format: "TabSeparatedRaw" } });
        let body = "";
        for await (const chunk of result.stream as AsyncIterable<Buffer | string>) body += chunk.toString();
        return body;
      };
      checks.push(...(await runSelfTest(send, input.config.username)));
    }
  }

  checks.push(reuse);
  if (input.remediation) checks.push(await checkRemediation(input.remediation));
  return { ...verdictOf(checks, serverVersion), ...(impersonationTargets ? { impersonationTargets } : {}) };
}

/**
 * Store a verdict on the connection row, for every replica to read. It is
 * about one login: a round that started before a switch must not write its
 * verdict over the new login's, so the row is matched on the user as well.
 */
export async function writeVerdict(connectionId: string, username: string, verdict: IdentityVerdict, now: number = Date.now()): Promise<void> {
  await run(sql`
    UPDATE rbac_clickhouse_connections
    SET identity_health = ${verdict.ok ? "ok" : "failing"}, identity_health_reason = ${verdict.reason ? verdict.reason.slice(0, 500) : null},
        identity_checked_at = ${now}, identity_server_version = ${verdict.serverVersion}
    WHERE id = ${connectionId} AND username = ${username}`);
}

/** Check one saved connection and store the verdict. A `shared` connection has no verdict to store. */
export async function checkSavedConnection(connectionId: string): Promise<IdentityVerdict | null> {
  const { getConnectionWithPassword } = await import("../../rbac/services/connections");
  const connection = await getConnectionWithPassword(connectionId);
  if (!connection || connection.identityMode === "shared") return null;
  const url = `${connection.sslEnabled ? "https" : "http"}://${connection.host}:${connection.port}`;
  let remediation: ConnectionConfig | undefined;
  try {
    const { getCredential } = await import("../remediation/store");
    const stored = await getCredential(connectionId);
    if (stored) remediation = { url, username: stored.username, password: stored.password, database: connection.database || undefined };
  } catch {
    // No remediation login table or row: nothing to check.
  }
  const verdict = await runIdentityChecks({
    config: { url, username: connection.username, password: connection.password || "", database: connection.database || undefined },
    mode: connection.identityMode,
    systemRole: connection.systemRole,
    impersonationRole: connection.impersonationRole,
    host: connection.host,
    port: connection.port,
    connectionId,
    remediation,
  });
  await writeVerdict(connectionId, connection.username, verdict);
  if (connection.identityMode === "personal" && verdict.ok) {
    // Bindings are checked only against a server that passed: a failing connection refuses everyone anyway.
    const { checkConnectionBindings } = await import("../../rbac/services/clickhouseBindings");
    await checkConnectionBindings(connectionId);
  }
  return verdict;
}

const LEASE_KEY = "connection-identity-health";
const INTERVAL_MS = 5 * 60_000;
const holder = randomUUID();
let timer: NodeJS.Timeout | null = null;
let ticking = false;

/** One round: every connection that is not `shared`, by whichever process holds the lease. */
export async function identityHealthTick(): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  try {
    if (!(await acquireLease(LEASE_KEY, holder, Math.floor(INTERVAL_MS / 1000) - 30))) return 0;
    const rows = await all(sql`SELECT id FROM rbac_clickhouse_connections WHERE identity_mode <> 'shared' AND is_active`);
    for (const row of rows) {
      const id = strOrNull(row.id);
      if (!id) continue;
      try {
        await checkSavedConnection(id);
      } catch (error) {
        // A check that cannot run leaves the old verdict to go stale, which refuses.
        logger.warn({ module: "IdentityHealth", connectionId: id, err: firstLine(error) }, "Identity check could not run");
      }
    }
    return rows.length;
  } finally {
    ticking = false;
  }
}

/** Start the five-minute timer. Runs in every server process; the lease keeps it to one at a time. */
export function startIdentityHealthTimer(): void {
  if (timer) return;
  const tick = (): void => {
    void identityHealthTick().catch((error: unknown) => logger.warn({ module: "IdentityHealth", err: firstLine(error) }, "Identity health round failed"));
  };
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  tick();
}

export function stopIdentityHealthTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
