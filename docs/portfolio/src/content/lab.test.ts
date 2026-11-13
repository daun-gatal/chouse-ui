import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LAB_DEVCONTAINER_PATH, LAB_URL } from "./lab";

const ROOT = join(__dirname, "../../../..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("lab link", () => {
  it("points at a devcontainer that exists", () => {
    expect(existsSync(join(ROOT, LAB_DEVCONTAINER_PATH))).toBe(true);
    expect(new URL(LAB_URL).searchParams.get("devcontainer_path")).toBe(LAB_DEVCONTAINER_PATH);
  });

  it("is the link in the README badge and on the docs page", () => {
    expect(read("README.md")).toContain(LAB_URL);
    expect(read("docs/portfolio/src/content/docs/try-the-lab.md")).toContain(LAB_URL);
  });

  it("is the link the devcontainer documents", () => {
    expect(read(LAB_DEVCONTAINER_PATH)).toContain(LAB_URL.replace(encodeURIComponent(LAB_DEVCONTAINER_PATH), LAB_DEVCONTAINER_PATH));
  });
});
