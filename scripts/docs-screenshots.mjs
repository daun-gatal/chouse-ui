// Docs screenshot capture — run by scripts/docs-screenshots.sh inside a
// Playwright container on the compose network (never against localhost: on
// DinD the published ports live on the Docker host).
//
// Seeds a small demo workload, waits for the collector, then captures every
// screen the docs show, in dark mode at 1440×900, as JPEGs in /out. The file
// names are what pages reference with `screenshot:` frontmatter.
//
// Logs go to stderr; stdout is reserved for the tar stream of /out.

/* global process, Buffer, console, setTimeout, fetch, window -- Node script; `window` is inside a page init script */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const APP = process.env.APP_URL ?? "http://chouse-ui:5521";
const CH = process.env.CH_URL ?? "http://clickhouse:8123";
const CH_AUTH = "Basic " + Buffer.from("admin:password").toString("base64");
const SEED_PASSWORD = "admin123!";
// The first-run password must be replaced before setup completes. Generate a
// fresh one per run (the stack is thrown away afterwards); the fixed prefix
// satisfies the upper/lower/digit/symbol policy.
const DEMO_PASSWORD = `Aa1!${randomBytes(12).toString("hex")}`;
const WAIT_SECONDS = Number(process.env.SHOTS_WAIT_SECONDS ?? 150);
const OUT = "/out";

const log = (...args) => console.error("[shots]", ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Click a tab inside the page (e.g. Agents › Assistant's sub-tabs) before the capture. */
const openTab = (name) => async (page) => {
  await page.getByRole("tab", { name, exact: true }).click();
};

/**
 * [file name, app route, optional action run before the capture] — file names
 * are referenced by docs frontmatter.
 */
const SHOTS = [
  ["home", "/overview"],
  ["explorer", "/explorer"],
  ["fleet", "/fleet"],
  ["monitoring-live-queries", "/monitoring/live-queries"],
  ["monitoring-query-logs", "/monitoring/logs"],
  ["monitoring-metrics", "/monitoring/metrics"],
  ["monitoring-parts", "/monitoring/parts"],
  ["monitoring-schema-advisor", "/monitoring/schema"],
  ["monitoring-cluster", "/monitoring/cluster"],
  ["monitoring-errors", "/monitoring/errors"],
  ["monitoring-performance", "/monitoring/performance"],
  ["monitoring-capacity", "/monitoring/capacity"],
  ["monitoring-upgrades", "/monitoring/upgrades"],
  ["data-overview", "/data/overview"],
  ["data-incidents", "/data/incidents"],
  ["data-lineage", "/data/lineage"],
  ["data-pipelines", "/data/pipelines"],
  ["data-datasets", "/data/datasets"],
  ["data-coverage", "/data/coverage"],
  ["data-context", "/data/context"],
  ["data-scheduled-queries", "/data/scheduled-queries"],
  ["doctor", "/doctor"],
  ["agents-sessions", "/agents/sessions"],
  ["agents-policies", "/agents/policies"],
  ["agents-mcp", "/agents/mcp"],
  ["ai-agents-features", "/agents/assistant"],
  ["ai-agents-tree", "/agents/assistant", openTab("Agents")],
  ["ai-agents-editor", "/agents/assistant", async (page) => {
    await openTab("Agents")(page);
    await page.getByRole("button", { name: "SQL Optimizer", exact: true }).click();
    await page.getByRole("dialog").waitFor();
  }],
  ["ai-agents-harnesses", "/agents/assistant", openTab("Harnesses")],
  ["ai-agents-skills", "/agents/assistant", openTab("Skills")],
  ["ai-agents-tools", "/agents/assistant", openTab("Tools")],
  ["ai-agents-test-console", "/agents/assistant", openTab("Test console")],
  ["admin-users", "/admin/users"],
  ["admin-roles", "/admin/roles"],
  ["admin-data-access", "/admin/data-access"],
  ["admin-connections", "/admin/connections"],
  ["admin-ai-models", "/admin/ai-models"],
  ["admin-sso", "/admin/sso"],
  ["admin-audit", "/admin/audit"],
  ["admin-alerting", "/admin/alerting"],
  ["preferences", "/preferences"],
];

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function ch(sql) {
  const res = await fetch(CH, { method: "POST", headers: { Authorization: CH_AUTH }, body: sql });
  if (!res.ok) throw new Error(`ClickHouse: ${(await res.text()).slice(0, 300)}\n${sql}`);
  return res.text();
}

async function waitFor(what, fn, seconds = 300) {
  for (let i = 0; i < seconds; i++) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready yet */
    }
    await sleep(1000);
  }
  throw new Error(`${what} never became ready`);
}

