import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { AiInvestigatedBadge } from "./AiInvestigatedBadge";

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>;
}

const run = (status: string): Record<string, unknown> => ({
  id: "r1", trigger: "doctor_report", subjectId: "rep-1", subjectTitle: "x", connectionId: null, status, reason: null,
  summary: "Disk 97% full on node-a.", result: { likelyCause: "Old partitions never dropped" }, notebookId: "nb", actionIds: ["a1", "a2"],
  tokens: 1, costUsd: null, error: null, startedAt: 1, finishedAt: 2,
});

describe("AiInvestigatedBadge", () => {
  it("shows a completed investigation with its finding and proposals", async () => {
    server.use(http.get("/api/ai-triage/runs/for-subject", () => HttpResponse.json({ success: true, data: run("completed") })));
    render(<AiInvestigatedBadge trigger="doctor_report" subjectId="rep-1" />, { wrapper });
    const badge = await screen.findByRole("link", { name: /AI investigated · 2 proposed/ });
    expect(badge.getAttribute("href")).toBe("/ai/triage");
    expect(badge.getAttribute("title")).toBe("Disk 97% full on node-a.\nLikely cause: Old partitions never dropped");
  });

  it("shows nothing for a skipped run, no run, or no permission", async () => {
    for (const response of [HttpResponse.json({ success: true, data: run("skipped") }), HttpResponse.json({ success: true, data: null }), HttpResponse.json({ success: false, error: { message: "no" } }, { status: 403 })]) {
      let hit = false;
      server.use(http.get("/api/ai-triage/runs/for-subject", () => {
        hit = true;
        return response.clone();
      }));
      const { container, unmount } = render(<AiInvestigatedBadge trigger="observe_incident" subjectId="i1" />, { wrapper });
      await waitFor(() => expect(hit).toBe(true));
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });
});
