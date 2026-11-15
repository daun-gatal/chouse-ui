import { describe, expect, it } from "bun:test";

import { checkedForTests } from "./checked.test-util";
import { executorOverClient, logCommentFor, quotaKeyFor, type ClientLike } from "./executor";
import { personActor, serviceActor } from "./types";

interface Sent {
  method: string;
  args: Record<string, unknown>;
}

function recordingClient(): { client: ClientLike; sent: Sent[] } {
  const sent: Sent[] = [];
  const record = (method: string) => async (args: Record<string, unknown>) => {
    sent.push({ method, args });
    return { query_id: String(args.query_id), response_headers: {}, json: async () => ({ data: [] }) };
  };
  const client = {
    query: record("query"),
    command: record("command"),
    exec: record("exec"),
    insert: record("insert"),
    ping: async () => ({ success: true }),
  } as unknown as ClientLike;
  return { client, sent };
}

describe("executor handle", () => {
  it("sets the query id, log_comment and quota key from the actor on every kind of request", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("u1", "pat-9"), { context: { source: "test" } });
    await executor.query({ query: "SELECT 1", format: "JSON" });
    await executor.command({ query: "OPTIMIZE TABLE t" });
    await executor.exec({ query: "EXPLAIN AST SELECT 1" });
    // By now the server is known to take the quota key, so the insert carries it too.
    await executor.insert({ table: "t", values: [], format: "JSONEachRow" });
    expect(sent.map((s) => s.method)).toEqual(["query", "command", "exec", "insert"]);
    for (const { args } of sent) {
      expect(String(args.query_id).startsWith("chouse:p:u1:")).toBe(true);
      expect(args.http_headers).toEqual({ "X-ClickHouse-Quota": "u1" });
      expect(JSON.parse((args.clickhouse_settings as { log_comment: string }).log_comment)).toEqual({ source: "test", rbac_user_id: "u1", token_id: "pat-9" });
    }
  });

  it("treats a caller's query_id as the nonce, never as the whole id", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("u1"));
    await executor.query({ query: "SELECT 1", query_id: "run-7" });
    await executor.query({ query: "SELECT 1", query_id: "chouse:p:someone-else:x" });
    expect(sent[0].args.query_id).toBe("chouse:p:u1:run-7");
    expect(executor.queryIdFor("run-7")).toBe("chouse:p:u1:run-7");
    expect(String(sent[1].args.query_id).startsWith("chouse:p:u1:")).toBe(true);
    expect(String(sent[1].args.query_id)).not.toContain("someone-else");
  });

  it("does not let a call override log_comment, and keeps its other settings", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("u1"), { defaults: { max_execution_time: 10 } });
    await executor.query({ query: "SELECT 1", clickhouse_settings: { readonly: "1", log_comment: JSON.stringify({ rbac_user_id: "victim" }) } });
    const settings = sent[0].args.clickhouse_settings as Record<string, unknown>;
    expect(JSON.parse(String(settings.log_comment))).toEqual({ rbac_user_id: "u1" });
    expect(settings.readonly).toBe("1");
    expect(settings.max_execution_time).toBe(10);
  });

  it("drops a session, role, credentials or headers smuggled into a call", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("u1"));
    const smuggled = { query: "SELECT 1", session_id: "s", role: "admin_role", auth: { username: "x", password: "y" }, http_headers: { "X-ClickHouse-Quota": "victim", "X-ClickHouse-User": "x" } };
    await executor.query(smuggled as never);
    await executor.command(smuggled as never);
    for (const { args } of sent) {
      expect(args.session_id).toBeUndefined();
      expect(args.role).toBeUndefined();
      expect(args.auth).toBeUndefined();
      expect(args.http_headers).toEqual({ "X-ClickHouse-Quota": "u1" });
    }
  });

  it("identity keys in the context cannot replace the actor's", () => {
    expect(JSON.parse(logCommentFor(personActor("u1"), { rbac_user_id: "victim", source: "x" }))).toEqual({ rbac_user_id: "u1", source: "x" });
    expect(JSON.parse(logCommentFor(serviceActor("collector", "u2"), { purpose: "other" }))).toEqual({ purpose: "collector", triggered_by: "u2" });
    expect(quotaKeyFor(serviceActor("collector"))).toBe("chouse-collector");
  });

  it("adds context per call site without changing the actor", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, serviceActor("collector")).withContext({ collector: "tables" });
    await executor.query({ query: "SELECT 1" });
    expect(String(sent[0].args.query_id).startsWith("chouse:s:collector:")).toBe(true);
    expect(JSON.parse((sent[0].args.clickhouse_settings as { log_comment: string }).log_comment)).toEqual({ collector: "tables", purpose: "collector" });
  });

  it("uses the service lane client only when asked", async () => {
    const lanes: string[] = [];
    const { client } = recordingClient();
    const executor = executorOverClient((lane) => { lanes.push(lane); return client; }, serviceActor("stop-query"));
    await executor.query({ query: "SELECT 1" });
    await executor.onServiceLane().command({ query: "KILL QUERY WHERE query_id = 'x'" });
    expect(lanes).toEqual(["statements", "service"]);
  });

  it("a pinned session sends the session id and checks it from the second statement on", async () => {
    const { client, sent } = recordingClient();
    const session = executorOverClient(() => client, personActor("u1")).session(undefined, "sess-1");
    await session.command("CREATE TABLE a (x UInt8) ENGINE = Memory", { queryId: "r1" });
    await session.command("EXCHANGE TABLES a AND b");
    expect(sent[0].args.session_id).toBe("sess-1");
    expect((sent[0].args.clickhouse_settings as Record<string, unknown>).session_check).toBeUndefined();
    expect((sent[1].args.clickhouse_settings as Record<string, unknown>).session_check).toBe(1);
    expect(sent[0].args.query_id).toBe("chouse:p:u1:r1");
  });

  describe("a server that refuses the quota key next to Basic auth (ClickHouse 23.8)", () => {
    const REFUSAL = "Invalid authentication: it is not allowed to use SSL certificate authentication and Authorization HTTP header simultaneously.";

    function oldServer(): { client: ClientLike; sent: Sent[] } {
      const sent: Sent[] = [];
      const record = (method: string) => async (args: Record<string, unknown>) => {
        sent.push({ method, args });
        if (args.http_headers) throw new Error(REFUSAL);
        return { query_id: String(args.query_id), response_headers: {}, json: async () => ({ data: [] }) };
      };
      return { client: { query: record("query"), command: record("command"), exec: record("exec"), insert: record("insert"), ping: async () => ({ success: true }) } as unknown as ClientLike, sent };
    }

    it("sends the first request again without the key, with the same query id, and remembers", async () => {
      const { client, sent } = oldServer();
      const executor = executorOverClient(() => client, personActor("u1"));
      await executor.query({ query: "SELECT 1", query_id: "n1" });
      expect(sent).toHaveLength(2);
      expect(sent[0].args.http_headers).toEqual({ "X-ClickHouse-Quota": "u1" });
      expect(sent[1].args.http_headers).toBeUndefined();
      expect(sent[1].args.query_id).toBe("chouse:p:u1:n1");
      await executor.command({ query: "OPTIMIZE TABLE t" });
      await executorOverClient(() => client, serviceActor("collector")).query({ query: "SELECT 2" });
      expect(sent).toHaveLength(4);
      expect(sent[2].args.http_headers).toBeUndefined();
      expect(sent[3].args.http_headers).toBeUndefined();
    });

    it("never sends a streamed insert twice: no key until the server is known to take it", async () => {
      const { client, sent } = oldServer();
      await executorOverClient(() => client, personActor("u1")).insert({ table: "t", values: [], format: "JSONEachRow" });
      expect(sent).toHaveLength(1);
      expect(sent[0].args.http_headers).toBeUndefined();

      const modern = recordingClient();
      const executor = executorOverClient(() => modern.client, personActor("u1"));
      await executor.query({ query: "SELECT 1" });
      await executor.insert({ table: "t", values: [], format: "JSONEachRow" });
      expect(modern.sent[1].args.http_headers).toEqual({ "X-ClickHouse-Quota": "u1" });
    });

    it("does not hide any other failure, and does not retry it", async () => {
      const sent: Sent[] = [];
      const client = { query: async (args: Record<string, unknown>) => { sent.push({ method: "query", args }); throw new Error("Code: 497. Not enough privileges"); } } as unknown as ClientLike;
      await expect(executorOverClient(() => client, personActor("u1")).query({ query: "SELECT 1" })).rejects.toThrow("497");
      expect(sent).toHaveLength(1);
    });
  });

  it("reports ping as a boolean", async () => {
    const { client } = recordingClient();
    expect(await executorOverClient(() => client, serviceActor("connection-test")).ping()).toBe(true);
  });
});

