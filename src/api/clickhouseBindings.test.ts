/**
 * Tests for the ClickHouse links API client: paths, request bodies, envelope
 * unwrapping and the server's message on a refused link.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { ApiError } from "./client";
import {
  BINDING_STATES,
  CLICKHOUSE_USER_NAME,
  bindingStateLabel,
  canRecheckBinding,
  confirmBinding,
  createBinding,
  getConnectionBindings,
  getMyBindings,
  recheckBinding,
  removeBinding,
  type AdminBinding,
  type ConnectionBindings,
  type OwnBinding,
} from "./clickhouseBindings";

const OWN: OwnBinding = {
  id: "b-1",
  connectionId: "conn-1",
  connectionName: "Production",
  connectionKind: "personal",
  clickhouseUser: "alice_ch",
  defaultDatabase: "analytics",
  state: "active",
  reason: null,
  checkedAt: 1_800_000_000_000,
};

const ADMIN: AdminBinding = { ...OWN, userId: "u-1", accountName: "alice", accountEmail: "alice@example.com", createdAt: 1_799_000_000_000 };

const LISTING: ConnectionBindings = {
  bindings: [ADMIN],
  grants: ["GRANT IMPERSONATE ON bob_ch TO chouse_impersonate;"],
  unbound: [{ user: "old_user", revoke: "REVOKE IMPERSONATE ON old_user FROM chouse_impersonate;" }],
  readiness: { counts: { pending_grant: 1, active: 1, suspended: 0, disabled: 0 }, jobsWithoutLink: 2 },
};

describe("ClickHouse links API", () => {
  it("names every state in plain words", () => {
    expect(BINDING_STATES.map(bindingStateLabel)).toEqual(["Waiting for the grant", "Active", "Suspended", "Disabled"]);
  });

  it("offers a recheck only for waiting and active links", () => {
    expect(BINDING_STATES.filter(canRecheckBinding)).toEqual(["pending_grant", "active"]);
  });

  it("accepts letters, digits and underscores as a ClickHouse user name", () => {
    expect(CLICKHOUSE_USER_NAME.test("alice_ch2")).toBe(true);
    expect(CLICKHOUSE_USER_NAME.test("_svc")).toBe(true);
    expect(CLICKHOUSE_USER_NAME.test("2alice")).toBe(false);
    expect(CLICKHOUSE_USER_NAME.test("alice-ch")).toBe(false);
    expect(CLICKHOUSE_USER_NAME.test("alice ch")).toBe(false);
    expect(CLICKHOUSE_USER_NAME.test("")).toBe(false);
  });

  it("reads the signed-in person's links", async () => {
    server.use(http.get("/api/rbac/clickhouse-bindings/mine", () => HttpResponse.json({ success: true, data: { bindings: [OWN] } })));

    expect(await getMyBindings()).toEqual([OWN]);
  });

  it("rechecks one link and returns it", async () => {
    let seen = "";
    server.use(
      http.post("/api/rbac/clickhouse-bindings/:id/recheck", ({ request }) => {
        seen = new URL(request.url).pathname;
        return HttpResponse.json({ success: true, data: { binding: { ...OWN, state: "pending_grant", reason: "The grant is missing." } } });
      }),
    );

    const binding = await recheckBinding("b/1");
    expect(seen).toBe("/api/rbac/clickhouse-bindings/b%2F1/recheck");
    expect(binding.state).toBe("pending_grant");
    expect(binding.reason).toBe("The grant is missing.");
  });

  it("reads a connection's links with the grant script, unbound users and readiness", async () => {
    let seen = "";
    server.use(
      http.get("/api/rbac/clickhouse-bindings/connection/:connectionId", ({ request }) => {
        seen = new URL(request.url).pathname;
        return HttpResponse.json({ success: true, data: LISTING });
      }),
    );

    expect(await getConnectionBindings("conn 1")).toEqual(LISTING);
    expect(seen).toBe("/api/rbac/clickhouse-bindings/connection/conn%201");
  });

  it("creates a link from an account and a ClickHouse user", async () => {
    let body: unknown;
    server.use(
      http.post("/api/rbac/clickhouse-bindings/connection/conn-1", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { binding: { ...ADMIN, state: "pending_grant" } } }, { status: 201 });
      }),
    );

    const binding = await createBinding("conn-1", { userId: "u-1", clickhouseUser: "alice_ch" });
    expect(body).toEqual({ userId: "u-1", clickhouseUser: "alice_ch" });
    expect(binding.state).toBe("pending_grant");
    expect(binding.accountEmail).toBe("alice@example.com");
  });

  it("keeps the server's message and code when a link is refused", async () => {
    server.use(
      http.post("/api/rbac/clickhouse-bindings/connection/conn-1", () =>
        HttpResponse.json(
          { success: false, error: { code: "BINDING_USER_NOT_FOUND", message: "ClickHouse has no user named ghost." } },
          { status: 422 },
        ),
      ),
    );

    const error = await createBinding("conn-1", { userId: "u-1", clickhouseUser: "ghost" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 422, code: "BINDING_USER_NOT_FOUND", message: "ClickHouse has no user named ghost." });
  });

  it("confirms a suspended link", async () => {
    server.use(
      http.post("/api/rbac/clickhouse-bindings/b-1/confirm", () => HttpResponse.json({ success: true, data: { binding: ADMIN } })),
    );

    expect(await confirmBinding("b-1")).toEqual(ADMIN);
  });

  it("removes a link, whose answer carries no data", async () => {
    let method = "";
    server.use(
      http.delete("/api/rbac/clickhouse-bindings/b-1", ({ request }) => {
        method = request.method;
        return HttpResponse.json({ success: true });
      }),
    );

    await expect(removeBinding("b-1")).resolves.toBeUndefined();
    expect(method).toBe("DELETE");
  });
});
