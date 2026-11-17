import { describe, expect, it } from "vitest";

import type { IdentityCheck } from "@/api/connectionIdentity";
import type { ClickHouseConnection } from "@/api/rbac";
import {
  connectionEnvironment,
  createSharedInput,
  footerWarning,
  generalDraftFrom,
  generalPatch,
  groupChecks,
  identityChangeFrom,
  isGeneralDirty,
  isLoginDirty,
  kindHint,
  kindLock,
  loginDraftFrom,
  loginPatch,
  loginPill,
  loginProblem,
  loginRoute,
  metadataWithEnvironment,
  nameProblem,
  onlyContactChanged,
  peopleNote,
  readinessPill,
  resultHeadline,
  setupScript,
  sharedTestInput,
  storedLoginOf,
  storedPasswordMayGo,
  whoCount,
  type LoginDraft,
  type StoredLogin,
} from "./loginForm";

function connection(overrides: Partial<ClickHouseConnection> = {}): ClickHouseConnection {
  return {
    id: "conn-1",
    name: "Staging",
    host: "ch.internal",
    port: 8443,
    username: "chouse_svc",
    database: "analytics",
    isDefault: false,
    isActive: true,
    sslEnabled: true,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    metadata: { environment: "staging", team: "data" },
    identityMode: "shared",
    systemRole: null,
    impersonationRole: null,
    accessContact: null,
    identityHealth: null,
    identityHealthReason: null,
    identityCheckedAt: null,
    identityServerVersion: null,
    ...overrides,
  };
}

const SHARED: StoredLogin = storedLoginOf(connection());
const CEILING: StoredLogin = storedLoginOf(connection({ identityMode: "shared_ceiling", username: "chouse_ceiling", systemRole: "chouse_system", accessContact: "#data" }));
const PERSONAL: StoredLogin = storedLoginOf(connection({ identityMode: "personal", username: "chouse_personal", systemRole: "chouse_system", impersonationRole: "chouse_act" }));

function draftOf(stored: StoredLogin | null, patch: Partial<LoginDraft> = {}): LoginDraft {
  return { ...loginDraftFrom(stored), ...patch };
}

describe("General tab rules", () => {
  it("reads the environment and keeps every other metadata key when changing it", () => {
    expect(connectionEnvironment(connection())).toBe("staging");
    expect(connectionEnvironment(connection({ metadata: { environment: "moon" } }))).toBe("unset");
    expect(connectionEnvironment(null)).toBe("unset");
    expect(metadataWithEnvironment({ environment: "staging", team: "data" }, "unset")).toEqual({ team: "data" });
    expect(metadataWithEnvironment(null, "production")).toEqual({ environment: "production" });
  });

  it("starts a new connection active and not the default", () => {
    expect(generalDraftFrom(null)).toEqual({ name: "", environment: "unset", isActive: true, isDefault: false });
  });

  it("sends no login field, and the toggles only when they change", () => {
    const stored = connection();
    const draft = { ...generalDraftFrom(stored), name: "  Staging EU  " };
    expect(isGeneralDirty(draft, generalDraftFrom(stored))).toBe(true);
    expect(generalPatch(draft, stored)).toEqual({ name: "Staging EU", metadata: { environment: "staging", team: "data" } });
    expect(generalPatch({ ...draft, isDefault: true, isActive: false }, stored)).toEqual({
      name: "Staging EU",
      metadata: { environment: "staging", team: "data" },
      isActive: false,
      isDefault: true,
    });
  });

  it("asks for a name", () => {
    expect(nameProblem("  ")).toBe("Enter a name for the connection.");
    expect(nameProblem("x".repeat(256))).toBe("The name is at most 255 characters.");
    expect(nameProblem("Prod")).toBeNull();
  });
});

describe("loginRoute", () => {
  it("creates a shared login through the connection routes and any other kind through the identity routes", () => {
    expect(loginRoute(null, "shared")).toBe("create_shared");
    expect(loginRoute(null, "shared_ceiling")).toBe("create_identity");
    expect(loginRoute(null, "personal")).toBe("create_identity");
  });

  it("patches a shared login that stays shared, and switches everything else", () => {
    expect(loginRoute(SHARED, "shared")).toBe("patch");
    expect(loginRoute(SHARED, "shared_ceiling")).toBe("switch");
    expect(loginRoute(CEILING, "shared_ceiling")).toBe("switch");
    expect(loginRoute(PERSONAL, "shared")).toBe("switch");
    expect(loginRoute({ ...SHARED, kind: "unknown" }, "shared")).toBe("switch");
  });
});

