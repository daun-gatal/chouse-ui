/**
 * MCP server status indicator for the dock (ADR 0013, ADR 0017).
 *
 * Shows whether the endpoint is on and, for people who can see AI Governance, opens
 * AI Governance › MCP where an administrator turns it on and picks the tools. The
 * item stays hidden until the backend reports the flag so older servers and
 * failed config fetches never render a misleading "disabled".
 */

import { memo } from "react";
import { useNavigate } from "react-router";
import { Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConfig } from "@/hooks";

interface McpStatusDockItemProps {
  side?: "top" | "right";
}

const TOOLTIP_CLASS =
  "z-[100] rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted shadow-lg";

export const McpStatusDockItem = memo(function McpStatusDockItem({
  side = "top",
}: McpStatusDockItemProps) {
  const { data } = useConfig();
  const navigate = useNavigate();
  const canOpen = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.AGENTS_VIEW));
  const mcpEnabled = data?.features?.mcpEnabled;

  if (typeof mcpEnabled !== "boolean") {
    return null;
  }

  const dotClass = mcpEnabled ? "bg-emerald-400" : "bg-paper-faint";
  const statusLabel = mcpEnabled
    ? "Enabled · PAT-only tool access"
    : "Disabled · turn on in AI Governance › MCP";

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`MCP server: ${mcpEnabled ? "enabled" : "disabled"}`}
            onClick={canOpen ? () => navigate("/ai/mcp") : undefined}
            className={cn(
              "relative grid h-8 w-8 place-items-center rounded-xs border border-ink-500 bg-ink-200 transition-colors hover:border-ink-700",
              !canOpen && "cursor-default"
            )}
          >
            <Puzzle className="h-3.5 w-3.5 text-paper-muted" aria-hidden />
            <span
              className={cn(
                "absolute -bottom-px -right-px h-2 w-2 rounded-full ring-2 ring-ink-100",
                dotClass
              )}
              aria-hidden
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={10} className={TOOLTIP_CLASS}>
          <div className="flex flex-col gap-0.5 normal-case tracking-normal">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              MCP server
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-paper">
              <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} aria-hidden />
              {statusLabel}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
