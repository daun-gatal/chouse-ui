import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { queryKeys } from "@/hooks";

import { McpStatusDockItem } from "./McpStatusDockItem";

function renderDockItem(): QueryClient {
  // useConfig sets retry: 1 at query level (overriding client defaults), so
  // retryDelay: 0 keeps failure tests fast instead of waiting out the 1s backoff.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <McpStatusDockItem />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("McpStatusDockItem", () => {
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
