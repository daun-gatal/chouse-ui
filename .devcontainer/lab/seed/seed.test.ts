import { describe, expect, it } from "vitest";

import { ChouseApi, LabError, chooseAi, readConfig } from "./lib";
import type { FetchLike } from "./lib";
import { runSeed } from "./seed";
import { SAVED_QUERIES, SHOWCASE_STEPS, TEAM, shopDashboard } from "./showcase";
import { checkQueryThroughApi, checkSingleConnection, checkSlowQuery, runSmoke } from "./smoke";

const ENV = {
  LAB_ADMIN_PASSWORD: "Lab-0123abcd-Ch1!",
  CLICKHOUSE_PASSWORD: "chpw",
  LAB_CHOUSE_URL: "http://chouse:5521",
  LAB_CLICKHOUSE_URL: "http://ch:8123",
};

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/** An in-memory stand-in for the CHouse API and ClickHouse's HTTP interface. */
class FakeLab {
  rows = new Map<string, number>([["shop.customers", 0], ["finance.payouts", 0], ["shop.orders_raw", 0]]);
  connections: Array<Record<string, unknown>> = [];
  providers: Array<Record<string, unknown>> = [];
  models: Array<Record<string, unknown>> = [];
  configs: Array<Record<string, unknown>> = [];
  bootstrapPending = true;
  requiresPasswordChange = false;
  loginStatus = 200;
  failBaseModel = false;
  slowQueries = 1;
  aiEnabled = false;
  networkFailures = 0;
  calls: Call[] = [];
  sql: string[] = [];
  /** Showcase collections, keyed by API path. */
  store = new Map<string, Array<Record<string, unknown>>>();
  rolePolicies = new Map<string, string[]>([["role-analyst", ["policy-system"]]]);
  curated = new Map<string, Record<string, unknown>>();
  tableMetrics = new Map<string, string[]>();
  showcaseDown = false;
  catalogPending = false;

  list(path: string): Array<Record<string, unknown>> {
    const items = this.store.get(path) ?? [];
    this.store.set(path, items);
    return items;
  }

  readonly fetch: FetchLike = async (input, init) => {
    if (this.networkFailures > 0) {
      this.networkFailures--;
      throw new TypeError("fetch failed");
    }
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    if (url.host === "ch:8123") return this.clickhouse(body ?? "");
    const parsed: unknown = body ? JSON.parse(body) : undefined;
    this.calls.push({ method, path: `${url.pathname}${url.search}`, body: parsed });
    return this.api(method, url.pathname, parsed);
  };

  private clickhouse(sql: string): Response {
    this.sql.push(sql);
    const count = /^SELECT count\(\) FROM (\S+)$/.exec(sql);
    if (count) return new Response(`${this.rows.get(count[1]) ?? 0}\n`);
    if (sql.includes("system.query_log")) return new Response(`${this.slowQueries}\n`);
    const insert = /^INSERT INTO (\S+) .* FROM numbers\((\d+)\)$/.exec(sql);
    if (insert) this.rows.set(insert[1], Number(insert[2]));
    return new Response("");
  }

