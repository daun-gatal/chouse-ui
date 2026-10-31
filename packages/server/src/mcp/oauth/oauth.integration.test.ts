/**
 * MCP OAuth end to end (ADR 0028) against a real SQLite database: discovery,
 * registration, authorize, consent, the token endpoint, an MCP tool call that
 * reaches the API in-process with the agent's token, refresh rotation and
 * reuse detection, revocation, and the administrator's switches. The app is
 * mounted the way the web server mounts it.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { createHash, randomBytes } from "crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

// Guardrails on MCP results read the registry; they are covered elsewhere.
mock.module("../guardrails", () => ({ guardMcpResult: async (_tool: string, result: unknown) => result }));

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import * as h from "../../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../../rbac/services/jwt";
import { createPat } from "../../rbac/services/personalAccessTokens";
import { getUserPermissions } from "../../rbac/services/rbac";
import { errorHandler } from "../../middleware/error";
import { corsMiddleware } from "../../middleware/cors";
import api from "../../routes/index";
import { createMcpApp } from "../index";
import { buildMcpDeps, MCP_PATH } from "../server";
import { resetMcpSettingsCache, saveMcpSettings } from "../settings";
import { createOAuthRoutes } from "./routes";
import { getClient, purgeExpired, UNUSED_CLIENT_TTL_MS } from "./store";

const ISSUER = "https://chouse.test";
const ALICE = "oauth-alice";
const BOB = "oauth-bob";
const ADMIN = "oauth-admin";
const AGENT_CB = "https://agent.example/callback";
const LOCAL_CB = "http://127.0.0.1/callback";
const ACCEPT = "application/json, text/event-stream";

let app: Hono;

function buildApp(): Hono {
  const root = new Hono();
  root.onError(errorHandler);
  root.use("*", corsMiddleware({ origin: [ISSUER], credentials: true, strictMode: true }));
  root.route("/api", api);
  root.route(MCP_PATH, createMcpApp(buildMcpDeps(root)).app);
  root.route("/", createOAuthRoutes());
  return root;
}

async function session(sub: string): Promise<string> {
  return generateAccessToken({ sub, email: `${sub}@test.local`, username: sub, roles: ["custom"], permissions: await getUserPermissions(sub), sessionId: `s-${sub}` });
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function apiCall<T>(method: string, path: string, bearer: string, body?: unknown): Promise<{ status: number; body: { success?: boolean; data: T; error?: { message: string; code?: string } } }> {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await json(res) };
}

async function setSettings(update: Record<string, unknown>): Promise<void> {
  await saveMcpSettings(update, ADMIN);
  resetMcpSettingsCache();
}

async function register(redirectUris: string[], extra: Record<string, unknown> = {}): Promise<Response> {
  return app.request("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: redirectUris, client_name: "Atlas Agent", ...extra }) });
}

async function registerClient(redirectUris = [AGENT_CB, LOCAL_CB]): Promise<string> {
  const res = await register(redirectUris);
  expect(res.status).toBe(201);
  return (await json<{ client_id: string }>(res)).client_id;
}

function authorizeUrl(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
  return `/oauth/authorize?${q.toString()}`;
}

/** authorize → consent approve → the code the agent receives. */
async function signIn(clientId: string, user: string, options: { redirectUri?: string; policy?: Record<string, unknown>; days?: number } = {}): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const { verifier, challenge } = pkce();
  const redirectUri = options.redirectUri ?? AGENT_CB;
  const res = await app.request(authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state: "st-1", resource: `${ISSUER}/mcp` }));
  expect(res.status).toBe(302);
  const location = res.headers.get("Location") ?? "";
  const requestId = new URL(location, ISSUER).searchParams.get("request");
  expect(requestId).toBeTruthy();
  const approved = await apiCall<{ redirectUrl: string }>("POST", `/api/oauth/requests/${requestId}/approve`, await session(user), {
    policy: options.policy ?? { toolkits: ["data"], t1: "auto", t2: "confirm", t3: "approver" },
    days: options.days ?? 30,
  });
  expect(approved.status).toBe(200);
  const back = new URL(approved.body.data.redirectUrl);
  expect(back.searchParams.get("state")).toBe("st-1");
  expect(back.searchParams.get("iss")).toBe(ISSUER);
  return { code: back.searchParams.get("code") ?? "", verifier, redirectUri };
}

