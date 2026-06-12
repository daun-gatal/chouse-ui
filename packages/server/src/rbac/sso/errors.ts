/**
 * SSO Error Description
 *
 * openid-client (via oauth4webapi) wraps provider failures in structured
 * errors whose `.message` is generic while the real reason lives in
 * `error` (e.g. "invalid_grant"), `error_description`, `code`, and `cause`.
 * This flattens whatever is present into a loggable object so SSO failures
 * carry the identity provider's own diagnostics. Never returns secrets.
 */
export function describeSsoError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { err: String(error) };
  }

  // The structured fields are non-standard library properties; read them
  // defensively (every access is typeof-guarded below).
  const e = error as Error & Record<string, unknown>;
  const out: Record<string, unknown> = { err: error.message };

  if (typeof e.code === "string") out.code = e.code;
  if (typeof e.error === "string") out.oauthError = e.error;
  if (typeof e.error_description === "string") {
    out.oauthErrorDescription = e.error_description;
  }

  if (error.cause instanceof Error) out.cause = error.cause.message;
  else if (typeof error.cause === "string") out.cause = error.cause;

  return out;
}
