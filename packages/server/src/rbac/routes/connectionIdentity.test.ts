import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

import { AppError } from "../../types";

const CONNECTION = { id: "c1", name: "prod", username: "svc", identityMode: "shared", systemRole: null, accessContact: null, identityHealth: null, identityHealthReason: null, identityCheckedAt: null, identityServerVersion: null };
const IDENTITY = { identityMode: "shared", username: "svc", systemRole: null, accessContact: null, health: null, healthReason: null, checkedAt: null, serverVersion: null, roleMap: [] };
const PASS = { ok: true, reason: null, verdict: { ok: true, reason: null, checks: [], serverVersion: "26.5.7.64" } };
const FAIL = { ok: false, reason: "svc holds a direct grant", verdict: { ok: false, reason: "svc holds a direct grant", checks: [{ id: "empty_login", label: "x", ok: false, detail: "svc holds a direct grant" }], serverVersion: "26.5.7.64" } };

const mockGetConnectionById = mock(async (_id: string) => CONNECTION as typeof CONNECTION | null);
const mockSwitch = mock(async () => PASS as typeof PASS | typeof FAIL);
const mockCheck = mock(async () => ({ result: PASS, resolved: {} }));
const mockSetRoleMap = mock(async () => [{ roleId: "r1", roleName: "analyst", clickhouseRole: "analyst_ro" }]);
const mockGetRoleMap = mock(async () => [] as Array<{ roleId: string; roleName: string; clickhouseRole: string }>);
const mockSetContact = mock(async () => undefined);
const mockRecheck = mock(async () => PASS.verdict);
const mockAudit = mock(async () => undefined);

mock.module("../services/connections", () => ({ getConnectionById: mockGetConnectionById }));
const SUPPORT = {
  serverVersion: "24.3.18.7",
  kinds: [
    { kind: "shared", state: "available", reason: "Works on every ClickHouse version CHouse UI supports." },
    { kind: "shared_ceiling", state: "unavailable", reason: "ClickHouse 24.3.18.7 does not take a ClickHouse role on a request. The role ceiling needs ClickHouse 24.4 or newer." },
    { kind: "personal", state: "unavailable", reason: "no EXECUTE AS" },
  ],
};
const MINE = [{ connectionId: "c1", connectionName: "prod", kind: "personal", runsAs: { type: "user", name: "alice" }, state: "ready", detail: null, limits: ["x"] }];
const mockCallerIdentities = mock(async (_userId: string, _superAdmin: boolean) => MINE);
const mockCreate = mock(async (): Promise<{ result: unknown; connection: unknown }> => ({ result: { ok: true, verdict: { ok: true, reason: null, checks: [], serverVersion: "26.5.7.64" }, reason: null }, connection: { id: "new-1", name: "created" } }));
mock.module("../services/connectionIdentity", () => ({
  ceilingSetupStatements: () => ["CREATE ROLE IF NOT EXISTS chouse_system;"],
  personalSetupStatements: () => ["CREATE ROLE IF NOT EXISTS chouse_impersonate;"],
  connectionKindSupport: async () => SUPPORT,
  callerIdentities: mockCallerIdentities,
  checkIdentityChange: mockCheck,
  createConnectionWithIdentity: mockCreate,
  getIdentity: async () => IDENTITY,
  getRoleMap: mockGetRoleMap,
  setAccessContact: mockSetContact,
  setRoleMap: mockSetRoleMap,
  switchIdentity: mockSwitch,
}));
mock.module("../../services/chExecutor/health", () => ({ checkSavedConnection: mockRecheck }));
mock.module("../services/rbac", () => ({ createAuditLogWithContext: mockAudit }));

/** The one audit entry written for a refused attempt: status failure, and never a password. */
function expectRefusalAudit(action: string): Record<string, unknown> {
  expect(mockAudit).toHaveBeenCalledTimes(1);
  const [, written, , entry] = mockAudit.mock.calls[0] as unknown as [unknown, string, string, { details: Record<string, unknown>; status: string }];
  expect(written).toBe(action);
  expect(entry.status).toBe("failure");
  expect(JSON.stringify(entry)).not.toContain("pw");
  return entry.details;
}

