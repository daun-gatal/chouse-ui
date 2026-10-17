/**
 * House-style classes for the chart and dashboard controls, so they read like
 * the rest of the app (square corners, small mono uppercase labels) instead of
 * the stock shadcn sizes.
 */

const LABEL_TEXT = "font-mono text-[11px] uppercase tracking-[0.14em]";

export const BTN_PRIMARY = `h-8 gap-1.5 rounded-xs bg-brand px-3 ${LABEL_TEXT} font-semibold text-ink-50 hover:bg-brand-soft disabled:opacity-50`;

export const BTN_OUTLINE = `h-8 gap-1.5 rounded-xs border-ink-500 bg-transparent px-3 ${LABEL_TEXT} text-paper-muted hover:bg-ink-200 hover:text-paper`;

export const BTN_GHOST = `h-8 gap-1.5 rounded-xs px-3 ${LABEL_TEXT} text-paper-muted hover:bg-ink-200 hover:text-paper`;

/** A compact outline button for inline actions, such as applying a lint fix. */
export const BTN_INLINE = "h-6 gap-1 rounded-xs border-ink-500 bg-transparent px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper";

export const BTN_ICON = "h-7 w-7 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper";

export const FIELD = "h-8 rounded-xs border-ink-500 bg-ink-100 text-[12px]";

export const TEXTAREA = "rounded-xs border-ink-500 bg-ink-100 text-[12px]";

export const FIELD_LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
