import { describe, expect, it } from "vitest";

import { getPageTitle } from "./PageTitleUpdater";

describe("getPageTitle", () => {
  it.each([
    ["/preferences", "Preferences"],
    ["/ai", "AI Governance"],
    ["/ai/assistant/abc", "AI Governance"],
    ["/fleet", "Fleet"],
    ["/doctor/42", "Doctor"],
    ["/data/tables/db/t", "Data"],
    ["/monitoring/logs", "Monitoring"],
    ["/admin/users/edit/7", "Edit User"],
    ["/admin/roles", "Admin"],
  ])("titles %s as %s", (path, title) => {
    expect(getPageTitle(path)).toBe(`CHouse UI | ${title}`);
  });

  it("matches whole segments only", () => {
    expect(getPageTitle("/dataops")).toBe("CHouse UI | Home");
    expect(getPageTitle("/aim")).toBe("CHouse UI | Home");
  });

  it("falls back to Home", () => {
    expect(getPageTitle("/")).toBe("CHouse UI | Home");
  });
});