  private api(method: string, path: string, body: unknown): Response {
    const json = (data: unknown, status = 200): Response => new Response(JSON.stringify({ success: status < 400, data }), { status });
    const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? { ...value } : {});
    if (path === "/api/rbac/auth/login") {
      if (this.loginStatus !== 200) return new Response(JSON.stringify({ error: "Too many requests" }), { status: this.loginStatus });
      return json({ user: {}, tokens: { accessToken: "jwt" } });
    }
    if (path === "/api/rbac/connections" && method === "GET") return json({ connections: this.connections, total: this.connections.length });
    if (path === "/api/rbac/connections" && method === "POST") {
      const created = { ...record(body), id: `conn-${this.connections.length + 1}`, isDefault: false };
      this.connections.push(created);
      return json(created, 201);
    }
    if (path.startsWith("/api/rbac/connections/") && method === "PATCH") {
      const connection = this.connections.find((c) => c.id === path.split("/").pop());
      if (connection) Object.assign(connection, record(body));
      return json(connection);
    }
    if (path === "/api/rbac/user-preferences/preferences/onboarding" && method === "GET") {
      return new Response(JSON.stringify({ progress: {}, bootstrapOnboardingPending: this.bootstrapPending, requiresPasswordChange: this.requiresPasswordChange }));
    }
    if (path === "/api/rbac/user-preferences/preferences/onboarding" && method === "PATCH") {
      this.bootstrapPending = false;
      return new Response(JSON.stringify({ progress: {}, bootstrapOnboardingPending: false, requiresPasswordChange: false }));
    }
    if (path === "/api/rbac/ai-providers" && method === "GET") return json(this.providers);
    if (path === "/api/rbac/ai-providers" && method === "POST") {
      const created = { ...record(body), id: `prov-${this.providers.length + 1}` };
      this.providers.push(created);
      return json(created, 201);
    }
    if (path.startsWith("/api/rbac/ai-providers/") && method === "DELETE") {
      this.providers = this.providers.filter((p) => p.id !== path.split("/").pop());
      return json({ deleted: true });
    }
    if (path === "/api/rbac/ai-base-models") {
      if (this.failBaseModel) return new Response(JSON.stringify({ success: false, error: { code: "INVALID_PARAMS", message: "bad model" } }), { status: 400 });
      const created = { ...record(body), id: `model-${this.models.length + 1}` };
      this.models.push(created);
      return json(created, 201);
    }
    if (path === "/api/rbac/ai-models") {
      const created = { ...record(body), id: `cfg-${this.configs.length + 1}` };
      this.configs.push(created);
      this.aiEnabled = true;
      return json(created, 201);
    }
    if (path === "/api/query/execute" && String(record(body).query).includes("finance.")) {
      return new Response(JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "Access denied" } }), { status: 403 });
    }
    if (path === "/api/query/execute") {
      return json({ meta: [], data: [{ orders: String(this.rows.get("shop.orders_raw") ?? 0) }], rows: 1 });
    }
    if (path === "/api/config") return json({ features: { aiOptimizer: this.aiEnabled, mcpEnabled: false } });
    if (this.showcaseDown) return new Response(JSON.stringify({ success: false, error: { message: "boom" } }), { status: 500 });
    if (path === "/api/rbac/roles") return json({ roles: [{ id: "role-analyst", name: "analyst" }, { id: "role-dev", name: "developer" }, { id: "role-viewer", name: "viewer" }] });
    if (path === "/api/rbac/users") {
      if (method === "GET") return json({ users: this.list(path) });
      this.list(path).push(record(body));
      return json(record(body), 201);
    }
    const rolePolicy = /^\/api\/rbac\/data-access-policies\/role\/(.+)$/.exec(path);
    if (rolePolicy) {
      if (method === "POST") this.rolePolicies.set(rolePolicy[1], (record(body).policyIds as string[]) ?? []);
      return json((this.rolePolicies.get(rolePolicy[1]) ?? []).map((id) => ({ id })));
    }
    const context = /^\/api\/context\/tables\/(\w+)\/(\w+)(\/metrics)?$/.exec(path);
    if (context) {
      const key = `${context[1]}.${context[2]}`;
      if (method === "GET" && this.catalogPending && !this.curated.has(key)) return new Response(JSON.stringify({ success: false, error: { message: "Table not found" } }), { status: 404 });
      if (method === "GET") return json({ curated: this.curated.get(key) ?? null, metrics: (this.tableMetrics.get(key) ?? []).map((name) => ({ name })) });
      if (context[3]) this.tableMetrics.set(key, [...(this.tableMetrics.get(key) ?? []), String(record(body).name)]);
      else this.curated.set(key, record(body));
      return json({});
    }
    const instantiate = /^\/api\/dashboards\/templates\/(.+)\/instantiate$/.exec(path);
    if (instantiate) {
      const titles: Record<string, string> = { "clickhouse-overview": "ClickHouse overview", "query-latency": "Query latency", "disk-and-tables": "Disk and tables" };
      this.list("/api/dashboards").push({ title: titles[instantiate[1]], ...record(body) });
      return json({}, 201);
    }
    if (/^\/api\/scheduled-queries\/.+\/run$/.test(path)) return json({});
    const collections = ["/api/rbac/data-access-policies", "/api/saved-queries", "/api/dashboards", "/api/alerting/rules", "/api/scheduled-queries", "/api/data-health"];
    if (collections.includes(path)) {
      if (method === "GET") {
        if (path === "/api/scheduled-queries") return json({ jobs: this.list(path) });
        if (path === "/api/data-health") return json({ promises: this.list(path) });
        return json(this.list(path));
      }
      const created = { ...record(body), id: `${path.split("/").pop()}-${this.list(path).length + 1}` };
      this.list(path).push(created);
      return json(created, 201);
    }
    return new Response(JSON.stringify({ success: false, error: { message: `no route ${method} ${path}` } }), { status: 404 });
  }

  count(method: string, path: string): number {
    return this.calls.filter((c) => c.method === method && c.path === path).length;
  }
}

