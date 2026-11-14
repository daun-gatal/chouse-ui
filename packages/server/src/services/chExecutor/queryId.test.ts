import { describe, expect, it } from "bun:test";

import { accountOfQueryId, accountQueryIdLike, isNonce, makeQueryId, parseQueryId, purposeQueryIdLike } from "./queryId";
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
