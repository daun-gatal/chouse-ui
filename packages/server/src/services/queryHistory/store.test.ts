import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawRun } from "../../rbac/db/migrationTestHarness";
import * as store from "./store";

beforeEach(async () => {
  await freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  await rawRun(sql`
    INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at)
    VALUES ('user-1', 'one@example.com', 'one', 'x', 1, 1, 1),
           ('user-2', 'two@example.com', 'two', 'x', 1, 1, 1)
  `);
});

afterEach(async () => {
  await closeDatabase();
});

describe("query history store", () => {
  it("scopes history by user, caps it, and supports deletion", async () => {
    for (let index = 0; index < 101; index += 1) {
      await store.recordQueryHistory("user-1", {
        id: `query-${index}`,
        query: `SELECT ${index}`,
        connectionId: null,
        connectionName: null,
        executedAt: index,
        durationMs: index,
        rows: 1,
        status: "success",
      });
    }
    await store.recordQueryHistory("user-2", {
      id: "other-user-query",
      query: "SELECT secret",
      connectionId: null,
      connectionName: null,
      executedAt: 200,
      durationMs: 1,
      rows: 1,
      status: "success",
    });

    const history = await store.listQueryHistory("user-1");
    expect(history).toHaveLength(100);
    expect(history[0].id).toBe("query-100");
    expect(history.at(-1)?.id).toBe("query-1");
    expect(history.some((item) => item.id === "other-user-query")).toBe(false);

    await store.deleteQueryHistoryItem("user-1", "query-100");
    expect((await store.listQueryHistory("user-1"))[0].id).toBe("query-99");
    await store.clearQueryHistory("user-1");
    expect(await store.listQueryHistory("user-1")).toEqual([]);
    expect(await store.listQueryHistory("user-2")).toHaveLength(1);
  });
});
