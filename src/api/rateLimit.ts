/**
 * Rate Limiting for API Endpoints
 * Protects against abuse and ensures fair usage
 */

import { Context, Next } from 'hono';

// ============ Types ============

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitConfig {
  windowMs: number;       // Time window in milliseconds
  maxRequests: number;    // Max requests per window
  keyPrefix?: string;     // Prefix for rate limit key
}

// ============ In-Memory Store ============

// In production, use Redis or similar
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

// ============ Rate Limiter ============

/**
 * Create a rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const { windowMs, maxRequests, keyPrefix = 'rl' } = config;

  return async (c: Context, next: Next) => {
    // Get client identifier (IP or API key)
    const clientId = getClientId(c);
    const key = `${keyPrefix}:${clientId}`;

    const now = Date.now();
    let entry = rateLimitStore.get(key);

    // Initialize or reset if window expired
    if (!entry || entry.resetTime < now) {
      entry = {
        count: 0,
        resetTime: now + windowMs,
      };
    }

    // Increment count
    entry.count++;
    rateLimitStore.set(key, entry);

    // Add rate limit headers
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetTime / 1000)));

    // Check if over limit
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      c.header('Retry-After', String(retryAfter));

      return c.json({
        success: false,
        error: 'Rate limit exceeded',
        suggestion: `Too many requests. Try again in ${retryAfter} seconds.`,
        retryAfterSeconds: retryAfter,
      }, 429);
    }

    await next();
  };
}

/**
 * Get client identifier for rate limiting
 */
function getClientId(c: Context): string {
  // Check for API key header first
  const apiKey = c.req.header('X-API-Key');
  if (apiKey) {
    return `key:${apiKey}`;
  }

  // Fall back to IP address
  const forwarded = c.req.header('X-Forwarded-For');
  if (forwarded) {
    return `ip:${forwarded.split(',')[0].trim()}`;
  }

  const ip = c.req.header('X-Real-IP') || 'unknown';
  return `ip:${ip}`;
}

// ============ Preset Configurations ============

/**
 * Standard rate limit (100 requests per minute)
 */
export const standardLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  keyPrefix: 'std',
});

/**
 * Strict rate limit for expensive operations (20 requests per minute)
 */
export const strictLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20,
  keyPrefix: 'strict',
});

/**
 * Very strict rate limit for transaction building (10 requests per minute)
 */
export const txLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
  keyPrefix: 'tx',
});

/**
 * Generous limit for read operations (200 requests per minute)
 */
export const readLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 200,
  keyPrefix: 'read',
});

// ============ Usage Stats ============

/**
 * Get rate limit stats (for monitoring)
 */
export function getRateLimitStats(): {
  totalKeys: number;
  keysByPrefix: Record<string, number>;
} {
  const stats: Record<string, number> = {};
  
  for (const key of rateLimitStore.keys()) {
    const prefix = key.split(':')[0];
    stats[prefix] = (stats[prefix] || 0) + 1;
  }

  return {
    totalKeys: rateLimitStore.size,
    keysByPrefix: stats,
  };
}

export default {
  rateLimit,
  standardLimit,
  strictLimit,
  txLimit,
  readLimit,
  getRateLimitStats,
};
