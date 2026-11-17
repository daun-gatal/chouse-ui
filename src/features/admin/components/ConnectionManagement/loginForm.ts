/**
 * The rules of the connection panel, kept free of React so they can be tested
 * one by one: the drafts of the General and ClickHouse login tabs, which
 * request a Save or a Test goes to, what the form warns about, the setup
 * script for the ClickHouse administrator and the pills of the connection list.
 */

import {
  CLICKHOUSE_ROLE_NAME,
  IDENTITY_MODE_CEILING,
  IDENTITY_MODE_PERSONAL,
  IDENTITY_MODE_SHARED,
  identityKind,
  identityKindLabel,
  type IdentityChange,
  type IdentityCheck,
  type IdentityCheckResult,
  type IdentityKind,
  type KnownIdentityMode,
  type ServerSupport,
} from "@/api/connectionIdentity";
import type { ClickHouseConnection, ConnectionReadiness, CreateConnectionInput, TestConnectionInput, UpdateConnectionInput } from "@/api/rbac";

export const DEFAULT_SYSTEM_ROLE = "chouse_system";
export const DEFAULT_IMPERSONATION_ROLE = "chouse_impersonate";
export const DEFAULT_PORT = 8123;
export const PASSWORD_MAX = 1000;
export const ACCESS_CONTACT_LIMIT = 500;

export type PanelTab = "general" | "login" | "who";

export const PANEL_TAB_LABELS: Record<PanelTab, string> = {
  general: "General",
  login: "ClickHouse login",
  who: "Who can query",
};

// ============================================
// General tab
// ============================================

export const ENVIRONMENT_OPTIONS = [
  { value: "unset", label: "Not set" },
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "development", label: "Development" },
] as const;

export type EnvironmentChoice = (typeof ENVIRONMENT_OPTIONS)[number]["value"];

export function isEnvironmentChoice(value: string): value is EnvironmentChoice {
  return ENVIRONMENT_OPTIONS.some((option) => option.value === value);
}

/** The environment stored in a connection's metadata (ADR 0025: production raises AI write tiers). */
export function connectionEnvironment(connection?: Pick<ClickHouseConnection, "metadata"> | null): EnvironmentChoice {
  const value = connection?.metadata?.environment;
  return value === "production" || value === "staging" || value === "development" ? value : "unset";
}

/** The connection's metadata with the chosen environment, keeping every other key. */
export function metadataWithEnvironment(metadata: Record<string, unknown> | null | undefined, environment: EnvironmentChoice): Record<string, unknown> {
  const next = { ...(metadata ?? {}) };
  if (environment === "unset") delete next.environment;
  else next.environment = environment;
  return next;
}

export interface GeneralDraft {
  name: string;
  environment: EnvironmentChoice;
  isActive: boolean;
  isDefault: boolean;
}

export function generalDraftFrom(connection: ClickHouseConnection | null): GeneralDraft {
  return {
    name: connection?.name ?? "",
    environment: connectionEnvironment(connection),
    isActive: connection?.isActive ?? true,
    isDefault: connection?.isDefault ?? false,
  };
}

export function isGeneralDirty(draft: GeneralDraft, baseline: GeneralDraft): boolean {
  return draft.name !== baseline.name || draft.environment !== baseline.environment || draft.isActive !== baseline.isActive || draft.isDefault !== baseline.isDefault;
}

/** What stops the General tab from being saved, or null. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter a name for the connection.";
  if (trimmed.length > 255) return "The name is at most 255 characters.";
  return null;
}

/** The PATCH of the General tab: never a login field, and the toggles only when they change. */
export function generalPatch(draft: GeneralDraft, connection: ClickHouseConnection): UpdateConnectionInput {
  const patch: UpdateConnectionInput = {
    name: draft.name.trim(),
    metadata: metadataWithEnvironment(connection.metadata, draft.environment),
  };
  if (draft.isActive !== connection.isActive) patch.isActive = draft.isActive;
  if (draft.isDefault !== connection.isDefault) patch.isDefault = draft.isDefault;
  return patch;
}

