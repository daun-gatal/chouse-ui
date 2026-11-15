import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import type {
  ConnectionIdentity,
  ConnectionIdentityDetail,
  IdentityChange,
  IdentityCheckResult,
  IdentityRecheckResult,
  IdentitySwitchResult,
} from "@/api/connectionIdentity";
import type { ClickHouseConnection, ConnectionPrivilegeReport } from "@/api/rbac";
import { IdentityPanel } from "./IdentityPanel";

const getIdentity = vi.fn<(id: string) => Promise<ConnectionIdentityDetail>>();
const checkIdentity = vi.fn<(id: string, change: IdentityChange) => Promise<IdentityCheckResult>>();
const switchIdentity = vi.fn<(id: string, change: IdentityChange) => Promise<IdentitySwitchResult>>();
const recheck = vi.fn<(id: string) => Promise<IdentityRecheckResult>>();
const setContact = vi.fn<(id: string, contact: string | null) => Promise<ConnectionIdentity>>();
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toast.success(...args),
    error: (...args: unknown[]) => toast.error(...args),
    warning: (...args: unknown[]) => toast.warning(...args),
  },
}));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/api/connectionIdentity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/connectionIdentity")>()),
  getConnectionIdentity: (id: string) => getIdentity(id),
  checkConnectionIdentity: (id: string, change: IdentityChange) => checkIdentity(id, change),
  switchConnectionIdentity: (id: string, change: IdentityChange) => switchIdentity(id, change),
  recheckConnectionIdentity: (id: string) => recheck(id),
  setConnectionAccessContact: (id: string, contact: string | null) => setContact(id, contact),
}));
// The editor has its own tests; here only whether the panel shows it.
vi.mock("./RoleMapEditor", () => ({
  RoleMapEditor: ({ connectionId }: { connectionId: string }): ReactElement => <div data-testid="role-map-editor">{connectionId}</div>,
}));

const CONNECTION: ClickHouseConnection = {
  id: "conn-1",
  name: "Production",
  host: "ch.internal",
  port: 8443,
  username: "chouse",
  database: null,
  isDefault: true,
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
};

const SHARED: ConnectionIdentityDetail = {
  identityMode: "shared",
  username: "chouse",
  systemRole: null,
  accessContact: null,
  health: null,
  healthReason: null,
  checkedAt: null,
  serverVersion: null,
  roleMap: [],
  setupStatements: ["CREATE ROLE chouse_system;", "CREATE USER <new_user> IDENTIFIED BY '...';"],
};

const CEILING: ConnectionIdentityDetail = {
  ...SHARED,
  identityMode: "shared_ceiling",
  username: "chouse_login",
  systemRole: "chouse_system",
  accessContact: "Ask #data-platform",
  health: "ok",
  checkedAt: 1_800_000_000_000,
  serverVersion: "24.8.1.1",
  roleMap: [{ roleId: "r-analyst", roleName: "analyst", clickhouseRole: "ch_analyst" }],
};

const PRIVILEGES: ConnectionPrivilegeReport = {
  ok: true,
  complete: true,
  kind: "shared_ceiling",
  username: "chouse_login",
  database: "default",
  missingCount: 0,
  optionalMissingCount: 0,
  features: [
    { id: "core", name: "Core", description: "Connect, explorer, SQL editor", required: true, status: "granted", missing: [], unavailable: [], errors: [], grants: [], source: "system_role" },
    { id: "data_editing", name: "Data editing", description: "Create and change tables", required: false, status: "granted", missing: [], unavailable: [], errors: [], grants: [], source: "mapped_role" },
  ],
  grantScript: "",
  optionalGrantScript: "",
};

const PASSING: IdentityCheckResult = {
  ok: true,
  reason: null,
  privileges: PRIVILEGES,
  verdict: {
    ok: true,
    reason: null,
    serverVersion: "24.8.1.1",
    checks: [
      { id: "version", label: "ClickHouse 24.4 or newer", ok: true, detail: "This server runs 24.8.1.1." },
      { id: "empty_login", label: "The login holds no grants", ok: true, detail: "chouse_login has no grants of its own." },
    ],
  },
};

const FAILING: IdentityCheckResult = {
  ok: false,
  reason: "chouse_login holds grants of its own.",
  verdict: {
    ok: false,
    reason: "chouse_login holds grants of its own.",
    serverVersion: "24.8.1.1",
    checks: [
      { id: "version", label: "ClickHouse 24.4 or newer", ok: true, detail: "This server runs 24.8.1.1." },
      { id: "empty_login", label: "The login holds no grants", ok: false, detail: "chouse_login holds SELECT ON *.*; revoke it." },
    ],
  },
};

