/**
 * The pure parts of MCP OAuth (ADR 0028): the issuer, redirect URI rules,
 * PKCE, client names, response URLs, lifetimes and the policy clamp.
 */

import { describe, expect, it } from "bun:test";
import { createHash, randomBytes } from "crypto";

import { clampPolicy, grantDayChoices } from "../../routes/oauth";
import { isLoopbackHost, resolveIssuer, resourceMetadataUrl, sameResource } from "./issuer";
import { hostMatches, matchRegisteredUri, redirectLabel, redirectUriProblem } from "./redirects";
import { cleanClientName, withParams } from "./routes";
import { hashSecret, isValidChallenge, newClientId, verifyPkce } from "./secrets";

describe("resolveIssuer", () => {
  it("prefers the MCP public address, then PUBLIC_BASE_URL", () => {
    expect(resolveIssuer({ publicUrl: "https://chouse.corp" }, { PUBLIC_BASE_URL: "https://other.corp" })).toEqual({ ok: true, value: { issuer: "https://chouse.corp", resource: "https://chouse.corp/mcp" } });
    expect(resolveIssuer({ publicUrl: null }, { PUBLIC_BASE_URL: " https://env.corp/ " })).toEqual({ ok: true, value: { issuer: "https://env.corp", resource: "https://env.corp/mcp" } });
  });

  it("keeps a path prefix", () => {
    const issuer = resolveIssuer({ publicUrl: "https://corp.example/chouse" }, {});
    expect(issuer).toEqual({ ok: true, value: { issuer: "https://corp.example/chouse", resource: "https://corp.example/chouse/mcp" } });
    if (issuer.ok) expect(resourceMetadataUrl(issuer.value)).toBe("https://corp.example/.well-known/oauth-protected-resource/chouse/mcp");
  });

  it("needs an https address, or http on this machine", () => {
    expect(resolveIssuer({ publicUrl: null }, {}).ok).toBe(false);
    expect(resolveIssuer({ publicUrl: "http://chouse.corp" }, {}).ok).toBe(false);
    expect(resolveIssuer({ publicUrl: "http://localhost:5521" }, {}).ok).toBe(true);
    expect(resolveIssuer({ publicUrl: "http://127.0.0.1:5521" }, {}).ok).toBe(true);
    expect(resolveIssuer({ publicUrl: null }, { PUBLIC_BASE_URL: "not a url" }).ok).toBe(false);
    expect(resolveIssuer({ publicUrl: null }, { PUBLIC_BASE_URL: "https://u:p@chouse.corp" }).ok).toBe(false);
  });

  it("compares resources by origin and path", () => {
    expect(sameResource("https://Chouse.corp/mcp/", "https://chouse.corp/mcp")).toBe(true);
    expect(sameResource("https://chouse.corp/mcp", "https://chouse.corp/mcp2")).toBe(false);
    expect(sameResource("https://chouse.corp/mcp?x=1", "https://chouse.corp/mcp")).toBe(false);
    expect(sameResource("nope", "https://chouse.corp/mcp")).toBe(false);
  });

  it("knows loopback hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "app.localhost"]) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ["localhost.evil.example", "127.0.0.2.example", "example.com"]) expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("allows https, loopback http and app schemes when unrestricted", () => {
    expect(redirectUriProblem("https://agent.example/cb", [])).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:3000/cb", [])).toBeNull();
    expect(redirectUriProblem("http://localhost/cb", [])).toBeNull();
    expect(redirectUriProblem("cursor://anysphere.cursor-mcp/oauth/callback", [])).toBeNull();
  });

  it("refuses unsafe ones", () => {
    for (const uri of ["http://agent.example/cb", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://agent.example/cb#x", "https://a:b@agent.example/cb", "nope", `https://agent.example/${"a".repeat(2001)}`]) {
      expect(redirectUriProblem(uri, [])).not.toBeNull();
    }
  });

  it("holds every URI to the host list when one is set", () => {
    const hosts = ["agent.example", "*.trusted.example", "localhost"];
    expect(redirectUriProblem("https://agent.example/cb", hosts)).toBeNull();
    expect(redirectUriProblem("https://x.trusted.example/cb", hosts)).toBeNull();
    expect(redirectUriProblem("https://trusted.example/cb", hosts)).not.toBeNull();
    expect(redirectUriProblem("https://evil.example/cb", hosts)).not.toBeNull();
    expect(redirectUriProblem("http://localhost:9/cb", hosts)).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:9/cb", hosts)).not.toBeNull();
    expect(redirectUriProblem("cursor://x/cb", hosts)).not.toBeNull();
  });

  it("matches exactly, or a loopback address on any port", () => {
    const registered = ["https://agent.example/cb", "http://127.0.0.1/callback"];
    expect(matchRegisteredUri("https://agent.example/cb", registered)).toBe("https://agent.example/cb");
    expect(matchRegisteredUri("https://agent.example/cb/", registered)).toBeNull();
    expect(matchRegisteredUri("https://agent.example:8443/cb", registered)).toBeNull();
    expect(matchRegisteredUri("http://127.0.0.1:61234/callback", registered)).toBe("http://127.0.0.1:61234/callback");
    expect(matchRegisteredUri("http://127.0.0.1:61234/other", registered)).toBeNull();
    expect(matchRegisteredUri("http://localhost:61234/callback", registered)).toBeNull();
  });

  it("matches host patterns", () => {
    expect(hostMatches("a.b.example", "*.b.example")).toBe(true);
    expect(hostMatches("b.example", "*.b.example")).toBe(false);
    expect(hostMatches("evilb.example", "*.b.example")).toBe(false);
    expect(hostMatches("B.Example", "b.example")).toBe(true);
  });

  it("labels where a sign-in returns to", () => {
    expect(redirectLabel("https://agent.example/cb")).toBe("agent.example");
    expect(redirectLabel("http://127.0.0.1:5/cb")).toBe("127.0.0.1");
    expect(redirectLabel("cursor://anysphere.cursor-mcp/cb")).toBe("cursor://anysphere.cursor-mcp");
  });
});

