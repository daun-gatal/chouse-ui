import React from "react";
import { Info, AlertTriangle, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Editorial info/warning dialog. Used by Fleet, Monitoring, and other pages
 * for the (i) button that explains what the page does. The chip + mono code
 * pattern matches the rest of the app so users see consistent dialog chrome
 * across the product.
 */
export default function InfoDialog({
  title,
  children,
  variant = "info",
  link,
  steps,
  isOpen,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  variant: "info" | "warning";
  link?: string;
  steps?: string[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const variantConfig = {
    info: {
      icon: <Info className="h-4 w-4" aria-hidden />,
      chipClass: "status-info",
      eyebrow: "Info",
    },
    warning: {
      icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
      chipClass: "status-warn",
      eyebrow: "Heads up",
    },
  } as const;

  const { icon, chipClass, eyebrow } = variantConfig[variant];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md rounded-xs border border-ink-500 bg-ink-100 text-paper">
        <DialogHeader className="space-y-3">
          <span className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
            <span className={cn(chipClass, "!px-1.5 !py-0.5")}>{eyebrow}</span>
            <span className="h-px w-6 bg-ink-700" aria-hidden />
          </span>
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className={`${chipClass} grid h-9 w-9 place-items-center !p-0`}>
              {icon}
            </span>
            <span className="text-[16px] font-semibold leading-tight tracking-tight">
              {title}
            </span>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-[13px] text-paper-muted">{children}</div>
          </DialogDescription>
        </DialogHeader>

        {steps && (
          <ol className="mt-2 ml-1 list-decimal space-y-2 pl-4 text-[13px] text-paper-muted marker:text-paper-faint">
            {steps.map((step, index) => (
              <li key={index} className="pl-1">
                {step}
              </li>
            ))}
          </ol>
        )}

        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:text-brand focus:outline-none focus-visible:text-brand"
          >
            Learn more
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </DialogContent>
    </Dialog>
  );
}
