/**
 * SAML Sign-in Completion Page
 *
 * The SAML ACS (server) finishes the IdP browser-POST handshake and redirects
 * the browser here with ?code=<one-time-code>. This page exchanges that
 * single-use code for a session (user + tokens) via the same store mechanism a
 * password login uses, then forwards to the original target. The code is
 * short-lived and server-bound — it is never logged, and tokens never touch the URL.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useRbacStore } from "@/stores";
import { log } from "@/lib/log";

/** Defensive mirror of the server-side guard: only same-app paths. */
function safeClientRedirect(target: string): string {
  if (!target.startsWith("/") || target[1] === "/" || target[1] === "\\") return "/";
  return target;
}

export default function SsoComplete(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const completeSamlLogin = useRbacStore((s) => s.completeSamlLogin);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return; // StrictMode double-invoke guard
    startedRef.current = true;

    const code = searchParams.get("code");
    if (!code) {
      setError("Missing sign-in code. Please start again from the login page.");
      return;
    }

    completeSamlLogin(code)
      .then((redirect) => navigate(safeClientRedirect(redirect), { replace: true }))
      .catch((err: unknown) => {
        log.error("SAML sign-in completion failed:", err);
        setError(err instanceof Error ? err.message : "SSO sign-in failed.");
      });
  }, [searchParams, completeSamlLogin, navigate]);

  return (
    <div className="dark grid min-h-screen w-full place-items-center bg-ink-50 px-6 text-paper">
      <div className="w-full max-w-[420px] rounded-md border border-ink-500 bg-ink-100 px-7 py-8 text-center">
        {error ? (
          <>
            <p
              role="alert"
              className="rounded-xs border border-red-900/60 bg-red-950/40 px-3 py-2.5 text-[13px] text-red-200"
            >
              {error}
            </p>
            <Link
              to="/login"
              className="mt-5 inline-block font-mono text-[11px] uppercase tracking-[0.16em] text-paper-muted underline-offset-4 hover:underline"
            >
              Back to login
            </Link>
          </>
        ) : (
          <p role="status" className="inline-flex items-center gap-2 text-sm text-paper-muted">
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
            Completing sign-in…
          </p>
        )}
      </div>
    </div>
  );
}
