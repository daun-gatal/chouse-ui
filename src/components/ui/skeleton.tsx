import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xs bg-ink-200 motion-safe:animate-pulse", className)}
      aria-hidden
      {...props}
    />
  );
}

export { Skeleton };