// ============================================
// ClickHouse login tab
// ============================================

export interface KindOption {
  value: KnownIdentityMode;
  label: string;
  description: string;
}

export const KIND_OPTIONS: readonly KindOption[] = [
  {
    value: IDENTITY_MODE_SHARED,
    label: "Shared login",
    description: "Everyone runs as this one ClickHouse user. CHouse access policies decide what each person sees.",
  },
  {
    value: IDENTITY_MODE_CEILING,
    label: "Role ceiling",
    description: "One empty user; ClickHouse limits each person to the role mapped to their CHouse role.",
  },
  {
    value: IDENTITY_MODE_PERSONAL,
    label: "Personal",
    description: "Each person runs as their own ClickHouse user.",
  },
];

export interface LoginDraft {
  kind: KnownIdentityMode;
  host: string;
  /** Kept as typed, so an empty or half-typed port is shown as it is. */
  port: string;
  sslEnabled: boolean;
  username: string;
  /** Empty keeps the stored one on edit. */
  password: string;
  database: string;
  systemRole: string;
  impersonationRole: string;
  accessContact: string;
}

/** The login as it is stored, which the draft is compared against; null while creating. */
export interface StoredLogin {
  kind: IdentityKind;
  host: string;
  port: number;
  sslEnabled: boolean;
  username: string;
  database: string | null;
  systemRole: string | null;
  impersonationRole: string | null;
  accessContact: string | null;
}

export function storedLoginOf(connection: ClickHouseConnection): StoredLogin {
  return {
    kind: identityKind(connection.identityMode),
    host: connection.host,
    port: connection.port,
    sslEnabled: connection.sslEnabled,
    username: connection.username,
    database: connection.database,
    systemRole: connection.systemRole,
    impersonationRole: connection.impersonationRole,
    accessContact: connection.accessContact,
  };
}

export function loginDraftFrom(stored: StoredLogin | null): LoginDraft {
  // A kind this build does not know starts the form on a shared login: it can only be switched away from.
  const kind: KnownIdentityMode = stored && stored.kind !== "unknown" ? stored.kind : IDENTITY_MODE_SHARED;
  return {
    kind,
    host: stored?.host ?? "",
    port: String(stored?.port ?? DEFAULT_PORT),
    sslEnabled: stored?.sslEnabled ?? false,
    username: stored?.username ?? "",
    password: "",
    database: stored?.database ?? "",
    systemRole: stored?.systemRole ?? DEFAULT_SYSTEM_ROLE,
    impersonationRole: stored?.impersonationRole ?? DEFAULT_IMPERSONATION_ROLE,
    accessContact: stored?.accessContact ?? "",
  };
}

export function isLoginDirty(draft: LoginDraft, baseline: LoginDraft): boolean {
  return (Object.keys(draft) as Array<keyof LoginDraft>).some((key) => draft[key] !== baseline[key]);
}

/** Which request a Save (or Create) and a Test of the login go to. */
export type LoginRoute =
  /** POST /connections; Test: POST /connections/test. */
  | "create_shared"
  /** POST /connections/identity; Test: POST /connections/identity/check. */
  | "create_identity"
  /** PATCH /connections/:id; Test: POST /connections/test with the connection id. */
  | "patch"
  /** PUT /connections/:id/identity; Test: POST /connections/:id/identity/check. */
  | "switch";

export function loginRoute(stored: StoredLogin | null, selected: KnownIdentityMode): LoginRoute {
  if (stored === null) return selected === IDENTITY_MODE_SHARED ? "create_shared" : "create_identity";
  return stored.kind === IDENTITY_MODE_SHARED && selected === IDENTITY_MODE_SHARED ? "patch" : "switch";
}

function portOf(draft: LoginDraft): number {
  return Number(draft.port);
}

/** Whether only the access contact differs: it is saved on its own, without running the checks. */
export function onlyContactChanged(draft: LoginDraft, baseline: LoginDraft): boolean {
  if (draft.accessContact.trim() === baseline.accessContact.trim()) return false;
  return !isLoginDirty({ ...draft, accessContact: baseline.accessContact }, baseline);
}

