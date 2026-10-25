// Docs screenshot capture — run by scripts/docs-screenshots.sh inside a
// Playwright container on the compose network (never against localhost: on
// DinD the published ports live on the Docker host).
//
// Seeds a small demo workload, waits for the collector, then captures every
// screen the docs show, in dark mode at 1440×900, as JPEGs in /out. The file
// names are what pages reference with `screenshot:` frontmatter.
//
// AI screens need AI traffic, so the script also serves a fake
// OpenAI-compatible model (FAKE_LLM_PORT, reached by the app as
// http://fake-llm:<port> — the container's network alias) and sends it a few
// real requests through the app.
//
// Logs go to stderr; stdout is reserved for the tar stream of /out.

/* global process, Buffer, console, setTimeout, fetch, window -- Node script; `window` is inside a page init script */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

const APP = process.env.APP_URL ?? "http://chouse-ui:5521";
const CH = process.env.CH_URL ?? "http://clickhouse:8123";
const FAKE_LLM_PORT = Number(process.env.FAKE_LLM_PORT ?? 5599);
const FAKE_LLM_URL = `http://fake-llm:${FAKE_LLM_PORT}/v1`;
const CH_AUTH = "Basic " + Buffer.from("admin:password").toString("base64");
const SEED_PASSWORD = "admin123!";
// The first-run password must be replaced before setup completes. Generate a
// fresh one per run (the stack is thrown away afterwards); the fixed prefix
// satisfies the upper/lower/digit/symbol policy.
const DEMO_PASSWORD = process.env.SHOTS_DEMO_PASSWORD || `Aa1!${randomBytes(12).toString("hex")}`;
const WAIT_SECONDS = Number(process.env.SHOTS_WAIT_SECONDS ?? 150);
const OUT = "/out";
// For iterating on captures against a stack that is already seeded (with the
// same SHOTS_DEMO_PASSWORD): skip seeding, and capture only the named shots.
const SKIP_SEED = process.env.SHOTS_SKIP_SEED === "1";
const ONLY = new Set((process.env.SHOTS_ONLY ?? "").split(",").filter(Boolean));

