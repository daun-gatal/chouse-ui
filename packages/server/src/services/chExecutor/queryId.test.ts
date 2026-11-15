import { describe, expect, it } from "bun:test";

import { accountOfQueryId, accountQueryIdLike, internalTrafficSql, isNonce, makeQueryId, ownerAccount, ownerAccountSql, parseQueryId, purposeQueryIdLike } from "./queryId";
import { personActor, serviceActor } from "./types";

describe("query ids", () => {
  it("carries the account for a person and the purpose for a service", () => {
    expect(makeQueryId(personActor("user-1"), "abc")).toBe("chouse:p:user-1:abc");
    expect(makeQueryId(serviceActor("collector"), "abc")).toBe("chouse:s:collector:abc");
  });

  it("uses a random part when no nonce is given, different each time", () => {
    const first = makeQueryId(personActor("user-1"));
    const second = makeQueryId(personActor("user-1"));
    expect(first).not.toBe(second);
    expect(parseQueryId(first)).toMatchObject({ kind: "person", accountId: "user-1" });
  });

  it("replaces a nonce that could change who the id names", () => {
    for (const bad of ["", "a:b", "x".repeat(65), "sp ace", "né", "a\nb"]) {
      expect(isNonce(bad)).toBe(false);
      const id = makeQueryId(personActor("user-1"), bad);
      expect(id.startsWith("chouse:p:user-1:")).toBe(true);
      expect(id.split(":")).toHaveLength(4);
      expect(accountOfQueryId(id)).toBe("user-1");
    }
  });

  it("refuses an account id that cannot be carried", () => {
    expect(() => makeQueryId(personActor("a:b"))).toThrow();
    expect(() => makeQueryId(personActor(""))).toThrow();
  });

  it("refuses an actor that is neither a person nor a known purpose", () => {
    expect(() => makeQueryId({ rbacUserId: "u1" } as never)).toThrow();
    expect(() => makeQueryId({ kind: "service", purpose: "made-up" } as never)).toThrow();
  });

  it("reads back who an id was made for", () => {
    expect(parseQueryId("chouse:p:u1:n1")).toEqual({ kind: "person", accountId: "u1", nonce: "n1" });
    expect(parseQueryId("chouse:s:stop-query:n1")).toEqual({ kind: "service", purpose: "stop-query", nonce: "n1" });
    expect(accountOfQueryId("chouse:s:collector:n1")).toBeNull();
  });

  it("owns nothing for an id that is not one of ours", () => {
    for (const other of [null, undefined, "", "a4b-long-u1", "chouse:p:u1", "chouse:x:u1:n", "chouse:s:not-a-purpose:n", "chouse:p:u1:n:extra", "other:p:u1:n", "chouse:p::n"]) {
      expect(parseQueryId(other)).toBeNull();
    }
  });

  it("builds LIKE patterns that match one account or one purpose only", () => {
    expect(accountQueryIdLike("user_1")).toBe("chouse:p:user\\_1:%");
    expect(purposeQueryIdLike("collector")).toBe("chouse:s:collector:%");
    expect(() => accountQueryIdLike("a%")).toThrow();
  });
});

describe("internal requests", () => {
  it("marks a feature's own request, and never lets a caller's nonce carry the mark", () => {
    expect(makeQueryId(personActor("u1"), undefined, true)).toMatch(/^chouse:p:u1:i-[0-9a-f-]{36}$/);
    expect(makeQueryId(personActor("u1"), "panel-7", true)).toBe("chouse:p:u1:i-panel-7");
    expect(makeQueryId(personActor("u1"), "i-panel-7", true)).toBe("chouse:p:u1:i-panel-7");
    const forged = makeQueryId(personActor("u1"), "i-hide-me");
    expect(forged).not.toContain(":i-");
    expect(forged.startsWith("chouse:p:u1:")).toBe(true);
    // A nonce too long to take the mark is replaced, not truncated into another id.
    expect(makeQueryId(personActor("u1"), "x".repeat(64), true)).toMatch(/^chouse:p:u1:i-[0-9a-f-]{36}$/);
  });

  it("writes a condition that matches CHouse's own traffic", () => {
    const condition = internalTrafficSql(["observe", "dash'boards"]);
    expect(condition).toContain("startsWith(initial_query_id, 'chouse:s:collector:')");
    expect(condition).toContain("'^chouse:p:[A-Za-z0-9_-]{1,64}:i-'");
    expect(condition).toContain("IN ('observe', 'dashboards')");
  });
});

describe("ownerAccount", () => {
  const login = "svc";
  it("reads the account from the id on a row of the connection's own login", () => {
    expect(ownerAccount({ queryId: "chouse:p:u1:n", user: "svc" }, login)).toBe("u1");
    expect(ownerAccount({ queryId: "chouse:p:u1:n", user: "svc", logComment: JSON.stringify({ rbac_user_id: "victim" }) }, login)).toBe("u1");
  });

  it("names no one for a service request, even when its log_comment names an account", () => {
    expect(ownerAccount({ queryId: "chouse:s:collector:n", user: "svc", logComment: JSON.stringify({ rbac_user_id: "u1" }) }, login)).toBeNull();
    expect(ownerAccount({ queryId: "chouse:x:broken", user: "svc", logComment: JSON.stringify({ rbac_user_id: "u1" }) }, login)).toBeNull();
  });

  it("falls back to log_comment only for an id that is not one of ours", () => {
    expect(ownerAccount({ queryId: "9f2c", user: "svc", logComment: JSON.stringify({ rbac_user_id: "u1" }) }, login)).toBe("u1");
    expect(ownerAccount({ queryId: "9f2c", user: "svc", logComment: "plain text" }, login)).toBeNull();
    expect(ownerAccount({ queryId: "9f2c", user: "svc", logComment: JSON.stringify({ rbac_user_id: 7 }) }, login)).toBeNull();
    expect(ownerAccount({ queryId: "9f2c", user: "svc" }, login)).toBeNull();
  });

  it("names no one on a row of another ClickHouse login, whatever it claims", () => {
    expect(ownerAccount({ queryId: "chouse:p:u1:n", user: "mallory" }, login)).toBeNull();
    expect(ownerAccount({ queryId: "9f2c", user: "mallory", logComment: JSON.stringify({ rbac_user_id: "u1" }) }, login)).toBeNull();
  });

  it("as SQL, reads the id first and only then log_comment, on rows of the current login", () => {
    const expr = ownerAccountSql();
    expect(expr.startsWith("if(user = currentUser(), ")).toBe(true);
    // initial_query_id: on a shard the row's own query id is not ours, and its log_comment is the statement's to set.
    expect(expr.indexOf("splitByChar(':', initial_query_id)[3]")).toBeLessThan(expr.indexOf("JSONExtractString(log_comment, 'rbac_user_id')"));
    expect(expr).not.toMatch(/[^_]query_id/);
    expect(ownerAccountSql({ queryId: "q.query_id", logComment: "Settings['log_comment']", user: "q.user" })).toContain("Settings['log_comment']");
  });
});
