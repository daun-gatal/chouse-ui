/**
 * Real-server checks for a shared-login connection (ADR 0033 §10.5, row 2):
 * what CHouse now leaves to ClickHouse itself, proven on ClickHouse. Each case
 * runs on the current server and on the old one.
 *
 * The access check is the real one. Where a case must show that ClickHouse
 * refuses what CHouse would have refused first, `setAccessOverrideForTests`
 * forces that stage of the check to allow.
 *
 * Skipped unless OBSERVE_E2E_URL is set (scripts/e2e-observe.sh sets it and
 * OBSERVE_E2E_OLD_URL):
 *   OBSERVE_E2E_URL=http://host:8123 OBSERVE_E2E_PASSWORD=… bun test src/services/chExecutor/shared.e2e.test.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { sql } from "drizzle-orm";

import { checkedOf, setAccessOverrideForTests, validateQueryAccess, validateSystemRead, type QueryAccessResult } from "../../middleware/dataAccess";
import { resetDefaultDatabaseCache } from "../../middleware/sqlAccess";
import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawRun } from "../../rbac/db/migrationTestHarness";
import { createConnection } from "../../rbac/services/connections";
import { ClickHouseService } from "../clickhouse";
import { execute as runPanel } from "../dashboards/runner";
import { NOT_OBSERVE } from "../observe/clickhouse";
import { execute as runJob, NO_OWNER } from "../scheduledQueries/runner";
import * as jobs from "../scheduledQueries/store";
import { connectionConfig, executorForConnection, makeQueryId, personActor } from "./index";

const SERVERS = [
  { label: "current", url: process.env["OBSERVE_E2E_URL"] ?? "" },
  { label: "old", url: process.env["OBSERVE_E2E_OLD_URL"] ?? "" },
].filter((server) => server.url !== "");
const PASSWORD = process.env["OBSERVE_E2E_PASSWORD"] ?? "";

const READER = ["table:select", "table:view", "query:execute"];
const WRITER = [...READER, "table:insert", "table:create", "table:drop", "table:alter", "query:execute:misc"];

/** The accounts of this suite. Only ADMIN and EDITOR exist in the RBAC database; the others are ids on a request. */
const ADMIN = "e2e-admin";
const EDITOR = "e2e-editor";
const ANALYST = "e2e-analyst";
const WRITER_ID = "e2e-writer";