const log = (...args) => console.error("[shots]", ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Click a tab inside the page (e.g. Agents › Assistant's sub-tabs) before the capture. */
const openTab = (name) => async (page) => {
  await page.getByRole("tab", { name, exact: true }).click();
};

/** Ids the seed step creates and some captures open. */
const seeded = { dashboardId: null, connectionId: null };

/** Open Chobi at a size (Bubble, Docked or Focus) on one of its tabs. */
const openChobi = (tab, size = "Docked") => async (page) => {
  const panel = page.getByTestId("chobi-panel");
  if (!(await panel.isVisible().catch(() => false))) await page.getByTestId("chobi-launcher").click();
  await panel.waitFor();
  await panel.getByRole("group", { name: "Panel size" }).getByRole("button", { name: size }).click().catch(() => undefined);
  await panel.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
};

/** Send a chat message to Chobi and wait until the reply settles (an answer, a receipt or an approval card). */
const chobiAsk = (text, waitFor) => async (page) => {
  await openChobi("Chat")(page);
  const chat = page.getByTestId("chobi-chat");
  const start = chat.getByRole("button", { name: /Start new chat/i });
  if (await start.isVisible().catch(() => false)) await start.click();
  const box = chat.locator("textarea").last();
  await box.fill(text);
  await box.press("Enter");
  await chat.getByText(waitFor).last().waitFor({ timeout: 60000 });
};

// A small Grafana dashboard for the import preview: a graph and a stat that
// convert, a table panel with a transform that changes, and a plugin panel
// that is skipped.
const GRAFANA_DASHBOARD = {
  title: "Shop orders (Grafana)",
  schemaVersion: 39,
  time: { from: "now-6h", to: "now" },
  templating: { list: [{ name: "country", type: "custom", query: "ID,SG,MY,TH,VN,PH", multi: true, current: { text: ["ID", "SG"], value: ["ID", "SG"] } }] },
  panels: [
    { id: 1, type: "timeseries", title: "Orders per minute", gridPos: { x: 0, y: 0, w: 12, h: 8 }, datasource: { type: "grafana-clickhouse-datasource" },
      targets: [{ rawSql: "SELECT $__timeInterval(created_at) AS time, count() AS orders FROM shop.orders WHERE $__timeFilter(created_at) GROUP BY time ORDER BY time" }] },
    { id: 2, type: "stat", title: "Paid GMV", gridPos: { x: 12, y: 0, w: 6, h: 8 }, datasource: { type: "grafana-clickhouse-datasource" },
      targets: [{ rawSql: "SELECT sumIf(amount, status = 'paid') AS paid_gmv FROM shop.orders WHERE $__timeFilter(created_at)" }] },
    { id: 3, type: "table", title: "Top countries", gridPos: { x: 0, y: 8, w: 12, h: 8 }, datasource: { type: "grafana-clickhouse-datasource" },
      transformations: [{ id: "organize" }],
      targets: [{ rawSql: "SELECT country, count() AS orders FROM shop.orders WHERE country IN ($country) GROUP BY country ORDER BY orders DESC" }] },
    { id: 4, type: "grafana-worldmap-panel", title: "Orders on a map", gridPos: { x: 12, y: 8, w: 12, h: 8 } },
  ],
};

/**
 * [file name, app route (or a function of `seeded`), optional action run
 * before the capture] — file names are referenced by docs pages.
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
  ["dashboards", (s) => `/dashboards/${s.dashboardId}?range=15m`],
  ["dashboards-panel-editor", (s) => `/dashboards/${s.dashboardId}?range=15m`, async (page) => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Edit Query latency", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Run preview" }).click();
  }],
  ["dashboards-ask-ai", (s) => `/dashboards/${s.dashboardId}?range=15m`, async (page) => {
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await page.getByLabel("What should the dashboard show?").fill("Add a panel with orders and paid GMV per country over time");
  }],
  ["dashboards-list", "/dashboards"],
  ["dashboards-canvas", (s) => `/dashboards/${s.dashboardId}?range=1h`, async (page) => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByText("Tidy up").first().waitFor();
  }],
  ["dashboards-annotations", (s) => `/dashboards/${s.dashboardId}?range=1h`, async (page) => {
    // Click the newest marker on the first chart (the seeded note) so its card shows.
    const hits = page.getByTestId("chart-marker-hit");
    await hits.first().waitFor({ state: "attached", timeout: 15000 });
    const boxes = await hits.evaluateAll((els) => els.map((el, i) => { const r = el.getBoundingClientRect(); return { i, x: r.x, y: r.y }; }));
    const top = Math.min(...boxes.map((b) => b.y));
    const target = boxes.filter((b) => Math.abs(b.y - top) < 50).sort((a, b) => b.x - a.x)[0];
    await hits.nth(target.i).dispatchEvent("click");
    await page.getByRole("dialog").waitFor();
  }],
  ["dashboards-history", (s) => `/dashboards/${s.dashboardId}?range=1h`, async (page) => {
    // Save a Tidy up first, so the history has two versions to compare.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: /Tidy up/i }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    await page.getByRole("button", { name: "More actions" }).first().click();
    await page.getByRole("menuitem", { name: /Version history/ }).click();
    await page.getByRole("dialog").waitFor();
  }],
  ["dashboards-grafana-import", "/dashboards", async (page) => {
    const json = Buffer.from(JSON.stringify(GRAFANA_DASHBOARD));
    await page.locator('input[type="file"]').first().setInputFiles({ name: "shop-orders.json", mimeType: "application/json", buffer: json });
    await page.getByRole("button", { name: /Preview the conversion/i }).click();
    await page.getByText("Orders on a map").first().waitFor({ timeout: 15000 });
  }],
  ["chobi-chat", "/overview", chobiAsk("Which countries drove paid GMV in the last hour?", "Want me to put this")],
  ["chobi-undo", "/overview", chobiAsk("Keep an eye on shop.orders until tomorrow", /Undo/)],
  ["chobi-approval", "/overview", chobiAsk("Create a table shop.refunds for refund events", /Approve/)],
  ["chobi-activity", "/overview", openChobi("Activity")],
  ["chobi-now", "/overview", openChobi("Now")],
  ["ai-approvals", "/ai/approvals"],
  ["ai-memories", "/ai/memories"],
  ["ai-triage", "/ai/triage"],
  ["ai-evals", "/ai/assistant", async (page) => {
    await openTab("Agents")(page);
    await page.getByRole("button", { name: "CHouse Assistant", exact: true }).first().click();
    await page.getByRole("tab", { name: /^evals/i }).click();
  }],
  ["ai-chobi-settings", "/ai/assistant", openTab("Chobi")],
  ["agents-mcp-write-tools", "/ai/mcp", async (page) => {
    await page.getByText("Write tools", { exact: true }).first().scrollIntoViewIfNeeded();
  }],
  ["doctor", "/doctor"],
  ["agents-sessions", "/ai/sessions"],
  ["agents-policies", "/ai/policies"],
  ["agents-mcp", "/ai/mcp"],
  ["ai-agents-features", "/ai/assistant"],
  ["ai-agents-tree", "/ai/assistant", openTab("Agents")],
  ["ai-agents-editor", "/ai/assistant", async (page) => {
    await openTab("Agents")(page);
    await page.getByRole("button", { name: "SQL Optimizer", exact: true }).click();
    await page.getByRole("dialog").waitFor();
  }],
  ["ai-agents-harnesses", "/ai/assistant", openTab("Harnesses")],
  ["ai-agents-skills", "/ai/assistant", openTab("Skills")],
  ["ai-agents-tools", "/ai/assistant", openTab("Tools")],
  ["ai-agents-test-console", "/ai/assistant", openTab("Test console")],
  ["ai-draft-with-ai", "/ai/assistant", async (page) => {
    await openTab("Agents")(page);
    await page.getByRole("button", { name: "Draft with AI" }).first().click();
    await page.getByRole("dialog").locator("textarea").first()
      .fill("An agent that checks the slowest queries every morning and posts a short summary with the top three fixes");
  }],
  ["ai-guardrails", "/ai/guardrails"],
  ["ai-usage", "/ai/usage"],
  ["admin-users", "/admin/users"],
  ["admin-roles", "/admin/roles"],
  ["admin-data-access", "/admin/data-access"],
  ["admin-connections", "/admin/connections"],
  ["admin-connections-schedule", "/admin/connections", async (page) => {
    await page.getByRole("button", { name: "Collection schedule" }).click();
    await page.getByRole("dialog").waitFor();
  }],
  ["admin-ai-models", "/admin/ai-models"],
  ["admin-sso", "/admin/sso"],
  ["admin-audit", "/admin/audit"],
  ["admin-alerting", "/admin/alerting"],
  ["admin-alerting-channels", "/admin/alerting?view=channels"],
  ["admin-alerting-add-channel", "/admin/alerting?view=channels", async (page) => {
    await page.getByRole("button", { name: "Add channel" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /^Slack/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Name").fill("#data-oncall");
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^App/ }).click();
  }],
  ["admin-alerting-rules", "/admin/alerting?view=rules"],
  ["admin-alerting-activity", "/admin/alerting?view=activity"],
  ["admin-connection-environment", "/admin/connections", async (page) => {
    await page.locator("button:has(svg.lucide-pencil)").first().click();
    const env = page.getByRole("dialog").getByLabel("Environment");
    await env.scrollIntoViewIfNeeded();
    await env.click();
  }],
  ["preferences", "/preferences"],
  ["preferences-chat-accounts", "/preferences", async (page) => {
    await page.getByText("Linked chat accounts").first().scrollIntoViewIfNeeded();
  }],
];

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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

// A query whose result carries an email column, so PII redaction has
// something to redact and the Guardrails tab shows triggers.
const EVIDENCE_SQL =
  "SELECT customer_id, ltv, concat('customer', toString(customer_id), '@example.com') AS email FROM analytics.customer_ltv ORDER BY ltv DESC LIMIT 5";

const OPTIMIZATION = {
  optimizedQuery: "SELECT country, sum(amount) AS gmv\nFROM shop.orders\nPREWHERE created_at > now() - INTERVAL 1 HOUR\nGROUP BY country",
  summary: "Filter on the sorting key with PREWHERE",
  explanation: "`created_at` leads the sorting key, so moving the time filter to PREWHERE reads only the matching granules before the other columns are loaded.",
  cause: "The time filter is applied after every column of the scanned parts is read.",
  tables: [{ name: "shop.orders", engine: "MergeTree", rows: "240000", note: "Sorted by (created_at, order_id); monthly partitions" }],
  suggestions: ["Keep time filters in PREWHERE", "Add a projection by country if this runs every minute"],
};

const textOf = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p?.text ?? "").join("") : "");

/** A chat title request: no tools, asked for a short title. */
function titleRequest(messages, tools) {
  return tools.length === 0 && messages.some((m) => /\btitle\b/i.test(textOf(m.content)));
}

const toolCall = (n, name, args) => ({ role: "assistant", content: null, tool_calls: [{ id: `call_${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

/** Rows with a `country` key anywhere in a tool result. */
function countryRows(text) {
  const find = (value) => {
    if (Array.isArray(value)) {
      if (value.length && value.every((r) => r && typeof r === "object" && "country" in r)) return value;
      for (const v of value) {
        const found = find(v);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value)) {
        const found = find(v);
        if (found) return found;
      }
    }
    return null;
  };
  try {
    return find(JSON.parse(text)) ?? [];
  } catch {
    return [];
  }
}

const GMV_SQL = "SELECT country, round(sumIf(amount, status = 'paid')) AS paid_gmv, count() AS orders FROM shop.orders WHERE created_at > now() - INTERVAL 1 HOUR GROUP BY country ORDER BY paid_gmv DESC";

/**
 * CHouse Assistant in the chat: three scripted conversations, picked by the
 * user's last message — a read with a table answer, a watch (undoable, so it
 * runs with Undo) and a new table (asks once, so the reply pauses for approval).
 */
function chatReply(messages, tools, n) {
  let last = -1;
  messages.forEach((m, i) => {
    if (m.role === "user") last = i;
  });
  const ask = textOf(messages[last]?.content);
  const after = messages.slice(last + 1);
  const called = after.flatMap((m) => (m.tool_calls ?? []).map((c) => c.function?.name));
  const has = (name) => tools.some((t) => t?.function?.name === name);
  const load = (toolkit) => {
    const params = tools.find((t) => t.function.name === "load_toolkit").function.parameters?.properties ?? {};
    const key = Object.keys(params)[0] ?? "toolkit";
    return toolCall(n, "load_toolkit", { [key]: toolkit });
  };
  const resultOf = (name) => {
    const at = after.findIndex((m) => (m.tool_calls ?? []).some((c) => c.function?.name === name));
    return at >= 0 ? textOf(after.slice(at + 1).find((m) => m.role === "tool")?.content) : "";
  };

  if (/keep an eye|watch/i.test(ask)) {
    if (!has("watch_table")) return called.includes("load_toolkit") ? { role: "assistant", content: "I could not load the Data Health toolkit." } : load("health");
    if (!called.includes("watch_table")) return toolCall(n, "watch_table", { database: "shop", table: "orders", eventTimeColumn: "created_at", maxAgeMinutes: 30 });
    return { role: "assistant", content: "Done — I'm watching **shop.orders** until 09:00 tomorrow. It's checked every 15 minutes, and you'll hear from me if no new orders arrive for 30 minutes. The watch removes itself when it ends; press **Undo** to stop it now." };
  }
  if (/refunds/i.test(ask)) {
    if (!called.includes("create_table")) {
      return toolCall(n, "create_table", {
        database: "shop",
        name: "refunds",
        columns: [
          { name: "refund_id", type: "UInt64" },
          { name: "order_id", type: "UInt64" },
          { name: "amount", type: "Decimal(12, 2)" },
          { name: "reason", type: "LowCardinality(String)" },
          { name: "created_at", type: "DateTime" },
        ],
        engine: "MergeTree()",
        orderBy: "(created_at, refund_id)",
        partitionBy: "toYYYYMM(created_at)",
      });
    }
    return { role: "assistant", content: "Created **shop.refunds**, partitioned by month and sorted by `(created_at, refund_id)` like `shop.orders`, so joins on time ranges stay cheap." };
  }
  if (!called.includes("run_select_query") && has("run_select_query")) return toolCall(n, "run_select_query", { sql: GMV_SQL });
  const rows = countryRows(resultOf("run_select_query"));
  const table = rows.length
    ? `\n\n| Country | Paid GMV | Orders |\n| --- | ---: | ---: |\n${rows.map((r) => `| ${r.country} | ${Number(r.paid_gmv).toLocaleString("en-US")} | ${Number(r.orders).toLocaleString("en-US")} |`).join("\n")}`
    : "";
  const total = rows.reduce((sum, r) => sum + Number(r.paid_gmv), 0);
  const lead = rows[0] && total > 0 ? ` **${rows[0].country}** leads with ${Math.round((Number(rows[0].paid_gmv) / total) * 100)}% of the total.` : "";
  return {
    role: "assistant",
    content: `**Paid GMV in the last hour**, by country from \`shop.orders\`:${table}\n\n${lead} Want me to put this on a dashboard, or keep an eye on the table?`.replace("\n\n ", "\n\n"),
  };
}

/**
 * Fake OpenAI-compatible chat completions: an agent that has a SQL tool calls
 * it once with EVIDENCE_SQL, then every answer is the OPTIMIZATION JSON
 * (structured output parses it; plain answers just show it).
 */
function startFakeLlm() {
  let n = 0;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.url?.startsWith("/hook")) {
        // The demo alert channel's webhook.
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        /* not JSON */
      }
      n++;
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const tools = Array.isArray(body.tools) ? body.tools : [];
      const sqlTools = tools.filter((t) => {
        const props = Object.keys(t?.function?.parameters?.properties ?? {});
        const required = t?.function?.parameters?.required ?? [];
        return props.includes("sql") && required.every((r) => ["sql", "database"].includes(r));
      });
      const sqlTool = sqlTools.find((t) => t.function.name === "run_select_query") ?? sqlTools[0];
      const calledTool = messages.some((m) => m.role === "tool");
      const chat = tools.some((t) => t?.function?.name === "load_toolkit") ? chatReply(messages, tools, n) : null;
      const usage = { prompt_tokens: 1800 + (n % 7) * 230, completion_tokens: 240 + (n % 5) * 60, total_tokens: 0 };
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      const message = chat ?? (titleRequest(messages, tools) ? { role: "assistant", content: "Paid GMV by country" } : null) ?? (sqlTool && !calledTool
        ?{ role: "assistant", content: null, tool_calls: [{ id: `call_${n}`, type: "function", function: { name: sqlTool.function.name, arguments: JSON.stringify({ sql: EVIDENCE_SQL }) } }] }
        : { role: "assistant", content: JSON.stringify(OPTIMIZATION) });
      const finish = message.tool_calls ? "tool_calls" : "stop";
      log(`fake-llm #${n}: ${tools.length} tools, ${message.tool_calls ? `calls ${message.tool_calls[0].function.name}` : "answers"}${chat ? " (chat)" : ""}`);
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const delta = message.tool_calls
          ? { role: "assistant", tool_calls: message.tool_calls.map((c, index) => ({ index, ...c })) }
          : { role: "assistant", content: message.content };
        const chunk = (choice, extra = {}) => `data: ${JSON.stringify({ id: `c${n}`, object: "chat.completion.chunk", created: 0, model: body.model, choices: [choice], ...extra })}\n\n`;
        res.write(chunk({ index: 0, delta, finish_reason: null }));
        res.write(chunk({ index: 0, delta: {}, finish_reason: finish }, { usage }));
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: `c${n}`, object: "chat.completion", created: 0, model: body.model, usage, choices: [{ index: 0, finish_reason: finish, message }] }));
    });
  });
  server.listen(FAKE_LLM_PORT, "0.0.0.0");
  return server;
}

