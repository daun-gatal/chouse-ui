import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

import { AppError } from "../../types";

const OWN = { id: "b1", userId: "ann", accountName: "ann", accountEmail: "ann@t.local", connectionId: "c1", connectionName: "prod", connectionKind: "personal", clickhouseUser: "alice", defaultDatabase: "default", state: "active", reason: null, checkedAt: 5, createdAt: 1 };
const OTHER = { ...OWN, id: "b2", userId: "ben", accountName: "ben", accountEmail: "ben@t.local", clickhouseUser: "bob" };

const mockCreate = mock(async () => OWN);
const mockConfirm = mock(async () => OWN);
const mockRecheck = mock(async (id: string) => (id === "b1" ? OWN : OTHER));
const mockRemove = mock(async () => undefined);
const mockGet = mock(async (id: string) => (id === "b1" ? OWN : id === "b2" ? OTHER : null));
const mockGetConnectionById = mock(async (id: string) => (id === "c1" ? { id: "c1", name: "prod" } : null));

mock.module("../services/clickhouseBindings", () => ({
  bindingCounts: async () => ({ pending_grant: 1, active: 1, suspended: 0, disabled: 0 }),
  confirmBinding: mockConfirm,
  createBinding: mockCreate,
  getBinding: mockGet,
  grantScript: async () => ({ grants: ["GRANT IMPERSONATE ON dave TO chouse_impersonate;  -- dan"], unbound: [{ user: "old", revoke: "REVOKE IMPERSONATE ON old FROM chouse_impersonate;" }] }),
  listBindingsOfConnection: async () => [OWN, OTHER],
  listBindingsOfUser: async (userId: string) => [OWN, OTHER].filter((binding) => binding.userId === userId),
  recheckBinding: mockRecheck,
  removeBinding: mockRemove,
}));
mock.module("../services/connections", () => ({ getConnectionById: mockGetConnectionById }));
mock.module("../../services/observe/db", () => ({
  all: async () => [{ n: 3 }],
  num: (value: unknown) => Number(value),
  sql: (strings: TemplateStringsArray) => strings.join("?"),
}));

let user = { sub: "root", roles: ["super_admin"] };
/** True for a request made with a token that names a scope. */
let scopedToken = false;
mock.module("../middleware", () => ({
  refuseScopedToken: () => {
    if (scopedToken) throw new AppError("This action is not within this token's scope.", "FORBIDDEN", "permission", 403);
  },
  rbacAuthMiddleware: async (c: { set(key: string, value: unknown): void }, next: () => Promise<void>) => {
    c.set("tokenScoped", scopedToken);
    return next();
  },
  getRbacUser: () => user,
}));

const { default: routes } = await import("./clickhouseBindings");
const app = new Hono();
app.route("/clickhouse-bindings", routes);
app.onError((error, c) => (error instanceof AppError ? c.json({ success: false, error: { code: error.code, message: error.message } }, error.statusCode as 400) : c.json({ success: false, error: { message: String(error) } }, 500)));

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const data = async (res: Response): Promise<Record<string, unknown>> => ((await res.json()) as { data: Record<string, unknown> }).data;