describe.skipIf(SERVERS.length === 0)("shared-login connections on a real server (ADR 0033)", () => {
  beforeAll(async () => {
    process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
    process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
    await freshDatabase("sqlite");
    await runMigrations();
    for (const id of [ADMIN, EDITOR]) {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@test.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
      await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) SELECT ${`ur-${id}`}, ${id}, id, unixepoch() FROM rbac_roles WHERE name = 'super_admin'`);
    }
  }, 60_000);

  afterEach(() => setAccessOverrideForTests(null));

  afterAll(async () => {
    await closeDatabase();
  });

  for (const server of SERVERS) {
    describe(`${server.label} server`, () => {
      const DB = `adr33_${server.label}_${Date.now()}`;
      let raw: ClickHouseClient;
      let version = "";
      let connectionId = "";
      let deadConnectionId = "";
      let readOnlyConnectionId = "";
      let impersonationParses = false;

      const serviceFor = async (accountId: string, connection = connectionId): Promise<ClickHouseService> =>
        new ClickHouseService(await connectionConfig(connection), personActor(accountId));

      const check = (accountId: string, permissions: string[], statement: string, isAdmin = false): Promise<QueryAccessResult> =>
        validateQueryAccess({ userId: accountId, isAdmin, permissions, sql: statement, connectionId });

      /** Check as the real access check would, then run what it returned. */
      const run = async (accountId: string, permissions: string[], statement: string, isAdmin = false): Promise<{ queryId: string | undefined; data: unknown[] }> => {
        const access = await check(accountId, permissions, statement, isAdmin);
        if (!access.allowed) throw new Error(`refused by CHouse: ${access.code} ${access.reason}`);
        const result = await (await serviceFor(accountId)).executeChecked(checkedOf(access));
        return { queryId: result.queryId, data: result.data };
      };

      const scalar = async (statement: string, params: Record<string, unknown> = {}): Promise<string> => {
        const result = await raw.query({ query: statement, query_params: params, format: "JSONEachRow" });
        const rows = (await result.json()) as Array<Record<string, unknown>>;
        return rows[0] ? String(Object.values(rows[0])[0]) : "";
      };

      const flush = (): Promise<unknown> => raw.command({ query: "SYSTEM FLUSH LOGS" });

      beforeAll(async () => {
        const url = new URL(server.url);
        const port = Number(url.port || 8123);
        raw = createClient({ url: server.url, username: "default", password: PASSWORD });
        version = await scalar("SELECT version()");
        await raw.command({ query: `CREATE DATABASE ${DB}` });
        await raw.command({ query: `CREATE TABLE ${DB}.t (a Int32) ENGINE = MergeTree ORDER BY a` });
        await raw.command({ query: `INSERT INTO ${DB}.t VALUES (1), (2)` });
        await raw.command({ query: `CREATE USER IF NOT EXISTS ${DB}_ro IDENTIFIED BY '${PASSWORD || "e2e"}' SETTINGS readonly = 2` });
        await raw.command({ query: `GRANT SELECT ON ${DB}.* TO ${DB}_ro` });

        connectionId = (await createConnection({ name: `adr33-${server.label}`, host: url.hostname, port, username: "default", password: PASSWORD, sslEnabled: false })).id;
        readOnlyConnectionId = (await createConnection({ name: `adr33-ro-${server.label}`, host: url.hostname, port, username: `${DB}_ro`, password: PASSWORD || "e2e", sslEnabled: false })).id;
        // Nothing listens on port 9: the parse cannot run there.
        deadConnectionId = (await createConnection({ name: `adr33-dead-${server.label}`, host: "127.0.0.1", port: 9, username: "default", password: PASSWORD, sslEnabled: false })).id;
        resetDefaultDatabaseCache();

        const probe = await check(ADMIN, [], "EXECUTE AS default SELECT 1", true);
        impersonationParses = probe.code === "IMPERSONATION";
      }, 120_000);

      afterAll(async () => {
        await raw?.command({ query: `DROP DATABASE IF EXISTS ${DB} SYNC` }).catch(() => undefined);
        await raw?.command({ query: `DROP USER IF EXISTS ${DB}_ro` }).catch(() => undefined);
        await raw?.command({ query: `DROP QUOTA IF EXISTS ${DB}_quota` }).catch(() => undefined);
        await raw?.close();
      });

      describe("read-only is enforced by ClickHouse (goal 2)", () => {
        it("refuses a write from a person who may write nothing, when the access check is forced to allow", async () => {
          setAccessOverrideForTests(() => true);
          const before = await scalar(`SELECT count() FROM ${DB}.t`);
          await expect(run(ANALYST, READER, `INSERT INTO ${DB}.t VALUES (99)`)).rejects.toMatchObject({ code: "READ_ONLY", statusCode: 403 });
          await expect(run(ANALYST, READER, `CREATE TABLE ${DB}.sneaky (a Int32) ENGINE = Memory`)).rejects.toMatchObject({ code: "READ_ONLY" });
          await expect(run(ANALYST, READER, `ALTER TABLE ${DB}.t DELETE WHERE 1`)).rejects.toMatchObject({ code: "READ_ONLY" });
          expect(await scalar(`SELECT count() FROM ${DB}.t`)).toBe(before);
          expect(await scalar(`SELECT count() FROM system.tables WHERE database = '${DB}' AND name = 'sneaky'`)).toBe("0");
        });

        it("lets the same statements through for a person who may write", async () => {
          setAccessOverrideForTests((stage) => stage === "table");
          await run(WRITER_ID, WRITER, `INSERT INTO ${DB}.t VALUES (3)`);
          expect(await scalar(`SELECT count() FROM ${DB}.t WHERE a = 3`)).toBe("1");
        });

        it("refuses a write in a dashboard panel, also for an admin viewer", async () => {
          const access = await check(ADMIN, [], `INSERT INTO ${DB}.t VALUES (77)`, true);
          expect(access.allowed).toBe(true);
          await expect(runPanel(checkedOf(access), { dashboardId: null, panelId: "e2e" })).rejects.toMatchObject({ code: "READ_ONLY", statusCode: 403 });
          expect(await scalar(`SELECT count() FROM ${DB}.t WHERE a = 77`)).toBe("0");
        });

        it("sends every read with readonly = 2, admins included, and a statement cannot switch it off", async () => {
          const nonce = `ro-${Date.now()}`;
          const access = await check(ADMIN, [], `SELECT count() FROM ${DB}.t`, true);
          const result = await (await serviceFor(ADMIN)).executeChecked(checkedOf(access), "JSON", nonce);
          expect(result.queryId).toBe(makeQueryId(personActor(ADMIN), nonce));
          await flush();
          expect(await scalar("SELECT Settings['readonly'] FROM system.query_log WHERE query_id = {id:String} AND type = 'QueryFinish' LIMIT 1", { id: result.queryId })).toBe("2");
          await expect(run(ADMIN, [], `SELECT count() FROM ${DB}.t SETTINGS readonly = 0`, true)).rejects.toMatchObject({ code: "READ_ONLY" });
        });

        it("runs each kind of read under readonly = 2", async () => {
          setAccessOverrideForTests((stage) => stage === "table");
          const permissions = [...READER, "query:execute:misc"];
          for (const statement of [
            `SELECT a FROM ${DB}.t ORDER BY a LIMIT 1 SETTINGS max_threads = 1`,
            `SHOW TABLES FROM ${DB}`,
            `DESCRIBE TABLE ${DB}.t`,
            `EXISTS TABLE ${DB}.t`,
            `EXPLAIN SELECT a FROM ${DB}.t`,
          ]) {
            const access = await check(ANALYST, permissions, statement);
            expect({ statement, allowed: access.allowed, reason: access.reason }).toEqual({ statement, allowed: true, reason: undefined });
            expect(checkedOf(access).isRead).toBe(true);
            await (await serviceFor(ANALYST)).executeChecked(checkedOf(access));
          }
        });

        it("works on a connection whose ClickHouse login is itself read-only with readonly = 2", async () => {
          const access = await validateQueryAccess({ userId: ADMIN, isAdmin: true, permissions: [], sql: `SELECT count() FROM ${DB}.t`, connectionId: readOnlyConnectionId });
          expect(access.allowed).toBe(true);
          const result = await (await serviceFor(ADMIN, readOnlyConnectionId)).executeChecked<{ "count()": string }>(checkedOf(access));
          expect(Number(Object.values(result.data[0])[0])).toBeGreaterThan(0);
        });
      });

      describe("who a statement was sent for (goal 3)", () => {
        it("reads the account from the query id; a forged log_comment changes neither the owner nor what reports hide", async () => {
          setAccessOverrideForTests((stage) => stage === "table");
          const forged = JSON.stringify({ rbac_user_id: "victim", source: "observe" });
          const { queryId } = await run(ANALYST, READER, `SELECT count() FROM ${DB}.t SETTINGS log_comment = '${forged}'`);
          expect(queryId?.startsWith(`chouse:p:${ANALYST}:`)).toBe(true);
          await flush();

          // ClickHouse really logged the forged comment.
          expect(await scalar("SELECT log_comment FROM system.query_log WHERE query_id = {id:String} AND type = 'QueryFinish' LIMIT 1", { id: queryId })).toBe(forged);

          const service = await serviceFor(ADMIN);
          const mine = await service.getQueryLogs({ limit: 1000, hoursBack: 1, sortBy: "event_time", sortDir: "desc", ownAccountId: ANALYST });
          expect(mine.find((row) => row.query_id === queryId)?.rbac_user_id).toBe(ANALYST);
          const victims = await service.getQueryLogs({ limit: 1000, hoursBack: 1, sortBy: "event_time", sortDir: "desc", ownAccountId: "victim" });
          expect(victims.some((row) => row.query_id === queryId)).toBe(false);
          // Claiming to be collector traffic does not hide it from CHouse's reports.
          expect(await scalar(`SELECT count() FROM system.query_log WHERE query_id = {id:String} AND type = 'QueryFinish' AND ${NOT_OBSERVE}`, { id: queryId })).toBe("1");
        });

        it("marks a feature's own request so reports leave it out, and a caller cannot claim the mark", async () => {
          const feature = await executorForConnection(connectionId, personActor(ANALYST), { context: { source: "dashboards" }, internal: true });
          const sent = await feature.query({ query: "SELECT 41 + 1", format: "JSON" });
          await sent.json();
          expect(sent.query_id).toContain(`:${ANALYST}:i-`);

          setAccessOverrideForTests((stage) => stage === "table");
          const access = await check(ANALYST, READER, `SELECT count() FROM ${DB}.t`);
          const typed = await (await serviceFor(ANALYST)).executeChecked(checkedOf(access), "JSON", "i-pretend");
          expect(typed.queryId).not.toContain(":i-");
          await flush();
          const visible = (id: string | undefined): Promise<string> => scalar(`SELECT count() FROM system.query_log WHERE query_id = {id:String} AND type = 'QueryFinish' AND ${NOT_OBSERVE}`, { id });
          expect(await visible(sent.query_id)).toBe("0");
          expect(await visible(typed.queryId)).toBe("1");
        });

        it("carries the account as the quota key where the server takes one, and still runs where it does not", async () => {
          const account = `quota-${Date.now()}`;
          await raw.command({ query: `CREATE QUOTA ${DB}_quota KEYED BY client_key FOR INTERVAL 1 hour MAX queries = 100000 TO default` });
          const service = await serviceFor(account);
          const usage = await service.executeQuery<{ quota_key: string; queries: string }>(`SELECT quota_key, queries FROM system.quota_usage WHERE quota_name = '${DB}_quota'`);
          const keyed = usage.data.some((row) => row.quota_key === account);
          const takesKey = Number(version.split(".")[0]) >= 24;
          expect({ version, keyed }).toEqual({ version, keyed: takesKey });
          await raw.command({ query: `DROP QUOTA ${DB}_quota` });
        });
      });

      describe("system tables that show other people's work (goal 4)", () => {
        it("refuses a restricted read of the statement log and the access tables, and allows other system tables", async () => {
          expect(await check(ANALYST, READER, "SELECT query FROM system.query_log LIMIT 1")).toMatchObject({ allowed: false, code: "TABLE_DENIED", status: 403 });
          expect(await check(ANALYST, READER, "SELECT query FROM system.processes")).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
          expect(await check(ANALYST, READER, "SELECT name FROM system.users")).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
          expect(await check(ANALYST, READER, "SELECT p.name FROM system.parts AS p INNER JOIN system.query_log AS q ON 1 = 1 LIMIT 1")).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
          expect(await check(ANALYST, READER, "SELECT * FROM (SELECT query FROM system.query_log) LIMIT 1")).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
          const parts = await run(ANALYST, READER, "SELECT count() FROM system.parts");
          expect(parts.data).toHaveLength(1);
        });

        it("allows the same reads with the permission each group asks for", async () => {
          const logs = await run(ANALYST, [...READER, "query:history:view:all"], "SELECT count() FROM system.query_log");
          expect(logs.data).toHaveLength(1);
          expect(await check(ANALYST, [...READER, "query:history:view:all"], "SELECT name FROM system.users")).toMatchObject({ allowed: false });
          expect(await check(ANALYST, [...READER, "clickhouse:users:view"], "SELECT name FROM system.users")).toMatchObject({ allowed: true });
        });

        it("applies the same rule to SQL a model writes for a person, and limits it to system tables", async () => {
          const read = (statement: string, permissions: string[] = []): Promise<QueryAccessResult> =>
            validateSystemRead({ userId: ANALYST, isAdmin: false, permissions, sql: statement, connectionId });
          expect(await read("SELECT query FROM system.query_log LIMIT 1")).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
          expect(await read(`SELECT a FROM ${DB}.t`)).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
          expect(await read(`INSERT INTO ${DB}.t VALUES (5)`)).toMatchObject({ allowed: false });
          const allowed = await read("SELECT count() FROM system.parts WHERE active");
          expect(allowed.allowed).toBe(true);
          const executor = await executorForConnection(connectionId, personActor(ANALYST));
          const result = await executor.queryChecked(checkedOf(allowed), { format: "JSON", readOnlyFeature: 1 });
          expect(((await result.json()) as { data: unknown[] }).data).toHaveLength(1);
        });
      });

      describe("admins are parsed (CUJ 7)", () => {
        it("refuses EXECUTE AS as the root, behind a comment and under PARALLEL WITH", async () => {
          for (const statement of ["EXECUTE AS default SELECT 1", "/* x */ -- y\nEXECUTE AS default SELECT 1", "SELECT 1 PARALLEL WITH EXECUTE AS default SELECT 2"]) {
            const access = await check(ADMIN, [], statement, true);
            expect(access.allowed).toBe(false);
            // A server that has no EXECUTE AS cannot parse it, which is a refusal too.
            expect(access.code).toBe(impersonationParses ? "IMPERSONATION" : "SQL_SYNTAX");
          }
        });

        it("keeps every other statement kind working for an admin", async () => {
          await run(ADMIN, [], `CREATE TABLE ${DB}.admin_t (a Int32) ENGINE = MergeTree ORDER BY a`, true);
          await run(ADMIN, [], `INSERT INTO ${DB}.admin_t VALUES (1)`, true);
          await run(ADMIN, [], `ALTER TABLE ${DB}.admin_t ADD COLUMN b String DEFAULT ''`, true);
          expect((await run(ADMIN, [], `SELECT count() FROM ${DB}.admin_t`, true)).data).toHaveLength(1);
          expect((await run(ADMIN, [], `SHOW CREATE TABLE ${DB}.admin_t`, true)).data).toHaveLength(1);
          await run(ADMIN, [], `OPTIMIZE TABLE ${DB}.admin_t FINAL`, true);
          await run(ADMIN, [], `KILL QUERY WHERE query_id = 'no-such-query'`, true);
          await run(ADMIN, [], `DROP TABLE ${DB}.admin_t`, true);
          expect(await scalar(`SELECT count() FROM system.tables WHERE database = '${DB}' AND name = 'admin_t'`)).toBe("0");
        });

        it("refuses an admin's statement when the parse cannot run", async () => {
          const access = await validateQueryAccess({ userId: ADMIN, isAdmin: true, permissions: [], sql: "SELECT 1", connectionId: deadConnectionId });
          expect(access).toMatchObject({ allowed: false, code: "CHECK_UNAVAILABLE", status: 503 });
        }, 30_000);
      });

      describe("typed KILL QUERY", () => {
        it("needs live_queries:kill_all", async () => {
          const statement = "KILL QUERY WHERE query_id = 'none'";
          expect(await check(ANALYST, [...WRITER, "live_queries:kill"], statement)).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
          expect(await check(ANALYST, [...WRITER, "live_queries:kill_all"], statement)).toMatchObject({ allowed: true });
        });
      });

      describe("who a scheduled job runs as (goal 10)", () => {
        const jobInput = (name: string): jobs.JobInput => ({
          name, description: null, connectionId, query: `SELECT count() AS c FROM ${DB}.t`, enabled: true, frequency: "daily", hour: 8, dayOfWeek: 1, dayOfMonth: 1,
          cronExpr: null, timezone: "UTC", outputMode: "none", destDatabase: null, destTable: null, outputConfig: null, maxRows: 100, timeoutSecs: 60,
          useFinal: false, seqConsistency: false, maxAttempts: 1, retentionDays: 30,
        });
        const runOnce = async (id: string): Promise<{ status: string; message: string | null; runId: string }> => {
          const job = (await jobs.getJob(id))!;
          const run = await runJob(job, { trigger: "manual", slotAt: Date.now(), attempt: 1, suppressNotifications: true });
          return { status: String(run?.status), message: run?.message ?? null, runId: String(run?.id) };
        };

        it("refuses a job with no owner and records why", async () => {
          const id = await jobs.createJob(jobInput("orphan"), null);
          const outcome = await runOnce(id);
          expect(outcome.status).toBe("error");
          expect(outcome.message).toContain(NO_OWNER);
        });

        it("runs as whoever took it over, which the statement's query id shows", async () => {
          const id = await jobs.createJob(jobInput("handed over"), ADMIN);
          const first = await runOnce(id);
          expect({ status: first.status, message: first.message }).toEqual({ status: "success", message: null });
          expect(await jobs.setJobOwner(id, EDITOR)).toBe(true);
          const second = await runOnce(id);
          expect(second.status).toBe("success");
          await flush();
          const sentFor = (runId: string): Promise<string> => scalar("SELECT query_id FROM system.query_log WHERE endsWith(query_id, {suffix:String}) AND type = 'QueryFinish' LIMIT 1", { suffix: `:${runId}` });
          expect(await sentFor(first.runId)).toBe(`chouse:p:${ADMIN}:${first.runId}`);
          expect(await sentFor(second.runId)).toBe(`chouse:p:${EDITOR}:${second.runId}`);
        });

        it("refuses a job whose owner no longer exists", async () => {
          const id = await jobs.createJob(jobInput("ghost"), "deleted-account");
          const outcome = await runOnce(id);
          expect(outcome.status).toBe("error");
          expect(outcome.message).toContain("data access denied");
        });
      });
    });
  }
});
