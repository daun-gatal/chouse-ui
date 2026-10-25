import { useEffect, useRef, useState, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The incident title, clamped to three lines. "Show more" appears when the
 * clamp hides text, or when the title is a shortened form of a longer one
 * (a whole ClickHouse error), and then shows the complete text.
 */
export function IncidentHeading({ title, fullTitle }: { title: string; fullTitle?: string }): ReactElement {
  const ref = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const shortened = Boolean(fullTitle) && fullTitle !== title;

  useEffect(() => {
    const heading = ref.current;
    if (!heading || expanded) return undefined;
    const measure = (): void => setClamped(heading.scrollHeight > heading.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(heading);
    return () => observer.disconnect();
  }, [title, expanded]);

  return (
    <div className="mt-1">
      <h2 ref={ref} className={cn("break-words text-[18px] font-semibold tracking-tight text-paper", expanded ? "whitespace-pre-line" : "line-clamp-3")}>
        {expanded && fullTitle ? fullTitle : title}
      </h2>
      {(expanded || clamped || shortened) && (
        <Button variant="link" aria-expanded={expanded} className="h-auto p-0 text-[11px] text-paper-muted hover:text-paper" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}
