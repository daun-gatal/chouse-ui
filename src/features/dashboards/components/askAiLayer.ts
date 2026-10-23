/**
 * Stacking for the full-screen Ask AI review. The app's dock (sidebar rail,
 * floating dock) sits at z-70/80, above ordinary dialogs (z-50), so the review
 * goes above it, and everything the review opens — details and refine sheets,
 * menus, popovers, confirmations, the model picker — goes above the review.
 */
export const REVIEW_LAYER = {
  overlay: "z-[90]",
  content: "z-[90]",
  nestedOverlay: "z-[95]",
  nested: "z-[100]",
} as const;

/** The model picker's dialog, over the review. */
export const PICKER_LAYER = { overlay: REVIEW_LAYER.nestedOverlay, content: REVIEW_LAYER.nested } as const;