describe("loginDraftFrom", () => {
  it("fills a new form with the default port and role names", () => {
    expect(loginDraftFrom(null)).toEqual({
      kind: "shared",
      host: "",
      port: "8123",
      sslEnabled: false,
      username: "",
      password: "",
      database: "",
      systemRole: "chouse_system",
      impersonationRole: "chouse_impersonate",
      accessContact: "",
    });
  });

  it("starts a kind this build does not know on a shared login", () => {
    expect(loginDraftFrom({ ...CEILING, kind: "unknown" }).kind).toBe("shared");
  });

  it("is dirty once anything is typed, the password included", () => {
    const baseline = loginDraftFrom(CEILING);
    expect(isLoginDirty({ ...baseline }, baseline)).toBe(false);
    expect(isLoginDirty({ ...baseline, password: "x" }, baseline)).toBe(true);
    expect(isLoginDirty({ ...baseline, kind: "personal" }, baseline)).toBe(true);
  });

  it("knows when only the access contact changed", () => {
    const baseline = loginDraftFrom(CEILING);
    expect(onlyContactChanged({ ...baseline, accessContact: "#other" }, baseline)).toBe(true);
    expect(onlyContactChanged({ ...baseline, accessContact: "#other", password: "x" }, baseline)).toBe(false);
    expect(onlyContactChanged({ ...baseline, accessContact: " #data " }, baseline)).toBe(false);
  });
});

describe("kindLock", () => {
  const support = { serverVersion: "25.8.4", kinds: [{ kind: "personal", state: "unavailable" as const, reason: "ClickHouse 25.8.4 fails the self-test." }] };

  it("lets an admin choose only a shared login", () => {
    expect(kindLock("shared", { superAdmin: false, storedKind: null })).toBeNull();
    expect(kindLock("shared_ceiling", { superAdmin: false, storedKind: null })).toBe("Only a super admin can choose this.");
    expect(kindLock("personal", { superAdmin: false, storedKind: "shared" })).toBe("Only a super admin can choose this.");
  });

  it("locks a kind the server cannot run, with the server's reason, but never the stored kind", () => {
    expect(kindLock("personal", { superAdmin: true, storedKind: "shared", support })).toBe("Not available: ClickHouse 25.8.4 fails the self-test.");
    expect(kindLock("personal", { superAdmin: true, storedKind: "personal", support })).toBeNull();
    expect(kindLock("shared_ceiling", { superAdmin: true, storedKind: "shared", support })).toBeNull();
  });
});

