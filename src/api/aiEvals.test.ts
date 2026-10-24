import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import {
  createEvalCase,
  createEvalCaseFromRequest,
  deleteEvalCase,
  getAgentEvals,
  getEvalGate,
  getEvalRun,
  startEvalRun,
  updateEvalCase,
} from "./aiEvals";

const ok = (data: unknown, status = 200): Response => HttpResponse.json({ success: true, data }, { status });
const CASE = { name: "Counts", kind: "chat" as const, input: { messages: [{ role: "user", content: "How many?" }] }, expectedTools: ["list_tables"], rubric: "A number" };

describe("aiEvals API", () => {
  it("lists, creates, edits and deletes cases", async () => {
    const seen: string[] = [];
    server.use(
      http.get("/api/ai-evals/agents/a%2F1", () => ok({ cases: [], runs: [], maxCases: 50 })),
      http.post("/api/ai-evals/agents/a1/cases", async ({ request }) => {
        seen.push(`create${new URL(request.url).search} ${JSON.stringify(await request.json())}`);
        return ok({ id: "c1" }, 201);
      }),
      http.put("/api/ai-evals/cases/c1", async ({ request }) => {
        seen.push(`update ${JSON.stringify(await request.json())}`);
        return ok({ id: "c1" });
      }),
      http.delete("/api/ai-evals/cases/c1", () => {
        seen.push("delete");
        return ok({ deleted: true });
      }),
      http.post("/api/ai-evals/cases/from-request", async ({ request }) => {
        seen.push(`from ${JSON.stringify(await request.json())}`);
        return ok({ id: "c2" }, 201);
      }),
    );
    expect((await getAgentEvals("a/1")).maxCases).toBe(50);
    await createEvalCase("a1", CASE);
    await createEvalCase("a1", CASE, "console");
    await updateEvalCase("c1", { ...CASE, name: "Renamed" });
    await deleteEvalCase("c1");
    expect((await createEvalCaseFromRequest("req-1")).id).toBe("c2");
    expect(seen).toEqual([
      `create ${JSON.stringify(CASE)}`,
      `create?source=console ${JSON.stringify(CASE)}`,
      `update ${JSON.stringify({ ...CASE, name: "Renamed" })}`,
      "delete",
      'from {"requestId":"req-1"}',
    ]);
  });

  it("starts runs for a draft or the saved agent, polls them, and asks the gate", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("/api/ai-evals/agents/a1/runs", async ({ request }) => {
        bodies.push(await request.json());
        return ok({ id: "r1", status: "running" }, 202);
      }),
      http.get("/api/ai-evals/runs/r1", () => ok({ id: "r1", status: "completed", score: 1 })),
      http.post("/api/ai-evals/agents/a1/gate", async ({ request }) => {
        bodies.push(await request.json());
        return ok({ required: true, threshold: 0.8, cases: 2, run: null, passing: false });
      }),
    );
    const draft = { slug: "a" } as never;
    expect((await startEvalRun("a1", draft, "m1")).status).toBe("running");
    await startEvalRun("a1");
    expect((await getEvalRun("r1")).score).toBe(1);
    expect((await getEvalGate("a1", draft)).passing).toBe(false);
    expect(bodies).toEqual([{ agent: { slug: "a" }, modelId: "m1" }, {}, { agent: { slug: "a" } }]);
  });

  it("surfaces a refused case", async () => {
    server.use(http.post("/api/ai-evals/agents/a1/cases", () => HttpResponse.json(
      { success: false, error: { code: "BAD_REQUEST", message: "A chat case is a conversation that ends with the user's message.", category: "validation" } },
      { status: 400 },
    )));
    await expect(createEvalCase("a1", CASE)).rejects.toMatchObject({ statusCode: 400 });
  });
});
