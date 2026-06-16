# ADR 0002 — Native ClickHouse access via an app-enforced Query Gateway

- **Status:** Proposed
- **Date:** 2026-06-16
- **Deciders:** CHouse UI maintainers
- **Tags:** RBAC, data-access, ClickHouse, connectivity, security
- **Depends on:** [ADR 0001 — Personal Access Tokens](./0001-personal-access-tokens.md)
- **Related:** `docs/datagrip-connection.md`, `docs/sso.md`

> **Scope split:** the credential this gateway authenticates with — the
> **Personal Access Token** — is specified separately in
> [ADR 0001](./0001-personal-access-tokens.md). This ADR assumes PATs exist
> (connection-bound, bounded-TTL, capped, verifiable via
> `verifyPersonalAccessToken`) and specifies the **gateway** that consumes them.

---

## Context

Today CHouse UI is the **only** path to ClickHouse, and **all security lives in
the application proxy layer**, not in ClickHouse:

1. **The browser never talks to ClickHouse.** The SPA calls the server
   (JWT-auth), which executes queries over **HTTP** (`@clickhouse/client`, port
   8123) using a **shared, server-side, AES-256-GCM-encrypted connection
   credential** (`rbac/services/connections.ts`). Connections are
   application-scoped; a user "sees" one only if a data-access policy on their
   role allows it.
2. **Enforcement happens in-process, before the query is sent:** RBAC permission
   checks (`rbac/middleware/rbacAuth.ts`, `middleware/dataAccess.ts`), SQL parsing
   (`middleware/sqlParser.ts`), data-access policies (regex/priority/allow-deny,
   `rbac/services/dataAccess.ts`), audit + query history, and the live-query view
   + kill (`services/clickhouse.ts`).
3. The app already manages real ClickHouse users, but those are a **separate
   identity space** we deliberately do **not** lean on here.

### The core tension

A native client (DataGrip, BI, `curl`) speaks ClickHouse's **wire protocol**
directly — **HTTP** (8123/8443) or **native TCP** (9000/9440). Connecting
straight to ClickHouse **bypasses every app-layer control** above. The question
is *not* "open a port" but **"where do authn/authz and audit live when the app is
no longer in the request path?"**

### What we want (the chosen product shape)

> Use the **app's** authentication, RBAC and data-access rules to govern queries
> from native tools. Keep the **live query view** and **data-access rule
> management** as the single control surface. Map to a **single super-admin
> service account on ClickHouse**, keep **all authn/authz + audit in the app**,
> and **do not replicate users or roles into ClickHouse**.

We run on **Kubernetes**, so sidecars / extra components are acceptable.

---

## Decision

Build a **ClickHouse Query Gateway**: an HTTP endpoint **wire-compatible with
ClickHouse's HTTP interface** that authenticates the caller with a **PAT
(ADR 0001)**, runs the **existing app enforcement pipeline** (RBAC → SQL parse →
data-access policy → audit/live-query), and forwards approved queries to the real
ClickHouse using **one shared super-admin service account**.

The gateway makes the app a **policy enforcement point (PEP) that speaks
ClickHouse**, so existing native tools point at it unchanged.

Concretely:

1. **PAT authentication** — the PAT (ADR 0001) is presented as the ClickHouse
   "password"/key; it resolves to the app user, the **bound connection**, and the
   effective permissions/data-access.
2. **Reuse, don't duplicate, enforcement** — the gateway calls the same
   `sqlParser` + `dataAccess` + audit + live-query modules the UI uses.
3. **Single service account** — downstream connection uses one privileged service
   credential (existing connection model). **No per-user ClickHouse users/roles.**
4. **App is the source of truth** for identity, authz and audit; ClickHouse only
   sees the service account, with per-user attribution injected
   (`log_comment`, `query_id`, `quota_key`).

### Why this (vs. pushing RBAC into ClickHouse)

Provisioning a native ClickHouse user/role per engineer and compiling app
policies into `GRANT`/`ROW POLICY` was rejected: it **splits the source of truth**
(sync/drift), **can't faithfully express** the app's regex/priority/deny model,
and **splits audit + live-query** from the single control surface.

