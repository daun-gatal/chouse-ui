import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HandoffDialog } from "./HandoffDialog";

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  ensureNotebook: vi.fn(),
  addCell: vi.fn(),
  postChannelMessage: vi.fn(),
}));

vi.mock("@/stores", () => ({
  RBAC_PERMISSIONS: { NOTEBOOKS_EDIT: "notebooks:edit", OBSERVE_VIEW: "observe:view", DATA_HEALTH_VIEW: "data_health:view", ALERTING_EDIT: "alerting:edit" },
  useAuthStore: (selector: (s: { activeConnectionName: string | null }) => unknown) => selector({ activeConnectionName: "prod" }),
  useRbacStore: (selector: (s: { hasPermission: (p: string) => boolean }) => unknown) => selector({ hasPermission: (p: string) => mocks.permissions.has(p) }),
}));
vi.mock("@/api/aiActions", () => ({
  getAiActivity: vi.fn().mockResolvedValue([{ id: "a1", title: "Run a scheduled job now", description: "Run job loader", status: "executed", undoneAt: null }]),
}));
vi.mock("@/api/observe", () => ({
  listIncidents: vi.fn().mockResolvedValue([{ source: "data_health", id: "inc-1", title: "orders late", connectionName: "prod" }]),
}));
vi.mock("@/api/alerting", () => ({
  listChannels: vi.fn().mockResolvedValue([{ id: "ch-1", name: "oncall", type: "slack", enabled: true }, { id: "ch-2", name: "old", type: "email", enabled: false }]),
  postChannelMessage: mocks.postChannelMessage,
}));
vi.mock("@/api/notebooks", () => ({ ensureNotebook: mocks.ensureNotebook, addCell: mocks.addCell }));

const MESSAGES = [
  { role: "user" as const, content: "Why is orders late?" },
  { role: "assistant" as const, content: "The loader failed; I reran it." },
];

function renderDialog(onClose = vi.fn()): ReturnType<typeof vi.fn> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HandoffDialog open onClose={onClose} title="Orders late" messages={MESSAGES} actionIds={["a1"]} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  // jsdom lacks what Radix Select calls while it opens.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.releasePointerCapture = vi.fn();
  mocks.permissions = new Set();
  mocks.ensureNotebook.mockReset().mockResolvedValue({ notebook: { id: "nb-1" }, cells: [] });
  mocks.addCell.mockReset().mockResolvedValue({ id: "cell-1" });
  mocks.postChannelMessage.mockReset().mockResolvedValue({ sent: true, channel: "oncall" });
});

describe("HandoffDialog", () => {
  it("previews the handoff with the changes the conversation made", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("handoff-preview").textContent).toContain("**Run a scheduled job now** — executed"));
    expect(screen.getByTestId("handoff-preview").textContent).toContain("connection prod");
    // Without the permissions there is nothing to send to: only copy and download.
    expect(screen.queryByRole("combobox", { name: "Incident" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Alert channel" })).toBeNull();
    expect(screen.getByRole("button", { name: /Download/ })).not.toBeNull();
  });

  it("adds the handoff to an incident's notebook", async () => {
    mocks.permissions = new Set(["notebooks:edit", "data_health:view"]);
    const onClose = renderDialog();
    fireEvent.click(await screen.findByRole("combobox", { name: "Incident" }));
    fireEvent.click(await screen.findByRole("option", { name: "orders late · prod" }));
    fireEvent.click(screen.getByRole("button", { name: /Add to its notebook/ }));

    await waitFor(() => expect(mocks.addCell).toHaveBeenCalled());
    expect(mocks.ensureNotebook).toHaveBeenCalledWith("incident_data_health", "inc-1", "orders late");
    expect(mocks.addCell.mock.calls[0][0]).toBe("nb-1");
    expect(mocks.addCell.mock.calls[0][1]).toMatchObject({ kind: "note" });
    expect(String(mocks.addCell.mock.calls[0][1].text)).toContain("# Handoff: Orders late");
    expect(onClose).toHaveBeenCalled();
  });

  it("posts to a channel only after a second click", async () => {
    mocks.permissions = new Set(["alerting:edit"]);
    renderDialog();
    fireEvent.click(await screen.findByRole("combobox", { name: "Alert channel" }));
    expect(screen.queryByRole("option", { name: /old/ })).toBeNull();
    fireEvent.click(await screen.findByRole("option", { name: "oncall · slack" }));

    fireEvent.click(screen.getByRole("button", { name: /Post a summary/ }));
    expect(mocks.postChannelMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /it reaches people/ }));

    await waitFor(() => expect(mocks.postChannelMessage).toHaveBeenCalledTimes(1));
    expect(mocks.postChannelMessage.mock.calls[0][0]).toBe("ch-1");
    expect(mocks.postChannelMessage.mock.calls[0][1]).toMatchObject({ title: "Handoff: Orders late" });
  });
});
