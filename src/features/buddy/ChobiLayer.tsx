import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Branch as DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import { FocusScope } from "@radix-ui/react-focus-scope";

import { CHOBI_ROOT_ATTRIBUTE, FloatingLayerContext, LAYERS, escapeDeferredToChobi, isInsideChobi } from "@/lib/layers";

interface ChobiLayerProps {
  /** The panel is open: Chobi may hold focus and answers Escape. */
  open: boolean;
  /** Escape pressed while focus is in Chobi and nothing inside handled it. */
  onEscape: () => void;
  children: ReactNode;
}

const preventDefault = (event: Event): void => event.preventDefault();

/** The last open dialog on the page (Radix stacks them in DOM order), outside Chobi. */
function topmostDialog(): HTMLElement | null {
  const open = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'))
    .filter((dialog) => !isInsideChobi(dialog));
  return open[open.length - 1] ?? null;
}

/**
 * Chobi lives above every dialog without being part of one (ADR 0025 §6).
 * A modal Radix dialog normally treats anything outside it as "outside":
 *
 * - a click or focus there dismisses it — the root is a DismissableLayer
 *   Branch, which Radix counts as inside every layer;
 * - its focus trap pulls focus back — while the user works in Chobi a
 *   FocusScope is mounted, which pauses the trap below it until focus leaves;
 * - its scroll lock cancels wheel and touch moves at the document — they stop
 *   at Chobi's root, so Chobi's own lists still scroll;
 * - it hides the rest of the page from screen readers — Chobi takes the
 *   aria-hidden off itself again;
 * - Escape closes it — the shared Radix wrappers leave Escape typed in Chobi
 *   to Chobi (useLayerProps), and Chobi answers it here; a control inside
 *   Chobi that answers Escape itself stops its propagation.
 */
export function ChobiLayer({ open, onEscape, children }: ChobiLayerProps): React.JSX.Element | null {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [holdsFocus, setHoldsFocus] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const attach = useCallback((node: HTMLDivElement | null): void => {
    rootRef.current = node;
    setRoot(node);
  }, []);

  useEffect(() => {
    if (!root) return undefined;
    const stop = (event: Event): void => event.stopPropagation();
    root.addEventListener("wheel", stop, { passive: true });
    root.addEventListener("touchmove", stop, { passive: true });
    const reveal = (): void => {
      if (root.getAttribute("aria-hidden") === "true") root.removeAttribute("aria-hidden");
    };
    reveal();
    const observer = new MutationObserver(reveal);
    observer.observe(root, { attributes: true, attributeFilter: ["aria-hidden"] });
    return () => {
      root.removeEventListener("wheel", stop);
      root.removeEventListener("touchmove", stop);
      observer.disconnect();
    };
  }, [root]);

  // Opening takes focus (remembering where it was); focus moving elsewhere lets go.
  useEffect(() => {
    if (!open) {
      setHoldsFocus(false);
      const back = returnFocusRef.current;
      returnFocusRef.current = null;
      const active = document.activeElement;
      if (active !== document.body && !isInsideChobi(active)) return undefined;
      // A dialog opened while Chobi was up owns focus now; otherwise go back to where it was.
      const target = topmostDialog() ?? (back?.isConnected ? back : null);
      if (target) target.focus();
      else if (active instanceof HTMLElement) active.blur();
      return undefined;
    }
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && !isInsideChobi(active) ? active : null;
    setHoldsFocus(true);
    const onFocusIn = (event: FocusEvent): void => setHoldsFocus(isInsideChobi(event.target));
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      // Something inside Chobi that answers Escape itself stops it before it gets here.
      if (event.key !== "Escape" || !isInsideChobi(document.activeElement)) return;
      if (event.defaultPrevented && !escapeDeferredToChobi(event)) return;
      event.preventDefault();
      onEscape();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onEscape]);

  const content = (
    <FloatingLayerContext.Provider value={LAYERS.chobiPopover}>
      <DismissableLayerBranch
        ref={attach}
        {...{ [CHOBI_ROOT_ATTRIBUTE]: "" }}
        style={{ pointerEvents: "auto" }}
        onPointerDownCapture={open ? () => setHoldsFocus(true) : undefined}
      >
        {children}
      </DismissableLayerBranch>
      {open && holdsFocus && (
        <FocusScope asChild trapped={false} onMountAutoFocus={preventDefault} onUnmountAutoFocus={preventDefault}>
          <span hidden />
        </FocusScope>
      )}
    </FloatingLayerContext.Provider>
  );
  return typeof document === "undefined" ? null : createPortal(content, document.body);
}