async function seedAi(token, connectionId, patToken) {
  log("adding an AI model and sending it a few requests");
  const provider = await api("POST", "/api/rbac/ai-providers", {
    token,
    body: { name: "Self-hosted gateway", providerType: "openai-compatible", baseUrl: FAKE_LLM_URL, apiKey: "sk-demo-not-a-real-key" },
  });
  const model = await api("POST", "/api/rbac/ai-base-models", {
    token,
    body: {
      providerId: provider.data.id,
      name: "Llama 3.3 70B",
      modelId: "llama-3.3-70b-instruct",
      params: { temperature: 0.2, contextWindow: 128000 },
      pricing: { input: 0.6, output: 0.8 },
    },
  });
  await api("POST", "/api/rbac/ai-models", {
    token,
    body: { modelId: model.data.id, name: "Default assistant", isActive: true, isDefault: true },
  });

  const queries = [
    "SELECT country, sum(amount) FROM shop.orders WHERE created_at > now() - INTERVAL 1 HOUR GROUP BY country",
    "SELECT status, count() FROM shop.orders GROUP BY status",
    "SELECT page, avg(duration_ms) FROM shop.events WHERE event = 'view' GROUP BY page ORDER BY 2 DESC LIMIT 20",
  ];
  const callers = [token, token, patToken].filter(Boolean);
  for (const [i, query] of queries.entries()) {
    await api("POST", "/api/ai/invoke", {
      token: callers[i % callers.length],
      headers: { "X-Connection-Id": connectionId },
      body: { capability: "optimize-query", input: { query, database: "shop" } },
    }).catch((e) => log("AI request:", e.message));
  }
}

