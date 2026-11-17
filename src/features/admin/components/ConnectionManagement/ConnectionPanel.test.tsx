import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import type { ConnectionBindings } from "@/api/clickhouseBindings";
import type {
  ConnectionIdentityDetail,
  CreateIdentityConnectionInput,
  CreatedIdentityConnection,
  IdentityChange,
  IdentityCheckResult,
  IdentityRecheckResult,
  IdentitySwitchResult,
  RoleMapEntry,
} from "@/api/connectionIdentity";
import type { ClickHouseConnection, CreateConnectionInput, RbacRole, SavedConnection, TestConnectionInput, TestConnectionResult, UpdateConnectionInput } from "@/api/rbac";
import { ConnectionPanel } from "./ConnectionPanel";
import type { PanelTab } from "./loginForm";

const api = {
  create: vi.fn<(input: CreateConnectionInput) => Promise<SavedConnection>>(),
  update: vi.fn<(id: string, input: UpdateConnectionInput) => Promise<SavedConnection>>(),
  test: vi.fn<(input: TestConnectionInput) => Promise<TestConnectionResult>>(),
  roles: vi.fn<() => Promise<RbacRole[]>>(),
  getIdentity: vi.fn<(id: string) => Promise<ConnectionIdentityDetail>>(),
  check: vi.fn<(id: string, change: IdentityChange) => Promise<IdentityCheckResult>>(),
  checkNew: vi.fn<(change: IdentityChange) => Promise<IdentityCheckResult>>(),
  createIdentity: vi.fn<(input: CreateIdentityConnectionInput) => Promise<CreatedIdentityConnection>>(),
  switchIdentity: vi.fn<(id: string, change: IdentityChange) => Promise<IdentitySwitchResult>>(),
  recheck: vi.fn<(id: string) => Promise<IdentityRecheckResult>>(),
  setContact: vi.fn<(id: string, contact: string | null) => Promise<unknown>>(),
  roleMap: vi.fn<(id: string) => Promise<RoleMapEntry[]>>(),
  bindings: vi.fn<(id: string) => Promise<ConnectionBindings>>(),
};
const access = { superAdmin: true, roles: ["super_admin"] };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/features/observe/ConnectionObservability", () => ({ ConnectionObservability: (): ReactElement => <div data-testid="observability" /> }));
vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  const state = (): Record<string, unknown> => ({
    hasPermission: () => true,
    isSuperAdmin: () => access.superAdmin,
    roles: access.roles,
    user: { id: "u-me" },
    isAuthenticated: true,
  });
  return {
    ...actual,
    useRbacStore: (selector?: (value: Record<string, unknown>) => unknown) => (selector ? selector(state()) : state()),
  };
});
vi.mock("@/api/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/rbac")>()),
  rbacConnectionsApi: {
    create: (input: CreateConnectionInput) => api.create(input),
    update: (id: string, input: UpdateConnectionInput) => api.update(id, input),
    test: (input: TestConnectionInput) => api.test(input),
  },
  rbacRolesApi: { list: () => api.roles() },
  rbacUsersApi: { list: () => Promise.resolve({ users: [], total: 0 }) },
}));
vi.mock("@/api/connectionIdentity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/connectionIdentity")>()),
  getConnectionIdentity: (id: string) => api.getIdentity(id),
  checkConnectionIdentity: (id: string, change: IdentityChange) => api.check(id, change),
  checkNewConnectionIdentity: (change: IdentityChange) => api.checkNew(change),
  createIdentityConnection: (input: CreateIdentityConnectionInput) => api.createIdentity(input),
  switchConnectionIdentity: (id: string, change: IdentityChange) => api.switchIdentity(id, change),
  recheckConnectionIdentity: (id: string) => api.recheck(id),
  setConnectionAccessContact: (id: string, contact: string | null) => api.setContact(id, contact),
  getConnectionRoleMap: (id: string) => api.roleMap(id),
  setConnectionRoleMap: () => Promise.resolve([]),
}));
vi.mock("@/api/clickhouseBindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/clickhouseBindings")>()),
  getConnectionBindings: (id: string) => api.bindings(id),
}));

