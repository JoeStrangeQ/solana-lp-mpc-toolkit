/**
 * Request ID Tracing Middleware
 * 
 * Generates a unique ID for each request, adds it to context,
 * and includes it in response headers for tracing/debugging.
 */

import { Context, Next } from 'hono';
import { randomUUID } from 'crypto';

// Header name for request ID (follows common conventions)
export const REQUEST_ID_HEADER = 'X-Request-ID';

// Key for storing request ID in Hono context
export const REQUEST_ID_KEY = 'requestId';

/**
 * Generate a short, unique request ID
 * Format: timestamp-randomhex (e.g., "1707321600-a1b2c3d4")
 * Shorter than UUID but still unique enough for tracing
 */
function generateRequestId(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(36);
  const random = randomUUID().slice(0, 8);
  return `${timestamp}-${random}`;
}

/**
 * Request ID middleware for Hono
 * 
 * - Checks for incoming X-Request-ID header (for distributed tracing)
 * - Generates new ID if not present
 * - Stores in context via c.set('requestId', ...)
 * - Adds to response headers
 * - Logs request with ID
 */
export async function requestIdMiddleware(c: Context, next: Next) {
  // Use incoming request ID if present (for distributed tracing)
  // Otherwise generate a new one
  const requestId = c.req.header(REQUEST_ID_HEADER) || generateRequestId();
  
  // Store in context for downstream handlers
  c.set(REQUEST_ID_KEY, requestId);
  
  // Add to response headers
  c.header(REQUEST_ID_HEADER, requestId);
  
  // Log request start with ID
  const method = c.req.method;
  const path = c.req.path;
  console.log(`[${requestId}] ${method} ${path}`);
  
  const start = Date.now();
  
  try {
    await next();
  } finally {
    // Log request completion with timing
    const duration = Date.now() - start;
    const status = c.res.status;
    console.log(`[${requestId}] ${method} ${path} → ${status} (${duration}ms)`);
  }
}

/**
 * Get request ID from Hono context
 * Safe to call even if middleware isn't applied
 */
export function getRequestId(c: Context): string | undefined {
  try {
    return c.get(REQUEST_ID_KEY);
  } catch {
    return undefined;
  }
}

/**
 * Create a standardized JSON response with request ID included
 */
export function jsonWithRequestId<T>(c: Context, data: T, status = 200) {
  const requestId = getRequestId(c);
  const response: T & { requestId?: string } = {
    ...data,
    requestId,
  };
  return c.json(response, status);
}
