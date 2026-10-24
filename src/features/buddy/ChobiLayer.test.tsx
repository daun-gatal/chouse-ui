import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LAYERS } from "@/lib/layers";
import { ChobiLayer } from "./ChobiLayer";

function Page({ onEscape = vi.fn() }: { onEscape?: () => void }): React.JSX.Element {
  const [dialog, setDialog] = useState(true);
  const [chobi, setChobi] = useState(true);
  return (
    <>
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogTitle>Edit table</DialogTitle>
          <input aria-label="Table name" />
        </DialogContent>
      </Dialog>
      <ChobiLayer open={chobi} onEscape={() => { onEscape(); setChobi(false); }}>
        <div role="region" aria-label="Chobi">
          <textarea aria-label="Ask Chobi" />
          <DropdownMenu>
            <DropdownMenuTrigger>Model</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Fast</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ChobiLayer>
      <span data-testid="chobi-state">{chobi ? "open" : "closed"}</span>
    </>
  );
}

describe("ChobiLayer", () => {
  it("lets you click and type in Chobi without closing the dialog behind it", async () => {
    render(<Page />);
    const dialog = await screen.findByRole("dialog", { name: "Edit table" });
    const ask = screen.getByLabelText("Ask Chobi");

    fireEvent.pointerDown(ask);
    fireEvent.mouseDown(ask);
    act(() => ask.focus());
    fireEvent.pointerUp(ask);
    fireEvent.click(ask);

    expect(screen.getByRole("dialog", { name: "Edit table" })).toBe(dialog);
    await waitFor(() => expect(document.activeElement).toBe(ask));
  });

  it("answers Escape typed in Chobi itself, leaving the dialog open", async () => {
    const onEscape = vi.fn();
    render(<Page onEscape={onEscape} />);
    await screen.findByRole("dialog", { name: "Edit table" });
    const ask = screen.getByLabelText("Ask Chobi");
    fireEvent.pointerDown(ask);
    act(() => ask.focus());

    fireEvent.keyDown(ask, { key: "Escape" });

    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("chobi-state").textContent).toBe("closed");
    const dialog = screen.getByRole("dialog", { name: "Edit table" });
    // Focus goes back to the dialog, not to a hidden Chobi.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("leaves Escape in the dialog to the dialog", async () => {
    const onEscape = vi.fn();
    render(<Page onEscape={onEscape} />);
    const name = await screen.findByLabelText("Table name");
    act(() => name.focus());

    fireEvent.keyDown(name, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit table" })).toBeNull());
    expect(onEscape).not.toHaveBeenCalled();
    expect(screen.getByTestId("chobi-state").textContent).toBe("open");
  });

  it("stays visible to screen readers while a modal dialog hides the page", async () => {
    render(<Page />);
    await screen.findByRole("dialog", { name: "Edit table" });
    const root = document.querySelector("[data-chobi-root]");
    expect(root).not.toBeNull();
    await waitFor(() => expect(root?.getAttribute("aria-hidden")).toBeNull());
    expect(screen.getByRole("region", { name: "Chobi" })).not.toBeNull();

    // Whenever a modal hides the page again, Chobi takes it back.
    root?.setAttribute("aria-hidden", "true");
    await waitFor(() => expect(root?.getAttribute("aria-hidden")).toBeNull());
  });

  it("raises menus opened from Chobi above Chobi", async () => {
    render(<Page />);
    await screen.findByRole("dialog", { name: "Edit table" });
    const trigger = screen.getByRole("button", { name: "Model" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    const menu = await screen.findByRole("menu");
    expect(menu.style.zIndex).toBe(String(LAYERS.chobiPopover));
    // Opening the menu did not dismiss the dialog either.
    // (The open menu hides it from the accessibility tree, as any modal menu does.)
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("data-state")).toBe("open");
    expect(dialog?.textContent).toContain("Edit table");
  });
});
