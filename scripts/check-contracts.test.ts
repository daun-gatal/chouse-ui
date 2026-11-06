// @vitest-environment node
// Filesystem checks only; no DOM, and jsdom would turn import.meta.url into an http: URL.
import { describe, expect, it } from "vitest";
import {
  checkContracts,
  containsIdentifier,
  extractCitations,
  extractLinks,
  extractTestTargets,
  isIgnored,
  isSourceFile,
  parseIgnore,
} from "./check-contracts";

describe("parseIgnore", () => {
  it("normalises prefixes and drops comments and blank lines", () => {
    const text = "# header\n\ne2e/\n./testbed\n/src/test/  # trailing comment\n";
    expect(parseIgnore(text)).toEqual(["e2e/", "testbed/", "src/test/"]);
  });
});

describe("isIgnored", () => {
  const ignore = ["e2e/", "src/test/"];

  it("matches a directory and everything below it", () => {
    expect(isIgnored("e2e", ignore)).toBe(true);
    expect(isIgnored("src/test/mocks", ignore)).toBe(true);
  });

  it("does not match a sibling that only shares a name prefix", () => {
    expect(isIgnored("src/testing", ignore)).toBe(false);
    expect(isIgnored("e2e-tools", ignore)).toBe(false);
  });
});

describe("isSourceFile", () => {
  it("accepts source files and rejects tests, declarations and non-code", () => {
    expect(isSourceFile("client.ts")).toBe(true);
    expect(isSourceFile("main.go")).toBe(true);
    expect(isSourceFile("client.test.ts")).toBe(false);
    expect(isSourceFile("client_test.go")).toBe(false);
    expect(isSourceFile("vite-env.d.ts")).toBe(false);
    expect(isSourceFile("README.md")).toBe(false);
    expect(isSourceFile("Makefile")).toBe(false);
  });
});

describe("extractLinks", () => {
  it("returns relative targets without anchors and skips URLs, absolute paths and code blocks", () => {
    const markdown = [
      "[child](./child/README.md) and [up](../README.md#section)",
      "[site](https://chouse-ui.com/docs/) [mail](mailto:a@b.c) [abs](/docs/x/) [anchor](#here)",
      "```md",
      "[example](./not-checked.md)",
      "```",
    ].join("\n");
    expect(extractLinks(markdown)).toEqual(["./child/README.md", "../README.md"]);
  });
});

describe("extractCitations", () => {
  it("parses symbol and bare citations but not markdown link text", () => {
    const markdown = [
      "- `[client.ts:ApiClient.request]` sends the request",
      "- see [../lib/log.ts] for logging",
      "- [store.ts](./store.ts) is a link, not a citation",
      "- [README.md:Overview] is not a citable file type",
    ].join("\n");
    expect(extractCitations(markdown)).toEqual([
      { path: "client.ts", symbol: "ApiClient.request" },
      { path: "../lib/log.ts", symbol: null },
    ]);
  });
});

describe("extractTestTargets", () => {
  it("collects vitest and bun test targets with their working directory", () => {
    const markdown = [
      "- Run: `bunx vitest run src/api src/lib`",
      "- Targeted: `cd packages/server && bun test src/middleware`",
      "- Full suite: `bunx vitest run`",
      "- Watch: `bunx vitest run src/hooks --reporter dot`",
    ].join("\n");
    expect(extractTestTargets(markdown)).toEqual([
      { cwd: "", target: "src/api" },
      { cwd: "", target: "src/lib" },
      { cwd: "packages/server", target: "src/middleware" },
      { cwd: "", target: "src/hooks" },
    ]);
  });
});

describe("containsIdentifier", () => {
  it("matches whole identifiers only, including $-prefixed ones", () => {
    const source = "export function runPanel() {}\nconst $store = 1;";
    expect(containsIdentifier(source, "runPanel")).toBe(true);
    expect(containsIdentifier(source, "run")).toBe(false);
    expect(containsIdentifier(source, "Panel")).toBe(false);
    expect(containsIdentifier(source, "$store")).toBe(true);
    expect(containsIdentifier(source, "store")).toBe(false);
  });
});

describe("checkContracts", () => {
  it("passes on the repository's own contracts", () => {
    expect(checkContracts()).toEqual([]);
  });
});
