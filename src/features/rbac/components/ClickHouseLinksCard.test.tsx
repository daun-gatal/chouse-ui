import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BindingState, OwnBinding } from "@/api/clickhouseBindings";
import { useRbacStore } from "@/stores";
import { ClickHouseLinksCard } from "./ClickHouseLinksCard";

const getMine = vi.fn<() => Promise<OwnBinding[]>>();
const recheck = vi.fn<(id: string) => Promise<OwnBinding>>();
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toast.success(...args),
    error: (...args: unknown[]) => toast.error(...args),
    warning: (...args: unknown[]) => toast.warning(...args),
  },
}));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/api/clickhouseBindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/clickhouseBindings")>()),
  getMyBindings: () => getMine(),
  recheckBinding: (id: string) => recheck(id),
}));
// The page is not under test, only the card frame it lends.
vi.mock("@/pages/Preferences", () => ({
  MONO_FAINT: "mono-faint",
  SettingCard: ({ title, children }: { title: string; children: ReactNode }): ReactElement => (
    <section aria-label={title}>{children}</section>
  ),
}));

function link(id: string, state: BindingState, patch: Partial<OwnBinding> = {}): OwnBinding {
  return {
    id,
    connectionId: `conn-${id}`,
    connectionName: `Connection ${id}`,
    connectionKind: "personal",
    clickhouseUser: `user_${id}`,
    defaultDatabase: null,
    state,
    reason: null,
    checkedAt: null,
    ...patch,
  };
}

function renderCard(): HTMLElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ClickHouseLinksCard />
    </QueryClientProvider>,
  ).container;
}

function row(connection: string): HTMLElement {
  const item = screen.getByText(connection).closest("li");
  if (!item) throw new Error(`no row for ${connection}`);
  return item;
}

beforeEach(() => {
  useRbacStore.setState({ isAuthenticated: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ClickHouseLinksCard", () => {
  it("renders nothing when the person has no links", async () => {
    getMine.mockResolvedValue([]);
    const container = renderCard();

    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1));
    expect(container.childElementCount).toBe(0);
  });

  it("renders nothing when the links cannot be read", async () => {
    getMine.mockRejectedValue(new Error("boom"));
    const container = renderCard();

    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1));
    expect(container.childElementCount).toBe(0);
  });

  it("shows each link with its connection, ClickHouse user, state, reason and default database", async () => {
    getMine.mockResolvedValue([
      link("a", "active", { defaultDatabase: "analytics" }),
      link("b", "pending_grant", { reason: "The ClickHouse administrator has not run the grant yet." }),
      link("c", "suspended", { reason: "How this account signs in changed." }),
      link("d", "disabled", { reason: "The ClickHouse user was recreated." }),
    ]);
    renderCard();

    expect(await screen.findByRole("region", { name: "ClickHouse user" })).toBeTruthy();
    expect(row("Connection a").textContent).toContain("Runs as user_a");
    expect(row("Connection a").textContent).toContain("default database analytics");
    expect(within(row("Connection a")).getByText("Active")).toBeTruthy();
    expect(within(row("Connection b")).getByText("Waiting for the grant")).toBeTruthy();
    expect(within(row("Connection b")).getByText("The ClickHouse administrator has not run the grant yet.")).toBeTruthy();
    expect(row("Connection b").textContent).not.toContain("default database");
    expect(within(row("Connection c")).getByText("Suspended")).toBeTruthy();
    expect(within(row("Connection c")).getByText("How this account signs in changed.")).toBeTruthy();
    expect(within(row("Connection d")).getByText("Disabled")).toBeTruthy();
    expect(screen.getByText(/Only a super admin can link your account/)).toBeTruthy();
  });

  it("offers Check again only on waiting and active links", async () => {
    getMine.mockResolvedValue([link("a", "active"), link("b", "pending_grant"), link("c", "suspended"), link("d", "disabled")]);
    renderCard();
    await screen.findByText("Connection a");

    expect(within(row("Connection a")).getByRole("button", { name: "Check again: Connection a" })).toBeTruthy();
    expect(within(row("Connection b")).getByRole("button", { name: "Check again: Connection b" })).toBeTruthy();
    expect(within(row("Connection c")).queryByRole("button")).toBeNull();
    expect(within(row("Connection d")).queryByRole("button")).toBeNull();
  });

  it("says a link on a connection of another kind is not in use yet", async () => {
    getMine.mockResolvedValue([link("a", "active", { connectionKind: "shared" }), link("b", "active")]);
    renderCard();
    await screen.findByText("Connection a");

    expect(within(row("Connection a")).getByText("Not in use until this connection is switched to Personal")).toBeTruthy();
    expect(within(row("Connection b")).queryByText(/Not in use/)).toBeNull();
  });

  it("checks a link again and reloads the list", async () => {
    const user = userEvent.setup();
    getMine.mockResolvedValueOnce([link("b", "pending_grant")]).mockResolvedValue([link("b", "active")]);
    recheck.mockResolvedValue(link("b", "active"));
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Check again: Connection b" }));

    await waitFor(() => expect(recheck).toHaveBeenCalledWith("b"));
    await waitFor(() => expect(within(row("Connection b")).getByText("Active")).toBeTruthy());
    expect(getMine).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("Your link runs as user_b");
  });

  it("says why a link is still not usable after a check", async () => {
    const user = userEvent.setup();
    getMine.mockResolvedValue([link("b", "pending_grant")]);
    recheck.mockResolvedValue(link("b", "pending_grant", { reason: "The grant is still missing." }));
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Check again: Connection b" }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("Waiting for the grant", { description: "The grant is still missing." }));
  });

  it("shows the server's message when the check fails", async () => {
    const user = userEvent.setup();
    getMine.mockResolvedValue([link("a", "active")]);
    recheck.mockRejectedValue(new Error("ClickHouse did not answer."));
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Check again: Connection a" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't check the link", { description: "ClickHouse did not answer." }));
  });
});
