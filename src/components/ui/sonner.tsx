import { useTheme } from "@/components/common/theme-provider";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const editorialClassNames = {
  toast:
    "group toast pointer-events-auto flex gap-3 rounded-xs border border-ink-500 bg-ink-100 p-4 text-paper shadow-none",
  title: "text-[13px] font-medium tracking-tight text-paper",
  description: "text-[12px] text-paper-muted",
  icon: "text-paper-dim",
  closeButton:
    "!border-ink-500 !bg-ink-200 !text-paper-dim hover:!bg-ink-100 hover:!text-paper",
  actionButton:
    "group-[.toast]:h-8 group-[.toast]:rounded-xs group-[.toast]:bg-brand group-[.toast]:px-3 group-[.toast]:font-mono group-[.toast]:text-[11px] group-[.toast]:font-semibold group-[.toast]:uppercase group-[.toast]:tracking-[0.14em] group-[.toast]:text-ink-50 hover:group-[.toast]:bg-brand-soft",
  cancelButton:
    "group-[.toast]:h-8 group-[.toast]:rounded-xs group-[.toast]:border group-[.toast]:border-ink-500 group-[.toast]:bg-ink-100 group-[.toast]:px-3 group-[.toast]:font-mono group-[.toast]:text-[11px] group-[.toast]:uppercase group-[.toast]:tracking-[0.14em] group-[.toast]:text-paper hover:group-[.toast]:bg-ink-200",
  success:
    "!border-emerald-900/60 !bg-emerald-950/30 !text-emerald-100 [&_[data-icon]]:!text-emerald-300",
  error:
    "!border-red-900/60 !bg-red-950/30 !text-red-100 [&_[data-icon]]:!text-red-300",
  warning:
    "!border-amber-900/60 !bg-amber-950/30 !text-amber-100 [&_[data-icon]]:!text-amber-300",
  info: "!border-ink-500 !bg-ink-100 !text-paper [&_[data-icon]]:!text-paper-dim",
  loading:
    "!border-ink-500 !bg-ink-100 !text-paper [&_[data-icon]]:!text-paper-dim",
};

const Toaster = ({ toastOptions, ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...editorialClassNames,
          ...(toastOptions?.classNames || {}),
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