async function login(identifier, password) {
  const res = await api("POST", "/api/rbac/auth/login", { body: { identifier, password } });
  return res.data.tokens.accessToken;
}

async function seedClickHouse() {
  log("seeding ClickHouse demo workload");
  const statements = [
    "CREATE DATABASE IF NOT EXISTS shop",
    `CREATE TABLE IF NOT EXISTS shop.orders (
       order_id UInt64, customer_id UInt32, status LowCardinality(String),
       amount Decimal(12, 2), country LowCardinality(String), created_at DateTime
     ) ENGINE = MergeTree PARTITION BY toYYYYMM(created_at) ORDER BY (created_at, order_id)`,
    `CREATE TABLE IF NOT EXISTS shop.events (
       event_time DateTime, user_id UInt64, event LowCardinality(String), page String, duration_ms Nullable(UInt32)
     ) ENGINE = MergeTree ORDER BY (event_time, user_id)`,
    `CREATE TABLE IF NOT EXISTS shop.orders_daily (day Date, country LowCardinality(String), orders UInt64, gmv Decimal(18, 2))
     ENGINE = SummingMergeTree ORDER BY (day, country)`,
    `CREATE MATERIALIZED VIEW IF NOT EXISTS shop.orders_daily_mv TO shop.orders_daily AS
     SELECT toDate(created_at) AS day, country, count() AS orders, sumIf(amount, status = 'paid') AS gmv
     FROM shop.orders GROUP BY day, country`,
    "CREATE DATABASE IF NOT EXISTS analytics",
    `CREATE TABLE IF NOT EXISTS analytics.customer_ltv (customer_id UInt32, ltv Decimal(18, 2), orders UInt64, updated_at DateTime)
     ENGINE = ReplacingMergeTree(updated_at) ORDER BY customer_id`,
  ];
  for (const sql of statements) await ch(sql);

  // Several write batches so freshness and volume have a cadence to learn.
  for (let batch = 0; batch < 12; batch++) {
    await ch(`INSERT INTO shop.orders SELECT
        number + ${batch * 20000}, rand() % 5000,
        ['paid','paid','paid','pending','refunded'][rand() % 5 + 1],
        round((rand() % 50000) / 100, 2),
        ['ID','SG','MY','TH','VN','PH'][rand() % 6 + 1],
        now() - toIntervalMinute(${(11 - batch) * 10}) - toIntervalSecond(rand() % 600)
      FROM numbers(20000)`);
    await ch(`INSERT INTO shop.events SELECT
        now() - toIntervalSecond(rand() % 7200), rand() % 100000,
        ['view','click','add_to_cart','checkout'][rand() % 4 + 1],
        concat('/p/', toString(rand() % 500)), if(rand() % 7 = 0, NULL, rand() % 4000)
      FROM numbers(50000)`);
  }
  await ch(`INSERT INTO analytics.customer_ltv
      SELECT customer_id, sumIf(amount, status = 'paid'), count(), now() FROM shop.orders GROUP BY customer_id`);

  // A read workload for query logs, usage, criticality and performance.
  const reads = [
    "SELECT country, sum(amount) FROM shop.orders WHERE created_at > now() - INTERVAL 1 HOUR GROUP BY country",
    "SELECT status, count() FROM shop.orders GROUP BY status",
    "SELECT * FROM shop.orders_daily ORDER BY day DESC LIMIT 50",
    "SELECT event, uniq(user_id) FROM shop.events GROUP BY event",
    "SELECT page, avg(duration_ms) FROM shop.events WHERE event = 'view' GROUP BY page ORDER BY 2 DESC LIMIT 20",
    "SELECT customer_id, ltv FROM analytics.customer_ltv ORDER BY ltv DESC LIMIT 10",
  ];
  for (let round = 0; round < 15; round++) for (const sql of reads) await ch(sql);
  await ch("SELECT * FROM shop.does_not_exist").catch(() => undefined); // an entry for Errors
  await ch("SYSTEM FLUSH LOGS");
}