/**
 * Whether the stored password may be sent to the target server: only to the
 * same host and port, and never over plain HTTP when it was stored for HTTPS.
 * Mirrors `storedPasswordMayGo` on the server.
 */
export function storedPasswordMayGo(stored: Pick<StoredLogin, "host" | "port" | "sslEnabled">, target: { host: string; port: number; sslEnabled: boolean }): boolean {
  return target.host === stored.host && target.port === stored.port && !(stored.sslEnabled && !target.sslEnabled);
}

const ROLE_NAME_RULE = "use letters, digits and underscores, not starting with a digit (128 at most).";

/** Why a kind cannot be chosen by this viewer on this server, or null. */
export function kindLock(kind: KnownIdentityMode, options: { superAdmin: boolean; storedKind: IdentityKind | null; support?: ServerSupport | null }): string | null {
  if (kind !== IDENTITY_MODE_SHARED && !options.superAdmin) return "Only a super admin can choose this.";
  // The kind in use stays selectable, so its login can still be replaced on a server that was downgraded.
  if (kind === options.storedKind) return null;
  const found = options.support?.kinds.find((entry) => entry.kind === kind);
  return found && found.state === "unavailable" ? `Not available: ${found.reason}` : null;
}

/** What stops the login form from being tested or saved, or null. */
export function loginProblem(draft: LoginDraft, stored: StoredLogin | null): string | null {
  const host = draft.host.trim();
  if (host === "") return "Enter the host.";
  if (host.length > 255) return "The host is at most 255 characters.";
  const port = portOf(draft);
  if (draft.port.trim() === "" || !Number.isInteger(port) || port < 1 || port > 65535) return "Enter a port between 1 and 65535.";
  const username = draft.username.trim();
  if (username === "") return "Enter the ClickHouse user.";
  if (username.length > 255) return "The ClickHouse user is at most 255 characters.";
  if (draft.password.length > PASSWORD_MAX) return `The password is at most ${PASSWORD_MAX} characters.`;
  if (draft.database.trim().length > 255) return "The default database is at most 255 characters.";
  const route = loginRoute(stored, draft.kind);
  if (draft.password === "") {
    // A login with no grants of its own still signs in: without a password anyone who reaches the server could use it.
    if (route === "create_identity") return "Enter the password of the ClickHouse user.";
    if (stored && route === "switch") {
      if (username !== stored.username) return "Enter the password of the new ClickHouse user.";
      if (!storedPasswordMayGo(stored, { host, port, sslEnabled: draft.sslEnabled })) {
        return "Enter the password again when the host or port changes, or when TLS is turned off.";
      }
    }
  }
  if (draft.kind !== IDENTITY_MODE_SHARED) {
    const systemRole = draft.systemRole.trim();
    if (systemRole === "") return "Enter the system role.";
    if (!CLICKHOUSE_ROLE_NAME.test(systemRole)) return `For the system role, ${ROLE_NAME_RULE}`;
  }
  if (draft.kind === IDENTITY_MODE_PERSONAL) {
    const impersonationRole = draft.impersonationRole.trim();
    if (impersonationRole === "") return "Enter the impersonation role.";
    if (!CLICKHOUSE_ROLE_NAME.test(impersonationRole)) return `For the impersonation role, ${ROLE_NAME_RULE}`;
    if (impersonationRole === draft.systemRole.trim()) return "The impersonation role and the system role must be two roles.";
  }
  if (draft.accessContact.trim().length > ACCESS_CONTACT_LIMIT) return `The access contact is at most ${ACCESS_CONTACT_LIMIT} characters.`;
  return null;
}