function open(connection: ClickHouseConnection = CONNECTION): { onChanged: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(<IdentityPanel connection={connection} onClose={onClose} onChanged={onChanged} />);
  return { onChanged, onClose };
}

function field(label: string | RegExp): HTMLInputElement | HTMLTextAreaElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) throw new Error("not a field");
  return element;
}

/** Fills the form for a switch from the shared login to a role ceiling with a new user. */
async function enterCeilingLogin(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("radio", { name: /Role ceiling/ }));
  await user.clear(field("ClickHouse user"));
  await user.type(field("ClickHouse user"), "chouse_login");
  await user.type(field(/^Password/), "s3cret");
}

const CEILING_CHANGE: IdentityChange = {
  identityMode: "shared_ceiling",
  username: "chouse_login",
  password: "s3cret",
  systemRole: "chouse_system",
  accessContact: null,
};

beforeEach(() => {
  // jsdom has no ResizeObserver; the Radix radio and switch measure themselves with one.
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  getIdentity.mockResolvedValue(SHARED);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("IdentityPanel", () => {
  it("renders nothing without a connection", () => {
    render(<IdentityPanel connection={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getIdentity).not.toHaveBeenCalled();
  });

  it("shows a shared login in plain words, not checked yet", async () => {
    open();

    const now = await screen.findByRole("region", { name: "Now" });
    expect(getIdentity).toHaveBeenCalledWith("conn-1");
    expect(within(now).getByText("Shared login")).toBeTruthy();
    expect(within(now).getByText("chouse")).toBeTruthy();
    expect(within(now).getByText("Not checked yet")).toBeTruthy();
    expect(within(now).getByText("No check has run")).toBeTruthy();
    // Nothing of the role ceiling is shown until it is chosen.
    expect(screen.queryByTestId("role-map-editor")).toBeNull();
    expect(screen.queryByText(/CHouse never runs them/)).toBeNull();
    expect(screen.queryByLabelText("System role")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("shows a ready role ceiling with its roles, last check, role map and setup statements", async () => {
    getIdentity.mockResolvedValue(CEILING);
    open({ ...CONNECTION, identityMode: "shared_ceiling", username: "chouse_login" });

    const now = await screen.findByRole("region", { name: "Now" });
    expect(within(now).getByText("Role ceiling")).toBeTruthy();
    expect(within(now).getByText("chouse_login")).toBeTruthy();
    expect(within(now).getByText("chouse_system")).toBeTruthy();
    expect(within(now).getByText("Ready")).toBeTruthy();
    expect(within(now).getByText(/^Last checked .+ · ClickHouse 24\.8\.1\.1$/)).toBeTruthy();
    expect(field("System role").value).toBe("chouse_system");
    expect(field(/^Access contact/).value).toBe("Ask #data-platform");
    expect(screen.getByTestId("role-map-editor").textContent).toBe("conn-1");

    const admin = screen.getByRole("region", { name: "For the ClickHouse administrator" });
    expect(within(admin).getByText(/A ClickHouse administrator runs these in ClickHouse.*CHouse never runs them\./)).toBeTruthy();
    expect(within(admin).getByText(/CREATE ROLE chouse_system;/)).toBeTruthy();
    expect(within(admin).getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("copies the setup statements", async () => {
    getIdentity.mockResolvedValue(CEILING);
    const writeText = vi.fn(async () => {});
    open({ ...CONNECTION, identityMode: "shared_ceiling" });
    const admin = await screen.findByRole("region", { name: "For the ClickHouse administrator" });
    // After userEvent-free setup: the clipboard stub must be the one the button reads.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    within(admin).getByRole("button", { name: "Copy" }).click();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CEILING.setupStatements.join("\n")));
  });

  it("shows a failing login with its reason", async () => {
    getIdentity.mockResolvedValue({ ...CEILING, health: "failing", healthReason: "The role chouse_system no longer exists." });
    open({ ...CONNECTION, identityMode: "shared_ceiling" });

    const now = await screen.findByRole("region", { name: "Now" });
    expect(within(now).getByRole("alert").textContent).toBe("Failing: The role chouse_system no longer exists.");
  });

  it("says a kind this build does not know refuses requests until switched", async () => {
    getIdentity.mockResolvedValue({ ...SHARED, identityMode: "personal" });
    open({ ...CONNECTION, identityMode: "personal" });

    expect(await screen.findByText('This build does not know the kind "personal"')).toBeTruthy();
    expect(screen.getByText("The connection refuses every request until it is switched to a kind below.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Now" })).getByText("Unknown kind")).toBeTruthy();
    // The form falls back to a kind it can save.
    expect(screen.getByRole("radio", { name: /Shared login/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("explains each kind in the form", async () => {
    open();
    await screen.findByRole("region", { name: "Switch" });

    expect(screen.getByText("One ClickHouse user holds every grant, and everyone's statements run as it.")).toBeTruthy();
    expect(screen.getByText(/The ClickHouse user holds no grants; each statement names the ClickHouse role mapped to the person's CHouse role/)).toBeTruthy();
    expect(screen.getByText(/Shown to people when ClickHouse refuses them\./)).toBeTruthy();
    expect(field(/^Access contact/).getAttribute("maxlength")).toBe("500");
  });

  it("choosing role ceiling reveals the system role, the role map and the setup statements before any switch", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("region", { name: "Switch" });

    await user.click(screen.getByRole("radio", { name: /Role ceiling/ }));
    expect(field("System role").value).toBe("chouse_system");
    expect(screen.getByTestId("role-map-editor")).toBeTruthy();
    expect(screen.getByRole("region", { name: "For the ClickHouse administrator" })).toBeTruthy();
  });

  it("warns that the new user replaces the old one at once", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("region", { name: "Switch" });
    await enterCeilingLogin(user);

    const warning = screen.getByRole("note");
    expect(warning.textContent).toContain("Saving replaces the ClickHouse user at once");
    expect(warning.textContent).toContain("chouse_login replaces chouse for this connection as soon as you save.");
    expect(warning.textContent).toContain("chouse keeps working until then; ask the ClickHouse administrator to drop it afterwards.");
  });

  it("Check sends the form, saves nothing, and lists every check with its detail and the privilege report", async () => {
    const user = userEvent.setup();
    checkIdentity.mockResolvedValue(PASSING);
    const { onChanged } = open();
    await screen.findByRole("region", { name: "Switch" });
    await enterCeilingLogin(user);

    await user.click(screen.getByRole("button", { name: "Check" }));

    const result = await screen.findByRole("region", { name: "Checks on the entered login" });
    expect(checkIdentity).toHaveBeenCalledWith("conn-1", CEILING_CHANGE);
    expect(switchIdentity).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(within(result).getByRole("status").textContent).toBe("Every check passed. Nothing was saved.");
    expect(within(result).getByText("ClickHouse 24.4 or newer")).toBeTruthy();
    expect(within(result).getByText("This server runs 24.8.1.1.")).toBeTruthy();
    expect(within(result).getByText("chouse_login has no grants of its own.")).toBeTruthy();
    expect(within(result).getAllByText("Passed")).toHaveLength(2);
    // The existing privilege report, in its kind-aware wording.
    const report = within(result).getByRole("region", { name: "ClickHouse privileges" });
    expect(within(report).getByText("Checked on the system role.")).toBeTruthy();
    expect(within(report).getByText("From each person's ClickHouse role")).toBeTruthy();
  });

  it("Check shows which check failed and why", async () => {
    const user = userEvent.setup();
    checkIdentity.mockResolvedValue(FAILING);
    open();
    await screen.findByRole("region", { name: "Switch" });
    await enterCeilingLogin(user);

    await user.click(screen.getByRole("button", { name: "Check" }));

    const result = await screen.findByRole("region", { name: "Checks on the entered login" });
    expect(within(result).getByRole("alert").textContent).toBe("chouse_login holds grants of its own. Nothing was saved.");
    expect(within(result).getAllByText("Passed")).toHaveLength(1);
    expect(within(result).getAllByText("Failed")).toHaveLength(1);
    expect(within(result).getByText("chouse_login holds SELECT ON *.*; revoke it.")).toBeTruthy();
    expect(within(result).queryByRole("region", { name: "ClickHouse privileges" })).toBeNull();
  });

  it("clears a result once the form no longer matches it", async () => {
    const user = userEvent.setup();
    checkIdentity.mockResolvedValue(PASSING);
    open();
    await screen.findByRole("region", { name: "Switch" });
    await enterCeilingLogin(user);
    await user.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByRole("region", { name: "Checks on the entered login" });

    await user.type(field("ClickHouse user"), "2");
    expect(screen.queryByRole("region", { name: "Checks on the entered login" })).toBeNull();
  });

  it("asks before saving a switch, then stores it and refreshes the list", async () => {
    const user = userEvent.setup();
    const { setupStatements: _statements, ...stored } = CEILING;
    switchIdentity.mockResolvedValue({ identity: { ...stored, accessContact: null }, check: PASSING });
    // The read after the save sees what was stored.
    getIdentity.mockResolvedValueOnce(SHARED).mockResolvedValue({ ...CEILING, accessContact: null });
    const { onChanged } = open();
    await screen.findByRole("region", { name: "Switch" });
    await enterCeilingLogin(user);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(switchIdentity).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("dialog", { name: "Replace the ClickHouse user?" });
    expect(confirm.textContent).toContain("chouse_login replaces chouse for this connection at once, as role ceiling.");
    expect(confirm.textContent).toContain("The old user keeps working until then and should be dropped by the ClickHouse administrator afterwards.");

    await user.click(within(confirm).getByRole("button", { name: "Save and replace" }));

    await waitFor(() => expect(switchIdentity).toHaveBeenCalledWith("conn-1", CEILING_CHANGE));
    const result = await screen.findByRole("region", { name: "Checks on the saved login" });
    expect(within(result).getByRole("status").textContent).toBe("Saved. Every check passed.");
    expect(toast.success).toHaveBeenCalledWith("Login switched");
    expect(onChanged).toHaveBeenCalledTimes(1);
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("Role ceiling")).toBeTruthy();
    expect(within(now).getByText("Ready")).toBeTruthy();
    // The stored password does not stay in the form, and nothing is pending any more.
    expect(field(/^Password/).value).toBe("");
    expect(screen.queryByRole("note")).toBeNull();
    // The statements are read again: they follow the stored role names.
    await waitFor(() => expect(getIdentity).toHaveBeenCalledTimes(2));
  });

  it("cancelling the confirmation saves nothing", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("region", { name: "Switch" });
    await enterCeilingLogin(user);

    await user.click(screen.getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("dialog", { name: "Replace the ClickHouse user?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Replace the ClickHouse user?" })).toBeNull());
    expect(switchIdentity).not.toHaveBeenCalled();
    expect(field("ClickHouse user").value).toBe("chouse_login");
  });

  it("a refused save shows the server's reason and the failing checks, and changes nothing", async () => {
    const user = userEvent.setup();
    switchIdentity.mockRejectedValue(new ApiError("chouse_login holds grants of its own.", 422, "IDENTITY_CHECK_FAILED", "unknown", FAILING));
    const { onChanged } = open();
    await screen.findByRole("region", { name: "Switch" });
    await enterCeilingLogin(user);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Replace the ClickHouse user?" })).getByRole("button", { name: "Save and replace" }));

    const result = await screen.findByRole("region", { name: "Checks on the entered login" });
    expect(within(result).getByRole("alert").textContent).toBe("chouse_login holds grants of its own. Nothing was saved.");
    expect(within(result).getByText("chouse_login holds SELECT ON *.*; revoke it.")).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith("Can't save this login yet", { description: "chouse_login holds grants of its own." });
    expect(onChanged).not.toHaveBeenCalled();
    expect(within(screen.getByRole("region", { name: "Now" })).getByText("Shared login")).toBeTruthy();
    // What was typed stays, password included, so it can be fixed and sent again.
    expect(field(/^Password/).value).toBe("s3cret");
  });

  it("shows another save error as it is", async () => {
    const user = userEvent.setup();
    switchIdentity.mockRejectedValue(new ApiError("Connection refused", 502, "CONNECTION_TEST_FAILED"));
    open();
    await screen.findByRole("region", { name: "Switch" });
    await enterCeilingLogin(user);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Replace the ClickHouse user?" })).getByRole("button", { name: "Save and replace" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't save the login", { description: "Connection refused" }));
    expect(within(screen.getByRole("region", { name: "Switch" })).getByRole("alert").textContent).toBe("Connection refused");
    expect(screen.queryByRole("region", { name: "Checks on the entered login" })).toBeNull();
  });

  it("needs the password of a new user, and a user at all", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("region", { name: "Switch" });

    await user.clear(field("ClickHouse user"));
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByText("Enter the ClickHouse user.")).toBeTruthy();

    await user.type(field("ClickHouse user"), "other");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter the password of the new ClickHouse user.")).toBeTruthy();

    expect(checkIdentity).not.toHaveBeenCalled();
    expect(switchIdentity).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Replace the ClickHouse user?" })).toBeNull();
  });

  it("keeps the stored password when the user is unchanged, and saves without asking", async () => {
    const user = userEvent.setup();
    const { setupStatements: _statements, ...stored } = SHARED;
    switchIdentity.mockResolvedValue({ identity: { ...stored, accessContact: "Ask Dana" }, check: { ...PASSING, privileges: undefined } });
    open();
    await screen.findByRole("region", { name: "Switch" });

    expect(screen.getByText("(leave empty to keep)")).toBeTruthy();
    await user.type(field(/^Access contact/), "Ask Dana");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(switchIdentity).toHaveBeenCalledWith("conn-1", { identityMode: "shared", username: "chouse", systemRole: null, accessContact: "Ask Dana" }),
    );
    expect(screen.queryByRole("dialog", { name: "Replace the ClickHouse user?" })).toBeNull();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Login saved"));
  });

  it("sends host, port and TLS only when Change server is open", async () => {
    const user = userEvent.setup();
    checkIdentity.mockResolvedValue(FAILING);
    open();
    await screen.findByRole("region", { name: "Switch" });

    const disclosure = screen.getByRole("button", { name: /Change server/ });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.textContent).toContain("Stays ch.internal:8443 over TLS.");
    expect(screen.queryByLabelText("Host")).toBeNull();

    await user.click(disclosure);
    expect(field("Host").value).toBe("ch.internal");
    expect(field("Port").value).toBe("8443");
    await user.clear(field("Host"));
    await user.type(field("Host"), "ch2.internal");
    await user.clear(field("Port"));
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByText("Enter a port between 1 and 65535.")).toBeTruthy();
    expect(checkIdentity).not.toHaveBeenCalled();

    await user.type(field("Port"), "9440");
    await user.click(screen.getByRole("switch", { name: "SSL / TLS" }));
    await user.click(screen.getByRole("button", { name: "Check" }));

    await waitFor(() =>
      expect(checkIdentity).toHaveBeenCalledWith("conn-1", {
        identityMode: "shared",
        username: "chouse",
        systemRole: null,
        accessContact: null,
        host: "ch2.internal",
        port: 9440,
        sslEnabled: false,
      }),
    );
  });

  it("saves the access contact alone", async () => {
    const user = userEvent.setup();
    const { setupStatements: _statements, ...stored } = SHARED;
    setContact.mockResolvedValue({ ...stored, accessContact: "Ask Dana" });
    const { onChanged } = open();
    await screen.findByRole("region", { name: "Switch" });

    const button = screen.getByRole("button", { name: "Save contact only" });
    expect(button).toHaveProperty("disabled", true);
    await user.type(field(/^Access contact/), " Ask Dana ");
    await user.click(button);

    await waitFor(() => expect(setContact).toHaveBeenCalledWith("conn-1", "Ask Dana"));
    expect(await within(screen.getByRole("region", { name: "Now" })).findByText("Ask Dana")).toBeTruthy();
    expect(switchIdentity).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Access contact saved");
  });

  it("Check now runs the stored login's checks and updates the health line", async () => {
    const user = userEvent.setup();
    getIdentity.mockResolvedValue(CEILING);
    const { setupStatements: _statements, ...stored } = CEILING;
    recheck.mockResolvedValue({
      verdict: FAILING.verdict,
      identity: { ...stored, health: "failing", healthReason: "chouse_login holds grants of its own." },
    });
    const { onChanged } = open({ ...CONNECTION, identityMode: "shared_ceiling" });
    const now = await screen.findByRole("region", { name: "Now" });

    await user.click(within(now).getByRole("button", { name: "Check now" }));

    await waitFor(() => expect(recheck).toHaveBeenCalledWith("conn-1"));
    expect((await within(now).findByRole("alert")).textContent).toBe("Failing: chouse_login holds grants of its own.");
    const result = screen.getByRole("region", { name: "Checks on the stored login" });
    expect(within(result).getAllByText("Failed")).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith("The stored login is failing its checks", { description: "chouse_login holds grants of its own." });
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The statements read with the panel stay on screen.
    expect(screen.getByRole("region", { name: "For the ClickHouse administrator" })).toBeTruthy();
  });

  it("Check now with nothing to check shows no rows", async () => {
    const user = userEvent.setup();
    const { setupStatements: _statements, ...stored } = SHARED;
    recheck.mockResolvedValue({ verdict: null, identity: { ...stored, health: "ok", checkedAt: 1_800_000_000_000 } });
    open();
    const now = await screen.findByRole("region", { name: "Now" });

    await user.click(within(now).getByRole("button", { name: "Check now" }));

    expect(await within(now).findByText("Ready")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Checks on the stored login" })).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Checked the stored login");
  });

  it("offers to try again when the identity cannot be read", async () => {
    const user = userEvent.setup();
    getIdentity.mockRejectedValueOnce(new ApiError("Only a super admin can change how a connection reaches ClickHouse.", 403, "FORBIDDEN"));
    open();

    expect((await screen.findByRole("alert")).textContent).toContain("Only a super admin can change how a connection reaches ClickHouse.");
    expect(screen.queryByRole("region", { name: "Switch" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Switch" })).toBeTruthy();
  });
});
