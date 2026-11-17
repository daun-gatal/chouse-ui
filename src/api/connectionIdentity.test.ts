/**
 * Tests for the connection identity API client: request shaping, envelope
 * unwrapping, and the checks a refused switch carries on its error.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { ApiError } from "./client";
import {
  CLICKHOUSE_ROLE_NAME,
  checkConnectionIdentity,
  checkNewConnectionIdentity,
  createIdentityConnection,
  getConnectionIdentity,
  getMyConnectionIdentities,
  getConnectionRoleMap,
  identityCheckFromError,
  kindSupport,
  identityKind,
  identityKindLabel,
  IDENTITY_MODE_PERSONAL,
  recheckConnectionIdentity,
  setConnectionAccessContact,
  setConnectionRoleMap,
  switchConnectionIdentity,
  type ConnectionIdentity,
  type IdentityChange,
  type IdentityCheckResult,
} from "./connectionIdentity";

const IDENTITY: ConnectionIdentity = {
  identityMode: "shared_ceiling",
  username: "chouse_login",
  systemRole: "chouse_system",
  impersonationRole: null,
  accessContact: "Ask #data-platform",
  health: "ok",
  healthReason: null,
  checkedAt: 1_800_000_000_000,
  serverVersion: "24.8.1.1",
  roleMap: [{ roleId: "r-analyst", roleName: "analyst", clickhouseRole: "ch_analyst" }],
};

const CHANGE: IdentityChange = { identityMode: "shared_ceiling", username: "chouse_login", password: "secret", systemRole: "chouse_system" };

const PASSING: IdentityCheckResult = {
  ok: true,
  reason: null,
  verdict: {
    ok: true,
    reason: null,
    serverVersion: "24.8.1.1",
    checks: [{ id: "version", label: "ClickHouse 24.4 or newer", ok: true, detail: "24.8.1.1" }],
  },
};

const FAILING: IdentityCheckResult = {
  ok: false,
  reason: "chouse_login holds grants of its own.",
  verdict: {
    ok: false,
    reason: "chouse_login holds grants of its own.",
    serverVersion: "24.8.1.1",
    checks: [{ id: "empty_login", label: "The login holds no grants", ok: false, detail: "chouse_login holds grants of its own." }],
  },
};

describe("Connection identity API", () => {
  it("reads a connection's identity with its setup statements", async () => {
    server.use(
      http.get("/api/rbac/connections/:id/identity", ({ params }) =>
        HttpResponse.json({ success: true, data: { ...IDENTITY, username: String(params.id), setupStatements: ["CREATE ROLE chouse_system;"], personalSetupStatements: ["CREATE ROLE IF NOT EXISTS chouse_impersonate;"] } }),
      ),
    );

    const identity = await getConnectionIdentity("conn-1");
    expect(identity.username).toBe("conn-1");
    expect(identity.roleMap).toEqual(IDENTITY.roleMap);
    expect(identity.setupStatements).toEqual(["CREATE ROLE chouse_system;"]);
    expect(identity.personalSetupStatements).toEqual(["CREATE ROLE IF NOT EXISTS chouse_impersonate;"]);
    expect(identity.impersonationRole).toBeNull();
  });

  it("escapes the connection id in the path", async () => {
    let seen = "";
    server.use(
      http.get("/api/rbac/connections/:id/identity", ({ request }) => {
        seen = new URL(request.url).pathname;
        return HttpResponse.json({ success: true, data: { ...IDENTITY, setupStatements: [] } });
      }),
    );

    await getConnectionIdentity("a/b");
    expect(seen).toBe("/api/rbac/connections/a%2Fb/identity");
  });

  it("checks a change without saving and returns the result", async () => {
    let body: unknown;
    server.use(
      http.post("/api/rbac/connections/conn-1/identity/check", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: FAILING });
      }),
    );

    const result = await checkConnectionIdentity("conn-1", CHANGE);
    expect(body).toEqual(CHANGE);
    expect(result).toEqual(FAILING);
  });

  it("sends the impersonation role of a personal login and returns the users it may act as", async () => {
    const change: IdentityChange = { identityMode: "personal", username: "chouse_personal", password: "secret", systemRole: "chouse_system", impersonationRole: "chouse_impersonate" };
    const result: IdentityCheckResult = {
      ok: true,
      reason: null,
      verdict: {
        ok: true,
        reason: null,
        serverVersion: "26.3.63.1",
        impersonationTargets: ["alice_ch"],
        checks: [{ id: "no_nesting", label: "A linked user cannot act as another", ok: true, detail: "Refused." }],
      },
    };
    let body: unknown;
    server.use(
      http.post("/api/rbac/connections/conn-1/identity/check", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: result });
      }),
    );

    expect(await checkConnectionIdentity("conn-1", change)).toEqual(result);
    expect(body).toEqual(change);
  });

  it("switches the identity and returns the stored identity with its check", async () => {
    let body: unknown;
    server.use(
      http.put("/api/rbac/connections/conn-1/identity", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { identity: IDENTITY, check: PASSING } });
      }),
    );

    const result = await switchConnectionIdentity("conn-1", CHANGE);
    expect(body).toEqual(CHANGE);
    expect(result.identity).toEqual(IDENTITY);
    expect(result.check).toEqual(PASSING);
  });

  it("keeps the message and the checks of a refused switch on the error", async () => {
    server.use(
      http.put("/api/rbac/connections/conn-1/identity", () =>
        HttpResponse.json(
          { success: false, error: { code: "IDENTITY_CHECK_FAILED", message: FAILING.reason, details: FAILING } },
          { status: 422 },
        ),
      ),
    );

    const error = await switchConnectionIdentity("conn-1", CHANGE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 422, code: "IDENTITY_CHECK_FAILED", message: "chouse_login holds grants of its own." });
    expect(identityCheckFromError(error)).toEqual(FAILING);
  });

  it("reads the checks off a switch refused because the server cannot run the kind", () => {
    const unsupported = { ...FAILING, unsupported: true, reason: "ClickHouse 24.3.18.7 does not take a ClickHouse role on a request." };
    const error = new ApiError(unsupported.reason, 422, "KIND_UNSUPPORTED_ON_SERVER", "unknown", unsupported);
    expect(identityCheckFromError(error)).toEqual(unsupported);
  });

  it("finds one kind's support, and nothing when the server gave none", () => {
    const support = { serverVersion: "24.3.18.7", kinds: [{ kind: "shared", state: "available" as const, reason: "a" }, { kind: "shared_ceiling", state: "unavailable" as const, reason: "b" }] };
    expect(kindSupport(support, "shared_ceiling")).toEqual({ kind: "shared_ceiling", state: "unavailable", reason: "b" });
    expect(kindSupport(support, "personal")).toBeNull();
    expect(kindSupport(undefined, "shared")).toBeNull();
    expect(kindSupport(null, "shared")).toBeNull();
  });

  it("finds no checks on other errors or malformed details", () => {
    expect(identityCheckFromError(new Error("boom"))).toBeNull();
    expect(identityCheckFromError(new ApiError("x", 403, "FORBIDDEN", "unknown", FAILING))).toBeNull();
    expect(identityCheckFromError(new ApiError("x", 422, "IDENTITY_CHECK_FAILED"))).toBeNull();
    expect(identityCheckFromError(new ApiError("x", 422, "IDENTITY_CHECK_FAILED", "unknown", { ok: false, verdict: null }))).toBeNull();
    expect(identityCheckFromError(new ApiError("x", 422, "IDENTITY_CHECK_FAILED", "unknown", { ok: "no", verdict: { checks: [] } }))).toBeNull();
  });

  it("surfaces a 403 for someone who is not a super admin", async () => {
    server.use(
      http.get("/api/rbac/connections/conn-1/identity", () =>
        HttpResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Only a super admin can change how a connection reaches ClickHouse." } }, { status: 403 }),
      ),
    );

    await expect(getConnectionIdentity("conn-1")).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  it("saves the access contact alone, including clearing it", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put("/api/rbac/connections/conn-1/identity/contact", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ success: true, data: { ...IDENTITY, accessContact: null } });
      }),
    );

    await setConnectionAccessContact("conn-1", "Ask #data-platform");
    const cleared = await setConnectionAccessContact("conn-1", null);
    expect(bodies).toEqual([{ accessContact: "Ask #data-platform" }, { accessContact: null }]);
    expect(cleared.accessContact).toBeNull();
  });

  it("reads and replaces the role map, unwrapping the entries", async () => {
    let body: unknown;
    server.use(
      http.get("/api/rbac/connections/conn-1/identity/role-map", () => HttpResponse.json({ success: true, data: { entries: IDENTITY.roleMap } })),
      http.put("/api/rbac/connections/conn-1/identity/role-map", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { entries: [] } });
      }),
    );

    expect(await getConnectionRoleMap("conn-1")).toEqual(IDENTITY.roleMap);
    expect(await setConnectionRoleMap("conn-1", [{ roleId: "r-analyst", clickhouseRole: "ch_analyst" }])).toEqual([]);
    expect(body).toEqual({ entries: [{ roleId: "r-analyst", clickhouseRole: "ch_analyst" }] });
  });

  it("surfaces the server's message for a role map it refuses", async () => {
    server.use(
      http.put("/api/rbac/connections/conn-1/identity/role-map", () =>
        HttpResponse.json({ success: false, error: { code: "BAD_REQUEST", message: "analyst is listed twice." } }, { status: 400 }),
      ),
    );

    await expect(setConnectionRoleMap("conn-1", [])).rejects.toMatchObject({ statusCode: 400, message: "analyst is listed twice." });
  });

  it("rechecks the stored login, with a null verdict when there is nothing to check", async () => {
    let method = "";
    server.use(
      http.post("/api/rbac/connections/conn-1/identity/recheck", ({ request }) => {
        method = request.method;
        return HttpResponse.json({ success: true, data: { verdict: null, identity: IDENTITY } });
      }),
    );

    const result = await recheckConnectionIdentity("conn-1");
    expect(method).toBe("POST");
    expect(result.verdict).toBeNull();
    expect(result.identity).toEqual(IDENTITY);
  });
});

describe("identityKind", () => {
  it("reads a missing mode as a shared login and any other string as unknown", () => {
    expect(identityKind("shared")).toBe("shared");
    expect(identityKind(undefined)).toBe("shared");
    expect(identityKind(null)).toBe("shared");
    expect(identityKind("shared_ceiling")).toBe("shared_ceiling");
    expect(identityKind("personal")).toBe(IDENTITY_MODE_PERSONAL);
    expect(identityKind("Personal")).toBe("unknown");
    expect(identityKind("per_statement")).toBe("unknown");
    expect(identityKind("")).toBe("unknown");
  });

  it("names each kind in plain words", () => {
    expect(identityKindLabel("shared")).toBe("Shared login");
    expect(identityKindLabel("shared_ceiling")).toBe("Role ceiling");
    expect(identityKindLabel("personal")).toBe("Personal");
    expect(identityKindLabel("per_statement")).toBe("Unknown kind");
  });
});

describe("Creating a connection with its kind", () => {
  const INPUT = {
    name: "finance-ch",
    identityMode: "personal",
    host: "ch-fin.internal",
    port: 8443,
    sslEnabled: true,
    username: "chouse_personal",
    password: "secret",
    database: "finance",
    systemRole: "chouse_system",
    impersonationRole: "chouse_impersonate",
    metadata: { environment: "production" },
  };

  it("creates the connection and returns it with its check", async () => {
    let body: unknown;
    server.use(
      http.post("/api/rbac/connections/identity", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { connection: { id: "conn-9", name: "finance-ch" }, check: PASSING } }, { status: 201 });
      }),
    );

    const created = await createIdentityConnection(INPUT);
    expect(body).toEqual(INPUT);
    expect(created.connection).toMatchObject({ id: "conn-9" });
    expect(created.check).toEqual(PASSING);
  });

  it("keeps the checks of a refused create on the error", async () => {
    server.use(
      http.post("/api/rbac/connections/identity", () =>
        HttpResponse.json({ success: false, error: { code: "IDENTITY_CHECK_FAILED", message: FAILING.reason, details: FAILING } }, { status: 422 }),
      ),
    );

    const error = await createIdentityConnection(INPUT).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 422, code: "IDENTITY_CHECK_FAILED" });
    expect(identityCheckFromError(error)).toEqual(FAILING);
  });

  it("says when the same login and kind is already a connection", async () => {
    server.use(
      http.post("/api/rbac/connections/identity", () =>
        HttpResponse.json({ success: false, error: { code: "CONNECTION_EXISTS", message: "Connection \"fin\" already uses this host, port, user and kind." } }, { status: 409 }),
      ),
    );

    const error = await createIdentityConnection(INPUT).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 409, code: "CONNECTION_EXISTS" });
    expect(identityCheckFromError(error)).toBeNull();
  });

  it("checks a login for a connection not created yet, saving nothing", async () => {
    let body: unknown;
    server.use(
      http.post("/api/rbac/connections/identity/check", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: FAILING });
      }),
    );

    const change = { ...CHANGE, host: "h", port: 8123, sslEnabled: false, database: "" };
    expect(await checkNewConnectionIdentity(change)).toEqual(FAILING);
    expect(body).toEqual(change);
  });

  it("reads the signed-in person's identity on each connection", async () => {
    const identities = [{ connectionId: "conn-1", connectionName: "Production", kind: "shared_ceiling", runsAs: null, state: "no_usable_role", detail: "Not mapped.", limits: [] }];
    server.use(http.get("/api/rbac/connections/identity/mine", () => HttpResponse.json({ success: true, data: { identities } })));

    expect(await getMyConnectionIdentities()).toEqual(identities);
  });
});

describe("CLICKHOUSE_ROLE_NAME", () => {
  it("accepts letters, digits and underscores, not starting with a digit, up to 128 characters", () => {
    expect(CLICKHOUSE_ROLE_NAME.test("ch_analyst")).toBe(true);
    expect(CLICKHOUSE_ROLE_NAME.test("_r2")).toBe(true);
    expect(CLICKHOUSE_ROLE_NAME.test("a".repeat(128))).toBe(true);
    expect(CLICKHOUSE_ROLE_NAME.test("a".repeat(129))).toBe(false);
    expect(CLICKHOUSE_ROLE_NAME.test("2fast")).toBe(false);
    expect(CLICKHOUSE_ROLE_NAME.test("ch-analyst")).toBe(false);
    expect(CLICKHOUSE_ROLE_NAME.test("ch analyst")).toBe(false);
    expect(CLICKHOUSE_ROLE_NAME.test("")).toBe(false);
  });
});
