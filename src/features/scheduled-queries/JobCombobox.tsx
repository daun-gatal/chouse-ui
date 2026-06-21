/**
 * Searchable job selector — type to filter scheduled queries by name (cmdk
 * combobox). Shared by the Runs and Lineage tabs so the job filter behaves
 * identically in both. House tokens only.
 */

import { useState } from "react";
import { ChevronsUpDown, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { ScheduledQuery } from "@/api/scheduledQueries";

interface JobComboboxProps {
  jobs: ScheduledQuery[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}

export function JobCombobox({ jobs, value, onChange, placeholder = "Select a job" }: JobComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = jobs.find((j) => j.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-56 justify-between rounded-xs border-ink-500 bg-ink-100 px-3 font-normal text-paper hover:border-ink-700 hover:bg-ink-200"
        >
          <span className="truncate">{selected ? selected.name : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-paper-faint" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 rounded-xs border-ink-500 bg-ink-100 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search jobs…" className="text-[12px]" />
          <CommandList>
            <CommandEmpty>No jobs found.</CommandEmpty>
            <CommandGroup>
              {jobs.map((j) => (
                <CommandItem
                  key={j.id}
                  value={`${j.name} ${j.id}`}
                  onSelect={() => { onChange(j.id); setOpen(false); }}
                  className="text-[12px]"
                >
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === j.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{j.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
