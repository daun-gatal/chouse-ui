import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { ChobiSettings } from "@/api/chobi";
import { server } from "@/test/mocks/server";
import { ChobiAlertsSection } from "./ChobiAlertsSection";

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const settings = (over: Partial<ChobiSettings> = {}): ChobiSettings => ({
  plainMode: false,
  nudges: true,
  alerts: { enabled: false, events: { secondApprover: true, background: true, heldMcp: false }, delayMinutes: 5, channels: [] },
  memorySuggestions: true,
  publicBaseUrl: true,
  updatedAt: null,
  ...over,
});

describe("ChobiAlertsSection", () => {
  let saved: unknown[];
  beforeEach(() => {
    saved = [];
    server.use(
      http.get("/api/alerting/channels", () => HttpResponse.json({ success: true, data: [
        { id: "c1", name: "ops-slack", type: "slack", enabled: true, config: { mode: "app", channelId: "C1" }, configured: {}, createdAt: 0, updatedAt: 0 },
        { id: "c2", name: "ops-hook", type: "webhook", enabled: true, config: { url: "https://x" }, configured: {}, createdAt: 0, updatedAt: 0 },
      ] })),
      http.put("/api/chobi/settings", async ({ request }) => {
        const body = await request.json();
        saved.push(body);
        return HttpResponse.json({ success: true, data: settings({ alerts: (body as { alerts: ChobiSettings["alerts"] }).alerts }) });
      }),
    );
  });

  it("will not save alerts that are on with no channel", async () => {
    render(<ChobiAlertsSection settings={settings()} canManage />, { wrapper });
    fireEvent.click(screen.getByRole("switch", { name: "Need You alerts" }));
    expect(await screen.findByText("Add a channel, or turn alerts off.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save alerts/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows each channel with approve-from-chat only where it can carry buttons, and saves", async () => {
    const current = settings({ alerts: { enabled: true, events: { secondApprover: true, background: false, heldMcp: false }, delayMinutes: 5, channels: [{ channelId: "c1", approveFromChat: true }, { channelId: "c2", approveFromChat: false }] } });
    render(<ChobiAlertsSection settings={current} canManage />, { wrapper });
    expect(await screen.findByText("ops-slack")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Approve from chat in ops-slack" })).toBeTruthy();
    expect(screen.getByText("Review link only")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Approve from chat in ops-slack" }));
    fireEvent.change(screen.getByLabelText("Delay in minutes"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: /Save alerts/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ alerts: { enabled: true, events: { secondApprover: true, background: false, heldMcp: false }, delayMinutes: 15, channels: [{ channelId: "c1", approveFromChat: false }, { channelId: "c2", approveFromChat: false }] } });
  });

  it("warns when the server has no public address", () => {
    render(<ChobiAlertsSection settings={settings({ publicBaseUrl: false })} canManage />, { wrapper });
    expect(screen.getByRole("alert").textContent).toContain("PUBLIC_BASE_URL is not set");
  });

  it("is read-only without ai_agents:manage", () => {
    render(<ChobiAlertsSection settings={settings()} canManage={false} />, { wrapper });
    expect((screen.getByRole("switch", { name: "Need You alerts" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Save alerts/ })).toBeNull();
  });
});