let roles = ["super_admin"];
/** True for a request made with a token that names a scope. */
let scopedToken = false;
/** True for a request made with a personal access token or an agent's grant. */
let withToken = false;
mock.module("../middleware", () => ({
  requireJwtSession: () => {
    if (withToken) throw new AppError("This action requires a browser session and cannot be performed with a personal access token", "FORBIDDEN", "permission", 403);
  },
  refuseScopedToken: () => {
    if (scopedToken) throw new AppError("This action is not within this token's scope. Use a browser session, or a token without a scope.", "FORBIDDEN", "permission", 403);
  },
  rbacAuthMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
  getRbacUser: () => ({ sub: "u1", roles }),
  getClientIp: () => "127.0.0.1",
}));

const { default: routes } = await import("./connectionIdentity");
const app = new Hono();
app.route("/connections", routes);
app.onError((error, c) => (error instanceof AppError ? c.json({ success: false, error: { code: error.code, message: error.message } }, error.statusCode as 400) : c.json({ success: false, error: { message: String(error) } }, 500)));

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const CHANGE = { identityMode: "shared_ceiling", username: "svc_ceiling", password: "pw", systemRole: "chouse_system" };
const CREATE = { ...CHANGE, name: "prod", host: "ch.internal", port: 8443, sslEnabled: true, database: "analytics" };

