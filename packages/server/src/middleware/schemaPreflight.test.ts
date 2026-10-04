import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

const mockAnalyzeDdl = mock();
const mockUserHasPermission = mock();
const mockAudit = mock();

mock.module("../services/schemaPreflight/impact", () => ({ analyzeDdl: mockAnalyzeDdl }));
mock.module("../rbac/services/rbac", () => ({ userHasPermission: mockUserHasPermission, createAuditLogWithContext: mockAudit }));

import { enforceSchemaPreflight } from "./schemaPreflight";

const BREAKING = { breaking: true, items: [{ severity: "breaks", label: "shop.orders_mv reads column c" }] };

function app(vars: { isAdmin?: boolean; permissions?: string[] }): Hono {
  const a = new Hono();
  a.post("/", async (c) => {
    c.set("rbacUserId", "u1");
    c.set("isRbacAdmin", vars.isAdmin ?? false);
    c.set("rbacPermissions", vars.permissions ?? []);
    const body = await c.req.json<{ sql: string }>();
    const blocked = await enforceSchemaPreflight(c, "conn1", body.sql, "shop");
    return blocked ?? c.json({ success: true });
  });
  return a;
}

function post(a: Hono, sql: string, confirm = false): Promise<Response> {
  return a.request("/", { method: "POST", headers: { "Content-Type": "application/json", ...(confirm ? { "X-Schema-Override": "confirm" } : {}) }, body: JSON.stringify({ sql }) });
}

describe("enforceSchemaPreflight", () => {
  beforeEach(() => {
    mockAnalyzeDdl.mockReset();
    mockUserHasPermission.mockReset();
    mockAudit.mockReset();
    mockUserHasPermission.mockResolvedValue(false);
  });

  it("skips statements that are not DDL", async () => {
    const res = await post(app({}), "SELECT 1");
    expect(res.status).toBe(200);
    expect(mockAnalyzeDdl).not.toHaveBeenCalled();
  });

  it("lets non-breaking DDL through", async () => {
    mockAnalyzeDdl.mockResolvedValue({ breaking: false, items: [] });
    const res = await post(app({}), "ALTER TABLE shop.orders ADD COLUMN x UInt8");
    expect(res.status).toBe(200);
    expect(mockAnalyzeDdl).toHaveBeenCalledWith("conn1", "ALTER TABLE shop.orders ADD COLUMN x UInt8", "shop");
  });

  it("refuses breaking DDL without schema:override even when confirmed", async () => {
    mockAnalyzeDdl.mockResolvedValue(BREAKING);
    const res = await post(app({}), "ALTER TABLE shop.orders DROP COLUMN c", true);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("SCHEMA_PREFLIGHT_BREAKS");
    expect(body.error.details.canOverride).toBe(false);
  });

  it("asks a permitted caller to confirm", async () => {
    mockAnalyzeDdl.mockResolvedValue(BREAKING);
    const res = await post(app({ permissions: ["schema:override"] }), "ALTER TABLE shop.orders DROP COLUMN c");
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.canOverride).toBe(true);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("runs a confirmed override and audits it", async () => {
    mockAnalyzeDdl.mockResolvedValue(BREAKING);
    const res = await post(app({ isAdmin: true }), "ALTER TABLE shop.orders DROP COLUMN c", true);
    expect(res.status).toBe(200);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][1]).toBe("schema.override");
  });
});
