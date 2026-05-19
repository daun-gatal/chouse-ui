import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  totalRows: number;
  rowLabel?: string;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
}

export function PaginationBar({
  page,
  totalPages,
  startIndex,
  endIndex,
  totalRows,
  rowLabel = "rows",
  onPrev,
  onNext,
  onFirst,
  onLast,
}: PaginationBarProps) {
  const atStart = page === 0;
  const atEnd = page >= totalPages - 1;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-ink-500 bg-ink-200/50 px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
        {(startIndex + 1).toLocaleString()}–{endIndex.toLocaleString()} of{" "}
        {totalRows.toLocaleString()} {rowLabel}
      </span>

      <div className="flex items-center gap-1">
        <PageBtn onClick={onFirst} disabled={atStart} label="First page">
          <ChevronsLeft className="h-3.5 w-3.5" />
        </PageBtn>
        <PageBtn onClick={onPrev} disabled={atStart} label="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" />
        </PageBtn>
        <span className="px-2 font-mono text-[11px] text-paper">
          {(page + 1).toLocaleString()} / {totalPages.toLocaleString()}
        </span>
        <PageBtn onClick={onNext} disabled={atEnd} label="Next page">
          <ChevronRight className="h-3.5 w-3.5" />
        </PageBtn>
        <PageBtn onClick={onLast} disabled={atEnd} label="Last page">
          <ChevronsRight className="h-3.5 w-3.5" />
        </PageBtn>
      </div>
    </div>
  );
}

function PageBtn({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted transition-colors",
        disabled
          ? "cursor-not-allowed opacity-40"
          : "hover:border-ink-700 hover:bg-ink-300 hover:text-paper"
      )}
    >
      {children}
    </button>
  );
}
