import { useEffect, useState, type RefObject } from "react";

/**
 * Whether the element has come within `rootMargin` of the viewport. It stays
 * true once seen, so work it starts (a query) is not thrown away on scroll.
 * Where IntersectionObserver is missing, everything counts as seen.
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = "200px"): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const element = ref.current;
    if (seen || !element || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    }, { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin, seen]);

  return seen;
}
