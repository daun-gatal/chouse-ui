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
mock.module("../services/connectionIdentity", () => ({
  ceilingSetupStatements: () => ["CREATE ROLE IF NOT EXISTS chouse_system;"],
  personalSetupStatements: () => ["CREATE ROLE IF NOT EXISTS chouse_impersonate;"],
  connectionKindSupport: async () => SUPPORT,
  checkIdentityChange: mockCheck,
  getIdentity: async () => IDENTITY,
  getRoleMap: mockGetRoleMap,
  setAccessContact: mockSetContact,
  setRoleMap: mockSetRoleMap,
  switchIdentity: mockSwitch,
}));
mock.module("../../services/chExecutor/health", () => ({ checkSavedConnection: mockRecheck }));
mock.module("../services/rbac", () => ({ createAuditLogWithContext: mockAudit }));

let roles = ["super_admin"];
/** True for a request made with a token that names a scope. */
let scopedToken = false;
mock.module("../middleware", () => ({
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

describe("connection identity routes (ADR 0033 §5, §6)", () => {
  beforeEach(() => {
    roles = ["super_admin"];
    for (const m of [mockSwitch, mockCheck, mockSetRoleMap, mockGetRoleMap, mockSetContact, mockRecheck, mockAudit]) m.mockClear();
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
      ] as const) {
        const res = await app.request(path, json(method, body));
        expect({ method, path, status: res.status }).toEqual({ method, path, status: 403 });
      }
    } finally {
      scopedToken = false;
    }
    for (const m of [mockSwitch, mockCheck, mockSetRoleMap, mockSetContact, mockRecheck, mockAudit]) expect(m).not.toHaveBeenCalled();
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
      ] as const) {
        const res = await app.request(path, json(method, body));
        expect({ who, method, path, status: res.status }).toEqual({ who, method, path, status: 403 });
      }
    }
    for (const m of [mockSwitch, mockCheck, mockSetRoleMap, mockSetContact, mockRecheck, mockAudit]) expect(m).not.toHaveBeenCalled();
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

  it("answers 422 KIND_UNSUPPORTED_ON_SERVER when the server cannot run the kind, and audits nothing", async () => {
    const reason = "ClickHouse 24.3.18.7 does not take a ClickHouse role on a request. The role ceiling needs ClickHouse 24.4 or newer.";
    mockSwitch.mockImplementation(async () => ({ ok: false, unsupported: true, reason, verdict: { ok: false, reason, checks: [], serverVersion: "24.3.18.7" }, support: SUPPORT }));
    const res = await app.request("/connections/c1/identity", json("PUT", CHANGE));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "KIND_UNSUPPORTED_ON_SERVER", message: reason });
    expect(body.error.details.support.serverVersion).toBe("24.3.18.7");
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("the identity data carries which kinds the connection's server can run", async () => {
    const body = await (await app.request("/connections/c1/identity")).json();
    expect(body.data.support).toEqual(SUPPORT);
  });

  it("answers 422 with the failed checks when the login does not pass, and audits nothing", async () => {
    mockSwitch.mockImplementation(async () => FAIL);
    const res = await app.request("/connections/c1/identity", json("PUT", CHANGE));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "IDENTITY_CHECK_FAILED", message: "svc holds a direct grant" });
    expect(body.error.details.verdict.checks[0].id).toBe("empty_login");
    expect(mockAudit).not.toHaveBeenCalled();
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
});
