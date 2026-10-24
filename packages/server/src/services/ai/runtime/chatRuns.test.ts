/**
 * Durable chat runs (ADR 0024): lifecycle against the RBAC database with a
 * scripted engine — live steps, the stored answer, stop, a pause for approval
 * and its resume, failures, stale runs and pruning.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

type InvokeOptions = {
  signal?: AbortSignal;
  run?: { id: string; resume?: Record<string, unknown>; onToolEvent?: (e: unknown) => void; pinnedSkills?: string[] };
};
type Behaviour = (options: InvokeOptions) => Promise<unknown>;
let behaviour: Behaviour = async () => ({ content: "", toolCalls: [], agent: AGENT, interrupts: [] });
const calls: InvokeOptions[] = [];

const AGENT = { id: "a1", slug: "clickhouse-data", name: "ClickHouse Data" };

mock.module("../engine", () => ({
  invokeChat: async (_ctx: unknown, _messages: unknown, options: InvokeOptions) => {
    calls.push(options);
    return behaviour(options);
  },
}));

const { closeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const { all, one, run, sql } = await import("../../observe/db");
const { createThread, deleteThread, getMessages } = await import("../../chatHistory");
const runs = await import("./chatRuns");
type ChatRunEvent = import("./chatRuns").ChatRunEvent;
const h = await import("../../../rbac/db/migrationTestHarness");

let userId = "";

function input(threadId: string, extra: Record<string, unknown> = {}) {
  return {
    userId,
    threadId,
    ctx: { userId },
    messages: [{ role: "user" as const, content: "how many orders?" }],
    agentId: undefined,
    runAgentId: null,
    ...extra,
  };
}

function collect(runId: string): ChatRunEvent[] {
  const events: ChatRunEvent[] = [];
  const sub = runs.subscribeChatRun(runId, (e) => events.push(e));
  if (sub) events.unshift(...sub.replay);
  return events;
}

const DIALECTS: Array<"sqlite" | "postgres"> = ["sqlite", "postgres"];
let pg: Awaited<ReturnType<typeof h.startPostgresContainer>> | undefined;

beforeAll(async () => {
  pg = await h.startPostgresContainer();
}, 180_000);

afterAll(async () => {
  await closeDatabase();
  pg?.stop();
}, 30_000);

for (const dialect of DIALECTS) {
  describe(`setup [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true });
      userId = crypto.randomUUID();
      await run(sql`INSERT INTO rbac_users (id, email, username, password_hash) VALUES (${userId}, 'runs@test', 'runs', 'x')`);
    }, 120_000);
    it("is ready", () => expect(true).toBe(true));
  });

  describe(`chat runs [${dialect}]`, () => {
    it("streams steps and stores the answer on the thread", async () => {
      const thread = await createThread(userId);
      behaviour = async (options) => {
        options.run?.onToolEvent?.({ type: "tool_start", id: "t1", name: "run_select_query", args: { query: "SELECT count() FROM orders" } });
        options.run?.onToolEvent?.({ type: "tool_end", id: "t1", name: "run_select_query", ok: true, summary: "1 row" });
        return {
          content: "There are 42 orders.",
          toolCalls: [{ name: "run_select_query", args: { query: "SELECT count() FROM orders" }, result: { rows: [{ c: 42 }] } }],
          agent: AGENT,
          interrupts: [],
        };
      };
      const { run: started, done } = await runs.startChatRun(input(thread.id, { pinnedSkills: ["query-optimization"] }));
      const events = collect(started.id);
      const finished = await done;

      expect(finished.status).toBe("completed");
      expect(finished.result?.content).toBe("There are 42 orders.");
      expect(calls.at(-1)?.run?.pinnedSkills).toEqual(["query-optimization"]);
      expect(events.map((e) => e.type)).toEqual(["run", "step", "step", "final"]);
      const steps = events.filter((e): e is Extract<ChatRunEvent, { type: "step" }> => e.type === "step");
      expect(steps.map((e) => e.step.status)).toEqual(["running", "done"]);

      const stored = await runs.getChatRun(started.id);
      expect(stored?.status).toBe("completed");
      expect(stored?.steps[0]).toMatchObject({ name: "run_select_query", status: "done", summary: "1 row" });
      const messages = await getMessages(thread.id);
      expect(messages.at(-1)).toMatchObject({ role: "assistant", content: "There are 42 orders." });
      // A finished run keeps no checkpoints.
      expect((await all(sql`SELECT 1 FROM ai_checkpoints WHERE thread_id = ${started.id}`)).length).toBe(0);
      expect(await runs.activeRunForThread(thread.id)).toBeNull();
    });

    it("refuses a second run on a thread that is still answering", async () => {
      const thread = await createThread(userId);
      let release: () => void = () => {};
      behaviour = () => new Promise((resolve) => {
        release = () => resolve({ content: "ok", toolCalls: [], agent: AGENT, interrupts: [] });
      });
      const first = await runs.startChatRun(input(thread.id));
      await expect(runs.startChatRun(input(thread.id))).rejects.toMatchObject({ statusCode: 409 });
      expect((await runs.activeRunForThread(thread.id))?.id).toBe(first.run.id);
      release();
      await first.done;
    });

    it("stops a run when asked, and reports it as cancelled", async () => {
      const thread = await createThread(userId);
      behaviour = (options) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
      const { run: started, done } = await runs.startChatRun(input(thread.id));
      const events = collect(started.id);
      await runs.cancelChatRun(started.id, userId);
      const finished = await done;
      expect(finished.status).toBe("cancelled");
      expect(events.at(-1)).toMatchObject({ type: "error", code: "CANCELLED", status: "cancelled" });
      expect((await getMessages(thread.id)).filter((m) => m.role === "assistant")).toHaveLength(0);
    });

    it("only lets the run's owner see or stop it", async () => {
      const thread = await createThread(userId);
      behaviour = async () => ({ content: "ok", toolCalls: [], agent: AGENT, interrupts: [] });
      const { run: started, done } = await runs.startChatRun(input(thread.id));
      await done;
      await expect(runs.cancelChatRun(started.id, "someone-else")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("fails with the engine's error and an empty answer as an error", async () => {
      const thread = await createThread(userId);
      behaviour = async () => { throw new Error("provider exploded"); };
      const failed = await (await runs.startChatRun(input(thread.id))).done;
      expect(failed).toMatchObject({ status: "failed", error: "provider exploded" });

      behaviour = async () => ({ content: "   ", toolCalls: [], agent: AGENT, interrupts: [] });
      const empty = await (await runs.startChatRun(input(thread.id))).done;
      expect(empty.status).toBe("failed");
      expect(empty.error).toContain("empty response");
    });

    it("pauses for approval and resumes with the decisions", async () => {
      const thread = await createThread(userId);
      const interrupt = { id: "int-1", toolCallId: "call-1", name: "kill_query", args: { queryId: "q1" }, description: "" };
      behaviour = async (options) => options.run?.resume
        ? { content: "Killed q1.", toolCalls: [], agent: AGENT, interrupts: [] }
        : { content: "", toolCalls: [], agent: AGENT, interrupts: [interrupt] };
      const paused = await (await runs.startChatRun(input(thread.id))).done;
      expect(paused.status).toBe("awaiting_approval");
      expect(paused.pending[0]).toMatchObject({ id: "int-1", name: "kill_query" });
      expect(paused.pending[0].expiresAt).toBeGreaterThan(Date.now());
      expect((await runs.activeRunForThread(thread.id))?.status).toBe("awaiting_approval");

      const decisions = { "int-1": { type: "approve" } };
      const rebuild = async () => input(thread.id);
      const resumed = await runs.resumeChatRun(paused.id, userId, { userId }, decisions, rebuild);
      // Someone following the resumed run starts from it running, not from the pause it answered.
      const followed = collect(paused.id);
      expect(followed.some((e) => e.type === "status" && e.status === "awaiting_approval")).toBe(false);
      expect(followed[0]).toMatchObject({ type: "run", run: { status: "running", pending: [] } });
      // A second answer to the same approval is refused.
      await expect(runs.resumeChatRun(paused.id, userId, { userId }, decisions, rebuild)).rejects.toMatchObject({ statusCode: 409 });
      const finished = await resumed.done;
      expect(finished.status).toBe("completed");
      expect(followed.at(-1)).toMatchObject({ type: "final", result: { content: "Killed q1." } });
      expect(calls.at(-1)?.run?.resume).toEqual(decisions);
      // Pinned skills and attachments belong to the first step only.
      expect(calls.at(-1)?.run?.pinnedSkills).toBeUndefined();
      expect((await getMessages(thread.id)).at(-1)?.content).toBe("Killed q1.");
    });

    it("stops a run that is waiting for approval", async () => {
      const thread = await createThread(userId);
      behaviour = async () => ({ content: "", toolCalls: [], agent: AGENT, interrupts: [{ id: "i", toolCallId: "c", name: "kill_query", args: {}, description: "" }] });
      const paused = await (await runs.startChatRun(input(thread.id))).done;
      const stopped = await runs.cancelChatRun(paused.id, userId);
      expect(stopped.status).toBe("cancelled");
      expect((await runs.getChatRun(paused.id))?.status).toBe("cancelled");
    });

    it("marks a run left behind by a stopped replica as failed", async () => {
      const thread = await createThread(userId);
      const id = crypto.randomUUID();
      const old = Date.now() - runs.STALE_MS - 1_000;
      await run(sql`
        INSERT INTO ai_chat_runs (id, thread_id, user_id, status, steps, cancel_requested, heartbeat_at, created_at, updated_at)
        VALUES (${id}, ${thread.id}, ${userId}, 'running', '[]', 0, ${old}, ${old}, ${old})`);
      const found = await runs.getChatRun(id);
      expect(found?.status).toBe("failed");
      expect(found?.error).toContain("stopped before it finished");
      expect(await runs.activeRunForThread(thread.id)).toBeNull();
    });

    it("prunes runs and checkpoints of deleted threads", async () => {
      const thread = await createThread(userId);
      behaviour = async () => ({ content: "", toolCalls: [], agent: AGENT, interrupts: [{ id: "i", toolCallId: "c", name: "kill_query", args: {}, description: "" }] });
      const paused = await (await runs.startChatRun(input(thread.id))).done;
      await run(sql`INSERT INTO ai_checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata, created_at) VALUES (${paused.id}, '', 'c1', 'x', 'y', 0)`);
      await deleteThread(thread.id, userId);
      expect(await runs.pruneChatRuns()).toBeGreaterThan(0);
      expect(await runs.getChatRun(paused.id)).toBeNull();
      expect((await all(sql`SELECT 1 FROM ai_checkpoints WHERE thread_id = ${paused.id}`)).length).toBe(0);
    });
  });
}
