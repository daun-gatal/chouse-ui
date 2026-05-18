import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { Section, Container, SectionHeader } from "./Section";

export default function ScreenshotGallery() {
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";
    fetch(`${base}screenshots.json`.replace(/\/+/g, "/"))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("no screenshots"))))
      .then((data: string[]) => {
        setScreenshots(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const navigate = (direction: 1 | -1) => (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!selected || screenshots.length === 0) return;
    const idx = screenshots.indexOf(selected);
    const next = (idx + direction + screenshots.length) % screenshots.length;
    setSelected(screenshots[next]);
  };

  const formatLabel = (file: string) =>
    file.replace(/[-_]/g, " ").replace(/\.(png|jpe?g|webp)$/i, "");

  if (loading || screenshots.length === 0) return null;

  // Triple list for seamless marquee loop without abrupt reset.
  const loop = [...screenshots, ...screenshots, ...screenshots];

  return (
    <Section id="gallery" aria-label="Interface preview" className="bg-ink-50">
      <Container>
        <SectionHeader
          eyebrow="Interface preview"
          eyebrowIndex={3}
          title="A glance at the workspace."
          description="Real screenshots from the live app — SQL editor, monitoring, RBAC admin, and AI optimizer."
        />
      </Container>

      <div className="relative mt-16 overflow-hidden pause-on-hover">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink-50 to-transparent md:w-40"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink-50 to-transparent md:w-40"
        />

        <div className="flex w-max animate-marquee gap-6 px-6">
          {loop.map((shot, idx) => {
            const base = import.meta.env.BASE_URL || "/";
            const src = `${base}screenshots/${shot}`.replace(/\/+/g, "/");
            return (
              <button
                key={`${shot}-${idx}`}
                type="button"
                onClick={() => setSelected(shot)}
                className="group relative aspect-video w-[560px] shrink-0 overflow-hidden rounded-md border border-ink-500 bg-ink-100 transition-colors hover:border-ink-700 md:w-[680px]"
                aria-label={`Preview: ${formatLabel(shot)}`}
              >
                <img
                  src={src}
                  alt={formatLabel(shot)}
                  loading="lazy"
                  className="h-full w-full object-cover object-top opacity-90 transition-opacity duration-500 group-hover:opacity-100"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-ink-50 via-ink-50/70 to-transparent p-5">
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper">
                    {formatLabel(shot)}
                  </span>
                  <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-100/80 text-paper-muted backdrop-blur-sm transition-colors group-hover:border-accent group-hover:text-accent">
                    <Expand className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink-0/90 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted transition-colors hover:border-ink-700 hover:text-paper"
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={navigate(-1)}
              className="absolute left-4 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted transition-colors hover:border-ink-700 hover:text-paper md:grid"
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={navigate(1)}
              className="absolute right-4 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted transition-colors hover:border-ink-700 hover:text-paper md:grid"
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <motion.figure
              key={selected}
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex max-h-[90vh] max-w-[1200px] flex-col gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={`${import.meta.env.BASE_URL || "/"}screenshots/${selected}`.replace(/\/+/g, "/")}
                alt={formatLabel(selected)}
                className="max-h-[80vh] w-full rounded-md border border-ink-500 object-contain"
              />
              <figcaption className="text-center font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted">
                {formatLabel(selected)}
              </figcaption>
            </motion.figure>
          </motion.div>
        )}
      </AnimatePresence>
    </Section>
  );
}
