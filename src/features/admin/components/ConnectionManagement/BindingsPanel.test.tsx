import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import type { AdminBinding, BindingState, ConnectionBindings, CreateBindingInput } from "@/api/clickhouseBindings";
import type { ClickHouseConnection, RbacUser } from "@/api/rbac";
import { BindingsPanel, clickhouseUserProblem, readinessLine } from "./BindingsPanel";

const getBindings = vi.fn<(connectionId: string) => Promise<ConnectionBindings>>();
const create = vi.fn<(connectionId: string, input: CreateBindingInput) => Promise<AdminBinding>>();
const confirm = vi.fn<(id: string) => Promise<AdminBinding>>();
const recheck = vi.fn<(id: string) => Promise<AdminBinding>>();
const remove = vi.fn<(id: string) => Promise<void>>();
const listUsers = vi.fn<(options?: { limit?: number; search?: string }) => Promise<{ users: RbacUser[]; total: number; activeCount: number; inactiveCount: number }>>();
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
  getConnectionBindings: (connectionId: string) => getBindings(connectionId),
  createBinding: (connectionId: string, input: CreateBindingInput) => create(connectionId, input),
  confirmBinding: (id: string) => confirm(id),
  recheckBinding: (id: string) => recheck(id),
  removeBinding: (id: string) => remove(id),
}));
vi.mock("@/api/rbac", () => ({
  rbacUsersApi: { list: (options?: { limit?: number; search?: string }) => listUsers(options) },
}));

const CONNECTION: ClickHouseConnection = {
  id: "conn-1",
  name: "Warehouse",
  host: "ch.internal",
  port: 8443,
  username: "chouse_personal",
  database: null,
  isDefault: false,
  isActive: true,
  sslEnabled: true,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  metadata: null,
  identityMode: "personal",
  systemRole: "chouse_system",
  impersonationRole: "chouse_impersonate",
  accessContact: null,
  identityHealth: "ok",
  identityHealthReason: null,
  identityCheckedAt: null,
  identityServerVersion: null,
};

function binding(id: string, state: BindingState, patch: Partial<AdminBinding> = {}): AdminBinding {
  return {
    id,
    userId: `u-${id}`,
    accountName: id,
    accountEmail: `${id}@example.com`,
    connectionId: "conn-1",
    connectionName: "Warehouse",
    connectionKind: "personal",
    clickhouseUser: `${id}_ch`,
    defaultDatabase: null,
    state,
    reason: null,
    checkedAt: null,
    createdAt: 1_799_000_000_000,
    ...patch,
  };
}

