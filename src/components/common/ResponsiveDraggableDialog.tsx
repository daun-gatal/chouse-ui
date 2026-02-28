/**
 * ResponsiveDraggableDialog
 *
 * A dialog wrapper that is viewport-friendly on tablet/mobile and draggable/resizable
 * on desktop (and optionally tablet). Integrates with user preferences to persist
 * position and size per device when dialogId is provided.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, useDragControls, type PanInfo } from "framer-motion";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useWindowSize } from "@/hooks/useWindowSize";
import { useDeviceType } from "@/hooks/useDeviceType";
import {
  getExplorerDialogPrefsFromWorkspace,
  mergeExplorerDialogPrefsIntoWorkspace,
  EXPLORER_DIALOG_DEFAULT_POSITION_AND_SIZE_BY_DEVICE,
  type WorkspacePreferencesMap,
} from "@/lib/devicePreferences";
import { rbacUserPreferencesApi } from "@/api/rbac";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const MIN_WIDTH = 400;
const MIN_HEIGHT = 360;

export interface ResponsiveDraggableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional stable id for persisting position/size (e.g. "createTable", "aiDebugger"). */
  dialogId?: string;
  /** Header content (title, badges). A drag handle is added automatically when draggable. */
  title?: React.ReactNode;
  /** Body content. */
  children: React.ReactNode;
  /** Optional footer (buttons). */
  footer?: React.ReactNode;
  /** Optional class for the inner content area. */
  contentClassName?: string;
  /** Optional class for the window chrome (border, bg, shadow, rounded). */
  windowClassName?: string;
  /** Optional class for the header wrapper. */
  headerClassName?: string;
  /** Optional class for the footer wrapper. */
  footerClassName?: string;
  /** Optional class for the close button. */
  closeButtonClassName?: string;
  /** Default width when no saved prefs (desktop/tablet). */
  defaultWidth?: number;
  /** Default height when no saved prefs (desktop/tablet). */
  defaultHeight?: number;
}

