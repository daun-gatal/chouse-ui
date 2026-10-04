import { describe, expect, it } from "vitest";
import { parseBlocks, parseFrontmatter, plainMarkdown, searchChunks, stripLeadingH1 } from "./content";
import { parseHeadings, resetHeadings } from "./lib";

describe("parseFrontmatter", () => {
  it("returns the body untouched when there is no frontmatter", () => {
    expect(parseFrontmatter("# Title\n\nBody")).toEqual({ facts: {}, body: "# Title\n\nBody" });
  });

  it("parses app, route, permissions and clickhouse", () => {
    const { facts, body } = parseFrontmatter(
      "---\napp: Data › Lineage\nroute: /data/lineage\npermissions: observe:view, data_health:view\nclickhouse: 23.8\n---\n# Lineage\n"
    );
    expect(facts).toEqual({
      app: "Data › Lineage",
      route: "/data/lineage",
      permissions: ["observe:view", "data_health:view"],
      clickhouse: "23.8",
    });
    expect(body).toBe("# Lineage\n");
  });

  it("accepts multi-segment permissions", () => {
    expect(parseFrontmatter("---\npermissions: query:history:view:all\n---\n").facts.permissions).toEqual([
      "query:history:view:all",
    ]);
  });

  it("rejects unknown keys, bad permissions and relative routes", () => {
    expect(() => parseFrontmatter("---\ntitle: Nope\n---\n")).toThrow(/Unknown frontmatter key "title"/);
    expect(() => parseFrontmatter("---\npermissions: Observe View\n---\n")).toThrow(/Bad permission/);
    expect(() => parseFrontmatter("---\nroute: data/lineage\n---\n")).toThrow(/route must start/);
    expect(() => parseFrontmatter("---\nnot a pair\n---\n")).toThrow(/Bad frontmatter line/);
  });
});

describe("stripLeadingH1", () => {
  it("drops the first H1 and the blank lines after it", () => {
    expect(stripLeadingH1("\n# Title\n\n## Section\ntext")).toBe("## Section\ntext");
  });

  it("leaves content without a leading H1 alone", () => {
    expect(stripLeadingH1("## Section\n")).toBe("## Section");
  });
});

describe("parseBlocks", () => {
  it("returns a single markdown block for plain content", () => {
    expect(parseBlocks("Hello\n\nWorld")).toEqual([{ kind: "markdown", text: "Hello\n\nWorld" }]);
  });

  it("splits out diagram markers", () => {
    expect(parseBlocks("Before\n{{diagram:architecture}}\nAfter")).toEqual([
      { kind: "markdown", text: "Before" },
      { kind: "diagram", name: "architecture" },
      { kind: "markdown", text: "After" },
    ]);
  });

  it("parses tabs, including code fences inside tabs", () => {
    const blocks = parseBlocks(
      ["Intro", ":::tabs", "", "@tab Docker", "```bash", "docker run x", "```", "@tab Helm", "```bash", "helm install x", "```", ":::", "Outro"].join("\n")
    );
    expect(blocks).toEqual([
      { kind: "markdown", text: "Intro" },
      {
        kind: "tabs",
        tabs: [
          { label: "Docker", markdown: "```bash\ndocker run x\n```" },
          { label: "Helm", markdown: "```bash\nhelm install x\n```" },
        ],
      },
      { kind: "markdown", text: "Outro" },
    ]);
  });

  it("ignores directive-looking lines inside code fences", () => {
    const text = "```text\n:::tabs\n{{diagram:architecture}}\n:::\n```";
    expect(parseBlocks(text)).toEqual([{ kind: "markdown", text }]);
  });

  it("rejects malformed tab blocks", () => {
    expect(() => parseBlocks(":::tabs\n@tab Only\nx\n:::")).toThrow(/at least two/);
    expect(() => parseBlocks(":::tabs\n@tab A\nx\n@tab B\ny")).toThrow(/Unclosed :::tabs/);
    expect(() => parseBlocks(":::tabs\nstray\n@tab A\n:::")).toThrow(/before the first @tab/);
    expect(() => parseBlocks(":::tabs\n@tab A\n:::tabs\n:::")).toThrow(/Nested/);
    expect(() => parseBlocks("```bash\nno end")).toThrow(/Unclosed code fence/);
  });

  it("plainMarkdown joins tab contents and drops diagrams", () => {
    const blocks = parseBlocks("A\n{{diagram:architecture}}\n:::tabs\n@tab X\n## In X\n@tab Y\nin y\n:::");
    expect(plainMarkdown(blocks)).toBe("A\n\n\n\n## In X\n\nin y");
  });
});

describe("searchChunks", () => {
  it("cuts one chunk per heading with anchors matching the rendered ids", () => {
    const markdown = "Intro **text** with [a link](/docs/mcp/).\n\n## Setup\nRun `chouse login`.\n\n### Setup\nAgain\n\n```bash\n## not a heading\n```";
    resetHeadings();
    const headings = parseHeadings(markdown);
    expect(searchChunks(markdown, headings)).toEqual([
      { anchor: "", heading: "", text: "Intro text with a link." },
      { anchor: "setup", heading: "Setup", text: "Run chouse login ." },
      { anchor: "setup-2", heading: "Setup", text: "Again not a heading" },
    ]);
  });

  it("skips an empty intro", () => {
    const markdown = "## Only\nbody";
    resetHeadings();
    expect(searchChunks(markdown, parseHeadings(markdown))).toEqual([{ anchor: "only", heading: "Only", text: "body" }]);
  });
});