async function seedApp() {
  log("signing in and finishing first-run setup");
  let token = await login("admin@localhost", SEED_PASSWORD);
  await api("POST", "/api/rbac/auth/change-password", {
    token,
    body: { currentPassword: SEED_PASSWORD, newPassword: DEMO_PASSWORD },
  });
  token = await login("admin@localhost", DEMO_PASSWORD);

  const conn = await api("POST", "/api/rbac/connections", {
    token,
    body: { name: "Production", host: "clickhouse.", port: 8123, username: "admin", password: "password" },
  });
  await api("PATCH", `/api/rbac/connections/${conn.data.id}`, { token, body: { isDefault: true } });
  await api("PATCH", "/api/rbac/user-preferences/preferences/onboarding", {
    token,
    body: { welcomeSeen: true, bootstrapComplete: true },
  });
  await api("POST", "/api/rbac/pats", { token, body: { name: "ci-nightly-report" } }).catch((e) => log("PAT:", e.message));
}

async function capture() {
  mkdirSync(OUT, { recursive: true });
  // The app needs a secure context (crypto APIs); on the compose network it is
  // served over plain HTTP from a non-localhost name, so tell Chromium to trust it.
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${APP}`] });
  // The container has no locale; without one Intl throws and the app never renders.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("vite-ui-theme", "dark");
    } catch {
      /* storage blocked */
    }
  });
  const page = await context.newPage();
  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => consoleLines.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ""}`));
  const debug = async (why) => {
    await page.screenshot({ path: `${OUT}/_debug.jpg`, type: "jpeg", quality: 70 }).catch(() => undefined);
    writeFileSync(`${OUT}/_debug.txt`, `${why}\nurl: ${page.url()}\n\n${consoleLines.join("\n")}\n\n${await page.content().catch(() => "")}`);
  };

  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/login.jpg`, type: "jpeg", quality: 82 });
  log("✓ login ← /login");

  try {
    await page.locator('input[autocomplete="username"]').fill("admin@localhost", { timeout: 60000 });
    await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
  } catch (error) {
    await debug(String(error));
    throw error;
  }

  for (const [name, route, action] of SHOTS) {
    try {
      await page.goto(`${APP}${route}`, { waitUntil: "networkidle", timeout: 45000 });
    } catch {
      log(`${route}: network never went idle; capturing anyway`);
    }
    await page.keyboard.press("Escape").catch(() => undefined); // dismiss any coachmark
    if (action) {
      try {
        await action(page);
      } catch (error) {
        log(`${name}: ${String(error)}; capturing anyway`);
      }
    }
    await sleep(2500); // charts animate in
    await page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 82 });
    log(`✓ ${name} ← ${route}`);
  }
  await browser.close();
}

await waitFor("CHouse UI", async () => (await fetch(`${APP}/api/health`)).ok);
await waitFor("ClickHouse", async () => (await fetch(`${CH}/ping`)).ok);
await seedClickHouse();
await seedApp();
log(`waiting ${WAIT_SECONDS}s for the collector to learn the workload`);
await sleep(WAIT_SECONDS * 1000);
await capture();
log("done");
