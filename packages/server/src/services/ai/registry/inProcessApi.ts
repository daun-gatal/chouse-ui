/**
 * In-process API client for CHouse management tools (ADR 0019 §9).
 *
 * Tools never reimplement business logic or read the metadata DB directly:
 * they issue GET subrequests against the app itself carrying the chatting
 * user's own access token, so every route's permission check, data-access
 * policy, rate limit and audit entry applies exactly as in the UI. A user can
 * never learn more through the assistant than through the screens.
 */

import type { Hono } from "hono";

const ASSISTANT_USER_AGENT = "chouse-assistant/1";
const DEFAULT_TIMEOUT_MS = 30_000;

let app: Hono | null = null;

/** Called once at startup with the root app (after every route is mounted). */
export function registerInProcessApi(root: Hono): void {
  app = root;
}

class InProcessApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "InProcessApiError";
    this.status = status;
  }
}

interface Envelope {
  success?: boolean;
  data?: unknown;
  error?: unknown;
}

function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as Envelope;
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error && typeof parsed.error === "object" && "message" in parsed.error) {
      return String((parsed.error as { message: unknown }).message);
    }
  } catch {
    // Non-JSON body: fall through to the status line.
  }
  return status === 403 ? "Permission denied" : `Request failed (${status})`;
}

export class InProcessApiClient {
  constructor(
    private readonly bearerToken: string,
    private readonly connectionId?: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  /** GET a route and unwrap the standard `{ success, data }` envelope. */
  async get<T = unknown>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    if (!app) throw new InProcessApiError("The in-process API is not available", 503);
    const url = new URL(path, "http://chouse.internal");
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.bearerToken}`,
      "User-Agent": ASSISTANT_USER_AGENT,
      // The API protection middleware admits browser-originated calls only.
      "X-Requested-With": "XMLHttpRequest",
    };
    if (this.connectionId) headers["X-Connection-Id"] = this.connectionId;
    const response = await app.request(url.pathname + url.search, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await response.text();
    if (response.status >= 400) throw new InProcessApiError(errorMessage(response.status, body), response.status);
    let envelope: Envelope;
    try {
      envelope = JSON.parse(body) as Envelope;
    } catch {
      throw new InProcessApiError("The API returned a non-JSON response", response.status);
    }
    if (envelope.success === false) throw new InProcessApiError(errorMessage(response.status, body), response.status);
    return (envelope.data ?? envelope) as T;
  }
}
