import { useCallback, useEffect, useState, type RefObject } from "react";

interface Options {
  /** The scrolling element the target sits in; the viewport when omitted. */
  root?: RefObject<Element | null>;
  rootMargin?: string;
}

/**
 * Whether the element has come within `rootMargin` of its scroll container.
 * It stays true once seen, so work it starts (a query) is not thrown away on
 * scroll. Returns a callback ref, so an element that mounts later is still
 * observed. Where IntersectionObserver is missing, everything counts as seen.
 */
export function useInView<T extends Element>({ root, rootMargin = "200px" }: Options = {}): [(element: T | null) => void, boolean] {
  const [element, setElement] = useState<T | null>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  const ref = useCallback((el: T | null) => setElement(el), []);

  useEffect(() => {
    if (seen || !element || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    }, { root: root?.current ?? null, rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, root, rootMargin, seen]);

  return [ref, seen];
}