describe("binding routes (ADR 0033 §7.4)", () => {
  beforeEach(() => {
    user = { sub: "root", roles: ["super_admin"] };
    for (const m of [mockCreate, mockConfirm, mockRecheck, mockRemove]) m.mockClear();
  });

  it("only a super admin lists a connection's links, creates, confirms or removes one (goal 11)", async () => {
    for (const roles of [["admin"], ["analyst"], []]) {
      user = { sub: "ann", roles };
      for (const [method, path, body] of [
        ["GET", "/clickhouse-bindings/connection/c1", undefined],
        ["POST", "/clickhouse-bindings/connection/c1", { userId: "ann", clickhouseUser: "alice" }],
        ["POST", "/clickhouse-bindings/b1/confirm", undefined],
        ["DELETE", "/clickhouse-bindings/b1", undefined],
        // An admin cannot remove or confirm their own link either.
        ["DELETE", "/clickhouse-bindings/b2", undefined],
      ] as const) {
        const res = await app.request(path, json(method, body));
        expect({ roles, method, path, status: res.status }).toEqual({ roles, method, path, status: 403 });
      }
    }
    for (const m of [mockCreate, mockConfirm, mockRemove]) expect(m).not.toHaveBeenCalled();
  });

  it("refuses a super admin's token that names a scope on the management routes, and lets it act only as its owner elsewhere", async () => {
    scopedToken = true;
    // As the token is resolved: a scope removes the administrator roles from it.
    user = { sub: "root", roles: [] };
    try {
      for (const [method, path, body] of [
        ["GET", "/clickhouse-bindings/connection/c1", undefined],
        ["POST", "/clickhouse-bindings/connection/c1", { userId: "ann", clickhouseUser: "alice" }],
        ["POST", "/clickhouse-bindings/b1/confirm", undefined],
        ["DELETE", "/clickhouse-bindings/b1", undefined],
      ] as const) {
        expect({ method, path, status: (await app.request(path, json(method, body))).status }).toEqual({ method, path, status: 403 });
      }
      // Its own links are still its owner's to see; someone else's link is as missing as for anyone.
      expect((await app.request("/clickhouse-bindings/mine")).status).toBe(200);
      expect((await app.request("/clickhouse-bindings/b2/recheck", json("POST"))).status).toBe(404);
    } finally {
      scopedToken = false;
    }
    for (const m of [mockCreate, mockConfirm, mockRemove, mockRecheck]) expect(m).not.toHaveBeenCalled();
  });

  it("a person sees their own links, without account fields or other people's", async () => {
    user = { sub: "ann", roles: ["analyst"] };
    const body = await data(await app.request("/clickhouse-bindings/mine"));
    expect(body.bindings).toEqual([{ id: "b1", connectionId: "c1", connectionName: "prod", connectionKind: "personal", clickhouseUser: "alice", defaultDatabase: "default", state: "active", reason: null, checkedAt: 5 }]);
  });

  it("a person may check their own link again, and gets not-found for someone else's or a missing one", async () => {
    user = { sub: "ann", roles: ["analyst"] };
    const own = await app.request("/clickhouse-bindings/b1/recheck", json("POST"));
    expect(own.status).toBe(200);
    expect((await data(own)).binding).not.toHaveProperty("accountEmail");
    expect(mockRecheck).toHaveBeenCalledWith("b1", "ann");
    for (const id of ["b2", "nope"]) expect((await app.request(`/clickhouse-bindings/${id}/recheck`, json("POST"))).status).toBe(404);
    expect(mockRecheck).toHaveBeenCalledTimes(1);
    // A super admin may check anyone's and sees the account.
    user = { sub: "root", roles: ["super_admin"] };
    expect((await data(await app.request("/clickhouse-bindings/b2/recheck", json("POST")))).binding).toHaveProperty("accountEmail", "ben@t.local");
  });

  it("a super admin gets the links, the grant script, the unbound users and the readiness counts", async () => {
    const body = await data(await app.request("/clickhouse-bindings/connection/c1"));
    expect(body).toMatchObject({
      bindings: [{ id: "b1" }, { id: "b2" }],
      grants: ["GRANT IMPERSONATE ON dave TO chouse_impersonate;  -- dan"],
      unbound: [{ user: "old" }],
      readiness: { counts: { pending_grant: 1, active: 1, suspended: 0, disabled: 0 }, jobsWithoutLink: 3 },
    });
    expect((await app.request("/clickhouse-bindings/connection/missing")).status).toBe(404);
  });

  it("creates, confirms and removes with the acting super admin, and validates the body", async () => {
    const created = await app.request("/clickhouse-bindings/connection/c1", json("POST", { userId: "ann", clickhouseUser: "alice" }));
    expect(created.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith("c1", "ann", "alice", "root");
    expect((await app.request("/clickhouse-bindings/b1/confirm", json("POST"))).status).toBe(200);
    expect(mockConfirm).toHaveBeenCalledWith("b1", "root");
    expect((await app.request("/clickhouse-bindings/b1", json("DELETE"))).status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith("b1", "root");
    for (const bad of [{}, { userId: "ann" }, { userId: "", clickhouseUser: "alice" }, { userId: "ann", clickhouseUser: "x".repeat(200) }]) {
      expect((await app.request("/clickhouse-bindings/connection/c1", json("POST", bad))).status).toBe(400);
    }
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("takes no ClickHouse password and returns none (goal 8)", async () => {
    await app.request("/clickhouse-bindings/connection/c1", json("POST", { userId: "ann", clickhouseUser: "alice", password: "secret", clickhousePassword: "secret" }));
    expect(mockCreate).toHaveBeenCalledWith("c1", "ann", "alice", "root");
    const text = JSON.stringify(await data(await app.request("/clickhouse-bindings/connection/c1")));
    expect(text.toLowerCase()).not.toContain("password");
  });

  it("passes the service's refusal through with its status", async () => {
    mockCreate.mockImplementationOnce(async () => {
      throw new AppError("There is no ClickHouse user named ghost on this connection.", "BINDING_USER_NOT_FOUND", "validation", 422);
    });
    const res = await app.request("/clickhouse-bindings/connection/c1", json("POST", { userId: "ann", clickhouseUser: "ghost" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BINDING_USER_NOT_FOUND");
  });
});