/** The login of a role-ceiling or personal connection as the identity routes take it. Never logged: it carries the password. */
export function identityChangeFrom(draft: LoginDraft): IdentityChange {
  const nonShared = draft.kind !== IDENTITY_MODE_SHARED;
  return {
    identityMode: draft.kind,
    host: draft.host.trim(),
    port: portOf(draft),
    sslEnabled: draft.sslEnabled,
    username: draft.username.trim(),
    ...(draft.password !== "" ? { password: draft.password } : {}),
    // Empty clears the default database; the server keeps it only when the key is absent.
    database: draft.database.trim(),
    systemRole: nonShared ? draft.systemRole.trim() : null,
    // Only a personal login has one; the server stores none for the other kinds.
    ...(draft.kind === IDENTITY_MODE_PERSONAL ? { impersonationRole: draft.impersonationRole.trim() } : {}),
    ...(nonShared ? { accessContact: draft.accessContact.trim() || null } : {}),
  };
}

/** The PATCH of a shared login: the login fields that changed, the password only when typed. */
export function loginPatch(draft: LoginDraft, stored: StoredLogin): UpdateConnectionInput {
  const patch: UpdateConnectionInput = {};
  const host = draft.host.trim();
  const port = portOf(draft);
  const username = draft.username.trim();
  const database = draft.database.trim();
  if (host !== stored.host) patch.host = host;
  if (port !== stored.port) patch.port = port;
  if (draft.sslEnabled !== stored.sslEnabled) patch.sslEnabled = draft.sslEnabled;
  if (username !== stored.username) patch.username = username;
  if (database !== (stored.database ?? "")) patch.database = database === "" ? null : database;
  if (draft.password !== "") patch.password = draft.password;
  return patch;
}

/** POST /connections: a shared login with its name and metadata. */
export function createSharedInput(draft: LoginDraft, general: GeneralDraft): CreateConnectionInput {
  const database = draft.database.trim();
  return {
    name: general.name.trim(),
    host: draft.host.trim(),
    port: portOf(draft),
    username: draft.username.trim(),
    ...(draft.password !== "" ? { password: draft.password } : {}),
    ...(database !== "" ? { database } : {}),
    sslEnabled: draft.sslEnabled,
    metadata: metadataWithEnvironment(null, general.environment),
  };
}

/** POST /connections/test for a shared login; on edit the stored password stands in for an empty one. */
export function sharedTestInput(draft: LoginDraft, connectionId: string | null): TestConnectionInput {
  const database = draft.database.trim();
  return {
    host: draft.host.trim(),
    port: portOf(draft),
    username: draft.username.trim(),
    ...(draft.password !== "" ? { password: draft.password } : {}),
    ...(database !== "" ? { database } : {}),
    sslEnabled: draft.sslEnabled,
    ...(connectionId ? { connectionId } : {}),
  };
}

export interface KindHint {
  title: string;
  /** Plain sentences under the title. */
  body: string;
  /**
   * The stored user holds grants and the new kind needs one with none: offer
   * a new empty user or emptying this one. Null when there is no such choice.
   */
  userWithGrants: string | null;
  /** The setup script applies (a role-ceiling or personal login). */
  script: boolean;
}

const NO_GRANTS_BODY: Record<Exclude<KnownIdentityMode, "shared">, string> = {
  shared_ceiling: "Its access comes only from roles that CHouse names on each request.",
  personal:
    "It only signs in. Each statement then runs as the person's own ClickHouse user, so their ClickHouse grants decide what they can reach. CHouse data access policies don't apply.",
};

/**
 * What the chosen kind needs from the ClickHouse user, shown when the kind
 * differs from the stored one, or at create for a kind other than a shared
 * login. Null when there is nothing to say.
 */
export function kindHint(stored: StoredLogin | null, selected: KnownIdentityMode): KindHint | null {
  if (stored !== null && stored.kind === selected) return null;
  if (selected === IDENTITY_MODE_SHARED) {
    if (stored === null) return null;
    return {
      title: "Shared login needs a ClickHouse user with full privileges",
      body: `${stored.username} has no grants of its own, so it can't be used. Enter a user that holds every privilege CHouse needs. Test lists any that are missing, with the GRANT lines to copy.`,
      userWithGrants: null,
      script: false,
    };
  }
  const title = `${identityKindLabel(selected)} needs a ClickHouse user with no grants of its own`;
  if (stored !== null && stored.kind === IDENTITY_MODE_SHARED) {
    return {
      title,
      body: `${stored.username} has its own grants, so it can't be used as it is. Either:`,
      userWithGrants: stored.username,
      script: true,
    };
  }
  return { title, body: NO_GRANTS_BODY[selected], userWithGrants: null, script: true };
}

