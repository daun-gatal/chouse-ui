/**
 * Real-app checks of the connection identity over MCP and the CLI (ADR 0033),
 * run against the seeded lab: a personal connection (Production), a role
 * ceiling (Analytics) and a shared login (Legacy). Exits non-zero when a
 * check fails. Needs the lab freshly seeded: it changes link states.
 */

const BASE = (process.env.LAB_CHOUSE_URL ?? "http://chouse-ui:5521").replace(/\/+$/, "");
const CH_A = (process.env.LAB_CH_A_URL ?? "http://ch-a:8123").replace(/\/+$/, "");
const ADMIN_PASSWORD = process.env.LAB_ADMIN_PASSWORD ?? "Lab-admin-123!";
const USER_PASSWORD = process.env.LAB_USER_PASSWORD ?? "Lab-pass-123!";
const CLI = process.env.LAB_CLI ?? "chouse";

let failed = 0;
function check(name: string, ok: boolean, detail: unknown = ""): void {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${typeof detail === "string" ? detail : JSON.stringify(detail)}`.slice(0, 700)}`);
}

interface Reply {
  status: number;
  data: Record<string, unknown>;
  message: string;
  code: string;
}

async function api(method: string, path: string, token?: string, body?: unknown): Promise<Reply> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await response.json().catch(() => ({}))) as { data?: unknown; error?: { message?: string; code?: string } };
  return { status: response.status, data: (parsed.data ?? {}) as Record<string, unknown>, message: parsed.error?.message ?? "", code: parsed.error?.code ?? "" };
}

async function login(identifier: string, password: string): Promise<string> {
  const reply = await api("POST", "/api/rbac/auth/login", undefined, { identifier, password });
  const tokens = (reply.data.tokens ?? reply.data) as { accessToken?: string };
  if (reply.status !== 200 || !tokens.accessToken) throw new Error(`login ${identifier}: ${reply.status} ${reply.message}`);
  return tokens.accessToken;
}

/** A personal access token of an account: tokens can only be made in a signed-in session. */
async function pat(session: string, name: string, scopes?: string[]): Promise<string> {
  const reply = await api("POST", "/api/rbac/pats", session, scopes ? { name, scopes } : { name });
  if (reply.status !== 201) throw new Error(`token ${name}: ${reply.status} ${reply.message}`);
  return String(reply.data.rawToken);
}

async function mcp(token: string, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const raw = await response.text();
  const line = raw.split("\n").find((entry) => entry.startsWith("data:") && entry.slice(5).trim() !== "");
  return JSON.parse(line ? line.slice(5) : raw || "{}") as Record<string, unknown>;
}

/** A tool's result: its text content parsed as JSON where it is JSON. */
async function tool(token: string, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string; json: unknown }> {
  const message = await mcp(token, "tools/call", { name, arguments: args });
  const result = (message.result ?? {}) as { isError?: boolean; content?: Array<{ text?: string }> };
  const text = (result.content ?? []).map((part) => part.text ?? "").join("\n") || JSON.stringify(message.error ?? {});
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { isError: result.isError === true || message.error !== undefined, text, json };
}