**Trade-off accepted:** the gateway is **HTTP-only**, so the native-TCP
`clickhouse-client` CLI is **not** covered in v1 (see Consequences / Future work).
DataGrip and the broad HTTP/JDBC ecosystem are covered.

---

## Architecture

```
                          ┌──────────────────────────────────────────────┐
                          │                CHouse UI                       │
  ┌──────────┐  HTTP(S)   │  ┌───────────────┐     ┌──────────────────┐   │
  │ DataGrip │──────────► │  │ Query Gateway │────►│ Enforcement core │   │
  │  (JDBC)  │  PAT as    │  │ (CH HTTP API  │     │ • PAT auth (0001)│   │
  └──────────┘  password  │  │  compatible)  │     │ • RBAC perms     │   │
                          │  └───────┬───────┘     │ • SQL parse      │   │
  ┌──────────┐            │          │             │ • data-access    │   │
  │ BI / curl│──────────► │          │             │ • audit + live Q │   │
  └──────────┘            │          │ @clickhouse/client (HTTP 8123)      │
                          │          │ ONE shared super-admin service acct │
                          └──────────┼──────────────────────────────────── ┘
                                     ▼
                          ┌────────────────────┐
                          │     ClickHouse      │ (only the gateway can reach it;
                          │  system.query_log   │  NetworkPolicy + TLS)
                          └────────────────────┘
```

### Request flow

1. DataGrip opens HTTP(S) to the gateway with credentials (HTTP Basic or
   `X-ClickHouse-User`/`X-ClickHouse-Key`) and SQL in the body — as it would to
   ClickHouse.
2. Gateway extracts the **PAT** from the password/key, calls
   `verifyPersonalAccessToken` → app user + **bound connection** + effective
   permissions. The "user" field is informational; the **PAT is authoritative**.
3. Gateway **parses** the SQL → statement types + tables.
4. Gateway runs **RBAC permission** + **data-access policy** checks per
   statement/table (same code as the UI). Fail → ClickHouse-shaped error.
5. Approved → **forward** to the bound connection's ClickHouse via the service
   account, **pinning safe settings** and **stripping dangerous ones** (Security),
   streaming the result in the client's requested format (TabSeparated /
   JSONCompact / RowBinary…).
6. **Audit** + **register in the live-query view** with a server-issued
   `query_id` and per-user `quota_key`, so existing monitoring / **kill** works.

### Connection selection (carried by the PAT)

A user may access **multiple connections**, but a DataGrip data source is one
`(host, port, database, user, password)`. **The PAT is bound to exactly one
connection (ADR 0001)**, so the connection is determined by the credential:

- Fixed by the PAT's `connection_id`; any client routing hint naming a *different*
  connection is **rejected**.
- **One PAT — one data source — per connection.** Two clusters ⇒ two tokens.
- The bound connection must remain permitted by the user's data-access policies
  at query time; revoke access and the PAT stops working.
- Operators may expose a per-connection **host/subdomain** purely as ergonomics;
  it is not a selector. The JDBC **database** field selects a DB *within* the
  bound connection (orthogonal).

---

## Security considerations (critical — the gateway holds super-admin)

The downstream credential is a **super-admin service account**, so the gateway is
the *entire* security boundary; enforcement must be **fail-closed** and the SQL
parser is **load-bearing**, not defense-in-depth.

1. **Force-safe settings, strip client settings.** Inject/pin protective settings
   and ignore client overrides: pin `readonly` to the user's permission set; cap
   `max_execution_time`, `max_result_rows/bytes`, `max_memory_usage`,
   `max_rows_to_read`; never let the client set `log_comment`, `database`, or
   limit-relaxing settings. Maintain a **forwardable-settings allowlist**.
2. **Deny escape hatches** at parse time (deny-by-default): DCL/identity
   (`CREATE/ALTER/DROP USER|ROLE|QUOTA|ROW POLICY`, `GRANT`, `REVOKE`), `SYSTEM …`,
   data-exfil table functions (`url`, `file`, `s3`, `remote`, `jdbc`, `mysql`,
   `postgresql`, `hdfs`, dictionaries, `INTO OUTFILE`, `FROM INFILE`), and
   sensitive `system.*` reads unless explicitly permitted.