describe("checked statements (ADR 0033 §2)", () => {
  const settingsOf = (sent: Sent): Record<string, unknown> => sent.args.clickhouse_settings as Record<string, unknown>;

  it("sends the checked text and parameters, with the actor's identity", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("u1"));
    const statement = checkedForTests({ sql: "SELECT * FROM {t:Identifier}", params: { t: "shop.orders" }, accountId: "u1" });
    await executor.queryChecked(statement, { format: "JSON", query_id: "n1" });
    expect(sent[0].method).toBe("query");
    expect(sent[0].args).toMatchObject({ query: "SELECT * FROM {t:Identifier}", query_params: { t: "shop.orders" }, format: "JSON", query_id: "chouse:p:u1:n1" });
    expect(sent[0].args.http_headers).toEqual({ "X-ClickHouse-Quota": "u1" });
  });

  it("ignores text, parameters and readonly that a call tries to pass", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("u1"));
    const write = checkedForTests({ sql: "INSERT INTO t SELECT 1", accountId: "u1", isRead: false, mayWrite: false });
    const smuggled = { query: "DROP TABLE t", query_params: { x: "1" }, clickhouse_settings: { readonly: "0", max_execution_time: 5 } };
    await executor.commandChecked(write, smuggled as never);
    expect(sent[0].method).toBe("command");
    expect(sent[0].args.query).toBe("INSERT INTO t SELECT 1");
    expect(sent[0].args.query_params).toBeUndefined();
    expect(settingsOf(sent[0])).toMatchObject({ readonly: "2", max_execution_time: 5 });
  });

  it("decides readonly from the statement: 2 for a read, none for a write by a person who may write", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("u1"));
    await executor.queryChecked(checkedForTests({ sql: "SELECT 1", accountId: "u1" }));
    await executor.commandChecked(checkedForTests({ sql: "INSERT INTO t SELECT 1", accountId: "u1", isRead: false, mayWrite: true }), { clickhouse_settings: { readonly: "1" } });
    await executor.queryChecked(checkedForTests({ sql: "INSERT INTO t SELECT 1", accountId: "u1", isRead: false, mayWrite: true }), { readOnlyFeature: 1 });
    expect(settingsOf(sent[0]).readonly).toBe("2");
    expect("readonly" in settingsOf(sent[1])).toBe(false);
    expect(settingsOf(sent[2]).readonly).toBe("1");
    expect("readOnlyFeature" in sent[2].args).toBe(false);
  });

  it("refuses a statement checked for someone else, and any statement on a service handle", async () => {
    const { client, sent } = recordingClient();
    const statement = checkedForTests({ sql: "SELECT 1", accountId: "u1" });
    expect(() => executorOverClient(() => client, personActor("u2")).queryChecked(statement)).toThrow("person it was checked for");
    expect(() => executorOverClient(() => client, serviceActor("collector")).commandChecked(statement)).toThrow("person it was checked for");
    expect(sent).toHaveLength(0);
  });

  it("refuses an object that only looks like a checked statement", () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("u1"));
    const forged = { sql: "DROP TABLE t", params: undefined, connectionId: "c1", accountId: "u1", isRead: false, mayWrite: true };
    expect(() => executor.commandChecked(forged as never)).toThrow("the access check returned");
    expect(() => executor.queryChecked(Object.create(Object.getPrototypeOf(checkedForTests({ sql: "SELECT 1" })), { sql: { value: "DROP TABLE t" }, accountId: { value: "u1" } }) as never)).toThrow("the access check returned");
    expect(sent).toHaveLength(0);
  });

  it("refuses a statement checked for another connection, when the handle knows its connection", async () => {
    const { client, sent } = recordingClient();
    const onA = executorOverClient(() => client, personActor("u1"), { connectionId: "conn-a" });
    expect(() => onA.queryChecked(checkedForTests({ sql: "SELECT 1", accountId: "u1", connectionId: "conn-b" }))).toThrow("connection it was checked for");
    await onA.queryChecked(checkedForTests({ sql: "SELECT 1", accountId: "u1", connectionId: "conn-a" }));
    expect(sent).toHaveLength(1);
  });

  it("the test helper refuses to make a statement outside a test run", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => checkedForTests({ sql: "SELECT 1" })).toThrow();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
