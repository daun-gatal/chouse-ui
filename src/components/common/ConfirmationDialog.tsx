import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, AlertTriangle, CheckCircle, Info, Loader2 } from "lucide-react";
import DOMPurify from "dompurify";

type Variant = "danger" | "warning" | "info" | "success";

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: Variant;
  onConfirmAction?: () => void;
  isLoading?: boolean;
}

/**
 * Variant style table. Chip uses the shared `.status-*` utility classes from
 * index.css so light/dark mode flip is handled centrally — no per-variant
 * dark: pairings to maintain. Confirm button colours stay inline because they
 * carry intent (danger button needs to look dangerous in both modes).
 */
const variantStyles: Record<
  Variant,
  {
    icon: React.ReactNode;
    chipClass: string;
    confirmBtn: string;
  }
> = {
  danger: {
    icon: <AlertCircle className="h-4 w-4" aria-hidden />,
    chipClass: "status-danger",
    confirmBtn:
      "bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600",
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
    chipClass: "status-warn",
    confirmBtn:
      "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500",
  },
  info: {
    icon: <Info className="h-4 w-4" aria-hidden />,
    chipClass: "status-neutral",
    confirmBtn:
      "bg-brand text-ink-50 hover:bg-brand-soft",
  },
  success: {
    icon: <CheckCircle className="h-4 w-4" aria-hidden />,
    chipClass: "status-success",
    confirmBtn:
      "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
  },
};

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  isLoading = false,
}) => {
  const { icon, chipClass, confirmBtn } = variantStyles[variant];

  const renderDescription = () => {
    if (typeof description === 'string') {
      return (
        <div
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(description, {
              ALLOWED_TAGS: ['strong', 'em', 'b', 'i', 'u', 'code', 'pre', 'br', 'p'],
              ALLOWED_ATTR: [],
            }),
          }}
        />
      );
    }
    return description;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] rounded-xs border border-ink-500 bg-ink-100 text-paper">
        <DialogHeader className="space-y-3">
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className={`${chipClass} grid h-9 w-9 place-items-center !p-0`}>
              {icon}
            </span>
            <span className="text-[16px] font-semibold tracking-tight">{title}</span>
          </DialogTitle>
          <DialogDescription className="text-[13px] text-paper-muted" asChild>
            <div>{renderDescription()}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
            className="h-9 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
          >
            {cancelText}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLoading}
            aria-busy={isLoading}
            className={`h-9 gap-2 rounded-xs px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] ${confirmBtn}`}
          >
            {isLoading && <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmationDialog;

