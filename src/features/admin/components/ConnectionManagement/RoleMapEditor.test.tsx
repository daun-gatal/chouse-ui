import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleMapEntry, RoleMapInput } from "@/api/connectionIdentity";
import type { RbacRole } from "@/api/rbac";
import { RoleMapEditor } from "./RoleMapEditor";

const listRoles = vi.fn<() => Promise<RbacRole[]>>();
const getRoleMap = vi.fn<(connectionId: string) => Promise<RoleMapEntry[]>>();
const setRoleMap = vi.fn<(connectionId: string, entries: RoleMapInput[]) => Promise<RoleMapEntry[]>>();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: (...args: unknown[]) => toastError(...args) },
}));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/api/rbac", () => ({ rbacRolesApi: { list: () => listRoles() } }));
vi.mock("@/api/connectionIdentity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/connectionIdentity")>()),
  getConnectionRoleMap: (connectionId: string) => getRoleMap(connectionId),
  setConnectionRoleMap: (connectionId: string, entries: RoleMapInput[]) => setRoleMap(connectionId, entries),
}));

function role(id: string, name: string, displayName: string): RbacRole {
  return { id, name, displayName, description: null, isSystem: false, isDefault: false, priority: 0, permissions: [], dataAccessPolicyIds: [] };
}

const ROLES = [role("r-admin", "super_admin", "Super Admin"), role("r-analyst", "analyst", "Analyst"), role("r-viewer", "viewer", "Viewer")];
const MAP: RoleMapEntry[] = [{ roleId: "r-analyst", roleName: "analyst", clickhouseRole: "ch_analyst" }];

function input(roleLabel: string): HTMLInputElement {
  const element = screen.getByLabelText(`ClickHouse role for ${roleLabel}`);
  if (!(element instanceof HTMLInputElement)) throw new Error("not an input");
  return element;
}