describe("loginProblem", () => {
  it("asks for the host, a valid port and the user", () => {
    expect(loginProblem(draftOf(null), null)).toBe("Enter the host.");
    expect(loginProblem(draftOf(null, { host: "h", port: "" }), null)).toBe("Enter a port between 1 and 65535.");
    expect(loginProblem(draftOf(null, { host: "h", port: "70000" }), null)).toBe("Enter a port between 1 and 65535.");
    expect(loginProblem(draftOf(null, { host: "h", port: "1.5" }), null)).toBe("Enter a port between 1 and 65535.");
    expect(loginProblem(draftOf(null, { host: "h" }), null)).toBe("Enter the ClickHouse user.");
    expect(loginProblem(draftOf(null, { host: "h", username: "u", password: "x".repeat(1001) }), null)).toBe("The password is at most 1000 characters.");
  });

  it("lets a shared login be created without a password, but not a login with no grants of its own", () => {
    expect(loginProblem(draftOf(null, { host: "h", username: "u" }), null)).toBeNull();
    expect(loginProblem(draftOf(null, { kind: "shared_ceiling", host: "h", username: "u" }), null)).toBe("Enter the password of the ClickHouse user.");
    expect(loginProblem(draftOf(null, { kind: "shared_ceiling", host: "h", username: "u", password: "p" }), null)).toBeNull();
  });

  it("keeps the stored password only for the same user on the same server, TLS not turned off", () => {
    expect(loginProblem(draftOf(CEILING), CEILING)).toBeNull();
    expect(loginProblem(draftOf(CEILING, { username: "other" }), CEILING)).toBe("Enter the password of the new ClickHouse user.");
    expect(loginProblem(draftOf(CEILING, { host: "elsewhere" }), CEILING)).toBe("Enter the password again when the host or port changes, or when TLS is turned off.");
    expect(loginProblem(draftOf(CEILING, { sslEnabled: false }), CEILING)).toBe("Enter the password again when the host or port changes, or when TLS is turned off.");
    expect(loginProblem(draftOf(SHARED, { kind: "shared_ceiling", username: "chouse_ceiling" }), SHARED)).toBe("Enter the password of the new ClickHouse user.");
  });

  it("leaves the stored-password rule of a shared login to the server, which knows whether one is stored", () => {
    expect(loginProblem(draftOf(SHARED, { host: "elsewhere" }), SHARED)).toBeNull();
  });

  it("checks the role names of the kind", () => {
    expect(loginProblem(draftOf(CEILING, { systemRole: "" }), CEILING)).toBe("Enter the system role.");
    expect(loginProblem(draftOf(CEILING, { systemRole: "1bad" }), CEILING)).toMatch(/^For the system role/);
    expect(loginProblem(draftOf(PERSONAL, { impersonationRole: "" }), PERSONAL)).toBe("Enter the impersonation role.");
    expect(loginProblem(draftOf(PERSONAL, { impersonationRole: "chouse_system" }), PERSONAL)).toBe("The impersonation role and the system role must be two roles.");
    expect(loginProblem(draftOf(CEILING, { accessContact: "x".repeat(501) }), CEILING)).toBe("The access contact is at most 500 characters.");
  });

  it("agrees with the server on where a stored password may go", () => {
    expect(storedPasswordMayGo(SHARED, { host: "ch.internal", port: 8443, sslEnabled: true })).toBe(true);
    expect(storedPasswordMayGo({ ...SHARED, sslEnabled: false }, { host: "ch.internal", port: 8443, sslEnabled: true })).toBe(true);
    expect(storedPasswordMayGo(SHARED, { host: "ch.internal", port: 8443, sslEnabled: false })).toBe(false);
    expect(storedPasswordMayGo(SHARED, { host: "ch.internal", port: 9000, sslEnabled: true })).toBe(false);
  });
});

describe("request bodies", () => {
  it("sends a role-ceiling login with its system role and contact, the database always, the password only when typed", () => {
    expect(identityChangeFrom(draftOf(CEILING, { database: " " }))).toEqual({
      identityMode: "shared_ceiling",
      host: "ch.internal",
      port: 8443,
      sslEnabled: true,
      username: "chouse_ceiling",
      database: "",
      systemRole: "chouse_system",
      accessContact: "#data",
    });
    expect(identityChangeFrom(draftOf(PERSONAL, { password: "pw" }))).toMatchObject({ identityMode: "personal", password: "pw", impersonationRole: "chouse_act" });
  });

  it("sends a switch back to a shared login without role names or contact", () => {
    const change = identityChangeFrom(draftOf(PERSONAL, { kind: "shared", username: "chouse_svc", password: "pw" }));
    expect(change).toMatchObject({ identityMode: "shared", systemRole: null, username: "chouse_svc" });
    expect(change).not.toHaveProperty("impersonationRole");
    expect(change).not.toHaveProperty("accessContact");
  });

  it("patches only the login fields of a shared login that changed", () => {
    expect(loginPatch(draftOf(SHARED), SHARED)).toEqual({});
    expect(loginPatch(draftOf(SHARED, { port: "9440", password: "pw", database: "" }), SHARED)).toEqual({ port: 9440, password: "pw", database: null });
    expect(loginPatch(draftOf(SHARED, { host: " h2 ", username: "u2", sslEnabled: false }), SHARED)).toEqual({ host: "h2", username: "u2", sslEnabled: false });
  });

  it("creates a shared login with its name and environment", () => {
    const draft = draftOf(null, { host: "h", username: "u", database: "db" });
    expect(createSharedInput(draft, { name: " New ", environment: "production", isActive: true, isDefault: false })).toEqual({
      name: "New",
      host: "h",
      port: 8123,
      username: "u",
      database: "db",
      sslEnabled: false,
      metadata: { environment: "production" },
    });
  });

  it("tests a shared login with the stored password when editing", () => {
    expect(sharedTestInput(draftOf(SHARED), "conn-1")).toEqual({ host: "ch.internal", port: 8443, username: "chouse_svc", database: "analytics", sslEnabled: true, connectionId: "conn-1" });
    expect(sharedTestInput(draftOf(null, { host: "h", username: "u", password: "p" }), null)).toEqual({ host: "h", port: 8123, username: "u", password: "p", sslEnabled: false });
  });
});

