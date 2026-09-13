/**
 * In-process API client for MCP tools (ADR 0013 §3).
 *
 * Tools never reimplement business logic: they issue subrequests against the
 * existing Hono app (`proxyApi`) carrying the caller's PAT and connection
 * headers, then parse the standard `{success, data, error}` envelope. Every
 * permission check, data-access policy, rate limit, and route-level audit
 * entry applies exactly as it does for the UI and CLI.
 */

import type { Hono } from "hono";
import { McpToolContext } from "./types";

export const MCP_USER_AGENT = "chouse-mcp/1";

export class McpApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "McpApiError";
    this.code = code;
    this.status = status;
  }
}

interface Envelope {
  success: boolean;
  data: unknown;
  error: unknown;
  code?: string;
}

/** Normalize the three server failure shapes (see cli/internal/api/client.go). */
function decodeError(status: number, raw: string): McpApiError {
  let code = "REQUEST_FAILED";
  let message = raw.slice(0, 300);
  try {
    const wire = JSON.parse(raw) as { error?: unknown; code?: string };
    if (wire.code) code = wire.code;
    if (typeof wire.error === "string") {
      message = wire.error;
    } else if (wire.error && typeof wire.error === "object") {
      const err = wire.error as { code?: string; message?: string };
      if (err.code) code = err.code;
      if (err.message) message = err.message;
    }
  } catch {
    // Non-JSON body: keep the raw snippet.
  }
  return new McpApiError(code, message, status);
}

export interface SubrequestOptions {
  body?: unknown;
  query?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Typed subrequest helper. `proxyApi.request` runs the full middleware chain
 * in-process (no network hop), including apiProtectionMiddleware's PAT
 * exemption and the per-request connection resolution (ADR 0010).
 */
export class McpApiClient {
  constructor(
    readonly proxy: Hono,
    private readonly ctx: McpToolContext,
    readonly timeoutMs: number
  ) {}

  /** A client for the same caller but pinned to a specific connection. */
  withConnection(connectionId: string): McpApiClient {
    return new McpApiClient(this.proxy, { ...this.ctx, connectionId }, this.timeoutMs);
  }

  async request<T>(method: string, path: string, options?: SubrequestOptions): Promise<T> {
    const url = new URL(path, "http://chouse.internal");
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.ctx.token}`,
      "User-Agent": MCP_USER_AGENT,
      "Content-Type": "application/json",
    };
    if (this.ctx.connectionId) {
      headers["X-Connection-Id"] = this.ctx.connectionId;
    }
    if (this.ctx.clientIp) {
      headers["X-Forwarded-For"] = this.ctx.clientIp;
    }

    const init: RequestInit = { method, headers };
    if (options?.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    init.signal = AbortSignal.timeout(timeoutMs);

    const response = await this.proxy.request(url.pathname + url.search, init);
    const raw = await response.text();

    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      throw decodeError(response.status, raw);
    }

    if (!envelope.success || response.status >= 400) {
      throw decodeError(response.status, raw);
    }
    return envelope.data as T;
  }
}
