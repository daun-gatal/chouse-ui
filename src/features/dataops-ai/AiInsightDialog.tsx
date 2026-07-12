import type { ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface AiInsightDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  loading?: boolean;
  error?: string | null;
  children?: ReactNode;
}

export function AiInsightDialog({ open, onOpenChange, title, description, loading = false, error, children }: AiInsightDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto rounded-xs border-ink-500 bg-ink-100">
        <DialogHeader>
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /><DialogTitle>{title}</DialogTitle></div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {loading && <div className="flex items-center gap-2 py-8 text-[12px] text-paper-muted"><Loader2 className="h-4 w-4 animate-spin" /> Investigating current evidence…</div>}
        {error && <p className="rounded-xs border border-red-500/30 bg-red-500/5 p-3 text-[11px] text-red-500">{error}</p>}
        {!loading && !error && children}
      </DialogContent>
    </Dialog>
  );
}