async function token(params: Record<string, string>): Promise<Response> {
  return app.request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
}

interface Tokens { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string }

async function exchange(clientId: string, signedIn: { code: string; verifier: string; redirectUri: string }): Promise<Tokens> {
  const res = await token({ grant_type: "authorization_code", client_id: clientId, code: signedIn.code, code_verifier: signedIn.verifier, redirect_uri: signedIn.redirectUri, resource: `${ISSUER}/mcp` });
  expect(res.status).toBe(200);
  return json<Tokens>(res);
}

async function mcp(bearer: string | null, body: unknown): Promise<Response> {
  return app.request(MCP_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: ACCEPT, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function whoami(bearer: string): Promise<{ status: number; username: string | null; isError: boolean }> {
  const res = await mcp(bearer, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } });
  if (res.status !== 200) return { status: res.status, username: null, isError: true };
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const rpc = JSON.parse(line ? line.slice(5) : text) as { result?: { isError?: boolean; content: Array<{ text: string }> } };
  const payload = JSON.parse(rpc.result?.content?.[0]?.text ?? "{}") as { user?: { username?: string } };
  return { status: res.status, username: payload.user?.username ?? null, isError: Boolean(rpc.result?.isError) };
}

async function roleId(name: string): Promise<string> {
  const rows = await h.rawAll(sql`SELECT id FROM rbac_roles WHERE name = ${name} LIMIT 1`);
  return String(rows[0].id);
}

beforeAll(async () => {
  delete process.env.PUBLIC_BASE_URL;
  await h.freshDatabase("sqlite");
  await runMigrations();
  const roles: Array<[string, string]> = [[ALICE, "admin"], [BOB, "viewer"], [ADMIN, "super_admin"]];
  for (const [id, role] of roles) {
    await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at)
      VALUES (${id}, ${`${id}@test.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
    await h.rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${`ur-${id}`}, ${id}, ${await roleId(role)}, unixepoch())`);
  }
  app = buildApp();
}, 60_000);

afterAll(async () => {
  await closeDatabase();
});

