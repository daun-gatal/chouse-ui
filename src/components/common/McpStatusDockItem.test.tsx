import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/test/mocks/server";
import { queryKeys } from "@/hooks";

import { McpStatusDockItem } from "./McpStatusDockItem";

let canViewAgents = false;

vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  return {
    ...actual,
    useRbacStore: <T,>(select: (state: { hasPermission: (permission: string) => boolean }) => T): T =>
      select({ hasPermission: () => canViewAgents }),
  };
});

function renderDockItem(): QueryClient {
  // useConfig sets retry: 1 at query level (overriding client defaults), so
  // retryDelay: 0 keeps failure tests fast instead of waiting out the 1s backoff.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<McpStatusDockItem />} />
          <Route path="/ai/mcp" element={<p>AI Governance MCP page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("McpStatusDockItem", () => {
  beforeEach(() => {
    canViewAgents = false;
  });

  it("opens AI Governance › MCP for people who can see AI Governance", async () => {
    canViewAgents = true;
    renderDockItem();

    fireEvent.click(await screen.findByRole("button", { name: "MCP server: enabled" }));
    expect(await screen.findByText("AI Governance MCP page")).toBeTruthy();
  });

  it("stays a plain indicator without agents:view", async () => {
    renderDockItem();

    fireEvent.click(await screen.findByRole("button", { name: "MCP server: enabled" }));
    expect(screen.queryByText("AI Governance MCP page")).toBeNull();
  });

  it("renders the enabled state once the config flag resolves", async () => {
    renderDockItem();

    const button = await screen.findByRole("button", { name: "MCP server: enabled" });
    expect(button.querySelector(".bg-emerald-400")).not.toBeNull();
  });

  it("renders the disabled state when the server reports MCP off", async () => {
    server.use(
      http.get("*/api/config", () =>
        HttpResponse.json({
          success: true,
          data: { features: { aiOptimizer: true, mcpEnabled: false } },
        }),
      ),
    );

    renderDockItem();

    const button = await screen.findByRole("button", { name: "MCP server: disabled" });
    expect(button.querySelector(".bg-paper-faint")).not.toBeNull();
  });

  it("renders nothing while the flag is unknown (older backend omits it)", async () => {
    server.use(
      http.get("*/api/config", () =>
        HttpResponse.json({
          success: true,
          data: { features: { aiOptimizer: true } },
        }),
      ),
    );

    const queryClient = renderDockItem();

    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.config)?.status).toBe("success"),
    );
    expect(screen.queryByRole("button", { name: /MCP server:/ })).toBeNull();
  });

  it("renders nothing when the config request fails", async () => {
    server.use(http.get("*/api/config", () => HttpResponse.error()));

    const queryClient = renderDockItem();

    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.config)?.status).toBe("error"),
    );
    expect(screen.queryByRole("button", { name: /MCP server:/ })).toBeNull();
  });
});
