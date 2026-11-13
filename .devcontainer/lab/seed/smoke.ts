// The lab's smoke check, run by CI (.github/workflows/lab.yml) after the
// loader: `docker compose run --rm seed /lab/smoke.ts`. It checks what a
// visitor depends on, through the same API the browser uses. Prints a JSON
// report on stdout and exits non-zero when any check fails.

import {
  ChouseApi,
  LAB_CONNECTION_NAME,
  LabError,
  SAMPLE_ORDER_ROWS,
  arrayField,
  booleanField,
  clickhouseQuery,
  isRecord,
  objectField,
  readConfig,
  runStep,
  stringField,
} from "./lib.ts";
import type { FetchLike, LabConfig, StepResult } from "./lib.ts";
import { CURRENCY_PROMISE, FRESHNESS_PROMISE, SAVED_QUERIES, SHOP_DASHBOARD, TEAM } from "./showcase.ts";

const SLOW_QUERY_WAIT_MS = 180_000;
const POLL_MS = 5_000;

/** Exactly one lab connection exists (the loader is idempotent). Returns its id. */
export async function checkSingleConnection(api: ChouseApi): Promise<string> {
  const data = await api.request("GET", "/api/rbac/connections");
  const matches = arrayField(data, "connections").filter((c) => stringField(c, "name") === LAB_CONNECTION_NAME);
  if (matches.length !== 1) throw new Error(`expected 1 "${LAB_CONNECTION_NAME}" connection, found ${matches.length}`);
  const id = stringField(matches[0], "id");
  if (!id) throw new Error("the lab connection has no id");
  return id;
}

/** The first-run flow is done: no password change and no pending setup. */
export async function checkSetup(api: ChouseApi): Promise<string> {
  const state = await api.request("GET", "/api/rbac/user-preferences/preferences/onboarding");
  if (booleanField(state, "requiresPasswordChange") !== false) throw new Error("the admin is asked to change the password");
  if (booleanField(state, "bootstrapOnboardingPending") !== false) throw new Error("first-install setup is still pending");
  return "no password change, setup complete";
}

/** A query through the CHouse API (the SQL workspace's path) sees the sample orders. */
export async function checkQueryThroughApi(api: ChouseApi, connectionId: string): Promise<string> {
  const result = await api.request(
    "POST",
    "/api/query/execute",
    { query: "SELECT count() AS orders FROM shop.orders_raw", format: "JSON" },
    { "X-Connection-Id": connectionId },
  );
  const rows = arrayField(isRecord(result) && "data" in result && !Array.isArray(result.data) ? result.data : result, "data");
  const first = rows[0];
  const orders = Number(isRecord(first) ? first.orders : Number.NaN);
  if (!(orders >= SAMPLE_ORDER_ROWS)) throw new Error(`expected at least ${SAMPLE_ORDER_ROWS} orders, got ${String(orders)}`);
  return `${orders} orders visible through the API`;
}

