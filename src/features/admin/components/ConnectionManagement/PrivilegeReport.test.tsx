import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectionPrivilegeReport, PrivilegeFeatureReport } from "@/api/rbac";
import { PrivilegeReport, privilegeSummary } from "./PrivilegeReport";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

function feature(overrides: Partial<PrivilegeFeatureReport>): PrivilegeFeatureReport {
  return { id: "core", name: "Core", description: "Connect, explorer, SQL editor", status: "granted", missing: [], unavailable: [], errors: [], grants: [], ...overrides };
}

const FAILING: ConnectionPrivilegeReport = {
  ok: false,
  username: "reader",
  database: "analytics",
  missingCount: 3,
  features: [
    feature({}),
    feature({
      id: "monitoring", name: "Monitoring and fleet", status: "missing", unavailable: ["system.crash_log"],
      missing: ["SELECT ON system.query_log", "SELECT ON system.metric_log"],
      grants: ["GRANT SELECT ON system.query_log TO reader;", "GRANT SELECT ON system.metric_log TO reader;"],
    }),
    feature({ id: "query_control", name: "Query control", description: "Kill running queries", status: "missing", missing: ["KILL QUERY ON *.*"], grants: ["GRANT KILL QUERY ON *.* TO reader;"] }),
  ],
  grantScript: "GRANT SELECT ON system.query_log TO reader;\nGRANT SELECT ON system.metric_log TO reader;\nGRANT KILL QUERY ON *.* TO reader;",
};

function mockClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

afterEach(() => {
  toastError.mockClear();
  vi.useRealTimers();
});

describe("privilegeSummary", () => {
  it("counts privileges and features", () => {
    expect(privilegeSummary(FAILING)).toBe("reader is missing 3 privileges across 2 features.");
    expect(privilegeSummary({ ...FAILING, missingCount: 1, features: [FAILING.features[2]] })).toBe("reader is missing 1 privilege across 1 feature.");
  });

  it("covers a passing report and checks that errored", () => {
    expect(privilegeSummary({ ...FAILING, ok: true, missingCount: 0, features: [feature({})], grantScript: "" })).toBe("reader has every privilege CHouse UI needs.");
    const errored = { ...FAILING, missingCount: 0, features: [feature({ status: "missing", errors: ["system.replicas: timeout"] })], grantScript: "" };
    expect(privilegeSummary(errored)).toBe("Some privileges for reader couldn't be checked. Check again.");
  });
});

describe("PrivilegeReport", () => {
  it("after a test, shows the gap and keeps failing features closed", () => {
    render(<PrivilegeReport report={FAILING} blocked={false} isEditing={false} version="26.5.7" latencyMs={42} />);

    expect(screen.getByText(/Connected to ClickHouse 26\.5\.7 in 42ms, but reader is missing 3 privileges across 2 features\./)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("system.crash_log not available on this server")).toBeTruthy();
    expect(screen.getByText("Granted")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Monitoring and fleet/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/GRANT SELECT ON system\.query_log/)).toBeNull();
  });

  it("when the save was refused, says so and opens every failing feature", () => {
    render(<PrivilegeReport report={FAILING} blocked isEditing={false} />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Can't create this connection yet")).toBeTruthy();
    expect(alert.textContent).toContain("Run the grants below as a ClickHouse admin, then save again.");
    expect(screen.getByText(/GRANT SELECT ON system\.query_log TO reader;\s+GRANT SELECT ON system\.metric_log TO reader;/)).toBeTruthy();
    expect(screen.getByText("GRANT KILL QUERY ON *.* TO reader;")).toBeTruthy();
  });

  it("uses edit wording when editing", () => {
    render(<PrivilegeReport report={FAILING} blocked isEditing />);
    expect(screen.getByText("Can't save these changes yet")).toBeTruthy();
  });

  it("toggles a feature open and closed", async () => {
    const user = userEvent.setup();
    render(<PrivilegeReport report={FAILING} blocked={false} isEditing={false} />);

    const row = screen.getByRole("button", { name: /Query control/ });
    await user.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("GRANT KILL QUERY ON *.* TO reader;")).toBeTruthy();
    await user.click(row);
    expect(screen.queryByText("GRANT KILL QUERY ON *.* TO reader;")).toBeNull();
  });

  it("copies one feature's grants or the whole script", async () => {
    const writeText = vi.fn(async () => {});
    mockClipboard(writeText);
    render(<PrivilegeReport report={FAILING} blocked isEditing={false} />);

    await act(async () => {
      screen.getAllByRole("button", { name: "Copy" })[1].click();
    });
    expect(writeText).toHaveBeenLastCalledWith("GRANT KILL QUERY ON *.* TO reader;");

    const all = screen.getByRole("button", { name: "Copy all grants" });
    await act(async () => {
      all.click();
    });
    expect(writeText).toHaveBeenLastCalledWith(FAILING.grantScript);
    expect(all.textContent).toContain("Copied");
  });

  it("goes back to the copy label after a moment", async () => {
    vi.useFakeTimers();
    mockClipboard(async () => {});
    render(<PrivilegeReport report={FAILING} blocked isEditing={false} />);
    const all = screen.getByRole("button", { name: "Copy all grants" });

    await act(async () => {
      all.click();
    });
    expect(all.textContent).toContain("Copied");
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(all.textContent).toContain("Copy all grants");
  });

  it("explains when the clipboard is blocked", async () => {
    mockClipboard(async () => {
      throw new Error("denied");
    });
    render(<PrivilegeReport report={FAILING} blocked isEditing={false} />);

    await act(async () => {
      screen.getByRole("button", { name: "Copy all grants" }).click();
    });
    expect(toastError).toHaveBeenCalledWith("Couldn't copy to the clipboard", { description: "Select the statements and copy them instead." });
  });

  it("shows checks that errored without a grant to copy", () => {
    const errored: ConnectionPrivilegeReport = {
      ...FAILING,
      missingCount: 0,
      features: [feature({ id: "monitoring", name: "Monitoring and fleet", status: "missing", errors: ["system.replicas: Timeout exceeded"] })],
      grantScript: "",
    };
    render(<PrivilegeReport report={errored} blocked isEditing={false} />);

    expect(screen.getByText("Not checked")).toBeTruthy();
    expect(screen.getByText("Couldn't check system.replicas: Timeout exceeded")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy all grants" })).toBeNull();
    expect(screen.getByRole("alert").textContent).not.toContain("Run the grants below");
  });

  it("says every feature is available when nothing is missing", () => {
    const ok: ConnectionPrivilegeReport = { ...FAILING, ok: true, missingCount: 0, features: [feature({})], grantScript: "" };
    render(<PrivilegeReport report={ok} blocked={false} isEditing={false} version="26.5.7" />);
    expect(screen.getByText(/Connected to ClickHouse 26\.5\.7\. Every feature is available\./)).toBeTruthy();
  });
});
