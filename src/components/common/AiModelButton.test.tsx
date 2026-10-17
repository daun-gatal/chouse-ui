import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { RBAC_PERMISSIONS, useAiModelStore, useRbacStore } from "@/stores";
import { AiModelButton } from "./AiModelButton";

function createWrapper(): ({ children }: { children: ReactNode }) => ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const triggerName = "Choose AI model";

describe("AiModelButton", () => {
  beforeEach(() => {
    useAiModelStore.setState({ modelId: null });
    useRbacStore.setState({ roles: [], permissions: [RBAC_PERMISSIONS.AI_OPTIMIZE] });
  });

  it("renders nothing without the ai:optimize permission", () => {
    useRbacStore.setState({ roles: [], permissions: [] });
    const { container } = render(<AiModelButton />, { wrapper: createWrapper() });
    expect(container.childElementCount).toBe(0);
  });

  it("shows Default and lists the active models with a Default badge", async () => {
    const user = userEvent.setup();
    render(<AiModelButton />, { wrapper: createWrapper() });

    const trigger = screen.getByRole("button", { name: triggerName });
    expect(trigger.textContent).toContain("Default");

    await user.click(trigger);
    expect(await screen.findByRole("radio", { name: /GPT-4/ })).toBeDefined();
    expect(screen.getByRole("radio", { name: /Claude/ })).toBeDefined();
    // GPT-4 is the configured default → carries the Default badge.
    expect(screen.getByRole("radio", { name: /GPT-4/ }).textContent).toContain("Default");
    // System default row is pre-selected.
    expect(screen.getByRole("radio", { name: /System default/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("stores the picked model, closes the dialog, and updates the trigger label", async () => {
    const user = userEvent.setup();
    render(<AiModelButton />, { wrapper: createWrapper() });

    await user.click(screen.getByRole("button", { name: triggerName }));
    await user.click(await screen.findByRole("radio", { name: /Claude/ }));

    expect(useAiModelStore.getState().modelId).toBe("model-2");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: triggerName }).textContent).toContain("Claude");

    // Picking System default clears the selection again.
    await user.click(screen.getByRole("button", { name: triggerName }));
    await user.click(await screen.findByRole("radio", { name: /System default/ }));
    expect(useAiModelStore.getState().modelId).toBeNull();
  });

  it("points to Admin → AI models when no model is configured", async () => {
    server.use(http.get("/api/ai/models", () => HttpResponse.json({ success: true, data: [] })));
    const user = userEvent.setup();
    render(<AiModelButton />, { wrapper: createWrapper() });

    await user.click(screen.getByRole("button", { name: triggerName }));
    expect(await screen.findByText("No AI models are configured. Add one in Admin → AI models.")).toBeDefined();
  });

  it("marks a stored model that is no longer active as unavailable", async () => {
    useAiModelStore.setState({ modelId: "ghost-model" });
    const user = userEvent.setup();
    render(<AiModelButton />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByRole("button", { name: triggerName }).textContent).toContain("Unavailable"));
    await user.click(screen.getByRole("button", { name: triggerName }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("radio", { name: /System default/ }).getAttribute("aria-checked")).toBe("false");
  });
});
