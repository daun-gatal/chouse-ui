/**
 * A house-styled multi-select form control — a dropdown of checkbox options with
 * the current selection shown as removable chips. Used for the notification
 * channels picker in the builder.
 */

import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: string;
}

export function MultiSelect({ options, selected, onChange, placeholder = "Select…", emptyText = "No options" }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  const selectedOptions = options.filter((o) => selected.includes(o.value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-9 w-full items-center justify-between gap-2 rounded-xs border border-ink-500 bg-ink-50 px-3 py-1.5 text-left text-[12px] text-paper hover:border-ink-700"
        >
          <span className="flex flex-1 flex-wrap gap-1">
            {selectedOptions.length === 0 ? (
              <span className="text-paper-faint">{placeholder}</span>
            ) : (
              selectedOptions.map((o) => (
                <Badge
                  key={o.value}
                  variant="outline"
                  className="rounded-xs border-ink-500 bg-ink-200 font-normal text-paper"
                >
                  {o.label}
                  <X
                    className="ml-1 h-3 w-3 cursor-pointer text-paper-faint hover:text-paper"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(o.value);
                    }}
                  />
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-paper-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] rounded-xs border-ink-500 bg-ink-100 p-1">
        {options.length === 0 ? (
          <p className="px-2 py-3 text-center text-[12px] text-paper-muted">{emptyText}</p>
        ) : (
          <ul className="max-h-60 overflow-y-auto">
            {options.map((o) => {
              const isSelected = selected.includes(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-[12px] text-paper hover:bg-ink-200"
                  >
                    <span className={cn("grid h-4 w-4 place-items-center rounded-xs border", isSelected ? "border-brand bg-brand text-ink-50" : "border-ink-500 bg-ink-200")}>
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1">{o.label}</span>
                    {o.hint && <span className="text-[10px] text-paper-faint">{o.hint}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
