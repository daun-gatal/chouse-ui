/**
 * SSO provider brand icons.
 *
 * Renders a recognisable logo for the inferred brand (see {@link resolveSsoBrand}).
 * Multi-colour marks (Google, Microsoft, …) carry their own brand colours, so
 * they read correctly on both light and dark backgrounds. Monochrome marks
 * (GitHub, Apple) and the generic protocol fallbacks use `currentColor`, so they
 * adapt to the surrounding theme.
 */

import type { ReactElement } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveSsoBrand, type SsoBrand, type SsoBrandInput } from "./ssoBrand";

interface SsoProviderIconProps {
  provider: SsoBrandInput;
  className?: string;
}

type BrandSvg = (props: { className?: string }) => ReactElement;

const SVG_PROPS = {
  viewBox: "0 0 24 24",
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": true,
} as const;

const BRAND_RENDERERS: Partial<Record<SsoBrand, BrandSvg>> = {
  google: ({ className }) => (
    <svg {...SVG_PROPS} className={className}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  ),
  microsoft: ({ className }) => (
    <svg {...SVG_PROPS} className={className}>
      <path fill="#F25022" d="M11.4 11.4H2V2h9.4z" />
      <path fill="#7FBA00" d="M22 11.4h-9.4V2H22z" />
      <path fill="#00A4EF" d="M11.4 22H2v-9.4h9.4z" />
      <path fill="#FFB900" d="M22 22h-9.4v-9.4H22z" />
    </svg>
  ),
  okta: ({ className }) => (
    <svg {...SVG_PROPS} className={className}>
      <path
        fill="#007DC1"
        fillRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"
      />
    </svg>
  ),
  github: ({ className }) => (
    <svg {...SVG_PROPS} className={className}>
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  ),
  gitlab: ({ className }) => (
    <svg {...SVG_PROPS} className={className}>
      <path
        fill="#FC6D26"
        d="m23.6 9.6-.03-.09-3.26-8.5a.85.85 0 0 0-1.62.08l-2.2 6.73H7.51l-2.2-6.73a.85.85 0 0 0-1.62-.08L.43 9.51l-.03.1a6.05 6.05 0 0 0 2.01 7l.04.03 4.96 3.72 2.46 1.86 1.5 1.13a1 1 0 0 0 1.2 0l1.5-1.13 2.46-1.86 5-3.74.01-.01a6.05 6.05 0 0 0 2.06-6.91z"
      />
    </svg>
  ),
  auth0: ({ className }) => (
    <svg {...SVG_PROPS} className={className}>
      <path
        fill="#EB5424"
        d="M21.98 7.45 19.62 0H4.35L2.02 7.45c-1.35 4.3.03 9.2 3.82 12.01L12.01 24l6.15-4.55c3.76-2.81 5.18-7.69 3.82-12.01l-6.16 4.58 2.34 7.44-6.15-4.59-6.16 4.58 2.36-7.43L2.02 7.43l7.63-.02L12.01 0l2.36 7.41 7.61.04z"
      />
    </svg>
  ),
  apple: ({ className }) => (
    <svg {...SVG_PROPS} className={className}>
      <path
        fill="currentColor"
        d="M17.05 12.04c-.03-2.6 2.13-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.39.86 1.25 1.89 2.66 3.24 2.61 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.03 2.28-1.28 3.14-2.54.99-1.45 1.4-2.86 1.42-2.93-.03-.01-2.72-1.04-2.75-4.13zM14.6 4.5c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.46z"
      />
    </svg>
  ),
  slack: ({ className }) => (
    <svg {...SVG_PROPS} className={className}>
      <path fill="#36C5F0" d="M9.04 2.5a2.27 2.27 0 1 0 0 4.54h2.27V4.77A2.27 2.27 0 0 0 9.04 2.5m0 6.04H3a2.27 2.27 0 1 0 0 4.54h6.04a2.27 2.27 0 1 0 0-4.54" />
      <path fill="#2EB67D" d="M21.5 10.81a2.27 2.27 0 1 0-4.54 0v2.27h2.27a2.27 2.27 0 0 0 2.27-2.27m-6.04 0V4.77a2.27 2.27 0 1 0-4.54 0v6.04a2.27 2.27 0 1 0 4.54 0" />
      <path fill="#ECB22E" d="M12.96 21.5a2.27 2.27 0 1 0 0-4.54h-2.27v2.27c0 1.25 1.02 2.27 2.27 2.27m0-6.04H19a2.27 2.27 0 1 0 0-4.54h-6.04a2.27 2.27 0 1 0 0 4.54" />
      <path fill="#E01E5A" d="M2.5 13.19a2.27 2.27 0 1 0 4.54 0v-2.27H4.77A2.27 2.27 0 0 0 2.5 13.19m6.04 0v6.04a2.27 2.27 0 1 0 4.54 0v-6.04a2.27 2.27 0 1 0-4.54 0" />
    </svg>
  ),
  amazon: ({ className }) => (
    <svg {...SVG_PROPS} className={className}>
      <path
        fill="#FF9900"
        d="M15.93 17.09c-1.94 1.43-4.76 2.2-7.18 2.2-3.4 0-6.46-1.26-8.77-3.35-.18-.16-.02-.39.2-.26 2.5 1.45 5.58 2.33 8.77 2.33 2.15 0 4.5-.45 6.68-1.37.33-.14.6.22.28.45m.81-.93c-.25-.32-1.64-.15-2.27-.08-.19.02-.22-.14-.05-.27 1.11-.78 2.93-.55 3.14-.29.21.26-.06 2.09-1.1 2.96-.16.14-.31.06-.24-.11.23-.58.74-1.87.52-2.14"
      />
      <path
        fill="#FF9900"
        d="M13.78 9.3v-1.1c0-.17.13-.28.28-.28h4.93c.16 0 .29.12.29.28v.95c0 .16-.14.37-.38.7l-2.55 3.64c.95-.02 1.95.12 2.81.6.19.11.24.27.26.43v1.18c0 .17-.18.36-.37.26-1.51-.79-3.51-.88-5.18.01-.18.09-.36-.09-.36-.26v-1.12c0-.18 0-.49.19-.77l2.96-4.24h-2.57c-.16 0-.29-.11-.31-.28M5.4 16.18H3.9a.28.28 0 0 1-.27-.25V8.22c0-.15.13-.27.29-.27h1.4c.15.01.27.13.28.26v1.01h.03c.36-.97 1.05-1.43 1.98-1.43.94 0 1.53.46 1.95 1.43.37-.97 1.2-1.43 2.08-1.43.63 0 1.32.26 1.74.84.47.65.37 1.59.37 2.42v4.88c0 .15-.13.27-.29.27h-1.5a.28.28 0 0 1-.27-.27v-4.1c0-.32.03-1.14-.04-1.45-.11-.52-.45-.66-.89-.66-.37 0-.75.25-.91.64-.16.4-.14 1.05-.14 1.47v4.1c0 .15-.13.27-.29.27H8.62a.28.28 0 0 1-.27-.27l-.01-4.1c0-.86.14-2.13-.93-2.13-1.08 0-1.04 1.24-1.04 2.13v4.1c0 .15-.13.27-.29.27"
      />
    </svg>
  ),
};

/** Brand mark for a provider, with a generic protocol glyph as the fallback. */
export function SsoProviderIcon({ provider, className }: SsoProviderIconProps) {
  const brand = resolveSsoBrand(provider);
  const Renderer = BRAND_RENDERERS[brand];
  if (Renderer) {
    return <Renderer className={cn("h-5 w-5 shrink-0", className)} />;
  }
  // generic-saml → shield, generic-oidc / keycloak / anything else → key.
  const GenericIcon = brand === "generic-saml" ? ShieldCheck : KeyRound;
  return <GenericIcon className={cn("h-5 w-5 shrink-0 text-paper-dim", className)} aria-hidden />;
}