function connection(overrides: Partial<ClickHouseConnection> = {}): ClickHouseConnection {
  return {
    id: "conn-1",
    name: "staging",
    host: "ch.internal",
    port: 8443,
    username: "chouse",
    database: null,
    isDefault: false,
    isActive: true,
    sslEnabled: true,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    metadata: null,
    identityMode: "shared",
    systemRole: null,
    impersonationRole: null,
    accessContact: null,
    identityHealth: null,
    identityHealthReason: null,
    identityCheckedAt: null,
    identityServerVersion: null,
    readiness: { state: "ready", policies: 3 },
    ...overrides,
  };
}

const SHARED = connection();
const CEILING = connection({
  id: "conn-ceiling",
  name: "prod-analytics",
  username: "chouse_ceiling",
  identityMode: "shared_ceiling",
  systemRole: "chouse_system",
  accessContact: "#data-platform",
  identityHealth: "ok",
  identityCheckedAt: 1_800_000_000_000,
  readiness: { state: "partial", policies: 1, roles: { total: 4, mapped: 2, peopleRefused: 37 } },
});
const PERSONAL = connection({
  id: "conn-personal",
  name: "finance-ch",
  username: "chouse_personal",
  identityMode: "personal",
  systemRole: "chouse_system",
  impersonationRole: "chouse_impersonate",
  identityHealth: "ok",
  readiness: { state: "none", policies: 0, links: { active: 0, pending: 3, other: 0 } },
});

function detail(of: ClickHouseConnection, patch: Partial<ConnectionIdentityDetail> = {}): ConnectionIdentityDetail {
  return {
    identityMode: of.identityMode,
    username: of.username,
    systemRole: of.systemRole,
    impersonationRole: of.impersonationRole,
    accessContact: of.accessContact,
    health: of.identityHealth,
    healthReason: of.identityHealthReason,
    checkedAt: of.identityCheckedAt,
    serverVersion: null,
    roleMap: [{ roleId: "r-analyst", roleName: "analyst", clickhouseRole: "analyst_ro" }],
    setupStatements: [],
    personalSetupStatements: [],
    support: { serverVersion: "26.3.63", kinds: [] },
    ...patch,
  };
}

const PASSING: IdentityCheckResult = {
  ok: true,
  reason: null,
  verdict: { ok: true, reason: null, serverVersion: "26.3.63", checks: [{ id: "version", label: "The login can connect", ok: true, detail: "ClickHouse 26.3.63." }] },
};

const FAILING: IdentityCheckResult = {
  ok: false,
  reason: "chouse_ceiling holds a direct grant.",
  verdict: {
    ok: false,
    reason: "chouse_ceiling holds a direct grant.",
    serverVersion: "26.3.63",
    checks: [
      { id: "version", label: "The login can connect", ok: true, detail: "ClickHouse 26.3.63." },
      { id: "empty_login", label: "The login holds no grant of its own", ok: false, detail: "chouse_ceiling holds a direct grant (SELECT ON default.*). Revoke it and grant it to a role instead." },
      { id: "login_reuse", label: "No connection of another kind uses the same login", ok: false, detail: "Connection \"prod-old\" (shared) uses the same host, port and user." },
    ],
  },
};

interface Rendered {
  onClose: ReturnType<typeof vi.fn>;
  onReload: ReturnType<typeof vi.fn>;
  onCreated: ReturnType<typeof vi.fn>;
}

function open(target: ClickHouseConnection | null, tab: PanelTab = "general", reloaded?: ClickHouseConnection[]): Rendered {
  const onClose = vi.fn();
  const onReload = vi.fn(async () => reloaded ?? (target ? [target] : []));
  const onCreated = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  }
  render(<ConnectionPanel connection={target} initialTab={tab} onClose={onClose} onReload={onReload} onCreated={onCreated} />, { wrapper: Wrapper });
  return { onClose, onReload, onCreated };
}

function panel(): HTMLElement {
  const sheets = screen.getAllByRole("dialog");
  return sheets[0];
}

async function chooseKind(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: /^Kind: / }));
  const list = screen.getByRole("listbox", { name: "Kind" });
  await user.click(within(list).getByRole("button", { name: new RegExp(`^${label}`) }));
}