/** The load loop's planted slow query reached system.query_log. */
export async function checkSlowQuery(cfg: LabConfig, fetchImpl: FetchLike, waitMs = SLOW_QUERY_WAIT_MS, pollMs = POLL_MS): Promise<string> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    await clickhouseQuery(cfg, "SYSTEM FLUSH LOGS", fetchImpl);
    const count = Number(
      (await clickhouseQuery(
        cfg,
        "SELECT count() FROM system.query_log WHERE log_comment = 'lab:slow-query' AND type = 'QueryFinish'",
        fetchImpl,
      )).trim(),
    );
    if (count > 0) return `${count} planted slow quer${count === 1 ? "y" : "ies"} logged`;
    if (Date.now() >= deadline) throw new Error(`no lab:slow-query finished within ${Math.round(waitMs / 1000)} s; is the load service running?`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** The example content is there: teammates, saved queries, the shop dashboard and both data-health promises. */
export async function checkShowcase(api: ChouseApi): Promise<string> {
  const missing: string[] = [];
  const users = arrayField(await api.request("GET", "/api/rbac/users"), "users").map((u) => stringField(u, "username"));
  for (const member of TEAM) if (!users.includes(member.username)) missing.push(`user ${member.username}`);
  const saved = await api.request("GET", "/api/saved-queries");
  const savedNames = (Array.isArray(saved) ? saved : []).map((q) => stringField(q, "name"));
  for (const q of SAVED_QUERIES) if (!savedNames.includes(q.name)) missing.push(`saved query "${q.name}"`);
  const dashboards = await api.request("GET", "/api/dashboards");
  if (!(Array.isArray(dashboards) ? dashboards : []).some((d) => stringField(d, "title") === SHOP_DASHBOARD)) missing.push(`dashboard "${SHOP_DASHBOARD}"`);
  const promises = arrayField(await api.request("GET", "/api/data-health"), "promises").map((p) => stringField(p, "name"));
  for (const name of [FRESHNESS_PROMISE, CURRENCY_PROMISE]) if (!promises.includes(name)) missing.push(`promise "${name}"`);
  if (missing.length > 0) throw new Error(`missing ${missing.join(", ")}`);
  return "teammates, saved queries, dashboards and data-health promises present";
}

/** An analyst reads the sample shop but is refused the finance table outside her data access policy. */
export async function checkAnalystBoundary(cfg: LabConfig, fetchImpl: FetchLike, connectionId: string): Promise<string> {
  const analyst = new ChouseApi(cfg.chouseUrl, fetchImpl);
  await analyst.login("maya", cfg.adminPassword);
  const run = (query: string): Promise<unknown> => analyst.request("POST", "/api/query/execute", { query, format: "JSON" }, { "X-Connection-Id": connectionId });
  await run("SELECT count() FROM shop.orders_raw");
  const denied = await run("SELECT count() FROM finance.payouts").then(() => null, (error: unknown) => error);
  if (!(denied instanceof LabError) || denied.status !== 403) {
    throw new Error(`maya could read finance.payouts (expected 403, got ${denied instanceof LabError ? denied.status : "success"})`);
  }
  return "maya reads shop, is refused finance.payouts";
}

/** The AI feature flag matches whether a key was supplied. */
export async function checkAiFlag(api: ChouseApi, expectAi: boolean): Promise<string> {
  const config = await api.request("GET", "/api/config");
  const enabled = booleanField(objectField(config, "features"), "aiOptimizer");
  if (enabled !== expectAi) throw new Error(`AI is ${enabled ? "on" : "off"}, expected ${expectAi ? "on" : "off"}`);
  return `AI ${expectAi ? "on" : "off"} as expected`;
}

/** The smoke check's report. */
export interface SmokeReport {
  ok: boolean;
  checks: StepResult[];
}

/** Runs every check; later checks that need the login or connection are skipped when those fail. */
export async function runSmoke(env: Record<string, string | undefined>, fetchImpl: FetchLike): Promise<SmokeReport> {
  const checks: StepResult[] = [];
  let cfg: LabConfig;
  try {
    cfg = readConfig(env);
  } catch (error) {
    return { ok: false, checks: [{ step: "config", ok: false, detail: error instanceof Error ? error.message : String(error) }] };
  }
  const api = new ChouseApi(cfg.chouseUrl, fetchImpl);
  const login = await runStep("admin login", async () => {
    await api.login(cfg.adminIdentifier, cfg.adminPassword);
    return "signed in with the generated password";
  });
  checks.push(login);
  if (login.ok) {
    checks.push(await runStep("setup", () => checkSetup(api)));
    let connectionId = "";
    const single = await runStep("one connection", async () => {
      connectionId = await checkSingleConnection(api);
      return `exactly one "${LAB_CONNECTION_NAME}"`;
    });
    checks.push(single);
    if (single.ok) {
      checks.push(await runStep("query via API", () => checkQueryThroughApi(api, connectionId)));
      checks.push(await runStep("analyst boundary", () => checkAnalystBoundary(cfg, fetchImpl, connectionId)));
    }
    const expectAi = Boolean(env.ANTHROPIC_API_KEY?.trim() || env.OPENAI_API_KEY?.trim());
    checks.push(await runStep("ai flag", () => checkAiFlag(api, expectAi)));
    checks.push(await runStep("showcase", () => checkShowcase(api)));
  }
  checks.push(await runStep("slow query", () => checkSlowQuery(cfg, fetchImpl)));
  return { ok: checks.every((c) => c.ok), checks };
}

if (process.argv[1]?.endsWith("smoke.ts")) {
  const report = await runSmoke(process.env, fetch);
  for (const c of report.checks) process.stderr.write(`${c.ok ? "PASS" : "FAIL"}  ${c.step}: ${c.detail}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(report.ok ? 0 : 1);
}
