import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CHOBI_DRAG_TYPE, droppedContext, Launcher } from "./Launcher";

function transfer(entries: Record<string, string>): Pick<DataTransfer, "getData" | "types"> & { dropEffect: string } {
  return { types: Object.keys(entries), getData: (type: string) => entries[type] ?? "", dropEffect: "none" };
}

describe("droppedContext", () => {
  it("takes one of our items, or dragged text", () => {
    expect(droppedContext(transfer({ [CHOBI_DRAG_TYPE]: JSON.stringify({ name: "row.json", content: "{\"id\":1}" }), "text/plain": "ignored" }))).toEqual({ name: "row.json", content: "{\"id\":1}" });
    expect(droppedContext(transfer({ "text/plain": "  SELECT 1  " }))).toEqual({ name: "selection.txt", content: "SELECT 1" });
  });

  it("falls back to the text when an item is malformed, and ignores empty drops", () => {
    expect(droppedContext(transfer({ [CHOBI_DRAG_TYPE]: "{not json", "text/plain": "x" }))).toEqual({ name: "selection.txt", content: "x" });
    expect(droppedContext(transfer({ [CHOBI_DRAG_TYPE]: JSON.stringify({ name: 1 }) }))).toBeNull();
    expect(droppedContext(transfer({ "text/plain": "   " }))).toBeNull();
    expect(droppedContext(transfer({ "text/html": "<b>x</b>" }))).toBeNull();
  });
});

describe("Launcher", () => {
  const base = { mood: "idle" as const, plain: false, open: false, side: "right" as const, y: 0.5, mobile: false, pendingApprovals: 0, peek: null };

  it("asks about what is dropped on it", () => {
    const onDropContext = vi.fn();
    render(<Launcher {...base} onToggle={vi.fn()} onMove={vi.fn()} onDropContext={onDropContext} />);
    const target = screen.getByTestId("chobi-drop-target");
    const data = transfer({ "text/plain": "orders are late" });

    fireEvent.dragEnter(target, { dataTransfer: data });
    expect(screen.getByRole("status").textContent).toContain("Drop to ask me about it");
    fireEvent.dragOver(target, { dataTransfer: data });
    fireEvent.drop(target, { dataTransfer: data });

    expect(onDropContext).toHaveBeenCalledWith({ name: "selection.txt", content: "orders are late" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ignores drops while AI is unavailable", () => {
    const onDropContext = vi.fn();
    render(<Launcher {...base} unavailable="off" onToggle={vi.fn()} onMove={vi.fn()} onDropContext={onDropContext} />);
    fireEvent.drop(screen.getByTestId("chobi-drop-target"), { dataTransfer: transfer({ "text/plain": "x" }) });
    expect(onDropContext).not.toHaveBeenCalled();
  });

  it("toggles on a click but not after a drag, and snaps to the nearer side", () => {
    const onToggle = vi.fn();
    const onMove = vi.fn();
    render(<Launcher {...base} onToggle={onToggle} onMove={onMove} />);
    const button = screen.getByTestId("chobi-launcher");
    button.setPointerCapture = vi.fn();

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 1000, clientY: 400 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("left", 200 / window.innerHeight);
  });

  it("moves with Alt+arrows for keyboard users", () => {
    const onMove = vi.fn();
    render(<Launcher {...base} onToggle={vi.fn()} onMove={onMove} />);
    const button = screen.getByTestId("chobi-launcher");
    fireEvent.keyDown(button, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(button, { key: "ArrowUp", altKey: true });
    expect(onMove.mock.calls).toEqual([["left", 0.5], ["right", 0.45]]);
  });
});