beforeEach(() => {
  listRoles.mockResolvedValue(ROLES);
  getRoleMap.mockResolvedValue(MAP);
  setRoleMap.mockImplementation(async (_id, entries) => entries.map((entry) => ({ ...entry, roleName: entry.roleId })));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RoleMapEditor", () => {
  it("shows one row per CHouse role with its mapped ClickHouse role, empty when not mapped", async () => {
    render(<RoleMapEditor connectionId="conn-1" />);

    expect(await screen.findByText("Analyst")).toBeTruthy();
    expect(getRoleMap).toHaveBeenCalledWith("conn-1");
    expect(input("Analyst").value).toBe("ch_analyst");
    expect(input("Super Admin").value).toBe("");
    expect(input("Viewer").value).toBe("");
    expect(input("Viewer").placeholder).toBe("Not mapped");
    expect(screen.getByText("2 roles are not mapped; their accounts are refused on this connection.")).toBeTruthy();
  });

  it("says what an unmapped role means and who can assign a mapped one", async () => {
    render(<RoleMapEditor connectionId="conn-1" />);
    await screen.findByText("Analyst");

    expect(screen.getByText(/An account whose role is not mapped is refused on this connection\./)).toBeTruthy();
    expect(screen.getByText(/Once a role is mapped, only a super admin can assign it to an account\./)).toBeTruthy();
  });

  it("keeps Save off until something changes", async () => {
    const user = userEvent.setup();
    render(<RoleMapEditor connectionId="conn-1" />);
    await screen.findByText("Analyst");

    const save = screen.getByRole("button", { name: "Save role map" });
    expect(save).toHaveProperty("disabled", true);
    await user.type(input("Viewer"), "ch_viewer");
    expect(save).toHaveProperty("disabled", false);
    await user.clear(input("Viewer"));
    expect(save).toHaveProperty("disabled", true);
  });

  it("refuses a name that is not letters, digits and underscores", async () => {
    const user = userEvent.setup();
    render(<RoleMapEditor connectionId="conn-1" />);
    await screen.findByText("Analyst");

    await user.type(input("Viewer"), "ch-viewer");
    expect(screen.getByText(/Use letters, digits and underscores/)).toBeTruthy();
    expect(input("Viewer").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("button", { name: "Save role map" })).toHaveProperty("disabled", true);

    await user.clear(input("Viewer"));
    await user.type(input("Viewer"), "2viewer");
    expect(screen.getByText(/Use letters, digits and underscores/)).toBeTruthy();

    await user.clear(input("Viewer"));
    await user.type(input("Viewer"), "ch_viewer");
    expect(screen.queryByText(/Use letters, digits and underscores/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save role map" })).toHaveProperty("disabled", false);
    expect(setRoleMap).not.toHaveBeenCalled();
  });

  it("saves the whole map, leaving out roles with an empty name and trimming the rest", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<RoleMapEditor connectionId="conn-1" onSaved={onSaved} />);
    await screen.findByText("Analyst");

    await user.type(input("Viewer"), " ch_viewer ");
    await user.click(screen.getByRole("button", { name: "Save role map" }));

    await waitFor(() => expect(setRoleMap).toHaveBeenCalledTimes(1));
    expect(setRoleMap).toHaveBeenCalledWith("conn-1", [
      { roleId: "r-analyst", clickhouseRole: "ch_analyst" },
      { roleId: "r-viewer", clickhouseRole: "ch_viewer" },
    ]);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith("Role map saved");
    expect(input("Viewer").value).toBe("ch_viewer");
    expect(screen.getByRole("button", { name: "Save role map" })).toHaveProperty("disabled", true);
  });

  it("unmaps a role when its name is cleared", async () => {
    const user = userEvent.setup();
    render(<RoleMapEditor connectionId="conn-1" />);
    await screen.findByText("Analyst");

    await user.clear(input("Analyst"));
    await user.click(screen.getByRole("button", { name: "Save role map" }));

    await waitFor(() => expect(setRoleMap).toHaveBeenCalledWith("conn-1", []));
    expect(await screen.findByText("3 roles are not mapped; their accounts are refused on this connection.")).toBeTruthy();
  });

  it("shows the server's message when the save is refused and keeps what was typed", async () => {
    const user = userEvent.setup();
    setRoleMap.mockRejectedValue(new Error("ch_viewer is not a role on this server."));
    const onSaved = vi.fn();
    render(<RoleMapEditor connectionId="conn-1" onSaved={onSaved} />);
    await screen.findByText("Analyst");

    await user.type(input("Viewer"), "ch_viewer");
    await user.click(screen.getByRole("button", { name: "Save role map" }));

    expect((await screen.findByRole("alert")).textContent).toBe("ch_viewer is not a role on this server.");
    expect(toastError).toHaveBeenCalledWith("Couldn't save the role map", { description: "ch_viewer is not a role on this server." });
    expect(onSaved).not.toHaveBeenCalled();
    expect(input("Viewer").value).toBe("ch_viewer");
    expect(screen.getByRole("button", { name: "Save role map" })).toHaveProperty("disabled", false);
  });

  it("offers to try again when loading fails", async () => {
    const user = userEvent.setup();
    getRoleMap.mockRejectedValueOnce(new Error("Only a super admin can change how a connection reaches ClickHouse."));
    render(<RoleMapEditor connectionId="conn-1" />);

    expect((await screen.findByRole("alert")).textContent).toContain("Only a super admin can change how a connection reaches ClickHouse.");
    expect(screen.queryByRole("button", { name: "Save role map" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Analyst")).toBeTruthy();
    expect(input("Analyst").value).toBe("ch_analyst");
  });

  it("says so when there are no roles", async () => {
    listRoles.mockResolvedValue([]);
    getRoleMap.mockResolvedValue([]);
    render(<RoleMapEditor connectionId="conn-1" />);

    expect(await screen.findByText("There are no CHouse roles to map.")).toBeTruthy();
  });
});