describe("MCP OAuth off", () => {
  it("answers 404 everywhere and the MCP 401 points nowhere", async () => {
    await setSettings({ enabled: true });
    expect((await app.request("/.well-known/oauth-protected-resource/mcp")).status).toBe(404);
    expect((await app.request("/.well-known/oauth-authorization-server")).status).toBe(404);
    expect((await register([AGENT_CB])).status).toBe(404);
    const res = await mcp(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("can't be turned on without a public address", async () => {
    const res = await apiCall("PUT", "/api/agents/mcp", await session(ADMIN), { oauthEnabled: true });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain("public address");
    const http = await apiCall("PUT", "/api/agents/mcp", await session(ADMIN), { oauthEnabled: true, publicUrl: "http://chouse.test" });
    expect(http.status).toBe(400);
    expect(http.body.error?.message).toContain("https");
  });

  it("turns on with an https public address", async () => {
    const res = await apiCall<{ settings: { oauthEnabled: boolean }; oauth: { issuer: string; metadataUrl: string } }>("PUT", "/api/agents/mcp", await session(ADMIN), { oauthEnabled: true, publicUrl: ISSUER });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.oauthEnabled).toBe(true);
    expect(res.body.data.oauth.issuer).toBe(ISSUER);
    expect(res.body.data.oauth.metadataUrl).toBe(`${ISSUER}/.well-known/oauth-protected-resource/mcp`);
    resetMcpSettingsCache();
  });
});

describe("discovery", () => {
  it("points a token-less MCP call at the resource metadata", async () => {
    const res = await mcp(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(`Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("serves the resource and authorization server metadata", async () => {
    const prm = await json<{ resource: string; authorization_servers: string[] }>(await app.request("/.well-known/oauth-protected-resource/mcp"));
    expect(prm.resource).toBe(`${ISSUER}/mcp`);
    expect(prm.authorization_servers).toEqual([ISSUER]);
    const as = await json<Record<string, unknown>>(await app.request("/.well-known/oauth-authorization-server"));
    expect(as.issuer).toBe(ISSUER);
    expect(as.token_endpoint).toBe(`${ISSUER}/oauth/token`);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("answers any origin without credentials, and still blocks other origins elsewhere", async () => {
    const pre = await app.request("/oauth/token", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(pre.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    const meta = await app.request("/.well-known/oauth-authorization-server", { headers: { Origin: "https://evil.example" } });
    expect(meta.status).toBe(200);
    expect(meta.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const other = await app.request("/api/oauth/grants", { headers: { Origin: "https://evil.example" } });
    expect(other.status).toBe(403);
  });
});

describe("registration", () => {
  it("refuses unsafe redirect URIs", async () => {
    for (const uri of ["http://agent.example/cb", "javascript:alert(1)", "https://agent.example/cb#frag", "not a url", "https://user:pw@agent.example/cb"]) {
      const res = await register([uri]);
      expect(res.status).toBe(400);
      expect((await json<{ error: string }>(res)).error).toBe("invalid_redirect_uri");
    }
    expect((await register([])).status).toBe(400);
    expect((await register([AGENT_CB], { grant_types: ["client_credentials"] })).status).toBe(400);
    expect((await register([AGENT_CB], { response_types: ["token"] })).status).toBe(400);
  });

  it("registers a public client and cleans its name", async () => {
    const res = await register([AGENT_CB, LOCAL_CB, "cursor://anysphere.cursor-mcp/oauth/callback"], { client_name: "Atlas‮ Agent\n\u0007", token_endpoint_auth_method: "client_secret_basic" });
    expect(res.status).toBe(201);
    const body = await json<{ client_id: string; client_name: string; token_endpoint_auth_method: string }>(res);
    expect(body.client_id.startsWith("chc_")).toBe(true);
    expect(body.client_name).toBe("Atlas Agent");
    expect(body.token_endpoint_auth_method).toBe("none");
  });
});

describe("authorize", () => {
  let clientId = "";
  beforeAll(async () => {
    clientId = await registerClient();
  });

  it("keeps requests it can't trust on CHouse", async () => {
    const { challenge } = pkce();
    const unknown = await app.request(authorizeUrl({ response_type: "code", client_id: "chc_nope", redirect_uri: AGENT_CB, code_challenge: challenge, code_challenge_method: "S256" }));
    expect(unknown.headers.get("Location")).toBe("/preferences/connect?error=unknown_client");
    const mismatch = await app.request(authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: "https://evil.example/cb", code_challenge: challenge, code_challenge_method: "S256" }));
    expect(mismatch.headers.get("Location")).toBe("/preferences/connect?error=redirect_mismatch");
    const missing = await app.request(authorizeUrl({ response_type: "code", client_id: clientId, code_challenge: challenge, code_challenge_method: "S256" }));
    expect(missing.headers.get("Location")).toBe("/preferences/connect?error=redirect_mismatch");
  });

  it("sends other problems back to the agent with state and iss", async () => {
    const { challenge } = pkce();
    const cases: Array<[Record<string, string | undefined>, string]> = [
      [{ response_type: "token", code_challenge: challenge, code_challenge_method: "S256" }, "unsupported_response_type"],
      [{ response_type: "code" }, "invalid_request"],
      [{ response_type: "code", code_challenge: challenge, code_challenge_method: "plain" }, "invalid_request"],
      [{ response_type: "code", code_challenge: challenge, code_challenge_method: "S256", resource: "https://other.example/mcp" }, "invalid_target"],
    ];
    for (const [params, error] of cases) {
      const res = await app.request(authorizeUrl({ client_id: clientId, redirect_uri: AGENT_CB, state: "xyz", ...params }));
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("Location") ?? "");
      expect(`${location.origin}${location.pathname}`).toBe(AGENT_CB);
      expect(location.searchParams.get("error")).toBe(error);
      expect(location.searchParams.get("state")).toBe("xyz");
      expect(location.searchParams.get("iss")).toBe(ISSUER);
    }
  });

  it("accepts a loopback redirect on any port and hands over to the consent page", async () => {
    const { challenge } = pkce();
    const res = await app.request(authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: "http://127.0.0.1:53111/callback", code_challenge: challenge, code_challenge_method: "S256" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^\/preferences\/connect\?request=[A-Za-z0-9_-]+$/);
  });
});

describe("consent", () => {
  let clientId = "";
  let requestId = "";
  beforeAll(async () => {
    clientId = await registerClient();
    const { challenge } = pkce();
    const res = await app.request(authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: AGENT_CB, code_challenge: challenge, code_challenge_method: "S256", state: "s" }));
    requestId = new URL(res.headers.get("Location") ?? "", ISSUER).searchParams.get("request") ?? "";
  });

  it("only works from a browser session", async () => {
    const pat = await createPat(ALICE, { name: "ci" });
    const res = await apiCall("GET", `/api/oauth/requests/${requestId}`, pat.rawToken);
    expect(res.status).toBe(403);
  });

  it("shows the agent, where it returns, and what the person may grant", async () => {
    const res = await apiCall<{ client: { name: string; returnsTo: string; status: string }; canAct: boolean; ceiling: { toolkits: string[] }; defaults: { toolkits: string[] }; dayChoices: number[] }>("GET", `/api/oauth/requests/${requestId}`, await session(ALICE));
    expect(res.status).toBe(200);
    expect(res.body.data.client).toMatchObject({ name: "Atlas Agent", returnsTo: "agent.example", status: "allowed" });
    expect(res.body.data.canAct).toBe(true);
    expect(res.body.data.defaults.toolkits).toEqual(["data"]);
    expect(res.body.data.dayChoices).toEqual([1, 7, 30, 90]);
    const bob = await apiCall<{ canAct: boolean; defaults: { toolkits: string[] } }>("GET", `/api/oauth/requests/${requestId}`, await session(BOB));
    expect(bob.body.data.canAct).toBe(false);
    expect(bob.body.data.defaults.toolkits).toEqual([]);
  });

  it("refuses a lifetime above the administrator's limit", async () => {
    const res = await apiCall("POST", `/api/oauth/requests/${requestId}/approve`, await session(ALICE), { policy: { toolkits: [], t1: "auto", t2: "confirm", t3: "off" }, days: 365 });
    expect(res.status).toBe(400);
  });

  it("is answered once: deny, then nothing", async () => {
    const denied = await apiCall<{ redirectUrl: string }>("POST", `/api/oauth/requests/${requestId}/deny`, await session(ALICE));
    expect(denied.status).toBe(200);
    const back = new URL(denied.body.data.redirectUrl);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("s");
    expect((await apiCall("POST", `/api/oauth/requests/${requestId}/approve`, await session(ALICE), { policy: { toolkits: [], t1: "auto", t2: "confirm", t3: "off" }, days: 30 })).status).toBe(404);
    expect((await apiCall("GET", `/api/oauth/requests/${requestId}`, await session(ALICE))).status).toBe(404);
  });
});

describe("tokens and MCP", () => {
  let clientId = "";
  let tokens: Tokens;
  let grantId = "";

  beforeAll(async () => {
    clientId = await registerClient();
  });

  it("checks the code exchange strictly", async () => {
    const signedIn = await signIn(clientId, ALICE);
    const otherClient = await registerClient();
    expect((await token({ grant_type: "authorization_code", client_id: clientId, code: signedIn.code, redirect_uri: signedIn.redirectUri })).status).toBe(400);
    const wrongVerifier = await token({ grant_type: "authorization_code", client_id: clientId, code: signedIn.code, code_verifier: pkce().verifier, redirect_uri: signedIn.redirectUri });
    expect((await json<{ error: string }>(wrongVerifier)).error).toBe("invalid_grant");
    const wrongRedirect = await token({ grant_type: "authorization_code", client_id: clientId, code: signedIn.code, code_verifier: signedIn.verifier, redirect_uri: LOCAL_CB });
    expect((await json<{ error: string }>(wrongRedirect)).error).toBe("invalid_grant");
    const wrongClient = await token({ grant_type: "authorization_code", client_id: otherClient, code: signedIn.code, code_verifier: signedIn.verifier, redirect_uri: signedIn.redirectUri });
    expect((await json<{ error: string }>(wrongClient)).error).toBe("invalid_grant");
    expect((await token({ grant_type: "authorization_code", client_id: "chc_nope", code: signedIn.code, code_verifier: signedIn.verifier, redirect_uri: signedIn.redirectUri })).status).toBe(401);
    expect((await json<{ error: string }>(await token({ grant_type: "password", client_id: clientId }))).error).toBe("unsupported_grant_type");

    const res = await token({ grant_type: "authorization_code", client_id: clientId, code: signedIn.code, code_verifier: signedIn.verifier, redirect_uri: signedIn.redirectUri });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    tokens = await json<Tokens>(res);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.access_token.startsWith("ch_oat_")).toBe(true);
    expect(tokens.refresh_token.startsWith("ch_ort_")).toBe(true);
    expect(tokens.expires_in).toBeGreaterThan(3500);
    expect(tokens.expires_in).toBeLessThanOrEqual(3600);
  });

  it("runs an MCP tool as the person, reaching the API in-process", async () => {
    const result = await whoami(tokens.access_token);
    expect(result.status).toBe(200);
    expect(result.isError).toBe(false);
    expect(result.username).toBe(ALICE);
  });

  it("is useless against the rest of the API", async () => {
    const res = await apiCall<unknown>("GET", "/api/rbac/auth/profile", tokens.access_token);
    expect(res.status).toBe(401);
    expect(res.body.error?.message).toContain("only work on the MCP endpoint");
    const noHeader = await app.request("/api/rbac/auth/profile", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    expect(noHeader.status).toBe(403);
  });

  it("is listed as a connected app, not a personal token, with the policy chosen", async () => {
    const owner = await session(ALICE);
    const grants = await apiCall<{ grants: Array<{ id: string; clientName: string; returnsTo: string; policy: { toolkits: string[] } }> }>("GET", "/api/oauth/grants", owner);
    const mine = grants.body.data.grants.filter((g) => g.clientName === "Atlas Agent");
    expect(mine.length).toBe(1);
    grantId = mine[0].id;
    expect(mine[0].returnsTo).toBe("agent.example");
    expect(mine[0].policy.toolkits).toEqual(["data"]);
    const pats = await apiCall<{ tokens: Array<{ id: string }> }>("GET", "/api/rbac/pats", owner);
    expect(pats.body.data.tokens.some((t) => t.id === grantId)).toBe(false);
    const policy = await apiCall<{ policy: { toolkits: string[] } }>("GET", `/api/rbac/pats/${grantId}/write-policy`, owner);
    expect(policy.status).toBe(200);
    expect(policy.body.data.policy.toolkits).toEqual(["data"]);
    expect((await apiCall("DELETE", `/api/rbac/pats/${grantId}`, owner)).status).toBe(404);
    expect((await apiCall("GET", "/api/oauth/grants", await session(BOB))).body).toMatchObject({ data: { grants: [] } });
  });

  it("rotates refresh tokens and revokes the grant when one is reused", async () => {
    const first = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token });
    expect(first.status).toBe(200);
    const next = await json<Tokens>(first);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await whoami(next.access_token)).username).toBe(ALICE);

    const reused = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token });
    expect((await json<{ error: string }>(reused)).error).toBe("invalid_grant");
    expect((await whoami(next.access_token)).status).toBe(401);
    expect((await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: next.refresh_token })).status).toBe(400);
    const audit = await h.rawAll(sql`SELECT COUNT(*) AS n FROM rbac_audit_logs WHERE action = 'oauth.token_reuse'`);
    expect(Number(audit[0].n)).toBeGreaterThan(0);
  });

  it("revokes the grant when a code is replayed", async () => {
    const signedIn = await signIn(clientId, ALICE);
    const issued = await exchange(clientId, signedIn);
    expect((await whoami(issued.access_token)).status).toBe(200);
    const replay = await token({ grant_type: "authorization_code", client_id: clientId, code: signedIn.code, code_verifier: signedIn.verifier, redirect_uri: signedIn.redirectUri });
    expect((await json<{ error: string }>(replay)).error).toBe("invalid_grant");
    expect((await whoami(issued.access_token)).status).toBe(401);
  });

  it("replaces an earlier grant when the same agent signs in again", async () => {
    const one = await exchange(clientId, await signIn(clientId, ALICE));
    const two = await exchange(clientId, await signIn(clientId, ALICE));
    expect((await whoami(one.access_token)).status).toBe(401);
    expect((await whoami(two.access_token)).status).toBe(200);
  });

  it("stops at revocation by the agent, the owner or an administrator", async () => {
    const byAgent = await exchange(clientId, await signIn(clientId, ALICE));
    expect((await app.request("/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, token: byAgent.refresh_token }).toString() })).status).toBe(200);
    expect((await whoami(byAgent.access_token)).status).toBe(401);
    expect((await app.request("/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, token: "ch_ort_unknown" }).toString() })).status).toBe(200);

    const byOwner = await exchange(clientId, await signIn(clientId, ALICE));
    const owned = await apiCall<{ grants: Array<{ id: string }> }>("GET", "/api/oauth/grants", await session(ALICE));
    expect((await apiCall("DELETE", `/api/oauth/grants/${owned.body.data.grants[0].id}`, await session(BOB))).status).toBe(404);
    expect((await apiCall("DELETE", `/api/oauth/grants/${owned.body.data.grants[0].id}`, await session(ALICE))).status).toBe(200);
    expect((await whoami(byOwner.access_token)).status).toBe(401);

    const byAdmin = await exchange(clientId, await signIn(clientId, ALICE));
    const all = await apiCall<{ grants: Array<{ id: string; user: { id: string } }> }>("GET", "/api/agents/mcp/oauth", await session(ADMIN));
    const target = all.body.data.grants.find((g) => g.user.id === ALICE);
    expect(target).toBeTruthy();
    expect((await apiCall("DELETE", `/api/agents/mcp/oauth/grants/${target?.id}`, await session(ADMIN))).status).toBe(200);
    expect((await whoami(byAdmin.access_token)).status).toBe(401);
  });

  it("follows the owner: deactivated or expired means no access", async () => {
    const live = await exchange(clientId, await signIn(clientId, BOB));
    expect((await whoami(live.access_token)).username).toBe(BOB);
    await h.rawRun(sql`UPDATE rbac_users SET is_active = 0 WHERE id = ${BOB}`);
    expect((await whoami(live.access_token)).status).toBe(401);
    await h.rawRun(sql`UPDATE rbac_users SET is_active = 1 WHERE id = ${BOB}`);
    expect((await whoami(live.access_token)).status).toBe(200);
    await h.rawRun(sql`UPDATE rbac_api_keys SET expires_at = ${Math.floor(Date.now() / 1000) - 60} WHERE kind = 'oauth' AND user_id = ${BOB} AND revoked_at IS NULL`);
    expect((await whoami(live.access_token)).status).toBe(401);
    expect((await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: live.refresh_token })).status).toBe(400);
  });
});

describe("administrator switches", () => {
  it("can turn pasted personal tokens off for MCP only", async () => {
    const pat = await createPat(ALICE, { name: "agent" });
    expect((await whoami(pat.rawToken)).status).toBe(200);
    await setSettings({ oauthPatsAllowed: false });
    const res = await mcp(pat.rawToken, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("Personal access tokens are turned off");
    expect((await apiCall("GET", "/api/rbac/auth/profile", pat.rawToken)).status).toBe(200);
    await setSettings({ oauthPatsAllowed: true });
  });

  it("holds new agents for approval, and blocking one revokes everyone's access", async () => {
    await setSettings({ oauthRegistration: "approval" });
    const clientId = await registerClient();
    const { challenge } = pkce();
    const held = await app.request(authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: AGENT_CB, code_challenge: challenge, code_challenge_method: "S256" }));
    expect(held.headers.get("Location")).toBe("/preferences/connect?error=client_pending");
    expect((await apiCall("PUT", `/api/agents/mcp/oauth/clients/${clientId}`, await session(BOB), { status: "allowed" })).status).toBe(403);
    expect((await apiCall("PUT", `/api/agents/mcp/oauth/clients/${clientId}`, await session(ADMIN), { status: "allowed" })).status).toBe(200);
    const issued = await exchange(clientId, await signIn(clientId, ALICE));
    expect((await whoami(issued.access_token)).status).toBe(200);

    expect((await apiCall("PUT", `/api/agents/mcp/oauth/clients/${clientId}`, await session(ADMIN), { status: "blocked" })).status).toBe(200);
    expect((await whoami(issued.access_token)).status).toBe(401);
    expect((await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: issued.refresh_token })).status).toBe(401);
    const blocked = await app.request(authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: AGENT_CB, code_challenge: challenge, code_challenge_method: "S256" }));
    expect(blocked.headers.get("Location")).toBe("/preferences/connect?error=client_blocked");
    await setSettings({ oauthRegistration: "open" });
  });

  it("narrows redirect hosts, even for agents registered before", async () => {
    const clientId = await registerClient();
    await setSettings({ oauthRedirectHosts: ["*.trusted.example"] });
    expect((await register([AGENT_CB])).status).toBe(400);
    expect((await register(["https://app.trusted.example/cb"])).status).toBe(201);
    expect((await register(["cursor://x/cb"])).status).toBe(400);
    const { challenge } = pkce();
    const res = await app.request(authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: AGENT_CB, code_challenge: challenge, code_challenge_method: "S256" }));
    expect(res.headers.get("Location")).toBe("/preferences/connect?error=redirect_not_allowed");
    await setSettings({ oauthRedirectHosts: [] });
  });

  it("turning OAuth off stops every agent token", async () => {
    const clientId = await registerClient();
    const issued = await exchange(clientId, await signIn(clientId, ALICE));
    await setSettings({ oauthEnabled: false });
    expect((await whoami(issued.access_token)).status).toBe(401);
    expect((await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: issued.refresh_token })).status).toBe(404);
    await setSettings({ oauthEnabled: true });
    expect((await whoami(issued.access_token)).status).toBe(200);
  });
});

describe("housekeeping", () => {
  it("forgets registrations nobody signed in with, but keeps used, granted and blocked agents", async () => {
    const unused = await registerClient();
    const blocked = await registerClient();
    await apiCall("PUT", `/api/agents/mcp/oauth/clients/${blocked}`, await session(ADMIN), { status: "blocked" });
    const granted = await registerClient();
    await exchange(granted, await signIn(granted, ALICE));
    const later = Date.now() + UNUSED_CLIENT_TTL_MS + 60_000;
    await purgeExpired(later);
    expect(await getClient(unused)).toBeNull();
    expect(await getClient(blocked)).not.toBeNull();
    expect(await getClient(granted)).not.toBeNull();
  });
});

