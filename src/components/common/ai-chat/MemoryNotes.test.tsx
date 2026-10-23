import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { MemoryNotes } from "./MemoryNotes";

describe("MemoryNotes", () => {
  it("shows what was kept and undoes a note", async () => {
    const deleted: string[] = [];
    server.use(http.delete("/api/ai-memories/:id", ({ params }) => {
      deleted.push(String(params.id));
      return HttpResponse.json({ success: true, data: { deleted: true } });
    }));
    render(<MemoryNotes notes={[
      { memoryId: "m1", scope: "user", status: "active", note: "Prefers UTC" },
      { memoryId: "m2", scope: "connection", status: "proposed", note: "events.ts is UTC" },
    ]} />);
    expect(screen.getByText("Saved to your memory")).not.toBeNull();
    expect(screen.getByText("Proposed as team memory")).not.toBeNull();
    expect(screen.getByText(/an admin reviews it first/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo “Prefers UTC”" }));
    await waitFor(() => expect(deleted).toEqual(["m1"]));
    expect(await screen.findByText("Removed")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Undo “Prefers UTC”" })).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw “events.ts is UTC”" })).not.toBeNull();
  });

  it("keeps the note when undo fails", async () => {
    server.use(http.delete("/api/ai-memories/:id", () => HttpResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Memory not found", category: "validation" } }, { status: 404 })));
    render(<MemoryNotes notes={[{ memoryId: "m1", scope: "user", status: "active", note: "Prefers UTC" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo “Prefers UTC”" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Undo “Prefers UTC”" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText("Removed")).toBeNull();
  });

  it("renders nothing without notes", () => {
    const { container } = render(<MemoryNotes notes={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