async function cli(token: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn([CLI, ...args], { env: { ...process.env, CHOUSE_SERVER: BASE, CH_HOUSE_PAT: token, HOME: "/tmp/cli-home" }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

async function clickhouse(statement: string): Promise<void> {
  const response = await fetch(CH_A, { method: "POST", headers: { "X-ClickHouse-User": "default", "X-ClickHouse-Key": "lab" }, body: statement });
  if (!response.ok) throw new Error(`ClickHouse: ${(await response.text()).slice(0, 200)}`);
}

type Identity = { connectionName: string; kind: string; runsAs: { type: string; name: string } | null; state: string; limits: string[] };
const byName = (value: unknown): Record<string, Identity> => {
  const data = (value as { data?: { identities?: Identity[] }; identities?: Identity[] } | null) ?? {};
  const list = data.identities ?? data.data?.identities ?? [];
  return Object.fromEntries(list.map((entry) => [entry.connectionName, entry]));
};

const rootSession = await login("admin", ADMIN_PASSWORD);
const root = await pat(rootSession, "check-root");
const rootScoped = await pat(rootSession, "check-root-scoped", ["table:select", "connections:view"]);
const ann = await pat(await login("ann.lee", USER_PASSWORD), "check-ann");
const dana = await pat(await login("dana.kim", USER_PASSWORD), "check-dana");
const eve = await pat(await login("eve.park", USER_PASSWORD), "check-eve");
const omar = await pat(await login("omar.admin", USER_PASSWORD), "check-omar");
const connections = (await api("GET", "/api/rbac/connections", rootSession)).data as { connections?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>;
const idOf = Object.fromEntries((Array.isArray(connections) ? connections : connections.connections ?? []).map((entry) => [entry.name, entry.id]));
const turnedOn = await api("PUT", "/api/agents/mcp", rootSession, { enabled: true });
check("MCP is turned on for the lab", turnedOn.status === 200, turnedOn.message);

// ---- MCP
const listed = ((await mcp(ann, "tools/list", {})).result ?? {}) as { tools?: Array<{ name: string }> };
const names = (listed.tools ?? []).map((entry) => entry.name);
check("MCP lists connection_runs_as", names.includes("connection_runs_as"), names.slice(0, 12));
check("MCP has no tool that manages links, kinds or role maps", !names.some((name) => /link|binding|identity|role_map/i.test(name)), names.filter((name) => /link|binding|identity|role_map/i.test(name)));
const rootListed = ((await mcp(root, "tools/list", {})).result ?? {}) as { tools?: Array<{ name: string }> };
check("not for a super admin's token either", !(rootListed.tools ?? []).some((entry) => /link|binding|role_map/i.test(entry.name)));

let mine = byName((await tool(ann, "connection_runs_as")).json);
check("an agent learns it runs as the linked ClickHouse user on the personal connection", mine.Production?.runsAs?.name === "alice" && mine.Production?.state === "ready" && mine.Production?.limits.length > 0, mine.Production);
check("as a ClickHouse role on the role ceiling", mine.Analytics?.runsAs?.type === "role" && mine.Analytics?.runsAs?.name === "analyst_ro", mine.Analytics);
check("and as the connection's login on the shared one", mine.Legacy?.runsAs?.type === "login" && mine.Legacy?.limits.length === 0, mine.Legacy);
mine = byName((await tool(dana, "connection_runs_as")).json);
check("an agent whose link waits is told so, for a connection it is not admitted to yet", mine.Production?.state === "pending_grant" && mine.Production?.runsAs?.name === "dave", mine.Production);
mine = byName((await tool(eve, "connection_runs_as")).json);
check("an agent with no link is told nothing about the personal connection", mine.Production === undefined && mine.Analytics !== undefined, Object.keys(mine));

let answer = await tool(ann, "query", { sql: "SELECT currentUser() AS u", connection_id: idOf.Production });
check("a statement over MCP runs as the person's own ClickHouse user", !answer.isError && answer.text.includes("alice"), answer.text.slice(0, 300));
answer = await tool(ann, "query", { sql: "SELECT count() FROM finance.salaries", connection_id: idOf.Production });
check("and ClickHouse refuses what that user may not read, naming the user", answer.isError && answer.text.includes("alice") && answer.text.includes("Not enough privileges"), answer.text.slice(0, 300));
answer = await tool(ann, "query", { sql: "SELECT currentRoles() AS r", connection_id: idOf.Analytics });
check("on the role ceiling a statement over MCP names the mapped role", !answer.isError && answer.text.includes("analyst_ro"), answer.text.slice(0, 300));
answer = await tool(dana, "query", { sql: "SELECT 1", connection_id: idOf.Production });
check("a waiting link refuses the statement and says why", answer.isError && /waiting/.test(answer.text), answer.text.slice(0, 300));

// ---- what no token may do, and what a scoped token may not
const personal = { identityMode: "personal", username: "svc_personal", password: "lab", systemRole: "chouse_system", impersonationRole: "chouse_impersonate" };
const byToken = [
  (await api("PUT", `/api/rbac/connections/${idOf.Legacy}/identity`, root, personal)).status,
  (await api("PUT", `/api/rbac/connections/${idOf.Analytics}/identity/role-map`, root, { entries: [] })).status,
];
check("a super admin's token cannot switch a kind or write a role map: a browser session only", byToken.every((status) => status === 403), byToken);
const links = (await api("GET", `/api/rbac/clickhouse-bindings/connection/${idOf.Production}`, rootSession)).data as { bindings?: Array<{ id: string; accountName: string }> };
const danaLink = (links.bindings ?? []).find((entry) => entry.accountName === "dana.kim")?.id ?? "";
check("nor confirm a link", (await api("POST", `/api/rbac/clickhouse-bindings/${danaLink}/confirm`, root)).status === 403);
const scopedCodes = [
  (await api("GET", `/api/rbac/clickhouse-bindings/connection/${idOf.Production}`, rootScoped)).status,
  (await api("POST", `/api/rbac/clickhouse-bindings/connection/${idOf.Production}`, rootScoped, { userId: "x", clickhouseUser: "alice" })).status,
  (await api("GET", `/api/rbac/connections/${idOf.Production}/identity`, rootScoped)).status,
  (await api("GET", "/api/rbac/users", rootScoped)).status,
];
check("a super admin's scoped token reads no links, adds none, and lists no users", scopedCodes.every((status) => status === 403), scopedCodes);
check("but still learns what it runs as", (await api("GET", "/api/rbac/connections/identity/mine", rootScoped)).status === 200);

// ---- CLI
let run = await cli(ann, "connection", "runs-as", "-o", "json");
mine = byName(JSON.parse(run.out || "[]").length !== undefined ? { identities: JSON.parse(run.out) } : JSON.parse(run.out));
check("chouse connection runs-as lists each connection with its identity", run.code === 0 && mine.Production?.runsAs?.name === "alice" && mine.Analytics?.runsAs?.name === "analyst_ro", run.out.slice(0, 300) + run.err.slice(0, 200));
run = await cli(ann, "query", "SELECT currentUser() AS u", "-c", "Production", "-o", "json");
check("a CLI query on the personal connection runs as the linked user", run.code === 0 && run.out.includes("alice"), run.out.slice(0, 200) + run.err.slice(0, 300));
run = await cli(dana, "connection", "runs-as", "Production", "-o", "json");
check("someone whose link waits sees why, by connection name", run.code === 0 && run.out.includes("pending_grant") && /waiting/.test(run.out), run.out.slice(0, 300) + run.err.slice(0, 200));
run = await cli(root, "connection", "identity", "get", "Production", "-o", "json");
check("a super admin reads a connection's kind, health and what its server can run", run.code === 0 && run.out.includes("\"personal\"") && run.out.includes("26.3.63.123") && run.out.includes("\"support\""), run.out.slice(0, 300) + run.err.slice(0, 200));
run = await cli(root, "connection", "identity", "recheck", "Production", "-o", "json");
check("and runs the checks now", run.code === 0 && run.out.includes("\"ok\": true"), run.out.slice(0, 300) + run.err.slice(0, 200));
run = await cli(root, "connection", "links", "list", "Production", "-o", "json");
check("links list shows every link with its state", run.code === 0 && ["alice", "bob", "carol", "dave", "pending_grant", "disabled"].every((word) => run.out.includes(word)), run.out.slice(0, 300) + run.err.slice(0, 200));
run = await cli(root, "connection", "links", "grants", "Production");
check("links grants prints the GRANT for the waiting link, and only SQL", run.code === 0 && run.out.trim() === "GRANT IMPERSONATE ON dave TO chouse_impersonate;  -- dana.kim", run.out + run.err.slice(0, 200));
await clickhouse(run.out.trim().split("--")[0]);
run = await cli(root, "connection", "links", "check", "Production", "dana.kim", "-o", "json");
check("after the administrator ran it, links check makes the link active", run.code === 0 && run.out.includes("\"active\""), run.out.slice(0, 300) + run.err.slice(0, 200));
run = await cli(dana, "query", "SELECT currentUser() AS u", "-c", "Production", "-o", "json");
check("and the account's statements now run as its ClickHouse user", run.code === 0 && run.out.includes("dave"), run.out.slice(0, 200) + run.err.slice(0, 300));
run = await cli(root, "connection", "links", "add", "Production", "--account", "eve.park", "--user", "no_such_user", "--yes");
check("links add shows the server's reason for a user that is not there", run.code !== 0 && run.err.includes("no ClickHouse user named no_such_user"), run.err.slice(0, 300));
run = await cli(root, "connection", "links", "add", "Production", "--account", "eve.park", "--user", "erin");
check("links add needs --yes when it cannot ask", run.code === 2, `${run.code} ${run.err.slice(0, 200)}`);
await clickhouse("CREATE USER IF NOT EXISTS erin IDENTIFIED BY 'lab'");
run = await cli(root, "connection", "links", "add", "Production", "--account", "eve.park@example.com", "--user", "erin", "--yes", "-o", "json");
check("links add links an account found by its email, waiting for its grant", run.code === 0 && run.out.includes("pending_grant") && run.err.includes("action=binding.created"), run.out.slice(0, 300) + run.err.slice(0, 300));
run = await cli(root, "connection", "links", "remove", "Production", "eve.park", "--yes");
check("links remove removes it", run.code === 0, run.err.slice(0, 300));
run = await cli(root, "connection", "links", "list", "Production", "-o", "json");
check("and it is gone", run.code === 0 && !run.out.includes("eve.park"), run.out.slice(0, 200));
// omar reaches no connection by name (no policy, no link), so the id: the refusal must come from the role check.
run = await cli(omar, "connection", "links", "list", idOf.Production);
check("an admin who is not a super admin is refused", run.code !== 0 && /super admin/i.test(run.err), `${run.code} ${run.err.slice(0, 300)}`);
run = await cli(rootScoped, "connection", "links", "list", "Production");
check("and so is a super admin's scoped token", run.code !== 0 && /scope/i.test(run.err), `${run.code} ${run.err.slice(0, 300)}`);
run = await cli(root, "connection", "links", "confirm", "Production", "ann.lee");
check("there is no command to confirm a suspended link", run.code === 2, `${run.code}`);

console.log(failed === 0 ? "\nAll identity checks passed." : `\n${failed} identity check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
