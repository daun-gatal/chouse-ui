// The lab's sample-data loader. Run by up.sh as
// `docker compose run --rm seed` (Bun inside the CHouse image). Safe to run
// again: every step checks what already exists first.
//
// It prints one JSON report on stdout, which up.sh saves for the ready banner,
// and exits non-zero when a required step failed. AI is optional, so a failed
// AI step is reported but does not fail the run.

import {
  ChouseApi,
  LAB_CONNECTION_NAME,
  SAMPLE_ORDER_ROWS,
  arrayField,
  booleanField,
  chooseAi,
  clickhouseQuery,
  isRecord,
  readConfig,
  runStep,
  stringField,
} from "./lib.ts";
import type { AiChoice, FetchLike, LabConfig, StepResult } from "./lib.ts";
import { SHOWCASE_STEPS, runShowcase } from "./showcase.ts";

/** Schema for the sample shop (raw orders, customers, a daily rollup fed by a materialized view) and a small finance table. */
export const SAMPLE_SCHEMA: readonly string[] = [
  "CREATE DATABASE IF NOT EXISTS shop",
  "CREATE TABLE IF NOT EXISTS shop.orders_raw (order_id UInt64, customer_id UInt64, amount Decimal(18, 2), currency LowCardinality(String), country LowCardinality(String), created_at DateTime) ENGINE = MergeTree PARTITION BY toYYYYMM(created_at) ORDER BY (created_at, order_id)",
  "CREATE TABLE IF NOT EXISTS shop.customers (customer_id UInt64, name String, country LowCardinality(String), updated_at DateTime) ENGINE = ReplacingMergeTree(updated_at) ORDER BY customer_id",
  "CREATE DATABASE IF NOT EXISTS analytics",
  "CREATE TABLE IF NOT EXISTS analytics.orders_daily (day Date, country LowCardinality(String), orders UInt64, revenue Decimal(38, 2)) ENGINE = SummingMergeTree ORDER BY (day, country)",
  // Outside the analyst policy, so signing in as an analyst shows a denial.
  "CREATE DATABASE IF NOT EXISTS finance",
  "CREATE TABLE IF NOT EXISTS finance.payouts (payout_id UInt64, customer_id UInt64, amount Decimal(18, 2), paid_at DateTime) ENGINE = MergeTree ORDER BY (paid_at, payout_id)",
  "CREATE MATERIALIZED VIEW IF NOT EXISTS shop.mv_orders_agg TO analytics.orders_daily AS SELECT toDate(created_at) AS day, country, count() AS orders, sum(amount) AS revenue FROM shop.orders_raw GROUP BY day, country",
];

/** Data for each sample table, inserted only while that table is empty. */
export const SAMPLE_DATA: ReadonlyArray<{ table: string; insert: string }> = [
  {
    table: "shop.customers",
    insert: "INSERT INTO shop.customers SELECT number, concat('customer-', toString(number)), ['DE', 'FR', 'NL', 'US', 'ID', 'JP'][number % 6 + 1], now() FROM numbers(50000)",
  },
  {
    table: "finance.payouts",
    insert: "INSERT INTO finance.payouts SELECT number, number % 50000, toDecimal64((number % 50000) / 10, 2), now() - toIntervalHour(number % 720) FROM numbers(5000)",
  },
  {
    // Spread over the last 30 days so "last day" and "last week" views have data.
    table: "shop.orders_raw",
    insert: `INSERT INTO shop.orders_raw SELECT number, number % 50000, toDecimal64((number % 19997) / 100, 2), if(number % 10 = 0, 'USD', 'EUR'), ['DE', 'FR', 'NL', 'US', 'ID', 'JP'][number % 6 + 1], now() - toIntervalSecond(number % 2592000) FROM numbers(${SAMPLE_ORDER_ROWS})`,
  },
];

/** Creates the sample databases and fills empty tables. */
export async function loadSampleData(cfg: LabConfig, fetchImpl: FetchLike, retryMs?: number): Promise<string> {
  for (const statement of SAMPLE_SCHEMA) await clickhouseQuery(cfg, statement, fetchImpl, retryMs);
  const filled: string[] = [];
  for (const { table, insert } of SAMPLE_DATA) {
    const count = Number((await clickhouseQuery(cfg, `SELECT count() FROM ${table}`, fetchImpl, retryMs)).trim());
    if (Number.isNaN(count)) throw new Error(`Could not count rows in ${table}`);
    if (count > 0) continue;
    await clickhouseQuery(cfg, insert, fetchImpl, retryMs);
    filled.push(table);
  }
  return filled.length > 0 ? `loaded ${filled.join(", ")}` : "sample data already present";
}

/** Finds the lab connection by exact name, or returns null. */
export async function findLabConnection(api: ChouseApi): Promise<Record<string, unknown> | null> {
  const data = await api.request("GET", `/api/rbac/connections?search=${encodeURIComponent(LAB_CONNECTION_NAME)}`);
  for (const item of arrayField(data, "connections")) {
    if (isRecord(item) && stringField(item, "name") === LAB_CONNECTION_NAME) return item;
  }
  return null;
}

