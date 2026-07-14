import { useLayoutEffect, useState, type JSX, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  hasActiveOnboardingSurfaces,
  prepareSurfacesForOnboarding,
  useOnboardingSurfaceDismissAction,
  waitForOnboardingSurfacesToSettle,
} from "@/lib/onboardingSurfaces";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./context-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "./dropdown-menu";
import { Popover, PopoverContent } from "./popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

interface CustomSurfaceProps {
  onDismiss: () => void;
}

interface PrepareOnMountProps {
  children: ReactNode;
}

function CustomSurface({ onDismiss }: CustomSurfaceProps): JSX.Element {
  useOnboardingSurfaceDismissAction(onDismiss);
  return <div>Custom window</div>;
}

function PrepareOnMount({ children }: PrepareOnMountProps): JSX.Element {
  useLayoutEffect(() => {
    prepareSurfacesForOnboarding();
  }, []);
  return <>{children}</>;
}

function StatefulDialog(): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Open window</DialogTitle>
        <DialogDescription>Temporary content</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

describe("onboarding surface preparation", () => {
  it("dismisses an open dialog before a guide starts", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Open window</DialogTitle>
          <DialogDescription>Temporary content</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(document.querySelector('[data-onboarding-surface="dialog"]')).not.toBeNull();
    expect(document.querySelector('[data-onboarding-surface-overlay="dialog"]')).not.toBeNull();
    act(() => prepareSurfacesForOnboarding());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables an open surface and settles it before the next animation frame", async () => {
    render(<StatefulDialog />);
    const surface = document.querySelector<HTMLElement>('[data-onboarding-surface="dialog"]');
    const overlay = document.querySelector<HTMLElement>('[data-onboarding-surface-overlay="dialog"]');
    expect(surface).not.toBeNull();
    expect(overlay).not.toBeNull();
    expect(hasActiveOnboardingSurfaces()).toBe(true);

    let activeOnNextFrame = Promise.resolve(true);
    await act(async () => {
      prepareSurfacesForOnboarding();
      expect(surface?.getAttribute("data-onboarding-surface-settling")).toBe("true");
      expect(surface?.style.getPropertyValue("animation")).toBe("none");
      expect(surface?.style.getPropertyValue("transition")).toBe("none");
      expect(overlay?.getAttribute("data-onboarding-surface-settling")).toBe("true");
      activeOnNextFrame = new Promise<boolean>((resolve) => {
        window.requestAnimationFrame(() => resolve(hasActiveOnboardingSurfaces()));
      });
      await Promise.resolve();
    });

    await waitForOnboardingSurfacesToSettle();
    expect(await activeOnNextFrame).toBe(false);
    expect(hasActiveOnboardingSurfaces()).toBe(false);
  });

  it("dismisses a surface mounted in the same commit as the guide", async () => {
    const onOpenChange = vi.fn();
    render(
      <PrepareOnMount>
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Open window</DialogTitle>
            <DialogDescription>Temporary content</DialogDescription>
          </DialogContent>
        </Dialog>
      </PrepareOnMount>,
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("dismisses an open popover before a guide starts", () => {
    const onOpenChange = vi.fn();
    render(
      <Popover open onOpenChange={onOpenChange}>
        <PopoverContent>Open panel</PopoverContent>
      </Popover>,
    );

    expect(document.querySelector('[data-onboarding-surface="popover"]')).not.toBeNull();
    act(() => prepareSurfacesForOnboarding());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("dismisses an open sheet before a guide starts", () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetTitle>Open sheet</SheetTitle>
          <SheetDescription>Temporary content</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expect(document.querySelector('[data-onboarding-surface="sheet"]')).not.toBeNull();
    expect(document.querySelector('[data-onboarding-surface-overlay="sheet"]')).not.toBeNull();
    act(() => prepareSurfacesForOnboarding());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("dismisses an open alert dialog before a guide starts", () => {
    const onOpenChange = vi.fn();
    render(
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm action</AlertDialogTitle>
          <AlertDialogDescription>Temporary content</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );

    expect(document.querySelector('[data-onboarding-surface="alert-dialog"]')).not.toBeNull();
    expect(document.querySelector('[data-onboarding-surface-overlay="alert-dialog"]')).not.toBeNull();
    act(() => prepareSurfacesForOnboarding());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("dismisses an open select before a guide starts", () => {
    const onOpenChange = vi.fn();
    const handleGlobalEscape = vi.fn();
    window.addEventListener("keydown", handleGlobalEscape);
    try {
      render(
        <Select open value="one" onOpenChange={onOpenChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
          </SelectContent>
        </Select>,
      );

      expect(document.querySelector('[data-onboarding-surface="select"]')).not.toBeNull();
      act(() => prepareSurfacesForOnboarding());
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(handleGlobalEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", handleGlobalEscape);
    }
  });

  it("dismisses an open dropdown menu before a guide starts", () => {
    const onOpenChange = vi.fn();
    render(
      <DropdownMenu open onOpenChange={onOpenChange}>
        <DropdownMenuContent>
          <DropdownMenuItem>Menu item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(document.querySelector('[data-onboarding-surface="dropdown-menu"]')).not.toBeNull();
    act(() => prepareSurfacesForOnboarding());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("dismisses an open context menu before a guide advances", async () => {
    const onOpenChange = vi.fn();
    render(
      <ContextMenu onOpenChange={onOpenChange}>
        <ContextMenuTrigger>Context target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Menu item</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Context target"), { clientX: 10, clientY: 10 });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(true));
    expect(document.querySelector('[data-onboarding-surface="context-menu"]')).not.toBeNull();

    act(() => prepareSurfacesForOnboarding());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("does not emit Escape for a closed menu surface", () => {
    const handleKeyDown = vi.fn();
    window.addEventListener("keydown", handleKeyDown);
    try {
      render(
        <DropdownMenu>
          <DropdownMenuContent>
            <DropdownMenuItem>Closed item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );

      act(() => prepareSurfacesForOnboarding());
      expect(handleKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", handleKeyDown);
    }
  });

  it("does not emit Escape for a closed select surface", () => {
    const handleKeyDown = vi.fn();
    window.addEventListener("keydown", handleKeyDown);
    try {
      render(
        <Select value="one">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
          </SelectContent>
        </Select>,
      );

      act(() => prepareSurfacesForOnboarding());
      expect(handleKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", handleKeyDown);
    }
  });

  it("bounds the surface barrier when a tagged surface cannot close", async () => {
    const stuckSurface = document.createElement("div");
    stuckSurface.setAttribute("data-onboarding-surface", "stuck-test-surface");
    stuckSurface.setAttribute("data-state", "open");
    document.body.appendChild(stuckSurface);
    vi.useFakeTimers();
    try {
      const barrier = waitForOnboardingSurfacesToSettle(40);
      await vi.advanceTimersByTimeAsync(40);
      await barrier;
    } finally {
      vi.useRealTimers();
      stuckSurface.remove();
    }
  });

  it("dismisses a custom window once across both prepare passes", async () => {
    const onDismiss = vi.fn();
    render(<CustomSurface onDismiss={onDismiss} />);

    await act(async () => {
      prepareSurfacesForOnboarding();
      await Promise.resolve();
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