describe("kindHint", () => {
  it("says nothing while the kind stays, or when a shared login is created", () => {
    expect(kindHint(SHARED, "shared")).toBeNull();
    expect(kindHint(CEILING, "shared_ceiling")).toBeNull();
    expect(kindHint(null, "shared")).toBeNull();
  });

  it("says what a role ceiling or personal login needs at create", () => {
    expect(kindHint(null, "shared_ceiling")).toEqual({
      title: "Role ceiling needs a ClickHouse user with no grants of its own",
      body: "Its access comes only from roles that CHouse names on each request.",
      userWithGrants: null,
      script: true,
    });
    expect(kindHint(null, "personal")?.title).toBe("Personal needs a ClickHouse user with no grants of its own");
    expect(kindHint(null, "personal")?.body).toMatch(/CHouse data access policies don't apply/);
  });

  it("names the shared login's user, which has grants, and offers the choice", () => {
    const hint = kindHint(SHARED, "personal");
    expect(hint?.userWithGrants).toBe("chouse_svc");
    expect(hint?.body).toBe("chouse_svc has its own grants, so it can't be used as it is. Either:");
  });

  it("asks for a user with full privileges on the way back to a shared login", () => {
    expect(kindHint(PERSONAL, "shared")).toEqual({
      title: "Shared login needs a ClickHouse user with full privileges",
      body: "chouse_personal has no grants of its own, so it can't be used. Enter a user that holds every privilege CHouse needs. Test lists any that are missing, with the GRANT lines to copy.",
      userWithGrants: null,
      script: false,
    });
  });

  it("offers no choice between two kinds whose users are both empty", () => {
    expect(kindHint(CEILING, "personal")?.userWithGrants).toBeNull();
  });
});

describe("peopleNote", () => {
  it("says nothing unless the kind changes to personal or back to a shared login", () => {
    expect(peopleNote(null, "personal", { policies: 0, links: null })).toBeNull();
    expect(peopleNote(SHARED, "shared", { policies: 0, links: null })).toBeNull();
    expect(peopleNote(SHARED, "shared_ceiling", { policies: 0, links: null })).toBeNull();
  });

  it("counts the links on a switch to personal", () => {
    expect(peopleNote(SHARED, "personal", { policies: 2, links: { total: 0, active: 0 } })).toEqual([
      "Each statement runs as the person's own ClickHouse user. CHouse data access policies stop applying.",
      "Only linked people can query. 0 people are linked, so everyone loses access until you add links in Who can query.",
      "Scheduled queries and alerts run as their owner's linked user. Owners who aren't linked see their runs refused.",
    ]);
    expect(peopleNote(CEILING, "personal", { policies: 2, links: { total: 3, active: 1 } })?.slice(0, 2)).toEqual([
      "Each statement runs as the person's own ClickHouse user. The role map stops applying.",
      "Only linked people can query. 3 people are linked, 1 active; everyone else loses access.",
    ]);
  });

  it("counts the policies and the kept links on the way back to a shared login", () => {
    expect(peopleNote(PERSONAL, "shared", { policies: 0, links: { total: 3, active: 3 } })).toEqual([
      "Everyone runs as the one user below, not as their own ClickHouse user.",
      "CHouse data access policies decide what each person sees. This connection has none, so people other than admins see no tables until you add some.",
      "The 3 person links are kept, unused, in case you switch back.",
    ]);
    expect(peopleNote(CEILING, "shared", { policies: 1, links: null })).toEqual([
      "Everyone runs as the one user below, without a ClickHouse role per person.",
      "CHouse data access policies decide what each person sees. 1 applies to this connection.",
      "The role map is kept, unused, in case you switch back.",
    ]);
  });
});

describe("footerWarning", () => {
  it("says the old user keeps working when a new user is entered", () => {
    expect(footerWarning(SHARED, draftOf(SHARED, { kind: "shared_ceiling", username: "chouse_ceiling" }))).toBe("New user entered: chouse_svc keeps working until you save.");
    expect(footerWarning(CEILING, draftOf(CEILING, { username: "chouse_ceiling2" }))).toBe("New user entered: chouse_ceiling keeps working until you save.");
  });

  it("says queries fail when the kind changes on the same user", () => {
    expect(footerWarning(SHARED, draftOf(SHARED, { kind: "shared_ceiling" }))).toBe("Queries on this connection fail until you save.");
  });

  it("says nothing otherwise", () => {
    expect(footerWarning(CEILING, draftOf(CEILING, { password: "new" }))).toBeNull();
    expect(footerWarning(null, draftOf(null, { kind: "personal", username: "u" }))).toBeNull();
  });
});

describe("setupScript", () => {
  const base = { username: "chouse_ceiling", currentUser: "chouse_svc", systemRole: "chouse_system", impersonationRole: "chouse_impersonate", mappedRoles: ["analyst_ro", "chouse_system", "analyst_ro"] } as const;

  it("builds the role-ceiling script from the form's names, without the password", () => {
    expect(setupScript({ ...base, kind: "shared_ceiling", variant: "new_user" })).toEqual([
      "CREATE ROLE IF NOT EXISTS chouse_system;",
      "GRANT SELECT ON system.* TO chouse_system;",
      "GRANT SHOW ON *.* TO chouse_system;",
      "GRANT KILL QUERY ON *.* TO chouse_system;",
      "CREATE ROLE IF NOT EXISTS analyst_ro;",
      "-- GRANT SELECT ON <database>.* TO analyst_ro;   -- the data this CHouse role may reach",
      "-- GRANT SELECT ON system.* TO analyst_ro;       -- optional: lets its people use the Monitoring pages",
      "CREATE USER IF NOT EXISTS chouse_ceiling IDENTIFIED BY '<password>';",
      "GRANT chouse_system, analyst_ro TO chouse_ceiling;",
      "ALTER USER chouse_ceiling DEFAULT ROLE NONE;",
    ]);
  });

  it("empties the current user instead of creating one", () => {
    const script = setupScript({ ...base, kind: "shared_ceiling", variant: "empty_current" });
    expect(script).toContain("REVOKE ALL ON *.* FROM chouse_svc;");
    expect(script).toContain("GRANT chouse_system, analyst_ro TO chouse_svc;");
    expect(script).toContain("ALTER USER chouse_svc DEFAULT ROLE NONE;");
    expect(script.some((line) => line.startsWith("CREATE USER"))).toBe(false);
  });

  it("builds the personal script and stands in a placeholder for an empty user", () => {
    const script = setupScript({ ...base, kind: "personal", username: " ", variant: "new_user" });
    expect(script).toContain("CREATE ROLE IF NOT EXISTS chouse_impersonate;");
    expect(script).toContain("CREATE USER IF NOT EXISTS <new_user> IDENTIFIED BY '<password>';");
    expect(script).toContain("GRANT chouse_system, chouse_impersonate TO <new_user>;");
    expect(script.join("\n")).not.toMatch(/analyst_ro/);
  });

  it("creates the user when there is no current one to empty", () => {
    expect(setupScript({ ...base, currentUser: null, kind: "shared_ceiling", variant: "empty_current" })).toContain("CREATE USER IF NOT EXISTS chouse_ceiling IDENTIFIED BY '<password>';");
  });
});

describe("check results", () => {
  const checks: IdentityCheck[] = [
    { id: "version", label: "The login can connect", ok: true, detail: "ClickHouse 26.3.63." },
    { id: "empty_login", label: "The login holds no grant of its own", ok: false, detail: "chouse_ceiling holds a direct grant (SELECT ON default.*). Revoke it and grant it to a role instead." },
    { id: "system_role", label: "The system role can read system tables", ok: false, detail: "The role chouse_system is not granted to chouse_ceiling. Run: GRANT chouse_system TO chouse_ceiling" },
    { id: "login_reuse", label: "No connection of another kind uses the same login", ok: false, detail: "Connection \"prod-old\" (shared) uses the same host, port and user." },
    { id: "bare_reads", label: "A request that names no role reads no data", ok: true, detail: "Refused, as it should be." },
  ];

  it("groups failures by who fixes them, with statements for the administrator", () => {
    const grouped = groupChecks({ verdict: { ok: false, reason: null, checks, serverVersion: null } }, "chouse_ceiling");
    expect(grouped.forAdmin.map((fix) => [fix.check.id, fix.statements])).toEqual([
      ["empty_login", ["REVOKE ALL ON *.* FROM chouse_ceiling;", "ALTER USER chouse_ceiling DEFAULT ROLE NONE;"]],
      ["system_role", ["GRANT chouse_system TO chouse_ceiling;"]],
    ]);
    expect(grouped.forYou.map((check) => check.id)).toEqual(["login_reuse"]);
    expect(grouped.passed.map((check) => check.id)).toEqual(["version", "bare_reads"]);
  });

  it("puts a failed connect with the person, and a server that cannot run the kind with the administrator", () => {
    const failed: IdentityCheck = { id: "version", label: "The login can connect", ok: false, detail: "Could not connect." };
    expect(groupChecks({ verdict: { ok: false, reason: null, checks: [failed], serverVersion: null } }, "u").forYou).toHaveLength(1);
    expect(groupChecks({ verdict: { ok: false, reason: null, checks: [failed], serverVersion: null }, unsupported: true }, "u").forAdmin).toHaveLength(1);
  });

  it("heads a result with what happened", () => {
    const failing = { ok: false, reason: "x", verdict: { ok: false, reason: "x", checks, serverVersion: null } };
    expect(resultHeadline(failing, "create")).toBe("Nothing was created. 3 checks failed.");
    expect(resultHeadline(failing, "test")).toBe("3 checks failed. Nothing was saved.");
    expect(resultHeadline(failing, "recheck")).toBe("The stored login fails 3 checks.");
    expect(resultHeadline({ ok: false, reason: "chouse is missing 2 privileges.", verdict: { ok: true, reason: null, checks: [], serverVersion: null } }, "save")).toBe("Nothing was saved. chouse is missing 2 privileges.");
    expect(resultHeadline({ ok: true, reason: null, verdict: { ok: true, reason: null, checks: [], serverVersion: null } }, "test")).toBe("Every check passed. Nothing was saved.");
  });
});

describe("list pills", () => {
  it("says who can query a shared login from its policies", () => {
    expect(readinessPill(connection({ readiness: { state: "ready", policies: 3 } }))).toEqual({ label: "Ready", tone: "ok" });
    expect(readinessPill(connection({ readiness: { state: "none", policies: 0 } }))).toEqual({ label: "No access policy", tone: "warn" });
    expect(readinessPill(connection({ readiness: null }))).toBeNull();
  });

  it("counts mapped roles and links", () => {
    expect(readinessPill(connection({ identityMode: "shared_ceiling", readiness: { state: "partial", policies: 1, roles: { total: 4, mapped: 2, peopleRefused: 37 } } }))).toEqual({ label: "2 of 4 roles mapped", tone: "warn" });
    expect(readinessPill(connection({ identityMode: "shared_ceiling", readiness: { state: "partial", policies: 0, roles: { total: 4, mapped: 4, peopleRefused: 0 } } }))).toEqual({ label: "No access policy", tone: "warn" });
    expect(readinessPill(connection({ identityMode: "personal", readiness: { state: "partial", policies: 0, links: { active: 2, pending: 1, other: 0 } } }))).toEqual({ label: "3 links · 1 waiting for GRANT", tone: "warn" });
    expect(readinessPill(connection({ identityMode: "personal", readiness: { state: "none", policies: 0, links: { active: 0, pending: 0, other: 0 } } }))).toEqual({ label: "Nobody can query yet", tone: "warn" });
  });

  it("leaves a refusing connection to the login pill", () => {
    expect(readinessPill(connection({ identityMode: "shared_ceiling", readiness: { state: "refusing", policies: 0 } }))).toBeNull();
  });

  it("shows the login's health on every kind but a shared login", () => {
    expect(loginPill(connection())).toBeNull();
    expect(loginPill(connection({ identityMode: "shared_ceiling", identityHealth: "ok" }))).toEqual({ label: "Passes", tone: "ok" });
    expect(loginPill(connection({ identityMode: "personal", identityHealth: "failing" }))).toEqual({ label: "Refusing", tone: "bad" });
    expect(loginPill(connection({ identityMode: "personal", identityHealth: null }))).toEqual({ label: "Not checked", tone: "muted" });
    expect(loginPill(connection({ identityMode: "per_statement" }))).toEqual({ label: "Refusing", tone: "bad" });
  });

  it("counts the Who can query tab", () => {
    expect(whoCount(connection({ identityMode: "shared_ceiling", readiness: { state: "partial", policies: 1, roles: { total: 4, mapped: 2, peopleRefused: 3 } } }))).toBe("2/4");
    expect(whoCount(connection({ identityMode: "personal", readiness: { state: "none", policies: 0, links: { active: 0, pending: 3, other: 0 } } }))).toBe("0/3");
    expect(whoCount(connection({ readiness: { state: "ready", policies: 1 } }))).toBeNull();
  });
});
