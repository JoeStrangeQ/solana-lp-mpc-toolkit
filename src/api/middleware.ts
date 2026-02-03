/**
 * API Middleware Collection
 * Request ID, timing, error handling, etc.
 */

import { Context, Next } from 'hono';
import { randomBytes } from 'crypto';
import * as log from './logger';

// ============ Request ID ============

/**
 * Add unique request ID to each request
 */
export function requestId() {
  return async (c: Context, next: Next) => {
    const id = c.req.header('X-Request-ID') || generateRequestId();
    c.set('requestId', id);
    c.header('X-Request-ID', id);
    await next();
  };
}

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

// ============ Response Time ============

/**
 * Add server timing header
 */
export function serverTiming() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    c.header('Server-Timing', `total;dur=${duration}`);
  };
}

// ============ Error Handler ============

/**
 * Global error handler - catches unhandled errors
 */
export function errorHandler() {
  return async (c: Context, next: Next) => {
    try {
      await next();
    } catch (error: any) {
      const requestId = c.get('requestId') || 'unknown';
      
      log.error('Unhandled error', {
        requestId,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      });

      // Don't expose internal errors to clients
      const status = error.status || 500;
      const message = status >= 500 
        ? 'Internal server error'
        : error.message;

      return c.json({
        success: false,
        error: message,
        requestId,
        suggestion: status >= 500 
          ? 'An unexpected error occurred. Please try again or contact support.'
          : undefined,
      }, status);
    }
  };
}

// ============ CORS Preflight ============

/**
 * Handle CORS preflight with proper headers
 */
export function corsHeaders() {
  return async (c: Context, next: Next) => {
    // Handle preflight
    if (c.req.method === 'OPTIONS') {
      return c.text('', 204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Request-ID',
        'Access-Control-Max-Age': '86400',
      });
    }

    await next();
  };
}

// ============ API Key Authentication ============

/**
 * Optional API key authentication
 * If API_KEYS env var is set, validates X-API-Key header
 */
export function apiKeyAuth() {
  const validKeys = process.env.API_KEYS?.split(',').map(k => k.trim()) || [];
  
  return async (c: Context, next: Next) => {
    // Skip auth if no keys configured
    if (validKeys.length === 0) {
      await next();
      return;
    }

    const apiKey = c.req.header('X-API-Key');
    
    if (!apiKey) {
      return c.json({
        success: false,
        error: 'Missing API key',
        suggestion: 'Include X-API-Key header with a valid API key',
      }, 401);
    }

    if (!validKeys.includes(apiKey)) {
      return c.json({
        success: false,
        error: 'Invalid API key',
        suggestion: 'Check that your API key is correct',
      }, 403);
    }

    // Store API key identifier for logging
    c.set('apiKey', apiKey.slice(0, 8) + '...');
    await next();
  };
}

// ============ Request Validation ============

/**
 * Validate Content-Type for POST requests
 */
export function validateContentType() {
  return async (c: Context, next: Next) => {
    if (c.req.method === 'POST' || c.req.method === 'PUT') {
      const contentType = c.req.header('Content-Type');
      
      if (!contentType?.includes('application/json')) {
        return c.json({
          success: false,
          error: 'Content-Type must be application/json',
          suggestion: 'Add header: Content-Type: application/json',
        }, 415);
      }
    }

    await next();
  };
}

// ============ Security Headers ============

/**
 * Add security headers to all responses
 */
export function securityHeaders() {
  return async (c: Context, next: Next) => {
    await next();
    
    // Security headers
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  };
}

// ============ Apply All Middleware ============

/**
 * Apply all standard middleware to an app
 */
export function applyMiddleware(app: any): void {
  app.use('*', requestId());
  app.use('*', serverTiming());
  app.use('*', errorHandler());
  app.use('*', corsHeaders());
  app.use('*', securityHeaders());
  app.use('*', validateContentType());
}

export default {
  requestId,
  serverTiming,
  errorHandler,
  corsHeaders,
  apiKeyAuth,
  validateContentType,
  securityHeaders,
  applyMiddleware,
};