export function ResponsiveDraggableDialog({
  open,
  onOpenChange,
  dialogId,
  title,
  children,
  footer,
  contentClassName,
  windowClassName,
  headerClassName,
  footerClassName,
  closeButtonClassName,
  defaultWidth,
  defaultHeight,
}: ResponsiveDraggableDialogProps) {
  const { width: viewportWidth, height: viewportHeight } = useWindowSize();
  const deviceType = useDeviceType();

  const dragControls = useDragControls();
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const defaultSize = EXPLORER_DIALOG_DEFAULT_POSITION_AND_SIZE_BY_DEVICE[deviceType];
  const [windowSize, setWindowSize] = useState({
    width: defaultWidth ?? defaultSize.size.width,
    height: defaultHeight ?? defaultSize.size.height,
  });
  const windowSizeRef = useRef(windowSize);
  useEffect(() => {
    windowSizeRef.current = windowSize;
  }, [windowSize]);

  const [isResizing, setIsResizing] = useState(false);
  type ResizeHandle = "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  const resizeRef = useRef<{
    handle: ResizeHandle;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);
  const lastLoadedRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const maxWidth = Math.max(MIN_WIDTH, viewportWidth - 40);
  const maxHeight = Math.max(MIN_HEIGHT, viewportHeight - 40);

  const effectiveWidth = Math.min(Math.max(windowSize.width, MIN_WIDTH), maxWidth);
  const effectiveHeight = Math.min(Math.max(windowSize.height, MIN_HEIGHT), maxHeight);

  const savePrefsDebounced = useCallback(
    (pos: { x: number; y: number }, size: { width: number; height: number }) => {
      if (!dialogId) return;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          const current = await rbacUserPreferencesApi.getPreferences();
          const workspace = current.workspacePreferences as WorkspacePreferencesMap | undefined;
          const merged = mergeExplorerDialogPrefsIntoWorkspace(
            workspace,
            deviceType,
            dialogId,
            { position: pos, size }
          );
          await rbacUserPreferencesApi.updatePreferences({
            workspacePreferences: merged,
          });
        } catch (err) {
          console.error("[ResponsiveDraggableDialog] Failed to save preferences:", err);
        }
      }, 400);
    },
    [dialogId, deviceType]
  );

  // Load saved position/size when dialog opens (and when dialogId/deviceType apply)
  useEffect(() => {
    if (!open || !dialogId) return;
    const key = `${dialogId}-${deviceType}`;
    if (lastLoadedRef.current === key) return;

    const load = async () => {
      try {
        const prefs = await rbacUserPreferencesApi.getPreferences();
        const workspace = prefs.workspacePreferences as WorkspacePreferencesMap | undefined;
        const { position: loadedPos, size: loadedSize } = getExplorerDialogPrefsFromWorkspace(
          workspace,
          deviceType,
          dialogId
        );
        setPosition(loadedPos);
        if (loadedSize.width >= MIN_WIDTH && loadedSize.height >= MIN_HEIGHT) {
          setWindowSize({
            width: Math.min(loadedSize.width, maxWidth),
            height: Math.min(loadedSize.height, maxHeight),
          });
        }
        lastLoadedRef.current = key;
      } catch (err) {
        console.error("[ResponsiveDraggableDialog] Failed to load preferences:", err);
        lastLoadedRef.current = key;
      }
    };
    load();
  }, [open, dialogId, deviceType, maxWidth, maxHeight]);

  // Reset lastLoaded when dialog closes so next open re-loads
  useEffect(() => {
    if (!open) lastLoadedRef.current = null;
  }, [open]);

  const handleDragEnd = useCallback(
    (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const newPos = {
        x: position.x + info.offset.x,
        y: position.y + info.offset.y,
      };
      setPosition(newPos);
      savePrefsDebounced(newPos, windowSizeRef.current);
    },
    [position, savePrefsDebounced]
  );

  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerType === "touch") e.preventDefault();
      setIsResizing(true);
      resizeRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startW: effectiveWidth,
        startH: effectiveHeight,
        startPosX: position.x,
        startPosY: position.y,
      };
    },
    [effectiveWidth, effectiveHeight, position.x, position.y]
  );

  useEffect(() => {
    if (!isResizing) return;
    const handlePointerMove = (e: globalThis.PointerEvent) => {
      if (!resizeRef.current) return;
      if (e.pointerType === "touch") e.preventDefault();
      const { handle, startX, startY, startW, startH, startPosX, startPosY } = resizeRef.current;
      const left = handle === "left" || handle === "top-left" || handle === "bottom-left";
      const right = handle === "right" || handle === "top-right" || handle === "bottom-right";
      const top = handle === "top" || handle === "top-left" || handle === "top-right";
      const bottom = handle === "bottom" || handle === "bottom-left" || handle === "bottom-right";
      const dW = left ? startX - e.clientX : right ? e.clientX - startX : 0;
      const dH = top ? startY - e.clientY : bottom ? e.clientY - startY : 0;
      let newW = Math.min(Math.max(startW + dW, MIN_WIDTH), maxWidth);
      let newH = Math.min(Math.max(startH + dH, MIN_HEIGHT), maxHeight);
      let newX = startPosX;
      let newY = startPosY;
      if (left) newX = startPosX + (startW - newW);
      if (top) newY = startPosY + (startH - newH);
      setPosition({ x: newX, y: newY });
      setWindowSize({ width: newW, height: newH });
    };
    const handlePointerUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizing, maxWidth, maxHeight]);

  // Save position + size when resize ends
  const prevResizingRef = useRef(false);
  useEffect(() => {
    const wasResizing = prevResizingRef.current;
    prevResizingRef.current = isResizing;
    if (wasResizing && !isResizing && dialogId) {
      savePrefsDebounced(position, windowSizeRef.current);
    }
  }, [isResizing, dialogId, deviceType, position, savePrefsDebounced]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "fixed inset-0 z-50 left-0 top-0 w-full h-full max-w-none translate-x-0 translate-y-0",
          "gap-0 p-0 border-0 bg-transparent shadow-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "[&>button.absolute]:hidden"
        )}
        onPointerDownOutside={(e) => {
          e.preventDefault();
        }}
        onEscapeKeyDown={() => handleClose()}
      >
        {/* Full-viewport container; inner box is positioned/sized by state */}
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-0 pointer-events-none"
          aria-hidden
        >
            <motion.div
                  drag
                  dragControls={dragControls}
                  dragListener={false}
                  dragMomentum={false}
                  onDragEnd={handleDragEnd}
                  initial={false}
                  animate={{ x: position.x, y: position.y }}
                  style={{
                    position: "fixed",
                    left: 0,
                    top: 0,
                    width: effectiveWidth,
                    height: effectiveHeight,
                    touchAction: "none",
                  }}
                  className={cn(
                    "pointer-events-auto flex flex-col overflow-hidden",
                    windowClassName ?? "rounded-lg border border-border bg-background shadow-lg"
                  )}
                >
                  <div className="flex flex-col flex-1 relative min-h-0">
                    {!isResizing && (
                      <>
                        <div className="ai-chat-resize-corner-tl" style={{ touchAction: "none", zIndex: 70 }} onPointerDown={(e) => { if (e.pointerType === "touch") e.preventDefault(); handleResizeStart("top-left", e); }} aria-hidden />
                        <div className="ai-chat-resize-top" style={{ touchAction: "none", zIndex: 70 }} onPointerDown={(e) => { if (e.pointerType === "touch") e.preventDefault(); handleResizeStart("top", e); }} aria-hidden />
                        <div className="ai-chat-resize-corner-tr" style={{ touchAction: "none", zIndex: 70 }} onPointerDown={(e) => { if (e.pointerType === "touch") e.preventDefault(); handleResizeStart("top-right", e); }} aria-hidden />
                        <div className="ai-chat-resize-right" style={{ touchAction: "none", zIndex: 70 }} onPointerDown={(e) => { if (e.pointerType === "touch") e.preventDefault(); handleResizeStart("right", e); }} aria-hidden />
                        <div className="ai-chat-resize-corner-br" style={{ touchAction: "none", zIndex: 70 }} onPointerDown={(e) => { if (e.pointerType === "touch") e.preventDefault(); handleResizeStart("bottom-right", e); }} aria-hidden />
                        <div className="ai-chat-resize-bottom" style={{ touchAction: "none", zIndex: 70 }} onPointerDown={(e) => { if (e.pointerType === "touch") e.preventDefault(); handleResizeStart("bottom", e); }} aria-hidden />
                        <div className="ai-chat-resize-corner" style={{ touchAction: "none", zIndex: 70 }} onPointerDown={(e) => { if (e.pointerType === "touch") e.preventDefault(); handleResizeStart("bottom-left", e); }} aria-hidden />
                        <div className="ai-chat-resize-left" style={{ touchAction: "none", zIndex: 70 }} onPointerDown={(e) => { if (e.pointerType === "touch") e.preventDefault(); handleResizeStart("left", e); }} aria-hidden />
                      </>
                    )}
                    {isResizing && (
                      <div
                        className="fixed inset-0 z-[100] cursor-grabbing"
                        style={{ left: "-100vw", right: "-100vw", top: "-100vh", bottom: "-100vh" }}
                        aria-hidden
                      />
                    )}

                    {title != null && (
                      <div
                        className={cn(
                          "flex-shrink-0 flex items-center gap-1 px-4 py-3 border-b border-border bg-muted/30 z-10",
                          headerClassName,
                          !isResizing && "cursor-grab active:cursor-grabbing"
                        )}
                        style={!isResizing ? { touchAction: "none" } : undefined}
                        aria-label="Drag to move"
                        title={!isResizing ? "Drag to move" : undefined}
                        onPointerDown={
                          !isResizing
                            ? (e) => {
                                const target = e.target instanceof Element ? e.target : null;
                                if (target?.closest("button, [role=button], a, input, select, textarea, [role=combobox], [role=listbox]")) return;
                                if (e.pointerType === "touch") e.preventDefault();
                                dragControls.start(e);
                              }
                            : undefined
                        }
                      >
                        <div className="min-w-0 flex-1 flex items-center justify-start overflow-hidden">
                          {title}
                        </div>
                        <button
                          type="button"
                          onClick={handleClose}
                          className={cn("p-2 rounded-md hover:bg-muted transition-colors shrink-0", closeButtonClassName)}
                          aria-label="Close"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    )}
                    <div className={cn("flex-1 min-h-0 overflow-hidden flex flex-col min-w-0", contentClassName)}>{children}</div>
                    {footer != null && (
                      <div className={cn("flex-shrink-0 border-t border-border px-4 py-3 bg-muted/20", footerClassName)}>
                        {footer}
                      </div>
                    )}
                  </div>
                </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
