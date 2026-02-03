/**
 * LP Toolkit API
 * Export all API components for external use
 */

// Core server
export { default as app } from "./server";

// Utilities
export {
  safeFetch,
  safePost,
  fetchFirst,
  fetchAll,
  safeRpcCall,
} from "./fetch";
export * from "./validation";
export * from "./errors";
export * from "./logger";
export * from "./config";

// Middleware
export {
  requestId,
  serverTiming,
  errorHandler,
  corsHeaders,
  apiKeyAuth,
  validateContentType,
  securityHeaders,
} from "./middleware";

// Rate limiting
export {
  rateLimit,
  standardLimit,
  strictLimit,
  txLimit,
  readLimit,
  getRateLimitStats,
} from "./rateLimit";

// Health checks
export { runHealthChecks, quickHealthCheck } from "./health";

// Transaction building
export {
  buildAddLiquidityTx,
  buildRemoveLiquidityTx,
  describeTx,
} from "./txBuilder";

// Monitoring
export {
  checkPositionHealth,
  checkPoolHealth,
  formatHealthReport,
  formatPoolReport,
} from "./monitoring";