async function seedDashboards(token, connectionId) {
  log("adding dashboards from templates");
  const scope = { connectionScope: { kind: "any" } };
  const headers = { "X-Connection-Id": connectionId };
  const overview = await api("POST", "/api/dashboards/templates/clickhouse-overview/instantiate", { token, headers, body: scope });
  await api("POST", "/api/dashboards/templates/query-latency/instantiate", { token, headers, body: scope });
  seeded.dashboardId = overview.data.dashboard.id;
  await api("POST", `/api/dashboards/${seeded.dashboardId}/pin`, { token, headers }).catch((e) => log("pin:", e.message));
  await api("POST", `/api/dashboards/${seeded.dashboardId}/notes`, {
    token,
    headers,
    // After the seed's DDL, so it is the newest marker on the charts.
    body: { at: Date.now() - 60 * 1000, text: "Backfill of last week's orders started" },
  }).catch((e) => log("note:", e.message));
}

/** A nightly job whose source table is gone, so Chobi's Now has a failed job to show. */
async function seedFailingJob(token, connectionId) {
  log("adding a failing scheduled job");
  const job = await api("POST", "/api/scheduled-queries", {
    token,
    headers: { "X-Connection-Id": connectionId },
    body: { connectionId, name: "Nightly refunds rollup", query: "SELECT count() FROM shop.refunds_staging", frequency: "daily", hour: 2, timezone: "UTC", outputMode: "none" },
  }).catch((e) => log("job:", e.message));
  const id = job?.data?.id ?? job?.data?.job?.id;
  if (id) await api("POST", `/api/scheduled-queries/${id}/run`, { token, headers: { "X-Connection-Id": connectionId } }).catch((e) => log("job run:", e.message));
}