/** Registers the lab's ClickHouse once and makes it the default connection. */
export async function ensureConnection(api: ChouseApi, cfg: LabConfig): Promise<{ id: string; detail: string }> {
  let connection = await findLabConnection(api);
  let created = false;
  if (!connection) {
    const data = await api.request("POST", "/api/rbac/connections", {
      name: LAB_CONNECTION_NAME,
      host: cfg.clickhouseHost,
      port: 8123,
      username: cfg.clickhouseUser,
      password: cfg.clickhousePassword,
      sslEnabled: false,
    });
    connection = isRecord(data) ? data : null;
    created = true;
  }
  const id = stringField(connection, "id");
  if (!id) throw new Error("The connection response had no id");
  if (booleanField(connection, "isDefault") !== true) {
    await api.request("PATCH", `/api/rbac/connections/${encodeURIComponent(id)}`, { isDefault: true });
  }
  return { id, detail: created ? `registered "${LAB_CONNECTION_NAME}"` : `"${LAB_CONNECTION_NAME}" already registered` };
}

/**
 * Finishes first-install setup so the Getting Started tour opens on its
 * chapters, not on a password change. The visitor's tour progress is left
 * alone.
 */
export async function completeSetup(api: ChouseApi): Promise<string> {
  const state = await api.request("GET", "/api/rbac/user-preferences/preferences/onboarding");
  if (booleanField(state, "requiresPasswordChange") === true) {
    throw new Error("The admin still has the default password. The lab volume predates up.sh's generated password: run `docker compose -f .devcontainer/lab/compose.yml down -v` and start again.");
  }
  if (booleanField(state, "bootstrapOnboardingPending") !== true) return "setup already complete";
  await api.request("PATCH", "/api/rbac/user-preferences/preferences/onboarding", { bootstrapComplete: true });
  return "setup marked complete";
}

/**
 * Registers the visitor's AI provider, its model and a default model config.
 * Skips when a lab provider exists. If a later call fails, the new provider
 * is deleted again so the next run starts clean instead of skipping a
 * half-configured provider.
 */
export async function ensureAi(api: ChouseApi, choice: AiChoice): Promise<string> {
  const providers = await api.request("GET", "/api/rbac/ai-providers");
  const existing = Array.isArray(providers) ? providers.find((p) => stringField(p, "name") === choice.providerName) : undefined;
  if (existing) return `"${choice.providerName}" already configured`;

  const provider = await api.request("POST", "/api/rbac/ai-providers", {
    name: choice.providerName,
    providerType: choice.providerType,
    apiKey: choice.apiKey,
  });
  const providerId = stringField(provider, "id");
  if (!providerId) throw new Error("The AI provider response had no id");
  try {
    const model = await api.request("POST", "/api/rbac/ai-base-models", {
      providerId,
      name: choice.modelId,
      modelId: choice.modelId,
      params: { contextWindow: choice.contextWindow },
    });
    const modelId = stringField(model, "id");
    if (!modelId) throw new Error("The AI model response had no id");
    await api.request("POST", "/api/rbac/ai-models", {
      modelId,
      name: `${choice.providerName} · ${choice.modelId}`,
      isActive: true,
      isDefault: true,
    });
  } catch (error) {
    await api.request("DELETE", `/api/rbac/ai-providers/${encodeURIComponent(providerId)}`).catch(() => undefined);
    throw error;
  }
  return `configured ${choice.providerType} with ${choice.modelId}`;
}

/** Steps whose failure is reported but does not fail the lab. */
const OPTIONAL_STEPS = new Set<string>(["ai", ...SHOWCASE_STEPS]);

/** The loader's report: overall result plus one line per step. */
export interface SeedReport {
  ok: boolean;
  ai: "off" | "on" | "failed";
  steps: StepResult[];
}

/** Runs every step in order; a failed required step stops the steps that depend on it. */
export async function runSeed(env: Record<string, string | undefined>, fetchImpl: FetchLike, retryMs?: number): Promise<SeedReport> {
  const steps: StepResult[] = [];
  let cfg: LabConfig;
  try {
    cfg = readConfig(env);
  } catch (error) {
    steps.push({ step: "config", ok: false, detail: error instanceof Error ? error.message : String(error) });
    return { ok: false, ai: "off", steps };
  }

  steps.push(await runStep("sample data", () => loadSampleData(cfg, fetchImpl, retryMs)));

  const api = new ChouseApi(cfg.chouseUrl, fetchImpl, retryMs);
  const login = await runStep("admin login", async () => {
    await api.login(cfg.adminIdentifier, cfg.adminPassword);
    return "signed in";
  });
  steps.push(login);
  if (!login.ok) return { ok: false, ai: "off", steps };

  let connectionId = "";
  const connection = await runStep("connection", async () => {
    const result = await ensureConnection(api, cfg);
    connectionId = result.id;
    return result.detail;
  });
  steps.push(connection);
  // Setup can only be completed once a connection exists.
  if (connection.ok) steps.push(await runStep("setup", () => completeSetup(api)));

  const choice = chooseAi(env);
  let ai: SeedReport["ai"] = "off";
  if (choice) {
    const result = await runStep("ai", () => ensureAi(api, choice));
    steps.push(result);
    ai = result.ok ? "on" : "failed";
  } else {
    steps.push({ step: "ai", ok: true, detail: "off (no OPENAI_API_KEY or ANTHROPIC_API_KEY secret)" });
  }

  // Example content for every area; optional, like AI.
  const showcase = connection.ok ? await runShowcase(api, connectionId, cfg.adminPassword) : [];
  steps.push(...showcase);

  const ok = steps.filter((s) => !OPTIONAL_STEPS.has(s.step)).every((s) => s.ok);
  return { ok, ai, steps };
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const report = await runSeed(process.env, fetch);
  for (const s of report.steps) {
    const label = s.ok ? "PASS" : OPTIONAL_STEPS.has(s.step) ? "WARN" : "FAIL";
    process.stderr.write(`${label}  ${s.step}: ${s.detail}\n`);
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(report.ok ? 0 : 1);
}
