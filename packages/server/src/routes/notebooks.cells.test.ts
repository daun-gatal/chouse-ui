/**
 * Reading a notebook: a query cell keeps the rows its author saw, so those rows
 * go only to readers whose own data access rules allow the cell's statement.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { fakeExec } from "../middleware/sqlAccess/fixtures/fakeParser";

const SECRET_ROW = { id: 7, salary: 123456 };
const PUBLIC_ROW = { id: 1, name: "open" };

// ClickHouse stand-in: EXPLAIN AST comes from the fake parser, and a SELECT
// returns one row that says which table it read.
mock.module("../services/scheduledQueries/chClient", () => ({
  clientForConnection: async () => ({
    exec: fakeExec,
    query: async (args: { query: string }) => ({
      response_headers: {},
      json: async () => (args.query.includes("secret.") ? [SECRET_ROW] : [PUBLIC_ROW]),
    }),
  }),
}));

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawRun } from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import notebooks from "./notebooks";

const CONNECTION = "conn-cells";
const AUTHOR = "cells-author";
const READER = "cells-reader";
const BROKEN = "cells-no-rules";
const ADMIN = "cells-admin";
const READ_PERMISSIONS = ["observe:view", "table:select"];
const AUTHOR_PERMISSIONS = [...READ_PERMISSIONS, "notebooks:edit", "query:execute"];

interface CellBody {
  id: string;
  kind: string;
  content: { sql?: string; snapshot?: { rows: unknown[][] } | null; snapshotWithheld?: boolean };
}

let app: Hono;
let notebookId = "";

async function headers(userId: string, roles: string[], permissions: string[]): Promise<Record<string, string>> {
  const token = await generateAccessToken({ sub: userId, email: `${userId}@test.local`, username: userId, roles, permissions, sessionId: `s-${userId}` });
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const asAuthor = (): Promise<Record<string, string>> => headers(AUTHOR, ["custom"], AUTHOR_PERMISSIONS);
const asReader = (): Promise<Record<string, string>> => headers(READER, ["custom"], READ_PERMISSIONS);

async function seedUser(id: string, roleId: string): Promise<void> {
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@test.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, is_default, priority, created_at, updated_at) VALUES (${roleId}, ${roleId}, ${roleId}, 0, 0, 1, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${`ur-${id}`}, ${id}, ${roleId}, unixepoch())`);
}

/** Give a role an allow rule on this connection for one database pattern. */
async function allow(roleId: string, databasePattern: string): Promise<void> {
  const policy = `pol-${roleId}`;
  await rawRun(sql`INSERT INTO rbac_data_access_policies (id, name, is_system, created_at, updated_at) VALUES (${policy}, ${policy}, 0, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_data_access_policy_rules (id, policy_id, connection_id, database_pattern, table_pattern, is_allowed, priority, created_at, updated_at)
    VALUES (${`rule-${roleId}`}, ${policy}, ${CONNECTION}, ${databasePattern}, '*', 1, 0, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_role_data_access_policies (id, role_id, policy_id, created_at) VALUES (${`rdp-${roleId}`}, ${roleId}, ${policy}, unixepoch())`);
}

async function cellsSeenBy(requestHeaders: Record<string, string>): Promise<CellBody[]> {
  const res = await app.request(`/notebooks/${notebookId}`, { headers: requestHeaders });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { cells: CellBody[] } }).data.cells;
}

function cellFor(cells: CellBody[], table: string): CellBody {
  const cell = cells.find((c) => c.content.sql?.includes(table));
  if (!cell) throw new Error(`no cell reads ${table}`);
  return cell;
}

