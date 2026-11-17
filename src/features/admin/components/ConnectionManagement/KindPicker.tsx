/**
 * The Kind dropdown of the ClickHouse login form: each kind with a one-line
 * description, and the kinds this viewer or this server cannot have locked
 * with the reason. The list opens in place, below the field, so it stays
 * inside the panel's scroll area.
 */

import { useId, useState, type KeyboardEvent, type ReactElement } from "react";
import { ChevronDown, Lock } from "lucide-react";

import { identityKindLabel, type KnownIdentityMode } from "@/api/connectionIdentity";
import { cn } from "@/lib/utils";
import { INPUT_CLASS } from "./formStyles";
import { KIND_OPTIONS } from "./loginForm";

interface KindPickerProps {
  value: KnownIdentityMode;
  /** The stored kind, named as "was …" once another one is chosen; null while creating. */
  storedLabel: string | null;
  /** Why each kind cannot be chosen, or null when it can. */
  lockOf: (kind: KnownIdentityMode) => string | null;
  onChange: (kind: KnownIdentityMode) => void;
  disabled?: boolean;
}

export function KindPicker({ value, storedLabel, lockOf, onChange, disabled }: KindPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const current = KIND_OPTIONS.find((option) => option.value === value);
  const changed = storedLabel !== null && storedLabel !== identityKindLabel(value);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape" && open) {
      // The panel's sheet closes on Escape too; this closes only the list.
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2" onKeyDown={onKeyDown}>
      <button
        type="button"
        id={`${listId}-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Kind: ${current?.label ?? value}`}
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
        className={cn(INPUT_CLASS, "flex w-full items-center justify-between gap-2 border px-3 text-left font-sans text-[13px] disabled:opacity-60", (open || changed) && "border-brand")}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-paper">{current?.label ?? value}</span>
          {changed && <span className="truncate text-[12px] text-paper-faint">was {storedLabel}</span>}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden />
      </button>
      {open && (
        <ul id={listId} role="listbox" aria-label="Kind" className="flex flex-col divide-y divide-ink-500 rounded-xs border border-ink-500 bg-ink-200">
          {KIND_OPTIONS.map((option) => {
            const lock = lockOf(option.value);
            const selected = option.value === value;
            return (
              <li key={option.value} role="option" aria-selected={selected} aria-disabled={lock !== null}>
                <button
                  type="button"
                  disabled={lock !== null}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left",
                    lock === null ? "hover:bg-ink-300" : "cursor-not-allowed",
                    selected && "bg-ink-300",
                  )}
                >
                  <span className={cn("flex items-center gap-1.5 text-[13px] font-medium", lock === null ? "text-paper" : "text-paper-muted")}>
                    {option.label}
                    {lock !== null && <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />}
                  </span>
                  <span className="text-[11px] leading-[1.45] text-paper-faint">{option.description}</span>
                  {lock !== null && <span className="text-[11px] leading-[1.45] text-amber-800 dark:text-amber-200">{lock}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