async function retype(user: ReturnType<typeof userEvent.setup>, label: string | RegExp, value: string): Promise<void> {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  if (value !== "") await user.type(field, value);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  access.superAdmin = true;
  access.roles = ["super_admin"];
  api.getIdentity.mockImplementation(async (id) => detail([SHARED, CEILING, PERSONAL].find((entry) => entry.id === id) ?? SHARED));
  api.roles.mockResolvedValue([]);
  api.roleMap.mockResolvedValue([]);
  api.bindings.mockResolvedValue({ bindings: [], grants: [], unbound: [], readiness: { counts: { pending_grant: 0, active: 0, suspended: 0, disabled: 0 }, jobsWithoutLink: 0 } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ConnectionPanel: tabs", () => {
  it("shows the three tabs to everyone who can open it, and Who can query only once the connection exists", async () => {
    open(null);
    expect(screen.getByRole("tab", { name: "General" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "ClickHouse login" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Who can query/ })).toHaveProperty("disabled", true);
    cleanup();

    access.superAdmin = false;
    open(CEILING);
    expect(screen.getByRole("tab", { name: /Who can query/ })).toHaveProperty("disabled", false);
    expect(screen.getByRole("tab", { name: /Who can query/ }).textContent).toContain("2/4");
  });

  it("opens on the tab it was asked for", async () => {
    open(SHARED, "who");
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.getByText("3 data access policies apply to this connection.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Data access policies" }).getAttribute("href")).toBe("/admin/data-access");
  });

  it("marks the login tab when the login is failing", () => {
    open({ ...CEILING, identityHealth: "failing", identityHealthReason: "Authentication failed for chouse_ceiling." });
    expect(screen.getByRole("tab", { name: "ClickHouse login (failing)" })).toBeTruthy();
  });
});

describe("ConnectionPanel: General", () => {
  it("saves name, environment and toggles without a login field", async () => {
    const user = userEvent.setup();
    api.update.mockResolvedValue(CEILING);
    const { onReload } = open(CEILING);

    await retype(user, "Name", "prod-eu");
    await user.click(screen.getByLabelText("Default connection"));
    await user.click(screen.getByRole("button", { name: "Save general" }));

    await waitFor(() => expect(api.update).toHaveBeenCalledWith("conn-ceiling", { name: "prod-eu", metadata: {}, isDefault: true }));
    expect(onReload).toHaveBeenCalled();
  });

  it("shows the server's refusal to make a connection nobody can query the default, under the toggle", async () => {
    const user = userEvent.setup();
    const message = "Nobody can query this connection yet, so it cannot be the default. Map roles or link people on its Who can query tab first.";
    api.update.mockRejectedValue(new ApiError(message, 409, "CONNECTION_NOT_READY"));
    open(PERSONAL);

    await user.click(screen.getByLabelText("Default connection"));
    await user.click(screen.getByRole("button", { name: "Save general" }));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.getByLabelText("Default connection").getAttribute("aria-checked")).toBe("true");
  });
});

