import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentInput, AiRegistry } from "@/api/aiAgents";
import type { EvalCase, EvalRun } from "@/api/aiEvals";
import { server } from "@/test/mocks/server";
import { EvalsTab } from "./EvalsTab";

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ok = (data: unknown, status = 200): Response => HttpResponse.json({ success: true, data }, { status });

const registry = { features: [{ id: "debug-query", title: "Debug query", delivery: "structured", agentId: "a1" }] } as unknown as AiRegistry;
const draft = (threshold: number | null = null) => ({ slug: "data", taskTemplate: null, tuning: { stepBudget: 10, evalThreshold: threshold } }) as unknown as AgentInput;

const CASE: EvalCase = {
  id: "c1", agentId: "a1", name: "Counts tables", kind: "chat", featureId: null, input: { messages: [{ role: "user", content: "How many tables?" }] },
  expectedTools: ["list_tables"], rubric: "Gives a number", source: "manual", createdBy: null, createdAt: 1, updatedAt: 1,
};

function run(status: EvalRun["status"], extra: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "r1", agentId: "a1", draftHash: "h", status, score: null, passed: 0, total: 1, results: [], regressions: [], tokens: 0, costUsd: null,
    error: null, createdBy: null, startedAt: Date.now(), finishedAt: null, ...extra,
  };
}

describe("EvalsTab", () => {
  let cases: EvalCase[];
  let polls: number;
  let created: unknown[];

  beforeEach(() => {
    cases = [CASE];
    polls = 0;
    created = [];
    server.use(
      http.get("/api/ai-evals/agents/a1", () => ok({ cases, runs: [], maxCases: 50 })),
      http.post("/api/ai-evals/agents/a1/cases", async ({ request }) => {
        const body = await request.json();
        created.push(body);
        cases = [...cases, { ...CASE, id: "c2", ...(body as object) }];
        return ok(cases.at(-1), 201);
      }),
      http.post("/api/ai-evals/agents/a1/runs", () => ok(run("running"), 202)),
      http.get("/api/ai-evals/runs/r1", () => {
        polls++;
        return ok(polls < 2 ? run("running") : run("completed", {
          score: 0, passed: 0, total: 1, finishedAt: Date.now(), tokens: 1200,
          results: [{ caseId: "c1", name: "Counts tables", passed: false, toolsOk: false, missingTools: ["list_tables"], calledTools: ["run_select_query"], judge: { pass: false, reason: "No number given" }, answer: "I could not tell.", error: null, durationMs: 900 }],
          regressions: [{ caseId: "c1", name: "Counts tables" }],
        }));
      }),
      http.post("/api/ai-evals/agents/a1/gate", () => ok({ required: true, threshold: 0.8, cases: 1, run: null, passing: false })),
    );
  });

  it("asks to save a new agent first", () => {
    render(<EvalsTab agentId={null} draft={draft()} registry={registry} readOnly={false} onThreshold={vi.fn()} />, { wrapper });
    expect(screen.getByText("Save the agent first")).not.toBeNull();
  });

  it("adds a chat case, refusing an empty one", async () => {
    render(<EvalsTab agentId="a1" draft={draft()} registry={registry} readOnly={false} onThreshold={vi.fn()} />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: /Add case/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add case" }).at(-1)!);
    expect(screen.getByText(/Give the case a name\./)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Lists databases" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Which databases exist?" } });
    fireEvent.change(screen.getByLabelText("Expected tools"), { target: { value: "list_databases" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add case" }).at(-1)!);
    await waitFor(() => expect(created).toEqual([{ name: "Lists databases", kind: "chat", featureId: null, input: { messages: [{ role: "user", content: "Which databases exist?" }] }, expectedTools: ["list_databases"], rubric: null }]));
  });

  it("runs the evals on the draft and shows results and regressions", async () => {
    render(<EvalsTab agentId="a1" draft={draft()} registry={registry} readOnly={false} onThreshold={vi.fn()} />, { wrapper });
    // The run button waits for the cases to load.
    await screen.findByText("Counts tables");
    fireEvent.click(screen.getByRole("button", { name: /Run evals on this draft/ }));
    expect(await screen.findByText(/Running 1 case against this draft/)).not.toBeNull();
    const results = await screen.findByRole("table", { name: "Eval results" }, { timeout: 5_000 });
    expect(within(results).getByText("No number given")).not.toBeNull();
    expect(within(results).getByText("list_tables")).not.toBeNull();
    expect(screen.getByText("0% passed")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Regressions (passed in the previous run): Counts tables");
  });

  it("explains the gate and reports a new threshold", async () => {
    const onThreshold = vi.fn();
    render(<EvalsTab agentId="a1" draft={draft(0.8)} registry={registry} readOnly={false} onThreshold={onThreshold} />, { wrapper });
    expect(await screen.findByText("Saving needs 80% of 1 case to pass: run the evals for this draft.")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Eval threshold, %"), { target: { value: "90" } });
    expect(onThreshold).toHaveBeenLastCalledWith(0.9);
    fireEvent.change(screen.getByLabelText("Eval threshold, %"), { target: { value: "" } });
    expect(onThreshold).toHaveBeenLastCalledWith(null);
    fireEvent.change(screen.getByLabelText("Eval threshold, %"), { target: { value: "150" } });
    expect(onThreshold).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Between 1 and 100, or empty.")).not.toBeNull();
  });
});
