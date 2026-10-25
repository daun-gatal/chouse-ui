/**
 * POST /ai-memories/suggest (ADR 0026 §9): suggestions from your own thread
 * only, without what memory already holds, without what a guardrail keeps
 * from the provider, without personal notes when memory is off; one model
 * call per thread length; nothing when turned off. It never saves.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

let calls = 0;
let lastInput: { turns: unknown[]; existing: { user: string[]; team: string[] }; userMemory: boolean } | null = null;
let reply: Array<{ note: string; scope: "user" | "connection" }> = [];
mock.module("../services/ai/engine", () => ({
  runStructuredCapability: async (_cap: unknown, input: typeof lastInput) => {
    calls++;
    lastInput = input;
    return { suggestions: reply };
  },
}));
mock.module("../services/aiConfig", () => ({ isAIEnabled: async () => true }));
const runtime = await import("../services/ai/memory/runtime");
mock.module("../services/ai/memory/runtime", () => ({ ...runtime, screenNote: async (text: string) => (text.includes("4111") ? ["PII"] : []) }));

const { closeDatabase } = await import("../rbac/db");
const { runMigrations } = await import("../rbac/db/migrations");
const h = await import("../rbac/db/migrationTestHarness");
const { generateAccessToken } = await import("../rbac/services/jwt");
const { errorHandler } = await import("../middleware/error");
const { createThread, addMessage } = await import("../services/chatHistory");
const { createMemory, setMemoryEnabled } = await import("../services/ai/memory/store");
const { resetChobiSettingsCache, saveChobiSettings } = await import("../services/chobi/settings");
const { default: aiMemories, resetSuggestCache } = await import("./ai-memories");

let app: Hono;
let thread = "";

async function suggest(threadId: string, sub = "ana"): Promise<{ status: number; data: { suggestions: Array<{ note: string; scope: string }>; off?: boolean } }> {
  const token = await generateAccessToken({ sub, email: `${sub}@t.io`, username: sub, roles: ["super_admin"], permissions: ["ai:chat"], sessionId: "s1" });
  const res = await app.request("/ai-memories/suggest", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ threadId }) });
  const json = (await res.json()) as { data: never };
  return { status: res.status, data: json.data };
}

beforeAll(async () => {
  await h.freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  for (const id of ["ana", "ben"]) {
    await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@t.io`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
  }
  await h.rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, created_at, updated_at) VALUES ('conn-1', 'prod', 'h', 8123, 'u', 'x', unixepoch(), unixepoch())`).catch(() => undefined);
  const t = await createThread("ana", "Times", "conn-1");
  thread = t.id;
  await addMessage(thread, "user", "Always use UTC for times, and orders_v1 is deprecated.");
  await addMessage(thread, "assistant", "Noted: UTC from now on.");
  await createMemory({ scope: "user", userId: "ana", connectionId: null, content: "Prefers dark mode.", source: "person" });
  app = new Hono();
  app.onError(errorHandler);
  app.route("/ai-memories", aiMemories);
}, 60_000);

afterAll(async () => {
  await closeDatabase();
});

beforeEach(() => {
  calls = 0;
  resetSuggestCache();
});

describe("POST /ai-memories/suggest", () => {
  it("suggests from the person's own thread, minus what memory already holds and what a guardrail keeps out", async () => {
    reply = [
      { note: "Prefers  UTC for all times.", scope: "user" },
      { note: "prefers dark mode.", scope: "user" },
      { note: "orders_v1 is deprecated; use orders.", scope: "connection" },
      { note: "Card 4111 1111 1111 1111 on file.", scope: "user" },
    ];
    const res = await suggest(thread);
    expect(res.status).toBe(200);
    expect(res.data.suggestions).toEqual([
      { note: "Prefers UTC for all times.", scope: "user" },
      { note: "orders_v1 is deprecated; use orders.", scope: "connection" },
    ]);
    expect(lastInput?.existing.user).toEqual(["Prefers dark mode."]);
    expect(lastInput?.userMemory).toBe(true);
    expect(await h.rawAll(sql`SELECT COUNT(*) AS n FROM ai_memories WHERE content LIKE '%UTC%'`)).toEqual([{ n: 0 }]);
  });

  it("asks the model once per thread length", async () => {
    reply = [{ note: "Uses UTC.", scope: "user" }];
    await suggest(thread);
    await suggest(thread);
    expect(calls).toBe(1);
    await addMessage(thread, "user", "Thanks");
    await addMessage(thread, "assistant", "Anytime");
    await suggest(thread);
    expect(calls).toBe(2);
  });

  it("does not offer a note again once it was saved, even from the cached answer", async () => {
    reply = [{ note: "Keeps reports in UTC.", scope: "user" }];
    expect((await suggest(thread)).data.suggestions).toEqual([{ note: "Keeps reports in UTC.", scope: "user" }]);
    await createMemory({ scope: "user", userId: "ana", connectionId: null, content: "Keeps reports in UTC.", source: "person" });
    expect((await suggest(thread)).data.suggestions).toEqual([]);
    expect(calls).toBe(1);
  });

  it("offers only team notes when the person turned memory off", async () => {
    await setMemoryEnabled("ana", false);
    reply = [{ note: "Uses UTC.", scope: "user" }, { note: "events.ts is UTC.", scope: "connection" }];
    expect((await suggest(thread)).data.suggestions).toEqual([{ note: "events.ts is UTC.", scope: "connection" }]);
    expect(lastInput?.userMemory).toBe(false);
    await setMemoryEnabled("ana", true);
  });

  it("refuses someone else's thread, and suggests nothing for a thread with no answer yet", async () => {
    expect((await suggest(thread, "ben")).status).toBe(404);
    const empty = await createThread("ana", "Empty", null);
    await addMessage(empty.id, "user", "hello?");
    expect((await suggest(empty.id)).data.suggestions).toEqual([]);
    expect(calls).toBe(0);
  });

  it("does nothing when an admin turned suggestions off", async () => {
    await saveChobiSettings({ memorySuggestions: false }, null);
    resetChobiSettingsCache();
    expect((await suggest(thread)).data).toEqual({ suggestions: [], off: true });
    expect(calls).toBe(0);
    await saveChobiSettings({ memorySuggestions: true }, null);
    resetChobiSettingsCache();
  });
});
