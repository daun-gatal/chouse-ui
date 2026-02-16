/**
 * Request ID Middleware
 * 
 * Generates a unique ID for each request to enable traceability.
 */

import { Context, Next } from 'hono';

declare module 'hono' {
    interface ContextVariableMap {
        requestId: string;
    }
}

export async function requestId(c: Context, next: Next) {
    // Use existing ID from header (e.g. from load balancer) or generate new one
    const id = c.req.header('x-request-id') || crypto.randomUUID();

    // Attach to context for use in logs/errors
    c.set('requestId', id);

    // Return in response header
    c.header('x-request-id', id);

    await next();
}
