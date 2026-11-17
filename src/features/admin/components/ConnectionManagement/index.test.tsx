import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClickHouseConnection, UpdateConnectionInput } from "@/api/rbac";
import type { ConnectionPanelProps } from "./ConnectionPanel";
import ConnectionManagement from "./index";

const listConnections = vi.fn<() => Promise<{ connections: ClickHouseConnection[]; total: number }>>();
const updateConnection = vi.fn<(id: string, input: UpdateConnectionInput) => Promise<ClickHouseConnection>>();
const access = { canEdit: true };
/** The last props the panel got, so a test can play its callbacks. */
let panelProps: ConnectionPanelProps | null = null;

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
  useRbacStore: () => ({ hasPermission: (permission: string) => permission !== "connections:edit" || access.canEdit, isSuperAdmin: () => false }),
}));
vi.mock("@/features/observe/CollectorSchedule", () => ({ CollectorSchedule: (): null => null }));
// The panel has its own tests; here only which connection and tab it opens on.
vi.mock("./ConnectionPanel", () => ({
  ConnectionPanel: (props: ConnectionPanelProps): ReactElement => {
    panelProps = props;
    return <div data-testid="panel">{`${props.connection?.name ?? "new"} · ${props.initialTab}`}</div>;
  },
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
    impersonationRole: null,
    accessContact: null,
    identityHealth: null,
    identityHealthReason: null,
    identityCheckedAt: null,
    identityServerVersion: null,
    readiness: { state: "ready", policies: 2 },
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
  identityHealth: "ok",
  readiness: { state: "partial", policies: 1, roles: { total: 4, mapped: 2, peopleRefused: 3 } },
});
const FAILING = connection({
  id: "conn-failing",
  name: "Legacy",
  identityMode: "shared_ceiling",
  identityHealth: "failing",
  identityHealthReason: "The role chouse_system no longer exists.",
  readiness: { state: "refusing", policies: 0 },
});
const UNKNOWN = connection({ id: "conn-unknown", name: "Lab", identityMode: "per_statement", readiness: { state: "refusing", policies: 0 } });
const PERSONAL = connection({
  id: "conn-personal",
  name: "Warehouse",
  username: "chouse_personal",
  identityMode: "personal",
  systemRole: "chouse_system",
  identityHealth: "ok",
  readiness: { state: "partial", policies: 0, links: { active: 2, pending: 1, other: 0 } },
});
const SANDBOX = connection({ id: "conn-sandbox", name: "Sandbox", readiness: { state: "none", policies: 0 } });

function row(name: string): HTMLElement {
  const found = screen.getByText(name).closest("tr");
  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  access.canEdit = true;
  panelProps = null;
  listConnections.mockResolvedValue({ connections: [SHARED, CEILING, FAILING, UNKNOWN, PERSONAL, SANDBOX], total: 6 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ConnectionManagement: the list", () => {
  it("badges a connection whose kind is not a shared login, and only those", async () => {
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    expect(within(row("Production")).getByText("Role ceiling")).toBeTruthy();
    expect(within(row("Lab")).getByText("Unknown kind")).toBeTruthy();
    expect(within(row("Warehouse")).getByText("Personal")).toBeTruthy();
    expect(within(row("Staging")).queryByText("Shared login")).toBeNull();
  });

  it("shows who can query each connection", async () => {
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    expect(within(row("Staging")).getByRole("button", { name: "Who can query Staging: Ready" })).toBeTruthy();
    expect(within(row("Sandbox")).getByText("No access policy")).toBeTruthy();
    expect(within(row("Production")).getByText("2 of 4 roles mapped")).toBeTruthy();
    expect(within(row("Warehouse")).getByText("3 links · 1 waiting for GRANT")).toBeTruthy();
    // A refusing connection says so once, on its login pill.
    expect(within(row("Legacy")).queryByRole("button", { name: /^Who can query/ })).toBeNull();
  });

  it("shows the login's health on every kind but a shared login, with the reason of a failing one", async () => {
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    expect(within(row("Production")).getByText("Passes")).toBeTruthy();
    const failing = within(row("Legacy")).getByRole("button", { name: "ClickHouse login of Legacy: Refusing" });
    expect(failing.getAttribute("title")).toBe("The role chouse_system no longer exists.");
    expect(within(row("Lab")).getByText("Refusing")).toBeTruthy();
    expect(within(row("Staging")).queryByText("Passes")).toBeNull();
  });

  it("keeps the same four actions on every row, and no separate login or links actions", async () => {
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    for (const name of ["Staging", "Production", "Warehouse"]) {
      const actions = within(row(name));
      expect(actions.getByRole("button", { name: `Test ${name}` })).toBeTruthy();
      expect(actions.getByRole("button", { name: `Deactivate ${name}` })).toBeTruthy();
      expect(actions.getByRole("button", { name: `Edit ${name}` })).toBeTruthy();
      expect(actions.getByRole("button", { name: `Delete ${name}` })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /^ClickHouse login of Production/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Linked ClickHouse users of/ })).toBeNull();
  });
});

describe("ConnectionManagement: opening the panel", () => {
  it("opens Edit on General", async () => {
    const user = userEvent.setup();
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    await user.click(screen.getByRole("button", { name: "Edit Production" }));
    expect(screen.getByTestId("panel").textContent).toBe("Production · general");
  });

  it("opens the readiness pill on Who can query, and a failing login pill on ClickHouse login", async () => {
    const user = userEvent.setup();
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    await user.click(within(row("Warehouse")).getByRole("button", { name: /^Who can query Warehouse/ }));
    expect(screen.getByTestId("panel").textContent).toBe("Warehouse · who");
    await user.click(within(row("Legacy")).getByRole("button", { name: /^ClickHouse login of Legacy/ }));
    expect(screen.getByTestId("panel").textContent).toBe("Legacy · login");
  });

  it("does not make a passing login pill a button", async () => {
    render(<ConnectionManagement />);
    await screen.findByText("Production");
    expect(within(row("Production")).queryByRole("button", { name: /^ClickHouse login of/ })).toBeNull();
  });

  it("opens nothing from the pills for someone who cannot edit connections", async () => {
    access.canEdit = false;
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    expect(within(row("Staging")).queryByRole("button", { name: /^Who can query/ })).toBeNull();
    expect(within(row("Staging")).getByText("Ready")).toBeTruthy();
    expect(within(row("Legacy")).queryByRole("button", { name: /^ClickHouse login of/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
  });

  it("opens Add connection on a new connection, then on Who can query of the one Create made", async () => {
    const user = userEvent.setup();
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    await user.click(screen.getByRole("button", { name: "Add connection" }));
    expect(screen.getByTestId("panel").textContent).toBe("new · general");

    const made = connection({ id: "conn-new", name: "finance-ch", identityMode: "personal" });
    listConnections.mockResolvedValue({ connections: [SHARED, made], total: 2 });
    panelProps?.onCreated(made);

    await waitFor(() => expect(screen.getByTestId("panel").textContent).toBe("finance-ch · who"));
    await waitFor(() => expect(listConnections).toHaveBeenCalledTimes(2));
  });

  it("closes the panel", async () => {
    const user = userEvent.setup();
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    await user.click(screen.getByRole("button", { name: "Edit Staging" }));
    panelProps?.onClose();
    await waitFor(() => expect(screen.queryByTestId("panel")).toBeNull());
  });

  it("reloads the list for the panel without blanking the table", async () => {
    const user = userEvent.setup();
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    await user.click(screen.getByRole("button", { name: "Edit Staging" }));
    const renamed = { ...SHARED, name: "Staging EU" };
    listConnections.mockResolvedValue({ connections: [renamed], total: 1 });
    const reloaded = await panelProps?.onReload();

    expect(reloaded).toEqual([renamed]);
    expect(await screen.findByText("Staging EU")).toBeTruthy();
    expect(screen.getByTestId("panel").textContent).toBe("Staging EU · general");
  });

  it("toggles a connection on and off from its row", async () => {
    const user = userEvent.setup();
    updateConnection.mockResolvedValue(SHARED);
    render(<ConnectionManagement />);
    await screen.findByText("Production");

    await user.click(screen.getByRole("button", { name: "Deactivate Staging" }));
    await waitFor(() => expect(updateConnection).toHaveBeenCalledWith("conn-shared", { isActive: false }));
  });
});