describe("readConfig", () => {
  it("names every missing secret", () => {
    expect(() => readConfig({})).toThrow(/LAB_ADMIN_PASSWORD, CLICKHOUSE_PASSWORD/);
  });

  it("defaults to the compose service names and trims trailing slashes", () => {
    const cfg = readConfig({ LAB_ADMIN_PASSWORD: "p", CLICKHOUSE_PASSWORD: "c", LAB_CHOUSE_URL: "http://x:1/" });
    expect(cfg.chouseUrl).toBe("http://x:1");
    expect(cfg.clickhouseUrl).toBe("http://clickhouse:8123");
    expect(cfg.clickhouseHost).toBe("clickhouse");
  });
});

describe("chooseAi", () => {
  it("is off without a key, including a blank one", () => {
    expect(chooseAi({})).toBeNull();
    expect(chooseAi({ OPENAI_API_KEY: "  " })).toBeNull();
  });

  it("prefers Anthropic when both keys are set and honours LAB_AI_MODEL", () => {
    expect(chooseAi({ OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" })?.providerType).toBe("anthropic");
    expect(chooseAi({ OPENAI_API_KEY: "o" })).toMatchObject({ providerType: "openai", modelId: "gpt-5-mini", apiKey: "o" });
    expect(chooseAi({ OPENAI_API_KEY: "o", LAB_AI_MODEL: "gpt-5" })?.modelId).toBe("gpt-5");
  });
});

describe("runSeed", () => {
  it("loads data, registers the default connection and completes setup on a fresh lab", async () => {
    const lab = new FakeLab();
    const report = await runSeed(ENV, lab.fetch, 0);

    expect(report).toMatchObject({ ok: true, ai: "off" });
    expect(lab.rows.get("shop.orders_raw")).toBeGreaterThan(0);
    expect(lab.connections).toHaveLength(1);
    expect(lab.connections[0]).toMatchObject({ name: "Lab ClickHouse", host: "clickhouse", port: 8123, username: "admin", password: "chpw", isDefault: true });
    expect(lab.bootstrapPending).toBe(false);
    expect(lab.calls[0]?.path).toBe("/api/rbac/auth/login");
  });

  it("changes nothing when run a second time", async () => {
    const lab = new FakeLab();
    await runSeed(ENV, lab.fetch, 0);
    const inserts = lab.sql.filter((s) => s.startsWith("INSERT")).length;
    lab.calls = [];

    const again = await runSeed(ENV, lab.fetch, 0);

    expect(again.ok).toBe(true);
    expect(again.steps.map((s) => s.detail)).toEqual(
      expect.arrayContaining(["sample data already present", '"Lab ClickHouse" already registered', "setup already complete"]),
    );
    expect(lab.sql.filter((s) => s.startsWith("INSERT")).length).toBe(inserts);
    expect(lab.connections).toHaveLength(1);
    expect(lab.calls.filter((c) => c.method !== "GET" && c.path !== "/api/rbac/auth/login")).toEqual([]);
  });

  it("stops after one rate-limited login instead of retrying", async () => {
    const lab = new FakeLab();
    lab.loginStatus = 429;
    const report = await runSeed(ENV, lab.fetch, 0);

    expect(report.ok).toBe(false);
    expect(report.steps.find((s) => s.step === "admin login")?.detail).toMatch(/429.*rate limited/);
    expect(lab.count("POST", "/api/rbac/auth/login")).toBe(1);
    expect(lab.calls).toHaveLength(1);
  });

  it("explains how to recover when the admin still has the default password", async () => {
    const lab = new FakeLab();
    lab.requiresPasswordChange = true;
    const report = await runSeed(ENV, lab.fetch, 0);

    expect(report.ok).toBe(false);
    expect(report.steps.find((s) => s.step === "setup")?.detail).toMatch(/down -v/);
  });

  it("retries while a service is still starting", async () => {
    const lab = new FakeLab();
    lab.networkFailures = 2;
    expect((await runSeed(ENV, lab.fetch, 0)).ok).toBe(true);
  });

  it("reports a missing secret without calling anything", async () => {
    const lab = new FakeLab();
    const report = await runSeed({}, lab.fetch, 0);
    expect(report).toMatchObject({ ok: false, steps: [{ step: "config", ok: false }] });
    expect(lab.calls).toHaveLength(0);
  });

  it("configures the visitor's AI provider once, as the default model", async () => {
    const lab = new FakeLab();
    const env = { ...ENV, ANTHROPIC_API_KEY: "sk-ant" };
    const report = await runSeed(env, lab.fetch, 0);

    expect(report).toMatchObject({ ok: true, ai: "on" });
    expect(lab.providers).toEqual([expect.objectContaining({ name: "Lab Anthropic", providerType: "anthropic", apiKey: "sk-ant" })]);
    expect(lab.models).toEqual([expect.objectContaining({ providerId: "prov-1", modelId: "claude-haiku-5-5", params: { contextWindow: 200_000 } })]);
    expect(lab.configs).toEqual([expect.objectContaining({ modelId: "model-1", isActive: true, isDefault: true })]);

    const again = await runSeed(env, lab.fetch, 0);
    expect(again.ai).toBe("on");
    expect(lab.providers).toHaveLength(1);
    expect(lab.configs).toHaveLength(1);
  });

  it("rolls the provider back when the model can't be added, without failing the lab", async () => {
    const lab = new FakeLab();
    lab.failBaseModel = true;
    const report = await runSeed({ ...ENV, OPENAI_API_KEY: "sk" }, lab.fetch, 0);

    expect(report).toMatchObject({ ok: true, ai: "failed" });
    expect(report.steps.find((s) => s.step === "ai")?.detail).toMatch(/bad model/);
    expect(lab.providers).toEqual([]);
  });
});

describe("smoke checks", () => {
  async function seeded(): Promise<{ lab: FakeLab; api: ChouseApi }> {
    const lab = new FakeLab();
    await runSeed(ENV, lab.fetch, 0);
    const api = new ChouseApi("http://chouse:5521", lab.fetch, 0);
    await api.login("admin", "x");
    return { lab, api };
  }

  it("passes on a seeded lab", async () => {
    const { lab } = await seeded();
    const report = await runSmoke(ENV, lab.fetch);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("fails when the connection was registered twice", async () => {
    const { lab, api } = await seeded();
    lab.connections.push({ ...lab.connections[0], id: "conn-2" });
    await expect(checkSingleConnection(api)).rejects.toThrow(/expected 1 .* found 2/);
  });

  it("fails when the API sees fewer rows than were loaded", async () => {
    const { lab, api } = await seeded();
    lab.rows.set("shop.orders_raw", 10);
    await expect(checkQueryThroughApi(api, "conn-1")).rejects.toThrow(/expected at least/);
  });

  it("fails when the analyst can read the finance table", async () => {
    const { lab } = await seeded();
    const leaky: FetchLike = async (input, init) => {
      if (input.endsWith("/api/query/execute")) return new Response(JSON.stringify({ success: true, data: { data: [{ orders: "1" }] } }));
      return lab.fetch(input, init);
    };
    const report = await runSmoke(ENV, leaky);
    expect(report.checks.find((c) => c.step === "analyst boundary")).toMatchObject({ ok: false, detail: expect.stringMatching(/maya could read/) });
  });

  it("gives up waiting for the slow query after the deadline", async () => {
    const lab = new FakeLab();
    lab.slowQueries = 0;
    await expect(checkSlowQuery(readConfig(ENV), lab.fetch, 0, 0)).rejects.toThrow(/load service/);
  });

  it("fails when AI is on but no key was supplied", async () => {
    const { lab } = await seeded();
    lab.aiEnabled = true;
    const report = await runSmoke(ENV, lab.fetch);
    expect(report.checks.find((c) => c.step === "ai flag")).toMatchObject({ ok: false });
  });

  it("surfaces API errors with their status and code", async () => {
    const lab = new FakeLab();
    const api = new ChouseApi("http://chouse:5521", lab.fetch, 0);
    const error = await api.request("GET", "/api/nope").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LabError);
    expect(error).toMatchObject({ status: 404 });
  });
});

describe("showcase", () => {
  it("fills every area on a fresh lab", async () => {
    const lab = new FakeLab();
    const report = await runSeed(ENV, lab.fetch, 0);

    expect(report.steps.filter((s) => !s.ok)).toEqual([]);
    expect(report.steps.map((s) => s.step)).toEqual(expect.arrayContaining([...SHOWCASE_STEPS]));
    expect(lab.list("/api/rbac/users").map((u) => u.username)).toEqual(TEAM.map((m) => m.username));
    expect(lab.list("/api/rbac/users")[0]).toMatchObject({ password: ENV.LAB_ADMIN_PASSWORD, roleIds: ["role-analyst"] });
    expect(lab.list("/api/saved-queries")).toHaveLength(SAVED_QUERIES.length);
    expect(lab.list("/api/saved-queries")[0]).toMatchObject({ connectionId: "conn-1", isPublic: true });
    expect(lab.list("/api/dashboards").map((d) => d.title)).toEqual(["ClickHouse overview", "Query latency", "Disk and tables", "Shop sales"]);
    expect(lab.list("/api/alerting/rules")).toEqual([expect.objectContaining({ sourceType: "fleet_threshold", enabled: true })]);
    expect(lab.list("/api/scheduled-queries")).toHaveLength(1);
    expect(lab.list("/api/data-health").map((p) => p.name)).toEqual(["Orders keep arriving", "Shop orders are in EUR"]);
    expect([...lab.curated.keys()]).toEqual(["shop.orders_raw", "shop.customers", "analytics.orders_daily"]);
    expect(lab.tableMetrics.get("shop.orders_raw")).toEqual(["revenue"]);
  });

  it("adds the analyst policy without dropping the role's existing policies", async () => {
    const lab = new FakeLab();
    await runSeed(ENV, lab.fetch, 0);
    expect(lab.rolePolicies.get("role-analyst")).toEqual(["policy-system", "data-access-policies-1"]);
  });

  it("creates nothing the second time and never overwrites table context the visitor edited", async () => {
    const lab = new FakeLab();
    await runSeed(ENV, lab.fetch, 0);
    lab.curated.set("shop.customers", { description: "edited by the visitor" });
    lab.calls = [];

    const again = await runSeed(ENV, lab.fetch, 0);

    expect(again.steps.filter((s) => !s.ok)).toEqual([]);
    expect(lab.calls.filter((c) => c.method !== "GET" && c.path !== "/api/rbac/auth/login")).toEqual([]);
    expect(lab.curated.get("shop.customers")).toEqual({ description: "edited by the visitor" });
  });

  it("writes table context before CHouse UI's catalog has seen the tables", async () => {
    const lab = new FakeLab();
    lab.catalogPending = true;
    const report = await runSeed(ENV, lab.fetch, 0);
    expect(report.steps.find((s) => s.step === "table context")).toMatchObject({ ok: true });
    expect(lab.curated.size).toBe(3);
  });

  it("warns but keeps the lab usable when the showcase API fails", async () => {
    const lab = new FakeLab();
    lab.showcaseDown = true;
    const report = await runSeed(ENV, lab.fetch, 0);

    expect(report.ok).toBe(true);
    expect(report.steps.filter((s) => !s.ok).map((s) => s.step)).toEqual([...SHOWCASE_STEPS]);
  });

  it("scopes the shop dashboard to the lab connection with a unique id per panel", () => {
    const dashboard = shopDashboard("conn-9");
    expect(dashboard.connectionScope).toEqual({ kind: "only", connectionIds: ["conn-9"] });
    const panels = Array.isArray(dashboard.panels) ? dashboard.panels : [];
    const ids = panels.map((p: unknown) => (typeof p === "object" && p !== null && "id" in p ? p.id : null));
    expect(new Set(ids).size).toBe(panels.length);
  });
});
