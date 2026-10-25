/** Links back into CHouse from a message. They need the server's public origin. */

/** The public origin links are built on, without a trailing slash; null when unset. */
export function publicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  return raw ? raw : null;
}

/** An absolute link to a CHouse page, or null when the public origin is unknown. */
export function appLink(path: string): string | null {
  const base = publicBaseUrl();
  if (!base) return null;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** One "Open in CHouse" style link, when it can be built. */
export function linkTo(label: string, path: string): Array<{ label: string; url: string }> {
  const url = appLink(path);
  return url ? [{ label, url }] : [];
}
