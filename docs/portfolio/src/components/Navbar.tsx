import { useEffect, useState } from "react";
import { Menu, X, Github, ArrowUpRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Features", href: "#features" },
  { label: "Highlights", href: "#highlights" },
  { label: "Try Lab", href: "#try-lab" },
  { label: "Quick Start", href: "#quick-start" },
  { label: "FAQ", href: "#faq" },
  { label: "Changelog", href: "#changelog" },
] as const;

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleScrollTo = (href: string) => {
    const el = document.querySelector(href);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setMobileOpen(false);
    }
  };

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-200",
        scrolled
          ? "border-b border-ink-500 bg-ink-50/85 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="container-editorial flex h-14 items-center justify-between gap-6">
        {/* Wordmark */}
        <a
          href="/"
          className="group flex items-center gap-2.5"
          aria-label="CHouse UI — home"
        >
          <img
            src={`${import.meta.env.BASE_URL}logo.svg`}
            alt=""
            aria-hidden="true"
            className="h-6 w-6"
            width="24"
            height="24"
            loading="eager"
          />
          <span className="text-[15px] font-semibold tracking-tight text-paper">
            CHouse<span className="text-paper-dim">UI</span>
          </span>
        </a>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.href}
              onClick={() => handleScrollTo(item.href)}
              className="rounded-xs px-3 py-1.5 text-[13px] font-medium text-paper-muted transition-colors hover:text-paper"
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/daun-gatal/chouse-ui"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-2 rounded-xs border border-ink-500 px-3 py-1.5 text-[13px] font-medium text-paper-muted transition-colors hover:border-ink-700 hover:text-paper md:inline-flex"
            aria-label="GitHub repository"
          >
            <Github className="h-3.5 w-3.5" aria-hidden />
            <span>GitHub</span>
          </a>

          <button
            type="button"
            onClick={() => handleScrollTo("#quick-start")}
            className="hidden h-8 items-center gap-2 rounded-xs bg-accent px-3 text-[13px] font-semibold tracking-tight text-ink-50 transition-colors hover:bg-accent-soft md:inline-flex"
          >
            Get started
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </button>

          {/* Mobile menu trigger */}
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xs border border-ink-500 text-paper-muted transition-colors hover:text-paper md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="border-t border-ink-500 bg-ink-50/95 backdrop-blur-md md:hidden"
          >
            <div className="container-editorial flex flex-col py-4">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.href}
                  onClick={() => handleScrollTo(item.href)}
                  className="border-b border-ink-500 py-3 text-left text-sm text-paper-muted last:border-b-0 hover:text-paper"
                >
                  {item.label}
                </button>
              ))}
              <div className="mt-4 flex items-center gap-2">
                <a
                  href="https://github.com/daun-gatal/chouse-ui"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xs border border-ink-500 px-3 py-2 text-sm font-medium text-paper-muted"
                >
                  <Github className="h-4 w-4" />
                  GitHub
                </a>
                <button
                  type="button"
                  onClick={() => handleScrollTo("#quick-start")}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xs bg-accent px-3 py-2 text-sm font-semibold text-ink-50"
                >
                  Get started
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
