import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IncidentHeading } from "./IncidentHeading";

const SHORT = "Hourly join: 1 errors in the last 3 samples: Identifier 'q.hostname' cannot be…";
const FULL = "Hourly join: 1 errors in the last 3 samples: Identifier 'q.hostname' cannot be resolved from table with name q. In scope SELECT q.hostname AS hostname FROM system.query_log AS q";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IncidentHeading", () => {
  it("shows a short title with no toggle", () => {
    render(<IncidentHeading title="Kafka lag rising" fullTitle="Kafka lag rising" />);
    expect(screen.getByRole("heading").textContent).toBe("Kafka lag rising");
    expect(screen.getByRole("heading").classList.contains("line-clamp-3")).toBe(true);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows no toggle when the detail has no full title", () => {
    render(<IncidentHeading title="Disk full" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("expands a shortened title to the full text and collapses it again", () => {
    render(<IncidentHeading title={SHORT} fullTitle={FULL} />);
    const heading = screen.getByRole("heading");
    expect(heading.textContent).toBe(SHORT);
    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(heading.textContent).toBe(FULL);
    expect(heading.classList.contains("line-clamp-3")).toBe(false);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(heading.textContent).toBe(SHORT);
    expect(heading.classList.contains("line-clamp-3")).toBe(true);
  });

  it("offers Show more when the clamp hides text of an unshortened title", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(80);
    render(<IncidentHeading title="A title that wraps past three lines on a phone" fullTitle="A title that wraps past three lines on a phone" />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("heading").classList.contains("line-clamp-3")).toBe(false);
    expect(screen.getByRole("heading").textContent).toBe("A title that wraps past three lines on a phone");
  });
});