async function seedAlerting(token) {
  log("adding alert channels");
  const channels = [
    { name: "data-oncall", type: "webhook", config: { url: `http://fake-llm:${FAKE_LLM_PORT}/hook` } },
    { name: "#ops-alerts", type: "slack", config: { mode: "webhook", webhookUrl: `http://fake-llm:${FAKE_LLM_PORT}/hook/slack` } },
  ];
  for (const channel of channels) {
    const created = await api("POST", "/api/alerting/channels", { token, body: channel }).catch((e) => log("channel:", e.message));
    if (created?.data?.id) await api("POST", `/api/alerting/channels/${created.data.id}/test`, { token }).catch((e) => log("channel test:", e.message));
  }
}

/** Look up what an earlier run seeded (SHOTS_SKIP_SEED). */
async function findSeeded() {
  const token = await login("admin@localhost", DEMO_PASSWORD);
  const conns = await api("GET", "/api/rbac/connections", { token });
  const list = Array.isArray(conns.data) ? conns.data : conns.data?.connections ?? [];
  seeded.connectionId = list[0]?.id ?? null;
  const dashboards = await api("GET", "/api/dashboards?limit=50", { token, headers: { "X-Connection-Id": seeded.connectionId } });
  const rows = Array.isArray(dashboards.data) ? dashboards.data : dashboards.data?.dashboards ?? dashboards.data?.items ?? [];
  seeded.dashboardId = rows.find((d) => /overview/i.test(d.name ?? d.title ?? ""))?.id ?? rows[0]?.id ?? null;
  log("found seeded", JSON.stringify(seeded));
  if (process.env.SHOTS_RESEED_JOB === "1") await seedFailingJob(token, seeded.connectionId);
}

