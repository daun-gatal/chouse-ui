import { forwardRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Editorial layout primitives — keep visual language consistent across sections.
 * No background decor, no shadow. Compose with explicit borders/spacing.
 */

type DivProps = HTMLAttributes<HTMLDivElement>;
type SectionProps = HTMLAttributes<HTMLElement> & {
  bordered?: boolean;
  dense?: boolean;
};

export const Section = forwardRef<HTMLElement, SectionProps>(
  ({ className, bordered = true, dense = false, ...props }, ref) => (
    <section
      ref={ref}
      className={cn(
        "relative w-full",
        dense ? "py-16 md:py-20" : "py-24 md:py-section",
        bordered && "border-b border-ink-500",
        className
      )}
      {...props}
    />
  )
);
Section.displayName = "Section";

export const Container = forwardRef<HTMLDivElement, DivProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("container-editorial", className)}
      {...props}
    />
  )
);
Container.displayName = "Container";

interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  index?: string | number;
  children: ReactNode;
}

export function Eyebrow({ index, children, className, ...props }: EyebrowProps) {
  return (
    <span className={cn("label-mono inline-flex items-center gap-3", className)} {...props}>
      {index !== undefined && (
        <span className="text-paper-faint">{String(index).padStart(2, "0")}</span>
      )}
      <span className="h-px w-6 bg-ink-700" aria-hidden />
      <span>{children}</span>
    </span>
  );
}

interface SectionHeaderProps {
  eyebrow?: ReactNode;
  eyebrowIndex?: string | number;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
  action?: ReactNode;
}

export function SectionHeader({
  eyebrow,
  eyebrowIndex,
  title,
  description,
  align = "left",
  className,
  action,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-6",
        align === "center" && "items-center text-center",
        className
      )}
    >
      <div className={cn(
        "flex w-full items-end gap-8",
        align === "center" ? "justify-center" : "justify-between"
      )}>
        <div className={cn("flex flex-col gap-4", align === "center" && "items-center text-center")}>
          {eyebrow && <Eyebrow index={eyebrowIndex}>{eyebrow}</Eyebrow>}
          <h2 className="text-display-lg font-semibold text-paper text-balance">{title}</h2>
        </div>
        {action && align !== "center" && <div className="hidden md:flex shrink-0">{action}</div>}
      </div>
      {description && (
        <p
          className={cn(
            "max-w-2xl text-lg leading-relaxed text-paper-muted",
            align === "center" && "mx-auto"
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}

interface PrimaryLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
}

export function PrimaryAction({ className, children, ...props }: PrimaryLinkProps) {
  return (
    <a
      className={cn(
        "group inline-flex h-11 items-center gap-3 rounded-xs bg-accent px-5 text-sm font-semibold tracking-tight text-ink-50",
        "transition-[transform,background-color] duration-200 hover:bg-accent-soft hover:-translate-y-px",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        className
      )}
      {...props}
    >
      {children}
    </a>
  );
}

export function SecondaryAction({ className, children, ...props }: PrimaryLinkProps) {
  return (
    <a
      className={cn(
        "group inline-flex h-11 items-center gap-3 rounded-xs border border-ink-500 bg-transparent px-5 text-sm font-semibold tracking-tight text-paper",
        "transition-colors duration-200 hover:border-ink-700 hover:bg-ink-100",
        className
      )}
      {...props}
    >
      {children}
    </a>
  );
}

/**
 * Editorial card — hairline border, no glow/blur. Use as base surface for content blocks.
 */
export const Card = forwardRef<HTMLDivElement, DivProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-ink-500 bg-ink-100",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showCopy?: boolean;
  className?: string;
  maxHeight?: string;
}

export function CodeBlock({
  code,
  language = "bash",
  filename,
  showCopy = true,
  className,
  maxHeight,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className={cn("group/code overflow-hidden rounded-md border border-ink-500 bg-ink-100", className)}>
      <div className="flex items-center justify-between border-b border-ink-500 bg-ink-200 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted">
          {filename ?? language}
        </span>
        {showCopy && (
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-xs px-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper"
            aria-label="Copy code"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-accent" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        )}
      </div>
      <pre
        className="m-0 overflow-x-auto px-5 py-5 font-mono text-[12.5px] leading-relaxed text-paper-muted"
        style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "accent" | "muted";
  children: ReactNode;
}

export function Tag({ variant = "default", className, children, ...props }: TagProps) {
  const styles = {
    default: "border-ink-500 text-paper-muted",
    accent: "border-accent/40 text-accent",
    muted: "border-ink-500 text-paper-faint",
  }[variant];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]",
        styles,
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
