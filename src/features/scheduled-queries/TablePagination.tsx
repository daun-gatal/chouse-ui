/**
 * Pagination footer — page-size selector + "showing X–Y of Z" + page nav.
 * Mirrors the Admin → User management pagination controls and house tokens.
 */

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

interface TablePaginationProps {
  /** 1-based current page. */
  page: number;
  total: number;
  pageSize: number;
  rowLabel?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const navBtn =
  "h-8 w-8 rounded-xs border-ink-500 bg-ink-100 text-paper-muted hover:border-ink-700 hover:bg-ink-200 hover:text-paper";

export function TablePagination({ page, total, pageSize, rowLabel = "rows", onPageChange, onPageSizeChange }: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const go = (p: number) => onPageChange(Math.min(Math.max(1, p), totalPages));

  return (
    <div className="flex flex-col items-center justify-between gap-4 border-t border-ink-500 pt-4 sm:flex-row">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">
        <span>Show</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-[70px] rounded-xs border-ink-500 bg-ink-200 text-paper">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>per page</span>
      </div>

      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">
        {total === 0 ? "0" : `${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, total)}`} of {total} {rowLabel}
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className={navBtn} onClick={() => go(1)} disabled={safePage === 1}>
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className={navBtn} onClick={() => go(safePage - 1)} disabled={safePage === 1}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="px-2 font-mono text-[11px] text-paper">{safePage} / {totalPages}</span>
        <Button variant="outline" size="icon" className={navBtn} onClick={() => go(safePage + 1)} disabled={safePage >= totalPages}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className={navBtn} onClick={() => go(totalPages)} disabled={safePage >= totalPages}>
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
