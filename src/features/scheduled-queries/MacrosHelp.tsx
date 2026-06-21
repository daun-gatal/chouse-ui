/**
 * A reusable `i` info button that reveals the window-macro reference on click.
 * Used next to the "Read-only SELECT" label and in the expanded editor window.
 */

import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const code = "rounded-xs bg-ink-200 px-1 py-0.5 font-mono text-[10px] text-paper";

export function MacrosHelp({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Window macro reference"
          className={cn("grid h-5 w-5 place-items-center rounded-full text-paper-faint hover:text-paper", className)}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-80 rounded-xs border-ink-500 bg-ink-100 p-3 text-[11px] leading-relaxed text-paper-muted">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Window macros (UTC)</p>
        <p className="mt-2">
          The scheduler binds a fixed per-run window. Use these macros in your filter:
        </p>
        <ul className="mt-2 space-y-1.5">
          <li>
            <span className="text-paper">Base</span> — <code className={code}>{"{{slot_start}}"}</code> <code className={code}>{"{{slot_end}}"}</code> <code className={code}>{"{{prev_run_at}}"}</code>
          </li>
          <li>
            <span className="text-paper">Shift</span> — <code className={code}>{"{{slot_start - 1d}}"}</code> <code className={code}>{"{{slot_end + 2h}}"}</code>
            <br />units: <code className={code}>y mo w d h m s</code> (or full words)
          </li>
          <li>
            <span className="text-paper">Extract</span> — <code className={code}>{"{{slot_start | yyyymmdd}}"}</code> <code className={code}>{"{{slot_end | date}}"}</code>
            <br />fns: <code className={code}>date datetime year month day hour minute second yyyymm yyyymmdd start_of_day start_of_hour start_of_month start_of_week unix</code>
          </li>
          <li>
            <span className="text-paper">Combine</span> — <code className={code}>{"{{slot_end - 1mo | date}}"}</code>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