/** The bullets of "What changes for people", for a switch to personal or back to a shared login; null otherwise. */
export function peopleNote(
  stored: StoredLogin | null,
  selected: KnownIdentityMode,
  counts: { policies: number | null; links: { total: number; active: number } | null },
): string[] | null {
  if (stored === null || stored.kind === selected) return null;
  if (selected === IDENTITY_MODE_PERSONAL) {
    const lines = [
      stored.kind === IDENTITY_MODE_CEILING
        ? "Each statement runs as the person's own ClickHouse user. The role map stops applying."
        : "Each statement runs as the person's own ClickHouse user. CHouse data access policies stop applying.",
    ];
    const links = counts.links;
    if (links === null) lines.push("Only linked people can query; link them in Who can query.");
    else if (links.total === 0) lines.push("Only linked people can query. 0 people are linked, so everyone loses access until you add links in Who can query.");
    else lines.push(`Only linked people can query. ${links.total} ${links.total === 1 ? "person is" : "people are"} linked, ${links.active} active; everyone else loses access.`);
    lines.push("Scheduled queries and alerts run as their owner's linked user. Owners who aren't linked see their runs refused.");
    return lines;
  }
  if (selected === IDENTITY_MODE_SHARED) {
    const lines = [
      stored.kind === IDENTITY_MODE_PERSONAL
        ? "Everyone runs as the one user below, not as their own ClickHouse user."
        : "Everyone runs as the one user below, without a ClickHouse role per person.",
    ];
    if (counts.policies === 0) {
      lines.push("CHouse data access policies decide what each person sees. This connection has none, so people other than admins see no tables until you add some.");
    } else if (counts.policies !== null) {
      lines.push(`CHouse data access policies decide what each person sees. ${counts.policies} ${counts.policies === 1 ? "applies" : "apply"} to this connection.`);
    } else {
      lines.push("CHouse data access policies decide what each person sees.");
    }
    if (stored.kind === IDENTITY_MODE_PERSONAL) {
      const total = counts.links?.total ?? 0;
      if (total > 0) lines.push(`The ${total} person ${total === 1 ? "link is" : "links are"} kept, unused, in case you switch back.`);
    } else if (stored.kind === IDENTITY_MODE_CEILING) {
      lines.push("The role map is kept, unused, in case you switch back.");
    }
    return lines;
  }
  return null;
}

/**
 * The warning under the login form: whether the stored login keeps working
 * until the save. Null when nothing changes for running queries.
 */
export function footerWarning(stored: StoredLogin | null, draft: LoginDraft): string | null {
  if (stored === null) return null;
  const userChanged = draft.username.trim() !== stored.username;
  if (userChanged) return `New user entered: ${stored.username} keeps working until you save.`;
  if (draft.kind !== stored.kind) return "Queries on this connection fail until you save.";
  return null;
}

export type ScriptVariant = "new_user" | "empty_current";

export interface ScriptInput {
  kind: Exclude<KnownIdentityMode, "shared">;
  /** The user typed in the form; a placeholder stands in for an empty one. */
  username: string;
  /** The stored user, emptied by the second variant. */
  currentUser: string | null;
  systemRole: string;
  impersonationRole: string;
  /** ClickHouse roles of the role map (role ceiling). */
  mappedRoles: readonly string[];
  variant: ScriptVariant;
}

const NEW_USER_PLACEHOLDER = "<new_user>";

/**
 * The statements a ClickHouse administrator runs to prepare the login,
 * built from the names in the form. They mirror `ceilingSetupStatements` and
 * `personalSetupStatements` on the server. The password is never put in: the
 * administrator types it. CHouse never runs these.
 */
