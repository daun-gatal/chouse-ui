import * as React from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4 sm:gap-6 relative",
        month: "space-y-4",
        month_caption: "flex justify-center pt-1 relative items-center text-paper text-sm font-medium",
        dropdowns: "flex items-center gap-2",
        dropdown_root:
          "relative inline-flex items-center rounded-xs border border-ink-500 bg-ink-200 px-2 py-0.5 text-paper hover:border-ink-700 hover:bg-ink-300 cursor-pointer",
        // <select> sits invisibly on top of the visible caption_label so the
        // browser-native picker still works while we control the chrome.
        dropdown:
          "absolute inset-0 z-10 cursor-pointer appearance-none bg-transparent text-transparent opacity-0",
        caption_label:
          "inline-flex items-center gap-1 text-[12px] font-medium tracking-tight text-paper pointer-events-none",
        chevron: "ml-0.5 h-3 w-3 text-paper-dim shrink-0",
        nav: "absolute top-0 inset-x-0 flex items-center justify-between px-1 pointer-events-none z-10",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-6 w-6 p-0 pointer-events-auto rounded-xs border-ink-500 bg-ink-200 text-paper-muted hover:border-ink-700 hover:bg-ink-300 hover:text-paper"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-6 w-6 p-0 pointer-events-auto rounded-xs border-ink-500 bg-ink-200 text-paper-muted hover:border-ink-700 hover:bg-ink-300 hover:text-paper"
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday:
          "text-paper-faint rounded-md w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
        ),
        range_end: "day-range-end",
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "bg-accent text-accent-foreground",
        outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        disabled: "text-muted-foreground opacity-50",
        range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        // react-day-picker v9 uses a single Chevron component for both nav
        // buttons (left/right) and dropdown indicators (down/up).
        Chevron: ({ orientation }: { orientation?: "up" | "down" | "left" | "right" }) => {
          if (orientation === "right") return <ChevronRight className="h-4 w-4" />;
          if (orientation === "down") return <ChevronDown className="h-3 w-3" />;
          if (orientation === "up") return <ChevronUp className="h-3 w-3" />;
          return <ChevronLeft className="h-4 w-4" />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar"

export { Calendar }