async function login(identifier, password) {
  const res = await api("POST", "/api/rbac/auth/login", { body: { identifier, password } });
  return res.data.tokens.accessToken;
}

// A read workload for query logs, usage, criticality, performance and the
// dashboard time series.
const READS = [
  "SELECT country, sum(amount) FROM shop.orders WHERE created_at > now() - INTERVAL 1 HOUR GROUP BY country",
  "SELECT status, count() FROM shop.orders GROUP BY status",
  "SELECT * FROM shop.orders_daily ORDER BY day DESC LIMIT 50",
  "SELECT event, uniq(user_id) FROM shop.events GROUP BY event",
  "SELECT page, avg(duration_ms) FROM shop.events WHERE event = 'view' GROUP BY page ORDER BY 2 DESC LIMIT 20",
  "SELECT customer_id, ltv FROM analytics.customer_ltv ORDER BY ltv DESC LIMIT 10",
];

/** Keep a light read workload going while the collector learns, so charts have a series, not one point. */
async function keepBusy(seconds) {
  const until = Date.now() + seconds * 1000;
  for (let round = 0; Date.now() < until; round++) {
    for (const sql of READS.slice(0, 2 + (round % (READS.length - 1)))) await ch(sql).catch(() => undefined);
    await sleep(8000);
  }
  await ch("SYSTEM FLUSH LOGS").catch(() => undefined);
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

  for (let round = 0; round < 15; round++) for (const sql of READS) await ch(sql);
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
  const pat = await api("POST", "/api/rbac/pats", { token, body: { name: "ci-nightly-report" } }).catch((e) => log("PAT:", e.message));
  seeded.connectionId = conn.data.id;
  await seedDashboards(token, conn.data.id);
  await seedAlerting(token);
  await seedFailingJob(token, conn.data.id);
  await seedAi(token, conn.data.id, pat?.data?.rawToken);
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

  for (const [name, to, action] of SHOTS) {
    if (ONLY.size && !ONLY.has(name)) continue;
    const route = typeof to === "function" ? to(seeded) : to;
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

const fakeLlm = startFakeLlm();
await waitFor("CHouse UI", async () => (await fetch(`${APP}/api/health`)).ok);
await waitFor("ClickHouse", async () => (await fetch(`${CH}/ping`)).ok);
if (SKIP_SEED) {
  await findSeeded();
} else {
  await seedClickHouse();
  await seedApp();
  log(`waiting ${WAIT_SECONDS}s for the collector to learn the workload`);
  await keepBusy(WAIT_SECONDS);
}
await capture();
fakeLlm.close();
log("done");
