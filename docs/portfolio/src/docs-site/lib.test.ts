import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHref, withBase } from "./lib";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveHref", () => {
  it("leaves links alone on the default root base", () => {
    vi.stubEnv("VITE_BASE_PATH", "");
    expect(resolveHref("/docs/mcp/")).toBe("/docs/mcp/");
    expect(resolveHref("/")).toBe("/");
  });

  it("prefixes root-absolute links with VITE_BASE_PATH", () => {
    vi.stubEnv("VITE_BASE_PATH", "/chouse-ui/");
    expect(resolveHref("/docs/mcp/")).toBe("/chouse-ui/docs/mcp/");
    expect(resolveHref("/")).toBe("/chouse-ui/");
  });

  it("does not prefix twice", () => {
    vi.stubEnv("VITE_BASE_PATH", "/chouse-ui/");
    expect(resolveHref(withBase("/docs/"))).toBe("/chouse-ui/docs/");
    expect(resolveHref("/chouse-ui")).toBe("/chouse-ui");
  });

  it("keeps anchors, full URLs, protocol-relative and missing links", () => {
    vi.stubEnv("VITE_BASE_PATH", "/chouse-ui/");
    expect(resolveHref("#faq")).toBe("#faq");
    expect(resolveHref("https://lab.chouse-ui.com")).toBe("https://lab.chouse-ui.com");
    expect(resolveHref("//cdn.example.com/x")).toBe("//cdn.example.com/x");
    expect(resolveHref(undefined)).toBeUndefined();
  });
});