describe("connection identity routes (ADR 0033 §5, §6)", () => {
  beforeEach(() => {
    roles = ["super_admin"];
    for (const m of [mockSwitch, mockCheck, mockSetRoleMap, mockGetRoleMap, mockSetContact, mockRecheck, mockAudit, mockCreate]) m.mockClear();
    mockCreate.mockImplementation(async () => ({ result: PASS, connection: { id: "new-1", name: "created" } }));
    mockGetConnectionById.mockImplementation(async () => CONNECTION);
    mockSwitch.mockImplementation(async () => PASS);
  });

  it("refuses a super admin's token that names a scope, on every route: a role cannot hold it to that scope", async () => {
    scopedToken = true;
    try {
      for (const [method, path, body] of [
        ["GET", "/connections/c1/identity", undefined],
        ["POST", "/connections/c1/identity/check", CHANGE],
        ["PUT", "/connections/c1/identity", CHANGE],
        ["PUT", "/connections/c1/identity/contact", { accessContact: "x" }],
        ["GET", "/connections/c1/identity/role-map", undefined],
        ["PUT", "/connections/c1/identity/role-map", { entries: [] }],
        ["POST", "/connections/c1/identity/recheck", undefined],
        ["POST", "/connections/identity", CREATE],
        ["POST", "/connections/identity/check", CHANGE],
      ] as const) {
        const res = await app.request(path, json(method, body));
        expect({ method, path, status: res.status }).toEqual({ method, path, status: 403 });
      }
    } finally {
      scopedToken = false;
    }
    for (const m of [mockSwitch, mockCheck, mockSetRoleMap, mockSetContact, mockRecheck, mockAudit, mockCreate]) expect(m).not.toHaveBeenCalled();
  });

  it("tells anyone signed in what their own statements run as, and passes whether they are a super admin", async () => {
    for (const who of [["analyst"], ["admin"], ["super_admin"]]) {
      roles = who;
      mockCallerIdentities.mockClear();
      const res = await app.request("/connections/identity/mine");
      expect(res.status).toBe(200);
      expect((await res.json()).data.identities).toEqual(MINE);
      expect(mockCallerIdentities).toHaveBeenCalledWith("u1", who.includes("super_admin"));
    }
    // It is not read as the identity of a connection named "identity".
    expect(mockGetConnectionById).not.toHaveBeenCalledWith("identity");
  });

  it("switching the kind and writing the role map need a browser session; a token may read, check and re-check", async () => {
    withToken = true;
    try {
      expect((await app.request("/connections/c1/identity", json("PUT", CHANGE))).status).toBe(403);
      expect((await app.request("/connections/c1/identity/role-map", json("PUT", { entries: [] }))).status).toBe(403);
      expect(mockSwitch).not.toHaveBeenCalled();
      expect(mockSetRoleMap).not.toHaveBeenCalled();
      for (const [method, path, body] of [["GET", "/connections/c1/identity", undefined], ["POST", "/connections/c1/identity/check", CHANGE], ["GET", "/connections/c1/identity/role-map", undefined], ["POST", "/connections/c1/identity/recheck", undefined]] as const) {
        expect({ path, status: (await app.request(path, json(method, body))).status }).toEqual({ path, status: 200 });
      }
    } finally {
      withToken = false;
    }
  });

  it("the identity data carries which kinds the connection's server can run", async () => {
    const body = await (await app.request("/connections/c1/identity")).json();
    expect(body.data.support).toEqual(SUPPORT);
  });

  it("answers 422 KIND_UNSUPPORTED_ON_SERVER when the server cannot run the kind, and audits the refusal", async () => {
    const reason = "ClickHouse 24.3.18.7 does not take a ClickHouse role on a request. The role ceiling needs ClickHouse 24.4 or newer.";
    mockSwitch.mockImplementation(async () => ({ ok: false, unsupported: true, reason, verdict: { ok: false, reason, checks: [], serverVersion: "24.3.18.7" }, support: SUPPORT }));
    const res = await app.request("/connections/c1/identity", json("PUT", CHANGE));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "KIND_UNSUPPORTED_ON_SERVER", message: reason });
    expectRefusalAudit("connection.identity_switched");
  });

  it("answers only a super admin, on every route, and does nothing for anyone else", async () => {
    for (const who of [["admin"], ["analyst"], []]) {
      roles = who;
      for (const [method, path, body] of [
        ["GET", "/connections/c1/identity", undefined],
        ["POST", "/connections/c1/identity/check", CHANGE],
        ["PUT", "/connections/c1/identity", CHANGE],
        ["PUT", "/connections/c1/identity/contact", { accessContact: "x" }],
        ["GET", "/connections/c1/identity/role-map", undefined],
        ["PUT", "/connections/c1/identity/role-map", { entries: [] }],
        ["POST", "/connections/c1/identity/recheck", undefined],
        ["POST", "/connections/identity", CREATE],
        ["POST", "/connections/identity/check", CHANGE],
      ] as const) {
        const res = await app.request(path, json(method, body));
        expect({ who, method, path, status: res.status }).toEqual({ who, method, path, status: 403 });
      }
    }
    for (const m of [mockSwitch, mockCheck, mockSetRoleMap, mockSetContact, mockRecheck, mockAudit, mockCreate]) expect(m).not.toHaveBeenCalled();
  });

  it("shows the kind, the role map and the statements for the ClickHouse administrator", async () => {
    const res = await app.request("/connections/c1/identity", json("GET"));
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data).toMatchObject({ identityMode: "shared", username: "svc", roleMap: [] });
    expect(data.setupStatements).toEqual(["CREATE ROLE IF NOT EXISTS chouse_system;"]);
  });

  it("checks a login without saving or auditing", async () => {
    const res = await app.request("/connections/c1/identity/check", json("POST", CHANGE));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ ok: true });
    expect(mockCheck).toHaveBeenCalledWith("c1", CHANGE);
    expect(mockSwitch).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("switches and records who did it, from what and to what, without the password", async () => {
    const res = await app.request("/connections/c1/identity", json("PUT", CHANGE));
    expect(res.status).toBe(200);
    expect(mockSwitch).toHaveBeenCalledWith("c1", CHANGE);
    const [, action, actor, entry] = mockAudit.mock.calls[0] as unknown as [unknown, string, string, { details: Record<string, unknown> }];
    expect(action).toBe("connection.identity_switched");
    expect(actor).toBe("u1");
    expect(entry.details).toMatchObject({ from: { identityMode: "shared", username: "svc" }, to: { identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system" } });
    expect(JSON.stringify(entry)).not.toContain("pw");
  });

  it("answers 422 with the failed checks when the login does not pass, and audits the refusal with the failed check", async () => {
    mockSwitch.mockImplementation(async () => FAIL);
    const res = await app.request("/connections/c1/identity", json("PUT", CHANGE));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "IDENTITY_CHECK_FAILED", message: "svc holds a direct grant" });
    expect(body.error.details.verdict.checks[0].id).toBe("empty_login");
    const details = expectRefusalAudit("connection.identity_switched");
    expect(details.failedCheck).toBe("empty_login");
  });

  it("replaces the role map and audits the before and after", async () => {
    mockGetRoleMap.mockImplementation(async () => [{ roleId: "r0", roleName: "old", clickhouseRole: "old_role" }]);
    const res = await app.request("/connections/c1/identity/role-map", json("PUT", { entries: [{ roleId: "r1", clickhouseRole: "analyst_ro" }] }));
    expect(res.status).toBe(200);
    expect(mockSetRoleMap).toHaveBeenCalledWith("c1", [{ roleId: "r1", clickhouseRole: "analyst_ro" }], "u1");
    const [, action, , entry] = mockAudit.mock.calls[0] as unknown as [unknown, string, string, { details: Record<string, unknown> }];
    expect(action).toBe("connection.role_map_changed");
    expect(entry.details).toMatchObject({ before: [{ role: "old", clickhouseRole: "old_role" }], after: [{ role: "analyst", clickhouseRole: "analyst_ro" }] });
  });

  it("refuses a malformed body, and a connection that does not exist", async () => {
    expect((await app.request("/connections/c1/identity", json("PUT", { identityMode: "shared_ceiling" }))).status).toBe(400);
    expect((await app.request("/connections/c1/identity/role-map", json("PUT", { entries: [{ roleId: "r1" }] }))).status).toBe(400);
    expect((await app.request("/connections/c1/identity/contact", json("PUT", { accessContact: "x".repeat(501) }))).status).toBe(400);
    mockGetConnectionById.mockImplementation(async () => null);
    expect((await app.request("/connections/nope/identity", json("GET"))).status).toBe(404);
    expect((await app.request("/connections/nope/identity", json("PUT", CHANGE))).status).toBe(404);
    expect(mockSwitch).not.toHaveBeenCalled();
  });

  it("runs the stored login's checks on demand", async () => {
    const res = await app.request("/connections/c1/identity/recheck", json("POST"));
    expect(res.status).toBe(200);
    expect(mockRecheck).toHaveBeenCalledWith("c1");
    expect((await res.json()).data.verdict).toMatchObject({ ok: true });
  });

  describe("creating a connection with its kind (ADR 0034)", () => {
    it("creates it, answers 201 with the connection and the checks, and audits the kind and login without the password", async () => {
      const res = await app.request("/connections/identity", json("POST", CREATE));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.connection.id).toBe("new-1");
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [, action, actor, entry] = mockAudit.mock.calls[0] as unknown as [unknown, string, string, { details: Record<string, unknown>; status: string; resourceId: string }];
      expect(action).toBe("connection.create");
      expect(actor).toBe("u1");
      expect(entry.resourceId).toBe("new-1");
      expect(entry.details).toMatchObject({ identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system", serverVersion: "26.5.7.64" });
      expect(JSON.stringify(entry)).not.toContain('"pw"');
    });

    it("creates nothing when a check fails: 422 with the checks, and a failure audit", async () => {
      mockCreate.mockImplementation(async () => ({ result: FAIL, connection: null }));
      const res = await app.request("/connections/identity", json("POST", CREATE));
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("IDENTITY_CHECK_FAILED");
      expect(expectRefusalAudit("connection.create").failedCheck).toBe("empty_login");
    });

    it("refuses a field it does not know instead of ignoring it", async () => {
      const res = await app.request("/connections/identity", json("POST", { ...CREATE, isDefault: true }));
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("refuses a personal access token or agent grant: a browser session only", async () => {
      withToken = true;
      try {
        const res = await app.request("/connections/identity", json("POST", CREATE));
        expect(res.status).toBe(403);
        expect(mockCreate).not.toHaveBeenCalled();
      } finally {
        withToken = false;
      }
    });

    it("checks a login for a connection not created yet, saving nothing", async () => {
      const res = await app.request("/connections/identity/check", json("POST", CHANGE));
      expect(res.status).toBe(200);
      expect(mockCheck).toHaveBeenCalledWith(null, expect.objectContaining({ identityMode: "shared_ceiling", username: "svc_ceiling" }));
      expect(mockAudit).not.toHaveBeenCalled();
    });
  });
});