export function setupScript(input: ScriptInput): string[] {
  const emptying = input.variant === "empty_current" && input.currentUser !== null;
  const user = emptying && input.currentUser !== null ? input.currentUser : input.username.trim() || NEW_USER_PLACEHOLDER;
  const systemRole = input.systemRole.trim() || DEFAULT_SYSTEM_ROLE;
  // Emptying an existing user takes away its direct grants instead of creating it.
  const userLine = emptying ? `REVOKE ALL ON *.* FROM ${user};` : `CREATE USER IF NOT EXISTS ${user} IDENTIFIED BY '<password>';`;
  const systemLines = [
    `CREATE ROLE IF NOT EXISTS ${systemRole};`,
    `GRANT SELECT ON system.* TO ${systemRole};`,
    `GRANT SHOW ON *.* TO ${systemRole};`,
    `GRANT KILL QUERY ON *.* TO ${systemRole};`,
  ];
  if (input.kind === IDENTITY_MODE_PERSONAL) {
    const impersonationRole = input.impersonationRole.trim() || DEFAULT_IMPERSONATION_ROLE;
    return [
      ...systemLines,
      `CREATE ROLE IF NOT EXISTS ${impersonationRole};`,
      userLine,
      `GRANT IMPERSONATE ON ${user} TO ${impersonationRole};   -- lets CHouse test the server; the login itself holds no grant`,
      `-- GRANT IMPERSONATE ON <user> TO ${impersonationRole};     -- one line per linked ClickHouse user (Who can query shows them)`,
      `GRANT ${systemRole}, ${impersonationRole} TO ${user};`,
      `ALTER USER ${user} DEFAULT ROLE NONE;`,
    ];
  }
  const mapped = [...new Set(input.mappedRoles)].filter((role) => role !== systemRole);
  return [
    ...systemLines,
    ...mapped.flatMap((role) => [
      `CREATE ROLE IF NOT EXISTS ${role};`,
      `-- GRANT SELECT ON <database>.* TO ${role};   -- the data this CHouse role may reach`,
      `-- GRANT SELECT ON system.* TO ${role};       -- optional: lets its people use the Monitoring pages`,
    ]),
    userLine,
    `GRANT ${[systemRole, ...mapped].join(", ")} TO ${user};`,
    `ALTER USER ${user} DEFAULT ROLE NONE;`,
  ];
}

// ============================================
// Check results
// ============================================

export interface AdminFix {
  check: IdentityCheck;
  /** Statements to copy for the ClickHouse administrator; empty when the detail says it all. */
  statements: string[];
}

export interface GroupedChecks {
  forAdmin: AdminFix[];
  forYou: IdentityCheck[];
  passed: IdentityCheck[];
}

/** Checks the person filling the form fixes themselves: another login, or the host and password they typed. */
function fixedByYou(check: IdentityCheck, unsupported: boolean): boolean {
  if (check.id === "login_reuse") return true;
  // "version" is the connect check, unless the server cannot run the kind at all: that is an upgrade.
  return check.id === "version" && !unsupported;
}

function statementsOf(check: IdentityCheck, username: string): string[] {
  const run = /Run: (.+)$/.exec(check.detail);
  if (run) {
    const statement = run[1].trim();
    return [statement.endsWith(";") ? statement : `${statement};`];
  }
  if (check.id === "empty_login" && /holds a direct grant/.test(check.detail)) {
    return [`REVOKE ALL ON *.* FROM ${username};`, `ALTER USER ${username} DEFAULT ROLE NONE;`];
  }
  return [];
}

/** The checks of a result grouped by who fixes them. */
export function groupChecks(result: Pick<IdentityCheckResult, "verdict" | "unsupported">, username: string): GroupedChecks {
  const grouped: GroupedChecks = { forAdmin: [], forYou: [], passed: [] };
  for (const check of result.verdict.checks) {
    if (check.ok) grouped.passed.push(check);
    else if (fixedByYou(check, result.unsupported === true)) grouped.forYou.push(check);
    else grouped.forAdmin.push({ check, statements: statementsOf(check, username) });
  }
  return grouped;
}

/** The one line above a result. */
export type CheckAction = "test" | "create" | "save" | "recheck";

