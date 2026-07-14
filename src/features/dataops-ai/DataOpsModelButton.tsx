/**
 * DataOpsModelButton — minimal header control that scopes an AI model to the
 * DataOps page. Opens a dialog listing the active models plus a "System
 * default" row; the selection is persisted per user and consumed by every
 * DataOps AI feature via useDataOpsModelId.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Check, Loader2 } from "lucide-react";

import { fetchAiModels } from "@/api/ai";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { RBAC_PERMISSIONS, useDataOpsModelStore, useRbacStore } from "@/stores";

export function DataOpsModelButton(): React.ReactElement | null {
  const canUseAi = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE));
  const modelId = useDataOpsModelStore((s) => s.modelId);
  const setModelId = useDataOpsModelStore((s) => s.setModelId);
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["ai-models"],
    queryFn: fetchAiModels,
    enabled: canUseAi && (open || Boolean(modelId)),
    staleTime: 5 * 60_000,
  });

  if (!canUseAi) return null;

  const models = data ?? [];
  const selected = modelId ? models.find((m) => m.id === modelId) : undefined;
  // Stale ids (deleted/deactivated configs) present as "Default", matching
  // what useDataOpsModelId actually sends.
  const isDefaultSelected = !selected;

  const choose = (id: string | null): void => {
    setModelId(id);
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label="Choose AI model for DataOps"
        className="h-9 gap-2 rounded-xs px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-200 hover:text-paper"
      >
        <Bot className="h-3.5 w-3.5 text-brand" aria-hidden />
        <span className="max-w-[140px] truncate">{selected?.label ?? "Default"}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-xs border-ink-500 bg-ink-100">
          <DialogHeader>
            <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-brand" /><DialogTitle>AI model for DataOps</DialogTitle></div>
            <DialogDescription>Applies to all AI features on this page. Stored per user.</DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto" role="radiogroup" aria-label="AI model">
            <ModelRow
              title="System default"
              subtitle="Backend chooses the configured default model"
              selected={isDefaultSelected}
              onSelect={() => choose(null)}
            />

            {isLoading && (
              <div className="flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-200 p-3 text-[12px] text-paper-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading AI models…
              </div>
            )}

            {models.map((model) => (
              <ModelRow
                key={model.id}
                title={model.label}
                subtitle={`${model.provider || "AI provider"} · ${model.model}`}
                isDefault={model.isDefault}
                selected={model.id === modelId}
                onSelect={() => choose(model.id)}
              />
            ))}

            {!isLoading && models.length === 0 && (
              <p className="text-[11px] leading-relaxed text-paper-faint">
                {error instanceof Error && error.message
                  ? error.message
                  : "No AI models are configured. Add one in Admin → AI models."}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ModelRowProps {
  title: string;
  subtitle: string;
  selected: boolean;
  isDefault?: boolean;
  onSelect: () => void;
}

function ModelRow({ title, subtitle, selected, isDefault = false, onSelect }: ModelRowProps): React.ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xs border bg-ink-200 p-3 text-left transition-colors hover:bg-ink-300",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
        selected ? "border-brand" : "border-ink-500",
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[12px] font-medium text-paper">
          <span className="truncate">{title}</span>
          {isDefault && (
            <span className="rounded-xs border border-brand/30 bg-brand/10 px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-brand">
              Default
            </span>
          )}
        </span>
        <span className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim">{subtitle}</span>
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
    </button>
  );
}
