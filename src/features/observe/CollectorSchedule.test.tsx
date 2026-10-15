import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeAll, describe, expect, it } from "vitest";

import type { CollectorScheduleRow, CollectorScheduleView } from "@/api/observe";
import { server } from "@/test/mocks/server";
import { CollectorSchedule } from "./CollectorSchedule";

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const MIB = 1024 * 1024;

function row(overrides: Partial<CollectorScheduleRow>): CollectorScheduleRow {
  return {
    name: "usage", label: "Usage", description: "Who reads each table.", reads: "system.query_log (new rows)", slower: "Readers update later.",
    minSeconds: 300, maxSeconds: 86_400, global: false, pausable: true, builtInSeconds: 900, defaults: {}, override: {},
    effective: { intervalSeconds: 900, intervalSource: "built-in", paused: false, pausedSource: "built-in" },
    status: { state: "ok", lastRunAt: Date.now() - 60_000, lastOkAt: Date.now() - 60_000, lastError: null, durationMs: 96, readRows: 1000, readBytes: MIB, queryCount: 3 },
    projectedBytesPerDay: 96 * MIB, overriddenOn: 0, pausedOn: 0,
    ...overrides,
  };
}

function view(collectors: CollectorScheduleRow[]): CollectorScheduleView {
  return { collectors, updatedBy: null, updatedAt: null };
}

const fleet = row({
  name: "fleet", label: "Fleet health", global: true, pausable: false, minSeconds: 10, builtInSeconds: 30, override: null, status: null,
  effective: { intervalSeconds: 30, intervalSource: "built-in", paused: false, pausedSource: "built-in" }, projectedBytesPerDay: null,
});

beforeAll(() => {
  // Radix Select needs these pointer and scroll APIs, which jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

describe("CollectorSchedule", () => {
  it("shows a connection's collectors with their last run and daily cost, and saves a new interval", async () => {
    const saved: unknown[] = [];
    server.use(
      http.get("/api/observe/collectors/schedule/c1", () => HttpResponse.json({ success: true, data: view([fleet, row({})]) })),
      http.put("/api/observe/collectors/schedule/c1", async ({ request }) => {
        saved.push(await request.json());
        return HttpResponse.json({ success: true, data: view([fleet, row({ override: { intervalSeconds: 3600 } })]) });
      }),
    );
    const user = userEvent.setup();
    render(<CollectorSchedule connectionId="c1" canEdit />, { wrapper });

    const table = await screen.findByRole("table", { name: "Collection schedule" });
    const usage = within(table).getByText("Usage").closest("tr") as HTMLElement;
    expect(within(usage).getByText(/3 queries · 1\.0 MiB read/)).toBeTruthy();
    expect(within(usage).getByText("96.0 MiB/day")).toBeTruthy();
    // Fleet runs once for all connections: no per-connection setting.
    const fleetRow = within(table).getByText("Fleet health").closest("tr") as HTMLElement;
    expect(within(fleetRow).getByText(/set in the defaults/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /save schedule/i }).hasAttribute("disabled")).toBe(true);

    await user.click(within(usage).getByRole("combobox", { name: "Usage interval" }));
    await user.click(await screen.findByRole("option", { name: "Every 1h" }));
    // The daily cost follows the draft: 24 runs of the last run's 1 MiB.
    expect(within(usage).getByText("24.0 MiB/day")).toBeTruthy();
    expect(within(usage).getByText(/Readers update later/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /save schedule/i }));
    await waitFor(() => expect(saved).toEqual([{ collectors: { usage: { intervalSeconds: 3600 } } }]));
  });

  it("pauses a collector and warns that its pages stop updating", async () => {
    server.use(http.get("/api/observe/collectors/schedule/c1", () => HttpResponse.json({ success: true, data: view([row({})]) })));
    const user = userEvent.setup();
    render(<CollectorSchedule connectionId="c1" canEdit />, { wrapper });
    const usage = (await screen.findByText("Usage")).closest("tr") as HTMLElement;
    await user.click(within(usage).getByRole("combobox", { name: "Usage state" }));
    await user.click(await screen.findByRole("option", { name: "Paused" }));
    expect(within(usage).getByText(/Paused: its Data pages stop updating/)).toBeTruthy();
    expect(within(usage).getByText("0 B/day")).toBeTruthy();
  });

  it("is read-only without connections:edit", async () => {
    server.use(http.get("/api/observe/collectors/schedule/c1", () => HttpResponse.json({ success: true, data: view([row({})]) })));
    render(<CollectorSchedule connectionId="c1" canEdit={false} />, { wrapper });
    const select = await screen.findByRole("combobox", { name: "Usage interval" });
    expect(select.hasAttribute("disabled") || select.getAttribute("data-disabled") !== null).toBe(true);
    expect(screen.queryByRole("button", { name: /save schedule/i })).toBeNull();
  });

  it("summarizes overrides across connections in the defaults", async () => {
    server.use(http.get("/api/observe/collectors/schedule", () => HttpResponse.json({ success: true, data: view([row({ override: null, status: null, overriddenOn: 1, pausedOn: 2, projectedBytesPerDay: 3 * 1024 * MIB })]) })));
    render(<CollectorSchedule connectionId={null} canEdit />, { wrapper });
    const usage = (await screen.findByText("Usage")).closest("tr") as HTMLElement;
    expect(within(usage).getByText("Own setting on 1 connection")).toBeTruthy();
    expect(within(usage).getByText("Paused on 2")).toBeTruthy();
    expect(within(usage).getByText("3.0 GiB/day")).toBeTruthy();
    expect(within(usage).getByRole("combobox", { name: "Usage interval" }).textContent).toContain("Built-in · 15m");
  });
});
