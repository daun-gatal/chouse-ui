import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type CalloutVariant = "note" | "warning" | "tip";

const STYLES: Record<CalloutVariant, { box: string; label: string }> = {
  note: { box: "border-ink-500 bg-ink-100", label: "text-paper-dim" },
  tip: { box: "border-ink-600 bg-ink-100", label: "text-accent" },
  warning: { box: "border-accent/40 bg-accent/[0.06]", label: "text-accent" },
};

/**
 * Editorial callout card. Content convention in markdown:
 *   > **Note:** …   → note (default)
 *   > **Tip:** …    → tip
 *   > **Warning:** …→ warning (accent tint)
 */
export function Callout({ variant, children }: { variant: CalloutVariant; children: ReactNode }) {
  return (
    <div
      className={cn(
        "mt-6 rounded-md border px-4 py-3.5 text-[14px] leading-relaxed text-paper-muted",
        "[&_a]:text-paper [&_strong]:font-semibold [&_code]:bg-ink-200",
        variant === "warning" && "[&_strong]:text-accent [&_code]:border-accent/30",
        variant === "tip" && "[&_strong]:text-accent",
        variant === "note" && "[&_strong]:text-paper",
        STYLES[variant].box
      )}
    >
      {children}
    </div>
  );
}