3. **Multi-statement safety.** Validate **every** statement; **parse-failure ⇒
   deny**. Constrain/reject `multiquery`.
4. **No raw passthrough.** No mode that skips parsing; unclassifiable ⇒ denied.
5. **Transport.** TLS on the gateway; mTLS/NetworkPolicy so **only** the gateway
   reaches ClickHouse's real ports. Never expose ClickHouse directly.
6. **Abuse limits.** Per-PAT rate limiting + concurrency caps; alert on repeated
   denials/auth failures.
7. **Unspoofable attribution.** `query_id`, `quota_key`, `log_comment` set
   server-side from the resolved identity.

> **Residual risk:** parser coverage *is* the boundary; new ClickHouse syntax can
> open holes. Mitigate with an **allowlist-first** posture and, where feasible, a
> down-scoped downstream service role ("super-admin minus dangerous grants").

---

## RBAC / permission changes

- **New gate `gateway:connect`** — whether a user may use native access *at all*.
  Minting a PAT (ADR 0001 `pat:create`) and using the gateway both require it, so
  an org can enable native access per role without touching data-access rules.
- **New admin gate `gateway:admin`** (`gateway:view` for read-only) — manage
  gateway settings (enable/disable, limits, settings allowlist, blocked
  functions).
- **Actual query authz is unchanged and reused:** existing `table:select`,
  `query:execute_ddl/dml`, etc. plus **data-access policies** decide what a
  request may do — no new query-level permissions.
- Add `gateway:*` to `schema/base.ts` `PERMISSIONS`, a `Connectivity / Gateway`
  category in `seed.ts`, and to frontend `RBAC_PERMISSIONS`. Grant `gateway:connect`
  to the roles that should reach native tools (proposed: `admin`, `developer`,
  `analyst`); `gateway:admin` → `admin` + `super_admin`. Adding to existing roles
  is a **grant migration** (with the data-migration test per `CLAUDE.md`).

---

## Audit & logging events

Reuse query history + live-query, and add a `gateway.*` namespace to
`AUDIT_ACTIONS` (`schema/base.ts`); server logs tagged `module: 'Gateway'`:

| Action | When | Notes |
|--------|------|-------|
| `gateway.query` | A statement is executed via the gateway | user, `tokenId`, connection, `query_id`, statement type, tables, row/byte counts, duration |
| `gateway.query_denied` | RBAC/data-access/parse rejects a statement | user, `tokenId`, reason, offending table/operation — security signal |
| `gateway.auth_failed` | Bad/missing/expired PAT at the gateway | correlates with ADR 0001 `pat.use_failed` |
| `gateway.settings_update` | Admin changes gateway config | actor + diff |

- Every gateway query carries the originating **`tokenId`** (ADR 0001) and the
  resolved **user**, so the **Audit** and **Query History** screens attribute
  native-tool traffic to a person, not the service account.
- The **live-query view** registers gateway queries with the server-issued
  `query_id`, so admins can watch and **kill** them exactly like UI queries.

---

## UI changes

- **Connection details / "Native access" panel (per connection):** in the
  connection view, a section showing the **gateway endpoint** (host/port, TLS),
  how to connect, a **"Create access token"** shortcut (deep-link to ADR 0001's
  Preferences → Access Tokens, pre-selecting this connection), and a link to the
  [DataGrip guide](../datagrip-connection.md). Gated on `gateway:connect`.
- **Live Query view:** add a **source/origin** indicator + filter
  (`UI` vs `Gateway/PAT`) and show the **token name + user** for gateway queries,
  reusing existing kill controls.
- **Audit view:** the new `gateway.*` actions appear automatically; add them to
  the action filter list.
- **Admin → Gateway settings (gated on `gateway:admin`):** enable/disable the
  gateway, view/edit limits (rate/concurrency, result/row caps), the forwardable-
  settings allowlist and blocked-function list, and the bound service account per
  connection. Read-only when config-sourced (mirrors the SSO settings pattern).
- **API client (`src/api/rbac.ts`):** `gatewayApi` (settings get/update; the
  per-connection native-access info). Token CRUD lives in ADR 0001's `patApi`.

---

## Kubernetes deployment options

