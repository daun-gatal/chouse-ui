import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClickHouseConnection, UpdateConnectionInput } from "@/api/rbac";
import ConnectionManagement from "./index";

const listConnections = vi.fn<() => Promise<{ connections: ClickHouseConnection[]; total: number }>>();
const updateConnection = vi.fn<(id: string, input: UpdateConnectionInput) => Promise<ClickHouseConnection>>();
const access = { superAdmin: false };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/api/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/rbac")>()),
  rbacConnectionsApi: {
    list: () => listConnections(),
    update: (id: string, input: UpdateConnectionInput) => updateConnection(id, input),
  },
}));
vi.mock("@/stores", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/stores")>()),
  useRbacStore: () => ({ hasPermission: () => true, isSuperAdmin: () => access.superAdmin }),
}));
vi.mock("@/features/observe/ConnectionObservability", () => ({ ConnectionObservability: (): null => null }));
vi.mock("@/features/observe/CollectorSchedule", () => ({ CollectorSchedule: (): null => null }));
// The panel has its own tests; here only who can open it, and for which connection.
vi.mock("./IdentityPanel", () => ({
  IdentityPanel: ({ connection }: { connection: ClickHouseConnection | null }): ReactElement | null =>
    connection ? <div data-testid="identity-panel">{connection.name}</div> : null,
}));

function connection(overrides: Partial<ClickHouseConnection>): ClickHouseConnection {
  return {
    id: "conn-shared",
    name: "Staging",
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
    accessContact: null,
    identityHealth: null,
    identityHealthReason: null,
    identityCheckedAt: null,
    identityServerVersion: null,
    ...overrides,
  };
}

const SHARED = connection({});
const CEILING = connection({
  id: "conn-ceiling",
  name: "Production",
  username: "chouse_login",
  identityMode: "shared_ceiling",
  systemRole: "chouse_system",
  identityHealth: "failing",
  identityHealthReason: "The role chouse_system no longer exists.",
});
const UNKNOWN = connection({ id: "conn-unknown", name: "Lab", identityMode: "personal" });

function row(name: string): HTMLElement {
  const found = screen.getByText(name).closest("tr");
  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

/** The row's Edit action: an icon button whose only name is its tooltip. */
function editButton(name: string): HTMLElement {
  const button = row(name).querySelector(".lucide-pencil")?.closest("button");
  if (!button) throw new Error(`no edit button for ${name}`);
  return button;
}

/** A form field by name: the password's label points at a wrapper, not at the input. */
function input(dialog: HTMLElement, name: string): HTMLInputElement {
  const found = dialog.querySelector(`input[name="${name}"]`);
  if (!(found instanceof HTMLInputElement)) throw new Error(`no input named ${name}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  access.superAdmin = false;
  listConnections.mockResolvedValue({ connections: [SHARED, CEILING, UNKNOWN], total: 3 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ConnectionManagement: connection kinds", () => {
  it("badges a connection whose kind is not a shared login, and only those", async () => {
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    expect(within(row("Production")).getByText("Role ceiling")).toBeTruthy();
    expect(within(row("Lab")).getByText("Unknown kind")).toBeTruthy();
    expect(within(row("Staging")).queryByText("Shared login")).toBeNull();
    expect(within(row("Staging")).queryByText("Role ceiling")).toBeNull();
  });

  it("marks a login that is failing its checks, with the reason on hover", async () => {
    const user = userEvent.setup();
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    const marker = within(row("Production")).getByLabelText("ClickHouse login is failing its checks");
    expect(within(row("Staging")).queryByLabelText("ClickHouse login is failing its checks")).toBeNull();
    await user.hover(marker);
    expect((await screen.findAllByText("The role chouse_system no longer exists.")).length).toBeGreaterThan(0);
  });

  it("hides the ClickHouse login action from someone who is not a super admin", async () => {
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    expect(screen.queryByRole("button", { name: /^ClickHouse login of/ })).toBeNull();
    expect(screen.queryByTestId("identity-panel")).toBeNull();
  });

  it("lets a super admin open the ClickHouse login panel of a connection", async () => {
    const user = userEvent.setup();
    access.superAdmin = true;
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    expect(screen.getAllByRole("button", { name: /^ClickHouse login of/ })).toHaveLength(3);
    expect(screen.queryByTestId("identity-panel")).toBeNull();
    await user.click(screen.getByRole("button", { name: "ClickHouse login of Production" }));
    expect(screen.getByTestId("identity-panel").textContent).toBe("Production");
  });

  it("locks the login and server fields of a role-ceiling connection in the edit dialog and leaves them out of the save", async () => {
    const user = userEvent.setup();
    updateConnection.mockResolvedValue(CEILING);
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    await user.click(editButton("Production"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/This is a role ceiling connection: host, port, TLS, user and password are changed in its ClickHouse login panel, by a super admin\./)).toBeTruthy();
    for (const name of ["host", "port", "username", "password"]) {
      expect(input(dialog, name).disabled).toBe(true);
    }
    expect(within(dialog).getByRole("switch")).toHaveProperty("disabled", true);
    expect(within(dialog).getByLabelText("Connection name")).toHaveProperty("disabled", false);

    await user.clear(within(dialog).getByLabelText("Connection name"));
    await user.type(within(dialog).getByLabelText("Connection name"), "Production EU");
    await user.click(within(dialog).getByRole("button", { name: "Update" }));

    await waitFor(() => expect(updateConnection).toHaveBeenCalledTimes(1));
    expect(updateConnection).toHaveBeenCalledWith("conn-ceiling", { name: "Production EU", database: undefined, metadata: {} });
  });

  it("keeps the edit dialog of a shared login as it was", async () => {
    const user = userEvent.setup();
    updateConnection.mockResolvedValue(SHARED);
    render(<ConnectionManagement />);
    await screen.findByText("Staging");

    await user.click(editButton("Staging"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/changed in its ClickHouse login panel/)).toBeNull();
    for (const name of ["host", "port", "username", "password"]) {
      expect(input(dialog, name).disabled).toBe(false);
    }

    await user.click(within(dialog).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(updateConnection).toHaveBeenCalledTimes(1));
    expect(updateConnection).toHaveBeenCalledWith("conn-shared", {
      name: "Staging",
      database: undefined,
      metadata: {},
      host: "ch.internal",
      port: 8443,
      username: "chouse",
      sslEnabled: true,
    });
  });
});
