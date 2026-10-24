/**
 * ChouseCheckpointSaver against a real DeepAgents run: a write tool pauses the
 * run (per-call approval), a *new* saver instance (another replica) resumes it,
 * and the tool runs exactly once. Also covers an approval inside a subagent.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { z } from "zod";
import { createDeepAgent, type CompiledSubAgent } from "deepagents";
import { humanInTheLoopMiddleware } from "langchain";
import { Command } from "@langchain/langgraph";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const { ChouseCheckpointSaver } = await import("./checkpointer");
const { all, sql } = await import("../../observe/db");
const h = await import("../../../rbac/db/migrationTestHarness");

type Reply = { content?: string; toolCall?: { name: string; args: Record<string, unknown> } };

class ScriptedModel extends BaseChatModel {
  constructor(private readonly script: (messages: BaseMessage[]) => Reply) {
    super({});
  }
  _llmType(): string {
    return "scripted";
  }
  override bindTools(): ScriptedModel {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const reply = this.script(messages);
    const message = new AIMessage({
      content: reply.content ?? "",
      tool_calls: reply.toolCall ? [{ id: `call-${crypto.randomUUID()}`, name: reply.toolCall.name, args: reply.toolCall.args }] : [],
    });
    return { generations: [{ text: String(message.content), message }] };
  }
}

function toolResults(messages: BaseMessage[]): string[] {
  return messages.filter((m) => m.getType() === "tool").map((m) => String(m.content));
}

function killTool(executed: string[]) {
  return tool(async ({ queryId }: { queryId: string }) => {
    executed.push(queryId);
    return `killed ${queryId}`;
  }, { name: "kill_query", description: "Kill a query", schema: z.object({ queryId: z.string() }) });
}

const approval = () => humanInTheLoopMiddleware({ interruptOn: { kill_query: { allowedDecisions: ["approve", "edit", "reject"] } }, interruptMode: "per_call" });

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
    }, 120_000);
    it("is ready", () => expect(true).toBe(true));
  });

  describe(`ChouseCheckpointSaver [${dialect}]`, () => {
    it("pauses a run for approval and resumes it from another saver instance", async () => {
      const executed: string[] = [];
      const script = (messages: BaseMessage[]): Reply => {
        const results = toolResults(messages);
        return results.length > 0 ? { content: `done: ${results.join(", ")}` } : { toolCall: { name: "kill_query", args: { queryId: "q-1" } } };
      };
      const build = (saver: InstanceType<typeof ChouseCheckpointSaver>) => createDeepAgent({
        model: new ScriptedModel(script) as never,
        tools: [killTool(executed)],
        systemPrompt: "ROOT",
        middleware: [approval()],
        checkpointer: saver,
      });
      const config = { configurable: { thread_id: "run-approve" } };

      const first = await build(new ChouseCheckpointSaver()).invoke({ messages: [{ role: "user", content: "kill it" }] }, config);
      const interrupts = (first as { __interrupt__?: Array<{ id: string; value: { type: string; name: string; args: Record<string, unknown> } }> }).__interrupt__ ?? [];
      expect(interrupts).toHaveLength(1);
      expect(interrupts[0].value).toMatchObject({ type: "tool_approval", name: "kill_query", args: { queryId: "q-1" } });
      expect(executed).toEqual([]);

      const resumed = await build(new ChouseCheckpointSaver()).invoke(new Command({ resume: { type: "approve" } }), config);
      expect(executed).toEqual(["q-1"]);
      const last = (resumed as { messages: BaseMessage[] }).messages.at(-1);
      expect(String(last?.content)).toBe("done: killed q-1");

      const stored = await all(sql`SELECT count(*) AS n FROM ai_checkpoints WHERE thread_id = 'run-approve'`);
      expect(Number(stored[0].n)).toBeGreaterThan(0);
    });

    it("applies an edited action and reports a rejection to the model", async () => {
      const executed: string[] = [];
      const script = (messages: BaseMessage[]): Reply => {
        const results = toolResults(messages);
        return results.length > 0 ? { content: `result: ${results.join(", ")}` } : { toolCall: { name: "kill_query", args: { queryId: "q-2" } } };
      };
      const saver = new ChouseCheckpointSaver();
      const agent = createDeepAgent({ model: new ScriptedModel(script) as never, tools: [killTool(executed)], systemPrompt: "ROOT", middleware: [approval()], checkpointer: saver });

      const edit = { configurable: { thread_id: "run-edit" } };
      await agent.invoke({ messages: [{ role: "user", content: "kill" }] }, edit);
      await agent.invoke(new Command({ resume: { type: "edit", edited_action: { name: "kill_query", args: { queryId: "q-2-edited" } } } }), edit);
      expect(executed).toEqual(["q-2-edited"]);

      const reject = { configurable: { thread_id: "run-reject" } };
      await agent.invoke({ messages: [{ role: "user", content: "kill" }] }, reject);
      const rejected = await agent.invoke(new Command({ resume: { type: "reject", message: "Not now" } }), reject);
      expect(executed).toEqual(["q-2-edited"]);
      expect(String((rejected as { messages: BaseMessage[] }).messages.at(-1)?.content)).toBe("result: Not now");
    });

    it("pauses inside a subagent and resumes the whole tree", async () => {
      const executed: string[] = [];
      const subScript = (messages: BaseMessage[]): Reply => {
        const results = toolResults(messages);
        return results.length > 0 ? { content: `sub: ${results.join(", ")}` } : { toolCall: { name: "kill_query", args: { queryId: "q-sub" } } };
      };
      const rootScript = (messages: BaseMessage[]): Reply => {
        const results = toolResults(messages);
        return results.length > 0 ? { content: `root: ${results.join(", ")}` } : { toolCall: { name: "task", args: { description: "kill the query", subagent_type: "operator" } } };
      };
      const build = (saver: InstanceType<typeof ChouseCheckpointSaver>) => {
        const sub = createDeepAgent({ model: new ScriptedModel(subScript) as never, tools: [killTool(executed)], systemPrompt: "SUB", middleware: [approval()], name: "operator" });
        return createDeepAgent({
          model: new ScriptedModel(rootScript) as never,
          tools: [],
          systemPrompt: "ROOT",
          subagents: [{ name: "operator", description: "Operates", runnable: sub } as CompiledSubAgent],
          checkpointer: saver,
        });
      };
      const config = { configurable: { thread_id: "run-sub" } };
      const first = await build(new ChouseCheckpointSaver()).invoke({ messages: [{ role: "user", content: "go" }] }, config);
      const interrupts = (first as { __interrupt__?: Array<{ value: { name: string } }> }).__interrupt__ ?? [];
      expect(interrupts.map((i) => i.value.name)).toEqual(["kill_query"]);
      expect(executed).toEqual([]);

      const resumed = await build(new ChouseCheckpointSaver()).invoke(new Command({ resume: { type: "approve" } }), config);
      expect(executed).toEqual(["q-sub"]);
      expect(String((resumed as { messages: BaseMessage[] }).messages.at(-1)?.content)).toBe("root: sub: killed q-sub");
    });

    it("deletes a thread's checkpoints and writes", async () => {
      const saver = new ChouseCheckpointSaver();
      await saver.deleteThread("run-approve");
      const left = await all(sql`SELECT count(*) AS n FROM ai_checkpoints WHERE thread_id = 'run-approve'`);
      const writes = await all(sql`SELECT count(*) AS n FROM ai_checkpoint_writes WHERE thread_id = 'run-approve'`);
      expect(Number(left[0].n)).toBe(0);
      expect(Number(writes[0].n)).toBe(0);
    });
  });
}
