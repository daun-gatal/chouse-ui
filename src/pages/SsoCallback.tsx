/**
 * SSO Callback Page
 *
 * The IdP redirects here with ?code & ?state (plus extras like Google's
 * ?iss). The server identifies the provider from its signed state cookie,
 * so no provider param is needed. Completes the login by forwarding the
 * raw query string to the server callback endpoint, then forwards to the
 * original target.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { useRbacStore } from "@/stores";
import { log } from "@/lib/log";

/** Defensive mirror of the server-side guard: only same-app paths. */
function safeClientRedirect(target: string): string {
  if (!target.startsWith("/") || target[1] === "/" || target[1] === "\\") return "/";
  return target;
}

export default function SsoCallback(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const completeSsoLogin = useRbacStore((s) => s.completeSsoLogin);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return; // StrictMode double-invoke guard
    startedRef.current = true;

    const idpError = searchParams.get("error");
    if (idpError) {
      setError(searchParams.get("error_description") || `Sign-in was cancelled (${idpError}).`);
      return;
    }

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code || !state) {
      setError("Missing sign-in parameters. Please start again from the login page.");
      return;
    }

    // Forward the ENTIRE query string — IdPs append more than code+state
    // (e.g. Google's iss), and openid-client validates the full response.
    completeSsoLogin(searchParams.toString())
      .then((redirect) => navigate(safeClientRedirect(redirect), { replace: true }))
      .catch((err: unknown) => {
        log.error("SSO callback failed:", err);
        setError(err instanceof Error ? err.message : "SSO sign-in failed.");
      });
  }, [searchParams, completeSsoLogin, navigate]);

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