export function resultHeadline(result: Pick<IdentityCheckResult, "ok" | "verdict" | "reason">, action: CheckAction): string {
  const failed = result.verdict.checks.filter((check) => !check.ok).length;
  if (action === "recheck") {
    if (result.ok) return "The stored login passes every check.";
    return failed > 0 ? `The stored login fails ${failed} ${failed === 1 ? "check" : "checks"}.` : result.reason ?? "The stored login did not pass the checks.";
  }
  const nothing = action === "create" ? "Nothing was created." : "Nothing was saved.";
  if (result.ok) return action === "test" ? "Every check passed. Nothing was saved." : "Saved. Every check passed.";
  if (failed > 0) return action === "test" ? `${failed} ${failed === 1 ? "check" : "checks"} failed. ${nothing}` : `${nothing} ${failed} ${failed === 1 ? "check" : "checks"} failed.`;
  return `${nothing} ${result.reason ?? "The login did not pass the checks."}`;
}

// ============================================
// Connection list pills
// ============================================

export type PillTone = "ok" | "warn" | "bad" | "muted";

export interface Pill {
  label: string;
  tone: PillTone;
}

/** "Who can query" in a few words, from the readiness the list carries; null when there is none to show. */
export function readinessPill(connection: Pick<ClickHouseConnection, "identityMode"> & { readiness?: ConnectionReadiness | null }): Pill | null {
  const readiness = connection.readiness;
  if (!readiness) return null;
  // The login pill already says the connection refuses; repeating it here would say the same thing twice.
  if (readiness.state === "refusing") return null;
  const kind = identityKind(connection.identityMode);
  if (kind === IDENTITY_MODE_SHARED) {
    return readiness.state === "ready" ? { label: "Ready", tone: "ok" } : { label: "No access policy", tone: "warn" };
  }
  if (readiness.state === "ready") return { label: "Ready", tone: "ok" };
  if (readiness.state === "none") return { label: "Nobody can query yet", tone: "warn" };
  if (kind === IDENTITY_MODE_CEILING && readiness.roles) {
    const { mapped, total } = readiness.roles;
    if (mapped === total && readiness.policies === 0) return { label: "No access policy", tone: "warn" };
    return { label: `${mapped} of ${total} roles mapped`, tone: "warn" };
  }
  if (kind === IDENTITY_MODE_PERSONAL && readiness.links) {
    const { active, pending, other } = readiness.links;
    const total = active + pending + other;
    const parts = [`${total} ${total === 1 ? "link" : "links"}`];
    if (pending > 0) parts.push(`${pending} waiting for GRANT`);
    if (other > 0) parts.push(`${other} suspended or disabled`);
    return { label: parts.join(" · "), tone: "warn" };
  }
  return { label: "Some can query", tone: "warn" };
}

/** The health of a role-ceiling or personal login; null for a shared login, which has no identity checks. */
export function loginPill(connection: Pick<ClickHouseConnection, "identityMode" | "identityHealth">): Pill | null {
  const kind = identityKind(connection.identityMode);
  if (kind === IDENTITY_MODE_SHARED) return null;
  if (kind === "unknown") return { label: "Refusing", tone: "bad" };
  if (connection.identityHealth === "ok") return { label: "Passes", tone: "ok" };
  if (connection.identityHealth === "failing") return { label: "Refusing", tone: "bad" };
  return { label: "Not checked", tone: "muted" };
}

/** The count on the Who can query tab: roles mapped, or active links, out of all. */
export function whoCount(connection: Pick<ClickHouseConnection, "identityMode"> & { readiness?: ConnectionReadiness | null }): string | null {
  const readiness = connection.readiness;
  if (!readiness) return null;
  const kind = identityKind(connection.identityMode);
  if (kind === IDENTITY_MODE_CEILING && readiness.roles) return `${readiness.roles.mapped}/${readiness.roles.total}`;
  if (kind === IDENTITY_MODE_PERSONAL && readiness.links) {
    const { active, pending, other } = readiness.links;
    return `${active}/${active + pending + other}`;
  }
  return null;
}