function account(id: string, username: string): RbacUser {
  return {
    id,
    email: `${username}@example.com`,
    username,
    displayName: null,
    avatarUrl: null,
    isActive: true,
    hasSsoIdentity: false,
    bootstrapOnboardingPending: false,
    requiresPasswordChange: false,
    roles: [],
    permissions: [],
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const ALICE = binding("alice", "active", { checkedAt: 1_800_000_000_000 });
const BOB = binding("bob", "pending_grant", { reason: "The ClickHouse administrator has not run the grant yet." });
const CAROL = binding("carol", "suspended", { reason: "How this account signs in changed." });
const DAVE = binding("dave", "disabled", { reason: "The ClickHouse user was recreated." });

const LISTING: ConnectionBindings = {
  bindings: [ALICE, BOB, CAROL, DAVE],
  grants: ["GRANT IMPERSONATE ON bob_ch TO chouse_impersonate;"],
  unbound: [{ user: "old_user", revoke: "REVOKE IMPERSONATE ON old_user FROM chouse_impersonate;" }],
  readiness: { counts: { pending_grant: 1, active: 1, suspended: 1, disabled: 1 }, jobsWithoutLink: 2 },
};

const EMPTY: ConnectionBindings = {
  bindings: [],
  grants: [],
  unbound: [],
  readiness: { counts: { pending_grant: 0, active: 0, suspended: 0, disabled: 0 }, jobsWithoutLink: 0 },
};

function open(connection: ClickHouseConnection | null = CONNECTION): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BindingsPanel connection={connection} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

function row(accountName: string): HTMLElement {
  // The account picker can show the same name; only the table has rows.
  const found = within(screen.getByRole("table")).getByText(accountName).closest("tr");
  if (!found) throw new Error(`no row for ${accountName}`);
  return found;
}

async function fillLink(user: ReturnType<typeof userEvent.setup>, accountName: string, clickhouseUser: string): Promise<void> {
  const accounts = await screen.findByRole("list", { name: "Accounts" });
  await user.click(within(accounts).getByText(accountName));
  await user.type(screen.getByLabelText("ClickHouse user"), clickhouseUser);
}

beforeEach(() => {
  getBindings.mockResolvedValue(LISTING);
  listUsers.mockResolvedValue({ users: [account("u-alice", "alice"), account("u-erin", "erin")], total: 2, activeCount: 2, inactiveCount: 0 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("readinessLine", () => {
  it("counts the links by state and the scheduled queries without one", () => {
    expect(readinessLine(LISTING.readiness)).toBe("1 active, 1 waiting, 1 suspended, 1 disabled · 2 scheduled queries whose owner has no active link");
    expect(readinessLine({ counts: { active: 3, pending_grant: 0, suspended: 0, disabled: 0 }, jobsWithoutLink: 1 })).toBe(
      "3 active, 0 waiting, 0 suspended, 0 disabled · 1 scheduled query whose owner has no active link",
    );
  });
});

describe("clickhouseUserProblem", () => {
  it("accepts letters, digits and underscores, and refuses default", () => {
    expect(clickhouseUserProblem("alice_ch2")).toBeNull();
    expect(clickhouseUserProblem("")).toBe("Enter the ClickHouse user.");
    expect(clickhouseUserProblem("alice-ch")).toMatch(/letters, digits and underscores/);
    expect(clickhouseUserProblem("2alice")).toMatch(/letters, digits and underscores/);
    expect(clickhouseUserProblem("default")).toBe("The ClickHouse user default cannot be linked to an account.");
  });
});

describe("BindingsPanel", () => {
  it("renders nothing without a connection", () => {
    open(null);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getBindings).not.toHaveBeenCalled();
  });

  it("lists every link with its account, ClickHouse user, state, reason and last check", async () => {
    open();

    const links = await screen.findByRole("region", { name: "Links" });
    expect(getBindings).toHaveBeenCalledWith("conn-1");
    expect(within(links).getByText("1 active, 1 waiting, 1 suspended, 1 disabled · 2 scheduled queries whose owner has no active link")).toBeTruthy();
    expect(within(row("alice")).getByText("alice@example.com")).toBeTruthy();
    expect(within(row("alice")).getByText("alice_ch")).toBeTruthy();
    expect(within(row("alice")).getByText("Active")).toBeTruthy();
    expect(within(row("alice")).getByText(new Date(1_800_000_000_000).toLocaleString())).toBeTruthy();
    expect(within(row("bob")).getByText("Waiting for the grant")).toBeTruthy();
    expect(within(row("bob")).getByText("The ClickHouse administrator has not run the grant yet.")).toBeTruthy();
    expect(within(row("bob")).getByText("Never")).toBeTruthy();
    expect(within(row("carol")).getByText("Suspended")).toBeTruthy();
    expect(within(row("dave")).getByText("Disabled")).toBeTruthy();
    expect(within(row("dave")).getByText("The ClickHouse user was recreated.")).toBeTruthy();
    // The connection is personal: its links are in use.
    expect(screen.queryByText(/Links are not in use/)).toBeNull();
  });

  it("offers each row only the actions its state allows", async () => {
    open();
    await screen.findByRole("region", { name: "Links" });

    const names = (accountName: string): string[] => within(row(accountName)).getAllByRole("button").map((button) => button.textContent ?? "");
    expect(names("alice")).toEqual(["Check again", "Remove"]);
    expect(names("bob")).toEqual(["Check again", "Remove"]);
    expect(names("carol")).toEqual(["Confirm", "Remove"]);
    expect(names("dave")).toEqual(["Remove"]);
  });

  it("shows the grant script for the ClickHouse administrator and copies it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();

    const admin = await screen.findByRole("region", { name: "For the ClickHouse administrator" });
    expect(admin.textContent).toContain("Hand this to your ClickHouse administrator. CHouse cannot run it.");
    expect(within(admin).getByText("GRANT IMPERSONATE ON bob_ch TO chouse_impersonate;")).toBeTruthy();
    await user.click(within(admin).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("GRANT IMPERSONATE ON bob_ch TO chouse_impersonate;"));
  });

  it("warns about ClickHouse users the connection may still act as, with the revoke to run", async () => {
    open();

    const unbound = await screen.findByRole("region", { name: "ClickHouse users without a link" });
    expect(unbound.textContent).toContain("This connection may still act as this ClickHouse user, although no link uses it: old_user.");
    expect(within(unbound).getByText("REVOKE IMPERSONATE ON old_user FROM chouse_impersonate;")).toBeTruthy();
  });

  it("says so when there are no links, and shows neither a grant script nor a warning", async () => {
    getBindings.mockResolvedValue(EMPTY);
    open();

    expect(await screen.findByText("No account is linked to a ClickHouse user on this connection yet.")).toBeTruthy();
    expect(screen.getByText("0 active, 0 waiting, 0 suspended, 0 disabled · 0 scheduled queries whose owner has no active link")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("region", { name: "For the ClickHouse administrator" })).toBeNull();
    expect(screen.queryByRole("region", { name: "ClickHouse users without a link" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add link" })).toBeTruthy();
  });

  it.each(["shared", "shared_ceiling"])("says links on a %s connection are not in use yet", async (identityMode) => {
    open({ ...CONNECTION, identityMode });

    expect((await screen.findByRole("note")).textContent).toBe("Links are not in use until this connection is switched to Personal.");
    // They can still be prepared.
    expect(screen.getByRole("button", { name: "Add link" })).toBeTruthy();
  });

  it("adds a link, clears the form and reloads the list", async () => {
    const user = userEvent.setup();
    const erin = binding("erin", "pending_grant");
    create.mockResolvedValue(erin);
    getBindings.mockResolvedValueOnce(LISTING).mockResolvedValue({ ...LISTING, bindings: [...LISTING.bindings, erin] });
    open();
    await screen.findByRole("region", { name: "Links" });

    await fillLink(user, "erin", " erin_ch ");
    await user.click(screen.getByRole("button", { name: "Add link" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith("conn-1", { userId: "u-erin", clickhouseUser: "erin_ch" }));
    await waitFor(() => expect(within(row("erin")).getByText("erin_ch")).toBeTruthy());
    expect(getBindings).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("Linked erin to erin_ch", { description: "It is waiting for the grant below." });
    expect(screen.getByLabelText("ClickHouse user")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Account")).toHaveProperty("value", "");
  });

  it("does not offer an account that already has a link on this connection", async () => {
    open();
    await screen.findByRole("region", { name: "Links" });

    const accounts = await screen.findByRole("list", { name: "Accounts" });
    const alice = within(accounts).getByText("alice").closest("button");
    expect(alice).toHaveProperty("disabled", true);
    expect(alice?.textContent).toContain("already linked here");
    expect(within(accounts).getByText("erin").closest("button")).toHaveProperty("disabled", false);
  });

  it("searches the accounts by what is typed", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("region", { name: "Links" });

    await user.type(screen.getByLabelText("Account"), "eri");

    await waitFor(() => expect(listUsers).toHaveBeenCalledWith({ limit: 20, search: "eri" }));
  });

  it("shows the server's message when a link is refused, and keeps the form", async () => {
    const user = userEvent.setup();
    create.mockRejectedValue(new ApiError("ClickHouse has no user named ghost.", 422, "BINDING_USER_NOT_FOUND"));
    open();
    await screen.findByRole("region", { name: "Links" });

    await fillLink(user, "erin", "ghost");
    await user.click(screen.getByRole("button", { name: "Add link" }));

    const add = screen.getByRole("region", { name: "Add link" });
    expect((await within(add).findByRole("alert")).textContent).toBe("ClickHouse has no user named ghost.");
    expect(toast.error).toHaveBeenCalledWith("Couldn't add the link", { description: "ClickHouse has no user named ghost." });
    expect(screen.getByLabelText("ClickHouse user")).toHaveProperty("value", "ghost");
    expect(getBindings).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["", "Enter the ClickHouse user."],
    ["erin-ch", /Use letters, digits and underscores/],
    ["default", "The ClickHouse user default cannot be linked to an account."],
  ])("refuses the ClickHouse user %j before anything is sent", async (name, message) => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("region", { name: "Links" });

    const accounts = await screen.findByRole("list", { name: "Accounts" });
    await user.click(within(accounts).getByText("erin"));
    if (name !== "") await user.type(screen.getByLabelText("ClickHouse user"), name);
    await user.click(screen.getByRole("button", { name: "Add link" }));

    expect(within(screen.getByRole("region", { name: "Add link" })).getByRole("alert").textContent).toMatch(message);
    expect(create).not.toHaveBeenCalled();
  });

  it("asks for the account before anything is sent", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("region", { name: "Links" });

    await user.type(screen.getByLabelText("ClickHouse user"), "erin_ch");
    await user.click(screen.getByRole("button", { name: "Add link" }));

    expect(within(screen.getByRole("region", { name: "Add link" })).getByRole("alert").textContent).toBe("Choose the account.");
    expect(create).not.toHaveBeenCalled();
  });

  it("confirms a suspended link and reloads the list", async () => {
    const user = userEvent.setup();
    confirm.mockResolvedValue({ ...CAROL, state: "active", reason: null });
    open();
    await screen.findByRole("region", { name: "Links" });

    await user.click(screen.getByRole("button", { name: "Confirm: carol" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("carol"));
    await waitFor(() => expect(getBindings).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalledWith("Confirmed the link to carol_ch");
  });

  it("checks a waiting link again and says why it is still waiting", async () => {
    const user = userEvent.setup();
    recheck.mockResolvedValue(BOB);
    open();
    await screen.findByRole("region", { name: "Links" });

    await user.click(screen.getByRole("button", { name: "Check again: bob" }));

    await waitFor(() => expect(recheck).toHaveBeenCalledWith("bob"));
    await waitFor(() => expect(getBindings).toHaveBeenCalledTimes(2));
    expect(toast.warning).toHaveBeenCalledWith("bob_ch: waiting for the grant", { description: "The ClickHouse administrator has not run the grant yet." });
  });

  it("removes a link only after it is confirmed", async () => {
    const user = userEvent.setup();
    remove.mockResolvedValue(undefined);
    open();
    await screen.findByRole("region", { name: "Links" });

    await user.click(screen.getByRole("button", { name: "Remove: dave" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove this link?" });
    expect(dialog.textContent).toContain("dave can no longer run statements as dave_ch on this connection.");
    expect(remove).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("dave"));
    await waitFor(() => expect(getBindings).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalledWith("Link removed");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove this link?" })).toBeNull());
  });

  it("keeps the link when the removal is cancelled", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("region", { name: "Links" });

    await user.click(screen.getByRole("button", { name: "Remove: dave" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove this link?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove this link?" })).toBeNull());
    expect(remove).not.toHaveBeenCalled();
  });

  it("shows the server's message when an action on a row fails", async () => {
    const user = userEvent.setup();
    confirm.mockRejectedValue(new ApiError("Only a super admin can link an account to a ClickHouse user.", 403, "FORBIDDEN"));
    open();
    await screen.findByRole("region", { name: "Links" });

    await user.click(screen.getByRole("button", { name: "Confirm: carol" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't confirm the link", { description: "Only a super admin can link an account to a ClickHouse user." }),
    );
    expect(getBindings).toHaveBeenCalledTimes(1);
  });

  it("offers to try again when the links cannot be read", async () => {
    const user = userEvent.setup();
    getBindings.mockRejectedValueOnce(new ApiError("Only a super admin can link an account to a ClickHouse user.", 403, "FORBIDDEN"));
    open();

    expect((await screen.findByRole("alert")).textContent).toContain("Only a super admin can link an account to a ClickHouse user.");
    expect(screen.queryByRole("region", { name: "Add link" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Links" })).toBeTruthy();
  });
});
