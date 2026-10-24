import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Briefing, BriefingItem } from "@/api/chobi";
import { useChobiStore } from "@/stores/chobi";
import { itemPath, NowTab, orderConnections } from "./NowTab";

const auth = vi.hoisted(() => ({ activeConnectionId: "dev" as string | null, setActiveConnection: vi.fn() }));

vi.mock("@/stores", () => ({
  useAuthStore: Object.assign(
    (selector: (state: { activeConnectionId: string | null }) => unknown) => selector({ activeConnectionId: auth.activeConnectionId }),
    { getState: () => ({ setActiveConnection: auth.setActiveConnection }) },
  ),
}));

vi.mock("./hooks", () => ({ useRefreshBriefing: () => vi.fn().mockResolvedValue(undefined) }));

function item(key: string, extra: Partial<BriefingItem> = {}): BriefingItem {
  return { key, kind: "incident", severity: "bad", title: `Title ${key}`, detail: null, at: null, connectionId: "prod", ref: { type: "incident", source: "data_health", id: key }, ...extra };
}

const BRIEFING: Briefing = {
  generatedAt: Date.now(),
  general: [item("approvals:a1", { kind: "approval", severity: "warn", title: "1 change waiting for your answer", connectionId: null, ref: { type: "action", id: "a1" } })],
  connections: [
    { id: "quiet", name: "Quiet one", production: false, status: "ok", items: [] },
    { id: "prod", name: "Production", production: true, status: "attention", items: [item("i1")] },
    { id: "dev", name: "Dev", production: false, status: "ok", items: [] },
    { id: "down", name: "Down", production: false, status: "unreachable", items: [item("c1", { kind: "connection", ref: null, connectionId: "down", title: "Cannot reach the cluster" })] },
  ],
  ai: { changedToday: 2, undoable: 1 },
  unavailable: ["scheduled queries (needs scheduled_queries:view)"],
};

function Where(): React.JSX.Element {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderNow(props: Partial<React.ComponentProps<typeof NowTab>> = {}): { onOpenActivity: ReturnType<typeof vi.fn>; onNavigated: ReturnType<typeof vi.fn> } {
  const onOpenActivity = vi.fn();
  const onNavigated = vi.fn();
  render(
    <MemoryRouter initialEntries={["/fleet"]}>
      <NowTab briefing={BRIEFING} loading={false} error={false} onOpenActivity={onOpenActivity} onNavigated={onNavigated} {...props} />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
  return { onOpenActivity, onNavigated };
}

beforeEach(() => {
  auth.activeConnectionId = "dev";
  auth.setActiveConnection.mockReset();
});

describe("NowTab", () => {
  it("puts the active connection first, then unreachable, then those needing a look", () => {
    expect(orderConnections(BRIEFING.connections, "dev").map((c) => c.id)).toEqual(["dev", "down", "prod", "quiet"]);
  });

  it("links incidents, jobs and fleet problems to their pages", () => {
    expect(itemPath(item("x"))).toBe("/data/incidents/data_health/x");
    expect(itemPath(item("j", { kind: "schedule", ref: { type: "job", id: "j 1" } }))).toBe("/data/scheduled-queries/jobs?job=j%201");
    expect(itemPath(item("c", { kind: "connection", ref: null }))).toBe("/fleet");
    expect(itemPath(item("a", { kind: "approval", ref: { type: "action", id: "a" } }))).toBeNull();
  });

  it("collapses quiet connections and says what it could not include", () => {
    renderNow();
    expect(screen.getByRole("region", { name: "Dev" })).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Quiet one" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /1 quiet connection/ }));
    expect(screen.getByText("Quiet one")).not.toBeNull();
    expect(screen.getByText(/Not included: scheduled queries/)).not.toBeNull();
    expect(screen.getByText(/AI changed 2 things for you today · 1 can be undone/)).not.toBeNull();
  });

  it("switches to the item's connection before opening it", () => {
    const { onNavigated } = renderNow();
    fireEvent.click(screen.getByRole("button", { name: /^Problem:\s*Title i1/ }));
    expect(auth.setActiveConnection).toHaveBeenCalledWith("prod", "Production");
    expect(screen.getByTestId("where").textContent).toBe("/data/incidents/data_health/i1");
    expect(onNavigated).toHaveBeenCalled();
  });

  it("opens approvals in the Activity tab", () => {
    const { onOpenActivity } = renderNow();
    fireEvent.click(screen.getByRole("button", { name: /1 change waiting for your answer/ }));
    expect(onOpenActivity).toHaveBeenCalled();
    expect(screen.getByTestId("where").textContent).toBe("/fleet");
  });

  it("asks Chobi to look into an item, with the facts attached", () => {
    renderNow();
    fireEvent.click(screen.getByRole("button", { name: "Ask Chobi about Title i1" }));
    const ask = useChobiStore.getState().ask;
    expect(ask).toMatchObject({ send: true, text: "Look into this on Production: Title i1. What happened, why, and what should I do?" });
    expect(ask?.context?.name).toBe("incident.json");
    expect(JSON.parse(ask?.context?.content ?? "{}")).toMatchObject({ key: "i1", connection: "Production" });
    // Approvals are answered, not discussed: no Ask on them.
    expect(screen.queryByRole("button", { name: /Ask Chobi about 1 change/ })).toBeNull();
  });

  it("says all clear when nothing needs a look", () => {
    renderNow({ briefing: { ...BRIEFING, general: [], connections: [{ id: "dev", name: "Dev", production: false, status: "ok", items: [] }], ai: { changedToday: 0, undoable: 0 }, unavailable: [] } });
    expect(screen.getByText(/All clear/)).not.toBeNull();
  });
});
