import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/test/mocks/server";
import AlertingSettings from "./index";

vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  return { ...actual, useRbacStore: () => ({ hasPermission: () => true }) };
});

let location = "";
function Spy(): null {
  location = `${useLocation().pathname}${useLocation().search}`;
  return null;
}

function renderAt(url: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>{children}<Spy /></MemoryRouter>
    </QueryClientProvider>
  );
  render(<AlertingSettings />, { wrapper });
}

const usage = (over: Record<string, number> = {}) => ({ fleetRules: 0, dashboardAlerts: 0, dashboardReports: 0, scheduledQueries: 0, dataHealth: 0, triage: 0, chobi: 0, remediation: 0, ...over });
const now = Date.now();
const CHANNELS = [
  { id: "c1", name: "ops-slack", type: "slack", enabled: true, config: { mode: "app", channelId: "C1", actors: { mode: "only", platformGroups: ["S0GROUP"], platformUsers: [], domains: [], users: [], roles: [] } }, configured: {}, createdAt: 0, updatedAt: 0, health: { lastSentAt: now - 60_000, lastFailedAt: null, lastError: null, sent24h: 4, failed24h: 0 }, usedBy: usage({ fleetRules: 1, chobi: 1 }) },
  { id: "c2", name: "pager-hook", type: "webhook", enabled: true, config: { url: "https://pager.example.com/x" }, configured: {}, createdAt: 0, updatedAt: 0, health: { lastSentAt: now - 3_600_000, lastFailedAt: now - 60_000, lastError: "HTTP 500", sent24h: 1, failed24h: 3 }, usedBy: usage({ dataHealth: 2 }) },
  { id: "c3", name: "old-mail", type: "email", enabled: false, config: { to: "a@b.c" }, configured: {}, createdAt: 0, updatedAt: 0, health: { lastSentAt: null, lastFailedAt: null, lastError: null, sent24h: 0, failed24h: 0 }, usedBy: usage() },
];