**A. In-process listener (recommended v1).** A second route/port on the existing
Bun + Hono server; shares enforcement code + DB. Expose via a dedicated
`Service` + `Ingress`/`Gateway` with TLS.

**B. Dedicated gateway Deployment.** Same image, `gateway`-only role, scaled and
network-isolated independently; needs shared RBAC DB + encryption keys.

**C. Connectivity sidecar / outbound agent (private clusters).** When ClickHouse
isn't reachable inbound, run a small **outbound-only agent** beside ClickHouse
that dials back to the gateway — the pattern
[ch-ui's "Remote ClickHouse Tunnel"](#evaluation-ch-ui-remote-clickhouse-tunnel)
uses. Keeps ClickHouse ports off the internet.

**Optional `chproxy` sidecar/service** between gateway and ClickHouse for
connection pooling, replica routing and resource governance — operational only;
it does **not** replace app enforcement. See
[Performance & scaling → Leveraging chproxy](#leveraging-chproxy) for topology
and the two traps specific to our single-service-account design.

### Evaluation: ch-ui "Remote ClickHouse Tunnel"

`caioricciuti/ch-ui`'s tunnel is a **secure WebSocket relay** (`wss://`), **not** a
TCP/SSH tunnel: a **server** (UI) + a lightweight **agent** (`ch-ui connect`) beside
ClickHouse; the **agent dials out** to the server's `/connect` endpoint
(outbound-only), token-authed (`cht_…`, `ch-ui tunnel create|rotate`), installable
as an OS service or Docker sidecar, talking **local ClickHouse over HTTP 8123**.

**Borrow:** the **outbound-agent + token** pattern for "reach a ClickHouse we can't
route to inbound" (option C); it validates the **HTTP-8123 + opaque-token**
approach. **Doesn't solve for us:** it connects *the UI server* to ClickHouse — it
does **not** authenticate *external native clients* as app users with app-enforced
authz. So it's a **complementary transport**, not the enforcement design.

---

## Performance & scaling

The gateway inserts the app into the **data path**, not just the control path:

```
DataGrip → Gateway (Bun/Hono) → ClickHouse → Gateway → DataGrip
```

Every byte of every result set now transits the app process (twice — in and back
out), with a load profile unlike today's UI traffic: **large result sets**, **many
concurrent/long-lived connections**, and DataGrip's chatty **introspection**
bursts, all multiplexed alongside the SPA/API on one Bun event loop. The risks:

- **Memory (the dangerous one):** buffering a full result set before forwarding
  lets a single `SELECT *` over a wide table OOM the pod.
- **CPU:** PAT verification, SQL parsing, format handling, (de)compression per
  request.
- **Concurrency:** long streaming downloads + introspection contend on the event
  loop and can starve the UI/API.
- **Extra hop / SPOF:** added latency, ~doubled bandwidth, and the app's scaling
  is now coupled to *data throughput*, not just request count.

### Streaming (mandatory)

The gateway **must pipe** ClickHouse's HTTP response straight to the client with
backpressure — never materialize the whole result in memory. Then per-request
memory is ~O(1) regardless of result size, and a slow client naturally throttles
the upstream read. The codebase already streams for the UI
(`/query/execute-stream`, NDJSON); the gateway extends that to arbitrary
ClickHouse formats and to request bodies (inserts). Combined with the
**pinned result caps** from [Security](#security-considerations-critical--the-gateway-holds-super-admin)
(`max_result_rows/bytes`, `max_execution_time`), a runaway can't stream forever.
Streaming is non-negotiable; everything below is optional scale tuning.

### Leveraging chproxy

[chproxy](https://www.chproxy.org/) is a mature ClickHouse **HTTP-only** proxy
(matches our HTTP-only gateway). Placed **downstream of the gateway**
(`gateway → chproxy → ClickHouse`), it adds: **connection pooling**,
**replica/shard load-balancing** with health checks, per-user **concurrency/rate
limits + queueing**, **KILL QUERY on client disconnect/timeout**, optional
**SELECT response caching** (filesystem or Redis), and Prometheus metrics. It
**never** sees app policies — authz/audit stay in the gateway; chproxy is purely
connection management + resource governance.

Two traps specific to our **single super-admin service account** design:

1. **chproxy is per-*user*, we forward as one service account.** chproxy maps each
   "input user" → a real ClickHouse user; ours all route `to_user:
   <service_account>`. Either use a **single chproxy user = service account**
   (coarse, *global* limits + pooling), or have the **gateway set chproxy's input
   user to the app user / tier** (still routing to the service account) to get
   per-user limits and per-user cache namespacing — *without* per-user ClickHouse
   users. Because chproxy config is **static YAML (reload on change)**, the latter
   only scales to a **fixed set of tiers** (e.g. `analyst`/`developer`/`admin`),
   not thousands of dynamic users. So **fine-grained per-PAT limits stay in the
   gateway**; chproxy enforces **coarse/tier** limits + pooling.
2. **Caching can leak across users.** chproxy keys its cache by query text + input
   user. Since every request hits ClickHouse as the *same* service account, a
   shared input user would let user A be served user B's cached rows for an
   identical query — **bypassing data-access policies**. Rule: **enable chproxy
   caching only when the cache is namespaced per identity** (input user = app
   user), or restrict it to data-access-equivalent contexts, or **leave caching
   off** and run chproxy as a pure proxy.

**Topology — sidecar vs. separate Deployment:**

| Topology | Pros | Cons | Use when |
|----------|------|------|----------|
| **Sidecar in the ClickHouse pod** | Locality (`localhost:8123`), per-node pooling | Requires you to *own* the CH pods (useless for managed/external CH); limits per node | You run CH in-cluster yourself |
| **Sidecar in the gateway pod** | Works with external/managed CH; no extra service; simplest | Pooling & limits are **per gateway replica** (not global); cache not shared; CH connections grow with gateway replicas | Single-replica / dev / minimal setup |
| **Separate Deployment + Service** | **Global** limits & **shared cache** (Redis), centralized CH connection mgmt, replica routing in one place, scales independently; can be the **only** thing allowed to reach CH (NetworkPolicy) | Extra hop + a component to run HA; truly-global concurrency needs few/large replicas or shared state | A real fleet / multiple gateway replicas |

**Recommendation:** default to a **separate chproxy Deployment + Service**,
NetworkPolicy'd as the **sole reachable path to ClickHouse**, with the gateway
setting chproxy's input user = app user/tier (per-user limits + safe cache
namespacing). Use the **gateway-pod sidecar** for single-replica / external-managed
CH where you just want pooling + KILL-on-disconnect with no new moving parts; the
**CH-pod sidecar** only if you operate ClickHouse in-cluster and want node
locality. chproxy stays optional throughout — remove it and the gateway still
enforces everything, just without pooling/caching/replica routing.

---

## Consequences

### Positive
- One control surface: existing **RBAC, data-access, audit, live-query** govern
  native-tool traffic; **no second policy engine**, **no user/role replication**.
- Works with the **HTTP/JDBC** ecosystem (DataGrip, BI, `curl`).
- Per-query **attribution** (to a person) and **kill** keep working.

### Negative / accepted
- **HTTP-only in v1** → native-TCP `clickhouse-client` CLI unsupported (Future work).
- A **single high-value boundary** in front of super-admin — parser/allowlist
  correctness is security-critical and needs upkeep as ClickHouse evolves.
- **Performance:** all native traffic flows through the app (it's now in the data
  path). Mandatory **streaming** prevents memory blowups; an optional **chproxy**
  deployment adds pooling/limits/replica-routing. See
  [Performance & scaling](#performance--scaling).

---

## Alternatives considered

1. **Per-user ClickHouse users + compile policies to GRANT/ROW POLICY.** Rejected:
   duplicates identity, can't express the policy model, splits audit. (Could be a
   future ADR if native-TCP + max perf ever outweigh single-source-of-truth.)
2. **Expose ClickHouse directly with a shared account.** Rejected: no per-user
   authz/audit/data-access.
3. **Native-TCP-protocol gateway.** Rejected for v1: reimplementing the binary
   protocol is a large, ongoing effort.

---

## MVP proof-of-concept — connect DataGrip (no UI)

The smallest end-to-end slice that lets DataGrip **connect and run a `SELECT`**,
authenticated by a PAT and authorized by the app's existing rules. **Assumes
[ADR 0001](./0001-personal-access-tokens.md) is done** (we can call
`verifyPersonalAccessToken(raw) → { userId, tokenId, isAdmin, permissions,
connectionId } | null`) and **skips all UI**.

### Key insight — a thin authorizing reverse-proxy

DataGrip's ClickHouse JDBC driver speaks the **HTTP interface**, so the MVP does
not need to understand result formats: **authenticate + authorize, then forward
the SQL verbatim to ClickHouse and stream the raw response back** in whatever wire
format the driver asked for. The whole MVP is two HTTP handlers.

### What DataGrip minimally needs from the HTTP surface

1. `GET /ping` → `Ok.\n` (driver liveness; "Test Connection").
2. `POST /` (and `GET /?query=…`) → execute a query. Credentials arrive as HTTP
   Basic password, `X-ClickHouse-Key`, or `?password=`. SQL is `?query=` + body
   (ClickHouse concatenates them). Version detection is just `SELECT version()`
   flowing through (2).

### Required changes (server only)

A new Hono sub-app mounted on the existing server, e.g. `app.route("/gateway",
gatewayRoutes)` (or a dedicated port). Reuses `getConnectionWithPassword`
(`rbac/services/connections.ts`) and `validateQueryAccess`
(`middleware/dataAccess.ts`) unchanged.

```ts
// packages/server/src/gateway/routes.ts  — illustrative MVP, not production
import { Hono } from "hono";
import { verifyPersonalAccessToken } from "../rbac/services/pat";        // ADR 0001
import { getConnectionWithPassword } from "../rbac/services/connections";
import { validateQueryAccess } from "../middleware/dataAccess";

const gateway = new Hono();

// ClickHouse-style plaintext error so the driver surfaces it cleanly.
const chError = (c, status: number, msg: string) =>
  c.text(`Code: ${status}. ${msg}\n`, status);

// 1. Liveness
gateway.get("/ping", (c) => c.text("Ok.\n"));

// 2. Query execution (the only real handler)
gateway.on(["GET", "POST"], "/", async (c) => {
  // a. PAT = the ClickHouse "password"/key (the username field is informational)
  const pat =
    c.req.header("X-ClickHouse-Key") ??
    basicAuthPassword(c.req.header("Authorization")) ??
    new URL(c.req.url).searchParams.get("password");
  const id = pat ? await verifyPersonalAccessToken(pat) : null;
  if (!id) return chError(c, 516, "Authentication failed");          // AUTHENTICATION_FAILED

  // b. SQL = ?query= + body (as ClickHouse concatenates them)
  const url = new URL(c.req.url);
  const sql = `${url.searchParams.get("query") ?? ""}\n${await c.req.text()}`.trim();
  if (!sql) return chError(c, 400, "Empty query");

  // c. MVP safety: read-only PoC — allow only SELECT/SHOW/DESCRIBE, single statement
  if (!isSingleReadOnly(sql)) return chError(c, 481, "Only read queries are allowed (PoC)");

  // d. Reuse the EXISTING enforcement (same code the UI uses)
  const database = url.searchParams.get("database") ?? undefined;
  const access = await validateQueryAccess(
    id.userId, id.isAdmin, id.permissions, sql, database, id.connectionId,
  );
  if (!access.allowed) return chError(c, 497, access.reason ?? "Access denied"); // ACCESS_DENIED

  // e. Forward to the PAT's bound connection AS THE SERVICE ACCOUNT
  const conn = await getConnectionWithPassword(id.connectionId);
  if (!conn) return chError(c, 501, "Connection unavailable");
  const up = new URL(`${conn.sslEnabled ? "https" : "http"}://${conn.host}:${conn.port}/`);
  // forward only safe params; PIN protective settings; never trust client settings
  if (database) up.searchParams.set("database", database);
  const fmt = url.searchParams.get("default_format");
  if (fmt) up.searchParams.set("default_format", fmt);
  up.searchParams.set("readonly", "1");                 // coarse PoC guard (see caveat)
  up.searchParams.set("max_result_rows", "1000000");
  up.searchParams.set("max_execution_time", "60");
  up.searchParams.set("query_id", crypto.randomUUID()); // server-issued attribution
  up.searchParams.set("log_comment", JSON.stringify({ pat: id.tokenId, user: id.userId }));

  const resp = await fetch(up, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${conn.username}:${conn.password ?? ""}`) },
    body: sql,                                          // verbatim SQL
  });

  // f. Stream ClickHouse's native response straight back (O(1) memory)
  return new Response(resp.body, {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") ?? "text/plain" },
  });
});

export default gateway;
```

Helpers (`basicAuthPassword`, `isSingleReadOnly`) are a few lines each;
`isSingleReadOnly` can lean on the existing `node-sql-parser` to assert exactly
one statement whose type is `select`/`show`/`describe`.

### Try it (no UI)

```bash
# liveness
curl https://chouse.example.com/gateway/ping            # → Ok.

# a query, PAT as the key (or  -u "me:chpat_…"  for Basic)
curl 'https://chouse.example.com/gateway/?query=SELECT%20now()' \
     -H 'X-ClickHouse-Key: chpat_AbC123_…'
```

**DataGrip:** New Data Source → ClickHouse; **Host/Port** = the gateway; **User** =
anything; **Password** = the PAT; enable SSL; set the JDBC driver **`path`**
property to `/gateway` (so the driver hits `/gateway/ping` and `/gateway/`).
Test Connection runs `SELECT 1` through handler (2).

### In scope vs. deliberately deferred

**In (MVP):** `/ping`; PAT auth; **reuse** of RBAC + data-access via
`validateQueryAccess`; read-only SELECT path; verbatim-forward + **streamed**
passthrough; pinned `readonly`/`max_result_rows`/`max_execution_time`;
server-issued `query_id` + `log_comment` attribution; one audit log line.

**Out (later phases):** writes/DDL behind permissions; the full
**escape-hatch denylist** (`url()/file()/s3()/remote()`, `SYSTEM`, DCL, sensitive
`system.*`) and forwardable-settings allowlist; strict multi-statement handling;
format negotiation beyond passthrough; **chproxy**; per-PAT rate/concurrency
limits; live-query registration + kill; the `gateway:*` permissions; TLS /
NetworkPolicy hardening; **all UI**.

> **⚠️ PoC only — do not expose to untrusted users as-is.** `readonly=1` blocks
> writes and settings changes but **not** read-side exfiltration (e.g. `SELECT …
> FROM url(…)`/`s3(…)`, sensitive `system.*`). The MVP is safe for a trusted
> internal demo; the **Phase 2 escape-hatch denylist is required before public
> exposure**, because the downstream account is super-admin.

---

## Implementation plan (phased)

**Prereq — ADR 0001 (PAT)** shipped: `verifyPersonalAccessToken`, connection
binding, limits.

**Phase 1 — Gateway (HTTP, read paths).** Listener implementing the CH HTTP
surface DataGrip's JDBC driver needs (`GET /ping`, version/handshake headers,
`POST /` execution, format negotiation, `X-ClickHouse-Summary`, gzip); PAT auth →
identity; reuse SQL parse + RBAC + data-access; forward via service account with
**pinned/stripped settings**; stream; wire **audit + live-query** + `query_id`/`quota_key`.

**Phase 2 — Writes + hardening.** Allowlisted DML/DDL gated by existing perms;
escape-hatch deny-list; multi-statement validation; per-PAT rate/concurrency
limits; TLS/NetworkPolicy; `gateway:*` permissions + admin settings UI.

**Phase 3 — Private-cluster connectivity (optional).** Outbound-agent/sidecar.

**Cross-cutting (each phase):** UI (native-access panel, live-query origin filter,
audit actions, admin settings), `gateway.*` audit, docs, changelog.

**Future work.** Native-TCP support (separate gateway or per-user accounts);
down-scoped downstream service role.

---

## Open questions

- Pin the downstream account to **read-only** in v1 and add writes behind a
  permission in Phase 2?
- `system.*` allowlist line for legitimate engineer introspection vs. exfiltration?
- Should `gateway:connect` be granted by default to `analyst`/`developer`, or be
  opt-in per deployment?
