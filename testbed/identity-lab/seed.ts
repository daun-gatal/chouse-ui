/**
 * Seeds the connection-identity lab through the CHouse UI API: three
 * connections (one of each kind), two roles, six accounts, the role map and
 * the links to ClickHouse users. It stops at once when the lab was seeded
 * before, so running it again changes nothing.
 */

const BASE = (process.env.LAB_CHOUSE_URL ?? "http://chouse-ui:5521").replace(/\/+$/, "");
const ADMIN_PASSWORD = process.env.LAB_ADMIN_PASSWORD ?? "Lab-admin-123!";
const USER_PASSWORD = process.env.LAB_USER_PASSWORD ?? "Lab-pass-123!";

interface Reply {
  status: number;
  data: unknown;
  message: string;
}

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Reply> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: { data?: unknown; error?: { message?: string } } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    parsed = { error: { message: text.slice(0, 300) } };
  }
  return { status: response.status, data: parsed.data, message: parsed.error?.message ?? "" };
}

async function must(what: string, reply: Promise<Reply>): Promise<Record<string, unknown>> {
  const result = await reply;
  if (result.status >= 300) throw new Error(`${what}: ${result.status} ${result.message}`);
  return (result.data ?? {}) as Record<string, unknown>;
}

/** The record a create route returns, whether it is wrapped under a key or not. */
function idOf(data: Record<string, unknown>, key: string): string {
  const inner = (data[key] ?? data) as { id?: unknown };
  if (typeof inner.id !== "string") throw new Error(`No id in the ${key} reply`);
  return inner.id;
}

