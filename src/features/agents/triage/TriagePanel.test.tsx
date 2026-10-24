import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { TriageRule, TriageRun, TriageTrigger } from "@/api/aiTriage";
import { TRIAGE_TRIGGERS } from "@/api/aiTriage";
import { server } from "@/test/mocks/server";
import { TriagePanel } from "./TriagePanel";

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>;
}

function rule(trigger: TriageTrigger, extra: Partial<TriageRule> = {}): TriageRule {
  return {
    trigger, label: trigger, enabled: false, agentId: null, cooldownMinutes: 60, dailyTokenBudget: 200_000, channelIds: [], proposeAs: null,
    watermark: 0, updatedBy: null, updatedByName: null, updatedAt: 0, tokensToday: 0, ...extra,
  };
}

const RUN: TriageRun = {
  id: "r1", trigger: "observe_incident", subjectId: "inc-1", subjectTitle: "Kafka lag rising", connectionId: "c1", status: "completed",
  reason: null, summary: "A stuck consumer is behind by 2M messages.", notebookId: "nb1", actionIds: ["a1"], tokens: 4_200, costUsd: null, error: null,
  startedAt: Date.now() - 60_000, finishedAt: Date.now(),
  result: { summary: "A stuck consumer is behind by 2M messages.", likelyCause: "Consumer group rebalancing loop", confidence: "high", severity: "high", findings: ["system.kafka_consumers shows 0 assignments"], nextSteps: ["Restart the Kafka table"] },
};

describe("TriagePanel", () => {
  let saved: Array<{ trigger: string; body: unknown }>;
  let canManage: boolean;

  beforeEach(() => {
    // jsdom has no ResizeObserver; the Radix checkbox measures itself with one.
    globalThis.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    saved = [];
    canManage = true;
    server.use(
      http.get("/api/ai-triage/rules", () => HttpResponse.json({ success: true, data: {
        canManage, defaultAgentId: "triager",
        rules: TRIAGE_TRIGGERS.map((t) => rule(t, t === "fleet_alert" ? { enabled: true, tokensToday: 150_000, channelIds: ["ch1"] } : {})),
        channels: [{ id: "ch1", name: "Ops webhook", type: "webhook", enabled: true }, { id: "ch2", name: "On-call Slack", type: "slack", enabled: true }],
        agents: [{ id: "triager", name: "Incident Triager" }, { id: "custom", name: "My SRE" }],
      } })),
      http.get("/api/ai-triage/runs", () => HttpResponse.json({ success: true, data: { runs: [RUN], total: 1 } })),
      http.put("/api/ai-triage/rules/:trigger", async ({ params, request }) => {
        saved.push({ trigger: String(params.trigger), body: await request.json() });
        return HttpResponse.json({ success: true, data: rule(params.trigger as TriageTrigger) });
      }),
    );
  });

  it("shows each trigger with its limits and today's spend", async () => {
    render(<TriagePanel />, { wrapper });
    const table = await screen.findByRole("table", { name: "Auto-triage rules" });
    expect(within(table).getByText("Fleet alerts")).not.toBeNull();
    expect(within(table).getByText("Ops webhook")).not.toBeNull();
    expect(within(table).getAllByText("Once an hour per connection")).toHaveLength(5);
    expect(within(table).getByRole("progressbar", { name: "Fleet alerts budget used" }).getAttribute("aria-valuenow")).toBe("75");
  });

  it("turns a trigger on from its switch, keeping its limits", async () => {
    render(<TriagePanel />, { wrapper });
    fireEvent.click(await screen.findByRole("switch", { name: "Auto-triage Observe incidents" }));
    await waitFor(() => expect(saved).toEqual([{ trigger: "observe_incident", body: { enabled: true, agentId: null, cooldownMinutes: 60, dailyTokenBudget: 200_000, channelIds: [] } }]));
  });

  it("edits a rule, refusing limits out of range", async () => {
    render(<TriagePanel />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: "Edit Failed scheduled runs" }));
    fireEvent.change(screen.getByLabelText("Daily token budget"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toContain("at least 1,000 tokens");
    expect(saved).toEqual([]);
    fireEvent.change(screen.getByLabelText("Daily token budget"), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText("Cooldown minutes"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "On-call Slack" }));
    fireEvent.click(screen.getByRole("switch", { name: "Investigate automatically" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toEqual([{ trigger: "scheduled_run_failed", body: { enabled: true, agentId: null, cooldownMinutes: 15, dailyTokenBudget: 50_000, channelIds: ["ch2"] } }]));
  });

  it("is read-only without ai_agents:manage", async () => {
    canManage = false;
    render(<TriagePanel />, { wrapper });
    const toggle = await screen.findByRole("switch", { name: "Auto-triage Fleet alerts" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Edit Fleet alerts" })).toBeNull();
  });

  it("lists investigations and opens one with its finding and proposals", async () => {
    render(<TriagePanel />, { wrapper });
    const table = await screen.findByRole("table", { name: "Investigations" });
    expect(within(table).getByText("1 proposed")).not.toBeNull();
    fireEvent.click(within(table).getByRole("button", { name: "Kafka lag rising" }));
    expect(await screen.findByText("Consumer group rebalancing loop")).not.toBeNull();
    expect(screen.getByText("Restart the Kafka table")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Open the investigation/ }).getAttribute("href")).toBe("/data/incidents/observe/inc-1");
    expect(screen.getByRole("link", { name: /1 proposed action/ }).getAttribute("href")).toBe("/ai/approvals");
  });
});
