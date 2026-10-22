import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { CanvasItem } from "./DashboardCanvas";
import { DashboardCanvas, readingOrder } from "./DashboardCanvas";
import { readImport } from "./DashboardList";
import { HeadingPanelCard, TextPanelCard } from "./PanelCard";

afterEach(() => cleanup());

const noop = (): void => undefined;

describe("TextPanelCard", () => {
  it("renders Markdown, never raw HTML, and opens links in a new tab", () => {
    render(<TextPanelCard panel={{ id: "t1", kind: "text", title: "Runbook", markdown: "**Page** [on-call](https://oncall.example/x)\n\n<script>alert(1)</script><b>raw</b>", layout: { x: 0, y: 0, w: 6, h: 6 } }} editing={false} onEdit={noop} onRemove={noop} />);
    const panel = screen.getByTestId("text-panel");
    expect(panel.querySelector("strong")?.textContent).toBe("Page");
    expect(panel.querySelector("script")).toBeNull();
    expect(panel.querySelector("b")).toBeNull();
    const link = screen.getByRole("link", { name: "on-call" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("drops javascript: links", () => {
    render(<TextPanelCard panel={{ id: "t1", kind: "text", title: "", markdown: "[click](javascript:alert(1))", layout: { x: 0, y: 0, w: 6, h: 6 } }} editing={false} onEdit={noop} onRemove={noop} />);
    expect(screen.getByText("click").getAttribute("href") ?? "").not.toContain("javascript");
  });

  it("shows edit controls only while editing", () => {
    const panel = { id: "t1", kind: "text" as const, title: "", markdown: "x", layout: { x: 0, y: 0, w: 6, h: 6 } };
    const { rerender } = render(<TextPanelCard panel={panel} editing={false} onEdit={noop} onRemove={noop} />);
    expect(screen.queryByRole("button", { name: "Edit Text" })).toBeNull();
    rerender(<TextPanelCard panel={panel} editing onEdit={noop} onRemove={noop} />);
    expect(screen.getByRole("button", { name: "Edit Text" })).toBeTruthy();
  });
});

describe("HeadingPanelCard", () => {
  it("shows its title and description", () => {
    render(<HeadingPanelCard panel={{ id: "h1", kind: "heading", title: "Ingestion", description: "Rows arriving", layout: { x: 0, y: 0, w: 24, h: 2 } }} editing={false} onEdit={noop} onRemove={noop} />);
    expect(screen.getByRole("heading", { name: "Ingestion" })).toBeTruthy();
    expect(screen.getByText("Rows arriving")).toBeTruthy();
  });
});

describe("DashboardCanvas", () => {
  const items: CanvasItem[] = [
    { key: "b", panel: { id: "b", kind: "text", title: "B", markdown: "b", layout: { x: 12, y: 2, w: 12, h: 6 } } },
    { key: "a", panel: { id: "a", kind: "heading", title: "A", description: "", layout: { x: 0, y: 0, w: 24, h: 2 } } },
    { key: "c", panel: { id: "c", kind: "text", title: "C", markdown: "c", layout: { x: 0, y: 2, w: 12, h: 9 } } },
  ];

  it("orders panels top to bottom, then left to right", () => {
    expect(readingOrder(items).map((i) => i.key)).toEqual(["a", "c", "b"]);
  });

  it("stacks panels in reading order at their own height on a narrow screen", () => {
    // jsdom measures the container as 0 px wide: narrower than 768.
    render(<DashboardCanvas items={items} editing={false} onLayoutChange={noop} renderItem={(item, height) => <div data-testid="cell" data-height={height}>{item.key}</div>} />);
    expect(screen.getAllByTestId("cell").map((c) => [c.textContent, c.getAttribute("data-height")])).toEqual([["a", "72"], ["c", "352"], ["b", "232"]]);
  });
});

describe("readImport", () => {
  // jsdom's File has no text(); readImport only needs the name and the text.
  const file = (body: unknown): File => ({ name: "board.json", text: async () => (typeof body === "string" ? body : JSON.stringify(body)) }) as unknown as File;

  it("takes format 2 and format 1 exports as they are", async () => {
    expect(await readImport(file({ format: "chouse.dashboard/v2", id: null, dashboard: {} }))).toEqual({ kind: "chouse", body: { format: "chouse.dashboard/v2", id: null, dashboard: {} } });
    expect(await readImport(file({ format: "chouse.dashboard/v1", id: "x", dashboard: {} }))).toEqual({ kind: "chouse", body: { format: "chouse.dashboard/v1", id: "x", dashboard: {} } });
  });

  it("recognises a Grafana dashboard, bare or wrapped by the HTTP API", async () => {
    const grafana = { schemaVersion: 39, title: "G", panels: [] };
    expect(await readImport(file(grafana))).toEqual({ kind: "grafana", json: grafana });
    expect((await readImport(file({ dashboard: grafana, meta: {} }))).kind).toBe("grafana");
  });

  it("says why a file is not an export", async () => {
    await expect(readImport(file("nope"))).rejects.toThrow("board.json is not JSON");
    await expect(readImport(file([1]))).rejects.toThrow("board.json is not a CHouse dashboard export");
    await expect(readImport(file({ format: "grafana" }))).rejects.toThrow("board.json is not a CHouse dashboard export (format chouse.dashboard/v2 or chouse.dashboard/v1) or a Grafana dashboard");
  });
});