describe("Admin › Alerting", () => {
  let searches: string[];
  beforeEach(() => {
    searches = [];
    server.use(
      http.get("/api/alerting/channels", () => HttpResponse.json({ success: true, data: CHANNELS })),
      http.get("/api/alerting/overview", () => HttpResponse.json({ success: true, data: { firing: { fleet: 1, dashboards: 1, dataHealth: 0 }, sent24h: 38, failed24h: 3, waiting: 1, failing: [{ id: "c2", name: "pager-hook", failed24h: 3, lastError: "HTTP 500" }] } })),
      http.get("/api/alerting/rules", () => HttpResponse.json({ success: true, data: [{ id: "r1", name: "Node memory", sourceType: "fleet_threshold", severity: "critical", enabled: true, aiRcaEnabled: false, aiRcaModelId: null, config: {}, channelIds: ["c1"] }] })),
      http.get("/api/dashboards/alerts", () => HttpResponse.json({ success: true, data: [{ id: "a1", name: "Orders low", dashboardId: "d1", dashboardTitle: "Shop", severity: "warning", enabled: true, channelIds: [], status: { state: "firing" } }] })),
      http.get("/api/data-health", () => HttpResponse.json({ success: false, error: { message: "Permission denied" } }, { status: 403 })),
      http.get("/api/scheduled-queries", () => HttpResponse.json({ success: true, data: { jobs: [] } })),
      http.get("/api/ai-triage/rules", () => HttpResponse.json({ success: true, data: { canManage: true, defaultAgentId: null, rules: [], channels: [], agents: [] } })),
      http.get("/api/alerting/settings/remediation", () => HttpResponse.json({ success: true, data: { channelIds: [], envSlack: false } })),
      http.get("/api/alerting/events/search", ({ request }) => {
        const url = new URL(request.url);
        searches.push(url.search);
        const cursor = url.searchParams.get("cursor");
        const events = cursor
          ? [{ id: "e3", ruleId: null, severity: "info", firedAt: now - 3000, payload: "older", deliveredTo: [], resolvedAt: null, source: "fleet_alert", channelIds: [], deliveryFailed: false }]
          : [
              { id: "e1", ruleId: null, severity: "critical", firedAt: now - 1000, payload: JSON.stringify({ title: "Node memory 92%" }), deliveredTo: ["ops-slack"], resolvedAt: null, source: "fleet_alert", channelIds: ["c1"], deliveryFailed: false },
              { id: "e2", ruleId: null, severity: "warning", firedAt: now - 2000, payload: JSON.stringify({ title: "Job failed" }), deliveredTo: [], resolvedAt: null, source: "scheduled_query", channelIds: [], deliveryFailed: true },
            ];
        return HttpResponse.json({ success: true, data: { events, nextCursor: cursor ? null : "next-1" } });
      }),
    );
  });

  it("opens on the Overview, with the numbers, the failing channel and links into filtered views", async () => {
    renderAt("/admin/alerting");
    expect(await screen.findByText("Firing now")).toBeTruthy();
    expect(screen.getByText("38")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("pager-hook failed 3 times in the last day: HTTP 500");
    fireEvent.click(screen.getByText("Failed sends, 24h"));
    await waitFor(() => expect(location).toBe("/admin/alerting?view=activity&range=24h&result=failed"));
  });

  it("filters channels from the URL, shows health, use and who can act, and clears", async () => {
    renderAt("/admin/alerting?view=channels&health=failing");
    const rows = await screen.findAllByTestId("channel-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("pager-hook");
    expect(rows[0].textContent).toContain("3 failed · 24h");
    expect(rows[0].textContent).toContain("Used by: Data Health (2)");
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    // A bad filter in the URL falls back to the default (shows everything).
    renderAt("/admin/alerting?view=channels&health=bogus");
    await waitFor(() => expect(screen.getAllByTestId("channel-row").length).toBeGreaterThanOrEqual(3));
    const slack = screen.getAllByTestId("channel-row").find((r) => r.textContent?.includes("ops-slack"))!;
    expect(slack.textContent).toContain("Only S0GROUP");
    expect(slack.textContent).toContain("Used by: Fleet rules · Chobi");
    expect(screen.getAllByTestId("channel-row").find((r) => r.textContent?.includes("old-mail"))!.textContent).toContain("Not used by anything");
  });

  it("warns what still uses a channel before deleting it", async () => {
    renderAt("/admin/alerting?view=channels&q=pager");
    fireEvent.click(await screen.findByRole("button", { name: "Delete pager-hook" }));
    expect((await screen.findByRole("alertdialog")).textContent).toContain("Used by: Data Health (2); those stop sending here.");
  });

  it("lists every source it may see, says what it may not, and filters by state", async () => {
    renderAt("/admin/alerting?view=rules");
    const rows = await screen.findAllByTestId("source-row");
    expect(rows.map((r) => within(r).getByText(/Node memory|Orders low|Remediation approvals/).textContent)).toEqual(["Node memory", "Orders low", "Remediation approvals"]);
    expect(screen.getByText(/Not shown, for lack of permission: Data Health/)).toBeTruthy();
    renderAt("/admin/alerting?view=rules&state=firing");
    await waitFor(() => expect(screen.getAllByTestId("source-row").filter((r) => r.textContent?.includes("Firing")).length).toBeGreaterThan(0));
  });

  it("searches activity on the server and loads more with the cursor", async () => {
    renderAt("/admin/alerting?view=activity&source=fleet_alert");
    expect((await screen.findAllByTestId("event-row"))).toHaveLength(2);
    expect(searches[0]).toContain("source=fleet_alert");
    expect(screen.getAllByTestId("event-row")[1].textContent).toContain("Some failed");
    fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
    await waitFor(() => expect(screen.getAllByTestId("event-row")).toHaveLength(3));
    expect(searches[1]).toContain("cursor=next-1");
    expect(screen.queryByRole("button", { name: /Load more/ })).toBeNull();
  });
});