async function login(): Promise<string> {
  // The server seeds its admin account a moment after it starts answering.
  for (let attempt = 0; attempt < 30; attempt++) {
    const reply = await call("POST", "/api/rbac/auth/login", undefined, { identifier: "admin", password: ADMIN_PASSWORD });
    if (reply.status === 200) {
      const data = reply.data as { accessToken?: string; tokens?: { accessToken?: string } };
      const token = data.tokens?.accessToken ?? data.accessToken;
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Could not sign in as admin");
}

const token = await login();

const existing = await must("list connections", call("GET", "/api/rbac/connections", token));
const listed = (Array.isArray(existing) ? existing : (existing.connections as unknown[] | undefined) ?? []) as Array<{ name?: string }>;
if (listed.some((connection) => connection.name === "Production")) {
  console.log("The lab is already seeded. Nothing to do.");
  process.exit(0);
}

const connection = async (name: string, host: string): Promise<string> =>
  idOf(await must(`connection ${name}`, call("POST", "/api/rbac/connections", token, { name, host, port: 8123, username: "default", password: "lab", database: "default", sslEnabled: false })), "connection");
// Each starts as a shared login; two are switched below.
const production = await connection("Production", "ch-a");
const analytics = await connection("Analytics", "ch-b");
const legacy = await connection("Legacy", "ch-b");

const permissionList = await must("permissions", call("GET", "/api/rbac/roles/permissions/list", token));
const permissions = (Array.isArray(permissionList) ? permissionList : (permissionList.permissions as unknown[])) as Array<{ id: string; name: string }>;
const READ = ["connections:view", "table:select", "table:view", "database:view", "query:execute", "query:execute:misc", "query:history:view", "live_queries:view", "metrics:view", "saved_queries:view", "saved_queries:create", "scheduled_queries:view", "scheduled_queries:edit", "scheduled_queries:run", "dashboards:view"];
const WRITE = [...READ, "table:insert", "table:create", "table:alter", "table:drop", "table:update", "table:delete", "query:execute:dml", "query:execute:ddl"];
const ids = (names: string[]): string[] => permissions.filter((permission) => names.includes(permission.name)).map((permission) => permission.id);

// Data access policies decide on the shared login and, above the ClickHouse role, on the role ceiling.
const policy = async (name: string, rules: Array<{ connectionId: string; databasePattern: string }>): Promise<string> =>
  idOf(await must(`policy ${name}`, call("POST", "/api/rbac/data-access-policies", token, { name, rules: rules.map((rule) => ({ ...rule, tablePattern: "*", isAllowed: true })) })), "policy");
const shopOnly = await policy("Shop, read", [{ connectionId: analytics, databasePattern: "shop" }, { connectionId: legacy, databasePattern: "shop" }]);
const everything = await policy("Shop and finance", [{ connectionId: analytics, databasePattern: "*" }, { connectionId: legacy, databasePattern: "*" }]);

const role = async (name: string, displayName: string, names: string[], policyId: string): Promise<string> =>
  idOf(await must(`role ${name}`, call("POST", "/api/rbac/roles", token, { name, displayName, permissionIds: ids(names), dataAccessPolicyIds: [policyId] })), "role");
const analyst = await role("lab_analyst", "Lab analyst", READ, shopOnly);
const finance = await role("lab_finance", "Lab finance", WRITE, everything);
const roles = await must("roles", call("GET", "/api/rbac/roles", token));
const adminRole = ((Array.isArray(roles) ? roles : (roles.roles as unknown[])) as Array<{ id: string; name: string }>).find((entry) => entry.name === "admin");
if (!adminRole) throw new Error("The built-in admin role is missing");

const account = async (username: string, roleId: string): Promise<string> =>
  idOf(await must(`account ${username}`, call("POST", "/api/rbac/users", token, { email: `${username}@example.com`, username, displayName: username, password: USER_PASSWORD, roleIds: [roleId] })), "user");
const ann = await account("ann.lee", analyst);
const ben = await account("ben.ortiz", finance);
const chris = await account("chris.wu", analyst);
const dana = await account("dana.kim", analyst);
await account("eve.park", analyst);
await account("omar.admin", adminRole.id);

// Analytics: a role ceiling. Each CHouse role names one ClickHouse role.
const analyticsIdentity = `/api/rbac/connections/${analytics}/identity`;
await must("role map", call("PUT", `${analyticsIdentity}/role-map`, token, { entries: [{ roleId: analyst, clickhouseRole: "analyst_ro" }, { roleId: finance, clickhouseRole: "finance_rw" }] }));
await must("switch Analytics to a role ceiling", call("PUT", analyticsIdentity, token, { identityMode: "shared_ceiling", username: "svc_ceiling", password: "lab", systemRole: "chouse_system", accessContact: "data-platform@example.com" }));

// Production: personal. Each account runs as its own ClickHouse user.
await must("switch Production to personal", call("PUT", `/api/rbac/connections/${production}/identity`, token, { identityMode: "personal", username: "svc_personal", password: "lab", systemRole: "chouse_system", impersonationRole: "chouse_impersonate", accessContact: "data-platform@example.com" }));
for (const [userId, clickhouseUser] of [[ann, "alice"], [ben, "bob"], [chris, "carol"], [dana, "dave"]] as const) {
  const reply = await call("POST", `/api/rbac/clickhouse-bindings/connection/${production}`, token, { userId, clickhouseUser });
  const state = (reply.data as { binding?: { state?: string } } | undefined)?.binding?.state ?? reply.message;
  console.log(`link ${clickhouseUser}: ${state}`);
}
// The admin account gets no link on Production on purpose: a super admin is held to a ClickHouse user too.

// One scheduled query on each of the two connections, created by ben so that he owns them.
const benLogin = await call("POST", "/api/rbac/auth/login", undefined, { identifier: "ben.ortiz", password: USER_PASSWORD });
const benToken = ((benLogin.data ?? {}) as { accessToken?: string; tokens?: { accessToken?: string } }).tokens?.accessToken ?? ((benLogin.data ?? {}) as { accessToken?: string }).accessToken;
if (benToken) {
  for (const [name, connectionId] of [["Unpaid invoices (Production)", production], ["Unpaid invoices (Analytics)", analytics]] as const) {
    const reply = await call("POST", "/api/scheduled-queries", benToken, { name, connectionId, query: "SELECT count() AS unpaid FROM finance.invoices WHERE paid = 0", frequency: "daily" });
    console.log(`scheduled query "${name}": ${reply.status < 300 ? "created" : `${reply.status} ${reply.message}`}`);
  }
}
console.log("Seeded: connections Production (personal), Analytics (role ceiling), Legacy (shared login).");
