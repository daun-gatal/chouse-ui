/**
 * Origin validation for the MCP Streamable HTTP endpoint (spec MUST,
 * DNS-rebinding protection — see ADR 0013 §2).
 *
 * Policy: when `allowedOrigins` is empty, any request *carrying* an Origin
 * header is rejected (403) while headerless calls (CI agents, curl) pass.
 * When configured, only exact matches pass. MCP hosts that send an Origin
 * (browser-embedded agents) must be listed explicitly.
 */

import type { Context, Next } from "hono";

export function originGuard(allowedOrigins: string[]): (c: Context, next: Next) => Promise<void | Response> {
  return async (c: Context, next: Next): Promise<void | Response> => {
    const origin = c.req.header("Origin");
    if (origin && !allowedOrigins.includes(origin)) {
      // Direct JSON response (same pattern as apiProtectionMiddleware): the
      // caller is not a trusted origin, so no further middleware should run.
      return c.json(
        {
          success: false,
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: `Origin '${origin}' is not allowed on the MCP endpoint. Add it to MCP_ALLOWED_ORIGINS (ADR 0013).`,
          },
        },
        403
      );
    }
    await next();
  };
}