beforeAll(async () => {
  process.env.JWT_SECRET ||= "notebook-cells-test-secret-at-least-32-characters";
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
    VALUES (${CONNECTION}, 'cells', 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
  await seedUser(AUTHOR, "role-cells-author");
  await allow("role-cells-author", "*");
  await seedUser(READER, "role-cells-reader");
  await allow("role-cells-reader", "pub");
  await seedUser(BROKEN, "role-cells-broken");
  await allow("role-cells-broken", "pub");
  await seedUser(ADMIN, "role-cells-admin");
  await rawRun(sql`INSERT INTO obs_incidents (id, connection_id, kind, subject_ref, status, severity, summary, opened_at, last_event_at, created_at, updated_at)
    VALUES ('inc-cells', ${CONNECTION}, 'capacity', 'disk-cells', 'open', 'critical', 'x', 1, 1, 1, 1)`);

  app = new Hono();
  app.onError(errorHandler);
  app.route("/notebooks", notebooks);

  const ensured = await app.request("/notebooks/ensure", { method: "POST", headers: await asAuthor(), body: JSON.stringify({ kind: "incident_observe", ref: "inc-cells" }) });
  expect(ensured.status).toBe(200);
  notebookId = ((await ensured.json()) as { data: { notebook: { id: string } } }).data.notebook.id;
  for (const statement of ["SELECT * FROM secret.salaries", "SELECT * FROM pub.events"]) {
    const added = await app.request(`/notebooks/${notebookId}/cells`, { method: "POST", headers: await asAuthor(), body: JSON.stringify({ kind: "query", sql: statement }) });
    expect(added.status).toBe(201);
  }
});

afterAll(async () => {
  await closeDatabase();
  mock.restore();
});

describe("GET /notebooks/:id query cell rows", () => {
  it("gives the author both cells with their rows", async () => {
    const cells = await cellsSeenBy(await asAuthor());
    expect(cellFor(cells, "secret.salaries").content.snapshot?.rows).toEqual([[7, 123456]]);
    expect(cellFor(cells, "pub.events").content.snapshot?.rows).toEqual([[1, "open"]]);
  });

  it("withholds the rows of a cell that reads a table the reader's rules do not allow", async () => {
    const cells = await cellsSeenBy(await asReader());
    const secret = cellFor(cells, "secret.salaries");
    expect(secret.content.snapshot).toBeNull();
    expect(secret.content.snapshotWithheld).toBe(true);
    expect(JSON.stringify(secret)).not.toContain("123456");
  });

  it("still gives that reader the rows of a cell their rules allow", async () => {
    const allowed = cellFor(await cellsSeenBy(await asReader()), "pub.events");
    expect(allowed.content.snapshot?.rows).toEqual([[1, "open"]]);
    expect(allowed.content.snapshotWithheld).toBeUndefined();
  });

  it("withholds rows from a reader who lacks the permission to read table data at all", async () => {
    const cells = await cellsSeenBy(await headers(BROKEN, ["custom"], ["observe:view"]));
    expect(cellFor(cells, "pub.events").content.snapshot).toBeNull();
    expect(cellFor(cells, "secret.salaries").content.snapshot).toBeNull();
  });

  it("gives an admin every cell's rows", async () => {
    const cells = await cellsSeenBy(await headers(ADMIN, ["super_admin"], ["observe:view"]));
    expect(cellFor(cells, "secret.salaries").content.snapshot?.rows).toEqual([[7, 123456]]);
  });

  it("applies the same rule to find-by-attachment, ensure and the Markdown export", async () => {
    const reader = await asReader();
    const attached = await app.request("/notebooks/attached/incident_observe/inc-cells", { headers: reader });
    expect(JSON.stringify(await attached.json())).not.toContain("123456");

    const ensured = await app.request("/notebooks/ensure", { method: "POST", headers: reader, body: JSON.stringify({ kind: "incident_observe", ref: "inc-cells" }) });
    expect(JSON.stringify(await ensured.json())).not.toContain("123456");

    const exported = await app.request(`/notebooks/${notebookId}/export`, { headers: reader });
    const markdown = await exported.text();
    expect(markdown).not.toContain("123456");
    expect(markdown).toContain("Rows withheld");
    expect(markdown).toContain("open");
  });
});