describe("secrets", () => {
  it("checks PKCE S256", () => {
    const verifier = randomBytes(40).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(isValidChallenge(challenge)).toBe(true);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(`${verifier}x`, challenge)).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
    expect(verifyPkce(verifier, "bad")).toBe(false);
    expect(isValidChallenge("x".repeat(42))).toBe(false);
  });

  it("makes distinct client ids and stable hashes", () => {
    expect(newClientId()).not.toBe(newClientId());
    expect(newClientId().startsWith("chc_")).toBe(true);
    expect(hashSecret("a")).toBe(hashSecret("a"));
    expect(hashSecret("a")).not.toBe(hashSecret("b"));
  });
});

describe("routes helpers", () => {
  it("cleans client names", () => {
    expect(cleanClientName("  Atlas\n  Agent‮ ")).toBe("Atlas Agent");
    expect(cleanClientName(undefined)).toBe("Unnamed agent");
    expect(cleanClientName("\u0000​")).toBe("Unnamed agent");
    expect(cleanClientName("x".repeat(300)).length).toBe(100);
  });

  it("appends response parameters and keeps the URI's own query", () => {
    expect(withParams("https://agent.example/cb?x=1", { code: "c", state: null, iss: "https://chouse.corp" })).toBe("https://agent.example/cb?x=1&code=c&iss=https%3A%2F%2Fchouse.corp");
  });

  it("offers lifetimes up to the administrator's limit", () => {
    expect(grantDayChoices(90)).toEqual([1, 7, 30, 90]);
    expect(grantDayChoices(45)).toEqual([1, 7, 30, 45]);
    expect(grantDayChoices(1)).toEqual([1]);
    expect(grantDayChoices(365)).toEqual([1, 7, 30, 90, 180, 365]);
  });

  it("holds a policy to the ceiling, and to reads only without ai:act", () => {
    const policy = { toolkits: ["data", "access"] as const, t1: "auto", t2: "confirm", t3: "approver" } as const;
    expect(clampPolicy({ ...policy, toolkits: [...policy.toolkits] }, { actionToolkits: ["data"] }, true).toolkits).toEqual(["data"]);
    expect(clampPolicy({ ...policy, toolkits: [...policy.toolkits] }, { actionToolkits: ["data", "access"] }, false).toolkits).toEqual([]);
  });
});