describe("ConnectionPanel: unsaved changes", () => {
  it("asks before leaving a tab with unsaved changes: Stay keeps them", async () => {
    const user = userEvent.setup();
    open(SHARED);

    await retype(user, "Name", "renamed");
    await user.click(screen.getByRole("tab", { name: "ClickHouse login" }));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes on General" });
    expect(prompt.textContent).toContain("Each tab saves on its own, so moving to ClickHouse login drops this change.");
    await user.click(within(prompt).getByRole("button", { name: "Stay" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unsaved changes on General" })).toBeNull());
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "renamed");
  });

  it("Discard drops the change and moves on", async () => {
    const user = userEvent.setup();
    open(SHARED);

    await retype(user, "Name", "renamed");
    await user.click(screen.getByRole("tab", { name: "ClickHouse login" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Unsaved changes on General" })).getByRole("button", { name: "Discard" }));

    expect(await screen.findByLabelText("Host")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "General" }));
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "staging");
    expect(api.update).not.toHaveBeenCalled();
  });

  it("Save and go saves the tab, then moves on", async () => {
    const user = userEvent.setup();
    api.update.mockResolvedValue(SHARED);
    open(SHARED);

    await retype(user, "Name", "renamed");
    await user.click(screen.getByRole("tab", { name: "ClickHouse login" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Unsaved changes on General" })).getByRole("button", { name: "Save and go" }));

    await waitFor(() => expect(api.update).toHaveBeenCalledWith("conn-1", { name: "renamed", metadata: {} }));
    expect(await screen.findByLabelText("Host")).toBeTruthy();
  });

  it("stays on the tab when Save and go is refused", async () => {
    const user = userEvent.setup();
    api.update.mockRejectedValue(new ApiError("boom", 500, "INTERNAL_ERROR"));
    open(SHARED);

    await retype(user, "Name", "renamed");
    await user.click(screen.getByRole("tab", { name: "ClickHouse login" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Unsaved changes on General" })).getByRole("button", { name: "Save and go" }));

    expect((await screen.findByRole("alert")).textContent).toBe("boom");
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "renamed");
  });

  it("asks before closing with an unsaved password", async () => {
    const user = userEvent.setup();
    const { onClose } = open(SHARED, "login");

    await user.type(await screen.findByLabelText(/^Password/), "new-secret");
    await user.keyboard("{Escape}");

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes on ClickHouse login" });
    expect(prompt.textContent).toContain("closing drops this change");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(prompt).getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes at once when nothing changed, from the footer or the sheet's own close button", async () => {
    const user = userEvent.setup();
    const { onClose } = open(SHARED);
    await user.click(screen.getByText("Close", { selector: "button" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const sheetClose = screen.getAllByRole("button", { name: "Close" }).find((button) => button.closest("form") === null);
    if (!sheetClose) throw new Error("no close button on the sheet");
    await user.click(sheetClose);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("ConnectionPanel: ClickHouse login for an admin", () => {
  beforeEach(() => {
    access.superAdmin = false;
    access.roles = ["admin"];
  });

  it("shows a role-ceiling login read-only, with whom to ask", () => {
    open(CEILING, "login");
    const tab = panel();

    expect(within(tab).getByText("ch.internal:8443 · TLS")).toBeTruthy();
    expect(within(tab).getByText("chouse_ceiling")).toBeTruthy();
    expect(within(tab).getByText("Only a super admin can change the login of a role-ceiling connection. Ask #data-platform.")).toBeTruthy();
    expect(within(tab).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(tab).queryByLabelText("Host")).toBeNull();
    expect(api.getIdentity).not.toHaveBeenCalled();
  });

  it("lets an admin edit a shared login, and choose only a shared login", async () => {
    const user = userEvent.setup();
    open(SHARED, "login");

    await user.click(screen.getByRole("button", { name: "Kind: Shared login" }));
    const list = screen.getByRole("listbox", { name: "Kind" });
    expect(within(list).getByRole("button", { name: /^Role ceiling/ })).toHaveProperty("disabled", true);
    expect(within(list).getByRole("button", { name: /^Personal/ }).textContent).toContain("Only a super admin can choose this.");
    expect(screen.getByLabelText("Host")).toHaveProperty("value", "ch.internal");
  });

  it("shows the counts of Who can query read-only", () => {
    open(CEILING, "who");
    expect(screen.getByText("2 of 4 CHouse roles are mapped to a ClickHouse role.")).toBeTruthy();
    expect(screen.getByText("37 people can't query yet.")).toBeTruthy();
    expect(screen.getByText("Only a super admin can change who can query a role-ceiling connection. Ask #data-platform.")).toBeTruthy();
    expect(screen.queryByText("Save mappings")).toBeNull();
  });
});

describe("ConnectionPanel: where Save and Test go", () => {
  it("patches a shared login that stays shared, and tests it with the stored password", async () => {
    const user = userEvent.setup();
    access.superAdmin = false;
    api.update.mockResolvedValue(SHARED);
    api.test.mockResolvedValue({ success: true, version: "26.3", latencyMs: 4 });
    open(SHARED, "login");

    await retype(user, "Port", "9440");
    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(api.test).toHaveBeenCalledWith({ host: "ch.internal", port: 9440, username: "chouse", sslEnabled: true, connectionId: "conn-1" }));
    expect(await screen.findByText("Connection successful")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("conn-1", { port: 9440 }));
    expect(api.switchIdentity).not.toHaveBeenCalled();
  });

  it("switches a shared login to a role ceiling through the identity routes, with the hint and the footer", async () => {
    const user = userEvent.setup();
    api.check.mockResolvedValue(PASSING);
    api.switchIdentity.mockResolvedValue({ identity: detail(CEILING), check: PASSING });
    open(SHARED, "login");
    await screen.findByLabelText("Host");

    await chooseKind(user, "Role ceiling");
    expect(screen.getByText("Role ceiling needs a ClickHouse user with no grants of its own")).toBeTruthy();
    expect(screen.getByText("chouse has its own grants, so it can't be used as it is. Either:")).toBeTruthy();
    expect(screen.getByText("Queries on this connection fail until you save.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Kind: Role ceiling/ }).textContent).toContain("was Shared login");

    await retype(user, "ClickHouse user", "chouse_ceiling");
    expect(screen.getByText("New user entered: chouse keeps working until you save.")).toBeTruthy();
    await user.type(screen.getByLabelText(/^Password/), "pw");

    await user.click(screen.getByRole("button", { name: "Test" }));
    const expected = {
      identityMode: "shared_ceiling",
      host: "ch.internal",
      port: 8443,
      sslEnabled: true,
      username: "chouse_ceiling",
      password: "pw",
      database: "",
      systemRole: "chouse_system",
      accessContact: null,
    };
    await waitFor(() => expect(api.check).toHaveBeenCalledWith("conn-1", expected));
    expect(await screen.findByText("Every check passed. Nothing was saved.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.switchIdentity).toHaveBeenCalledWith("conn-1", expected));
    expect(api.update).not.toHaveBeenCalled();
    // A switch to a role ceiling goes on to who can query under it.
    await waitFor(() => expect(screen.getByRole("tab", { name: /Who can query/ }).getAttribute("aria-selected")).toBe("true"));
  });

  it("asks for the password of a new user before anything is sent", async () => {
    const user = userEvent.setup();
    open(CEILING, "login");
    await screen.findByLabelText("Host");

    await retype(user, "ClickHouse user", "chouse_other");
    await user.click(screen.getByRole("button", { name: "Test" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Enter the password of the new ClickHouse user.");
    expect(api.check).not.toHaveBeenCalled();
  });

  it("saves only the access contact without running the checks", async () => {
    const user = userEvent.setup();
    api.setContact.mockResolvedValue(detail(CEILING));
    open(CEILING, "login");
    await screen.findByLabelText("Host");

    await retype(user, /^Access contact/, "#data-access");
    expect(screen.queryByText(/keeps working until you save/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.setContact).toHaveBeenCalledWith("conn-ceiling", "#data-access"));
    expect(api.switchIdentity).not.toHaveBeenCalled();
  });

  it("tells the person to reload when the connection changed while the checks ran", async () => {
    const user = userEvent.setup();
    api.switchIdentity.mockRejectedValue(new ApiError("This connection was changed by someone else while the checks ran. Reload it and try again.", 409, "CONNECTION_CHANGED"));
    const { onReload } = open(CEILING, "login");
    await screen.findByLabelText("Host");

    await user.type(screen.getByLabelText(/^Password/), "pw");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This connection was changed by someone else while the checks ran")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalled();
  });

  it("locks a kind the server cannot run, with the server's reason", async () => {
    const user = userEvent.setup();
    api.getIdentity.mockResolvedValue(detail(SHARED, { support: { serverVersion: "25.8.4", kinds: [{ kind: "personal", state: "unavailable", reason: "ClickHouse 25.8.4 on this server fails the self-test (session settings)." }] } }));
    open(SHARED, "login");
    await screen.findByLabelText("Host");

    await user.click(screen.getByRole("button", { name: "Kind: Shared login" }));
    const personal = within(screen.getByRole("listbox", { name: "Kind" })).getByRole("button", { name: /^Personal/ });
    expect(personal).toHaveProperty("disabled", true);
    expect(personal.textContent).toContain("Not available: ClickHouse 25.8.4 on this server fails the self-test (session settings).");
  });

  it("says what changes for people on the way back to a shared login", async () => {
    const user = userEvent.setup();
    open(PERSONAL, "login");
    await screen.findByLabelText("Host");

    await chooseKind(user, "Shared login");
    expect(screen.getByText("Shared login needs a ClickHouse user with full privileges")).toBeTruthy();
    const note = screen.getByRole("note", { name: "What changes for people" });
    expect(note.textContent).toContain("Everyone runs as the one user below, not as their own ClickHouse user.");
    expect(note.textContent).toContain("This connection has none, so people other than admins see no tables until you add some.");
    expect(note.textContent).toContain("The 3 person links are kept, unused, in case you switch back.");
  });

  it("counts the links prepared on the connection on a switch to personal", async () => {
    const user = userEvent.setup();
    open(SHARED, "login");
    await screen.findByLabelText("Host");

    await chooseKind(user, "Personal");
    await waitFor(() => expect(screen.getByRole("note", { name: "What changes for people" }).textContent).toContain("0 people are linked, so everyone loses access until you add links in Who can query."));
    expect(api.bindings).toHaveBeenCalledWith("conn-1");
  });

  it("shows the setup script built from the form, never with the password, and the variant that empties the current user", async () => {
    const user = userEvent.setup();
    open(SHARED, "login");
    await screen.findByLabelText("Host");

    await chooseKind(user, "Role ceiling");
    await retype(user, "ClickHouse user", "chouse_ceiling");
    await user.type(screen.getByLabelText(/^Password/), "top-secret");
    await user.click(screen.getByRole("button", { name: "Show the script for the admin" }));

    const dialog = await screen.findByRole("dialog", { name: "Script for the ClickHouse admin" });
    const script = within(dialog).getByLabelText("Setup script");
    expect(script.textContent).toContain("CREATE USER IF NOT EXISTS chouse_ceiling IDENTIFIED BY '<password>';");
    expect(script.textContent).toContain("GRANT chouse_system, analyst_ro TO chouse_ceiling;");
    expect(script.textContent).not.toContain("top-secret");

    await user.click(within(dialog).getByRole("radio", { name: "Empty the current user" }));
    expect(script.textContent).toContain("REVOKE ALL ON *.* FROM chouse;");
    expect(script.textContent).not.toContain("CREATE USER");
  });

  it("re-runs the checks of a failing login", async () => {
    const user = userEvent.setup();
    const failing = { ...PERSONAL, identityHealth: "failing" as const, identityHealthReason: "Authentication failed for chouse_personal." };
    api.recheck.mockResolvedValue({ verdict: FAILING.verdict, identity: detail(failing) });
    const { onReload } = open(failing, "login");
    await screen.findByLabelText("Host");

    expect(screen.getByText("The login is failing its checks")).toBeTruthy();
    expect(screen.getByText("Authentication failed for chouse_personal.")).toBeTruthy();
    expect(screen.getByText("Saving a working login ends the refusal at once.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Re-run checks" }));

    await waitFor(() => expect(api.recheck).toHaveBeenCalledWith("conn-personal"));
    expect(await screen.findByText("The stored login fails 2 checks.")).toBeTruthy();
    expect(onReload).toHaveBeenCalled();
  });
});

describe("ConnectionPanel: create", () => {
  it("creates a shared login with General's name through the connection routes", async () => {
    const user = userEvent.setup();
    access.superAdmin = false;
    const created = connection({ id: "conn-new", name: "sandbox" });
    api.create.mockResolvedValue(created);
    api.test.mockResolvedValue({ success: true, version: "26.3", latencyMs: 4 });
    const { onCreated } = open(null);

    await user.type(screen.getByLabelText("Name"), "sandbox");
    await user.click(screen.getByRole("button", { name: "Next: ClickHouse login" }));
    await user.type(await screen.findByLabelText("Host"), "ch-sbx.internal");
    await user.type(screen.getByLabelText("ClickHouse user"), "chouse");

    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(api.test).toHaveBeenCalledWith({ host: "ch-sbx.internal", port: 8123, username: "chouse", sslEnabled: false }));

    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ name: "sandbox", host: "ch-sbx.internal", port: 8123, username: "chouse", sslEnabled: false, metadata: {} }));
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("sends Create back to General when the name is missing", async () => {
    const user = userEvent.setup();
    open(null, "login");

    await user.type(screen.getByLabelText("Host"), "h");
    await user.type(screen.getByLabelText("ClickHouse user"), "u");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Enter a name for the connection.");
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("creates a role ceiling through the identity routes, and keeps the fields when a check fails", async () => {
    const user = userEvent.setup();
    api.checkNew.mockResolvedValue(FAILING);
    api.createIdentity.mockRejectedValueOnce(new ApiError(FAILING.reason ?? "", 422, "IDENTITY_CHECK_FAILED", "validation", FAILING));
    const created = { ...CEILING, id: "conn-new" };
    api.createIdentity.mockResolvedValueOnce({ connection: created, check: PASSING });
    const { onCreated } = open(null);

    await user.type(screen.getByLabelText("Name"), "prod-analytics");
    await user.click(screen.getByRole("tab", { name: "ClickHouse login" }));
    await chooseKind(user, "Role ceiling");
    expect(screen.getByText("Role ceiling needs a ClickHouse user with no grants of its own")).toBeTruthy();
    expect(screen.getByText("Its access comes only from roles that CHouse names on each request.")).toBeTruthy();
    await user.type(screen.getByLabelText("Host"), "ch-prod.internal");
    await retype(user, "Port", "8443");
    await user.type(screen.getByLabelText("ClickHouse user"), "chouse_ceiling");

    await user.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Enter the password of the ClickHouse user.");
    await user.type(screen.getByLabelText(/^Password/), "pw");

    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(api.checkNew).toHaveBeenCalledWith(expect.objectContaining({ identityMode: "shared_ceiling", username: "chouse_ceiling", password: "pw", host: "ch-prod.internal", port: 8443 })));

    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Nothing was created. 2 checks failed.")).toBeTruthy();
    const admin = screen.getByRole("region", { name: "For your ClickHouse admin" });
    expect(admin.textContent).toContain("REVOKE ALL ON *.* FROM chouse_ceiling;");
    expect(screen.getByRole("region", { name: "For you" }).textContent).toContain("prod-old");
    expect(screen.getByRole("region", { name: "Passed · 1" })).toBeTruthy();
    expect(screen.getByLabelText("ClickHouse user")).toHaveProperty("value", "chouse_ceiling");
    expect(onCreated).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(api.createIdentity).toHaveBeenLastCalledWith({
      identityMode: "shared_ceiling",
      name: "prod-analytics",
      host: "ch-prod.internal",
      port: 8443,
      sslEnabled: false,
      username: "chouse_ceiling",
      password: "pw",
      database: "",
      systemRole: "chouse_system",
      accessContact: null,
      metadata: {},
    });
  });

  it("asks before closing a new connection with something typed, without offering to save", async () => {
    const user = userEvent.setup();
    const { onClose } = open(null);
    await user.type(screen.getByLabelText("Name"), "x");
    await user.click(screen.getByText("Close", { selector: "button" }));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes on the new connection" });
    expect(within(prompt).queryByRole("button", { name: "Save and go" })).toBeNull();
    await user.click(within(prompt).getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ConnectionPanel: Who can query for a super admin", () => {
  it("shows the role map of a role ceiling with the viewer's own role", async () => {
    api.roles.mockResolvedValue([{ id: "r-sa", name: "super_admin", displayName: "Super admin", description: null, isSystem: true, isDefault: false, priority: 0, permissions: [], dataAccessPolicyIds: [], userCount: 2 }]);
    open(CEILING, "who");

    expect(await screen.findByText("2 people can't query yet")).toBeTruthy();
    expect(screen.getByText(/including your own/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save mappings" })).toBeTruthy();
  });

  it("shows the person links of a personal connection nobody can query yet", async () => {
    open(PERSONAL, "who");

    expect(screen.getByText("Nobody can query this connection yet")).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Person links" })).toBeTruthy();
    expect(api.bindings).toHaveBeenCalledWith("conn-personal");
  });

  it("closes with Finish later", async () => {
    const user = userEvent.setup();
    const { onClose } = open(PERSONAL, "who");
    await user.click(screen.getByRole("button", { name: "Finish later" }));
    expect(onClose).toHaveBeenCalled();
  });
});
