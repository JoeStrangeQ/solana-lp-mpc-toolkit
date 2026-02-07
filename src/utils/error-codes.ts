/**
 * Structured Error Codes for LP Agent Toolkit
 * 
 * Error format: {domain}_{category}_{specific}
 * - LP_xxx: LP operations
 * - WALLET_xxx: Wallet operations
 * - ORACLE_xxx: Price feeds
 * - SWAP_xxx: Swap operations
 * - BOT_xxx: Telegram bot
 * - MONITOR_xxx: Position monitoring
 */

export enum ErrorCode {
  // LP Operations (LP_xxx)
  LP_INSUFFICIENT_BALANCE = 'LP_INSUFFICIENT_BALANCE',
  LP_POOL_NOT_FOUND = 'LP_POOL_NOT_FOUND',
  LP_POSITION_NOT_FOUND = 'LP_POSITION_NOT_FOUND',
  LP_BUILD_FAILED = 'LP_BUILD_FAILED',
  LP_SIGN_FAILED = 'LP_SIGN_FAILED',
  LP_SIGN_TIMEOUT = 'LP_SIGN_TIMEOUT',
  LP_SUBMIT_FAILED = 'LP_SUBMIT_FAILED',
  LP_BUNDLE_FAILED = 'LP_BUNDLE_FAILED',
  LP_SLIPPAGE_EXCEEDED = 'LP_SLIPPAGE_EXCEEDED',
  LP_OUT_OF_RANGE = 'LP_OUT_OF_RANGE',
  
  // Wallet Operations (WALLET_xxx)
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  WALLET_CREATE_FAILED = 'WALLET_CREATE_FAILED',
  WALLET_LOAD_FAILED = 'WALLET_LOAD_FAILED',
  WALLET_PRIVY_ERROR = 'WALLET_PRIVY_ERROR',
  
  // Oracle Operations (ORACLE_xxx)
  ORACLE_FETCH_FAILED = 'ORACLE_FETCH_FAILED',
  ORACLE_ALL_SOURCES_FAILED = 'ORACLE_ALL_SOURCES_FAILED',
  ORACLE_PRICE_STALE = 'ORACLE_PRICE_STALE',
  ORACLE_PRICE_DIVERGENT = 'ORACLE_PRICE_DIVERGENT',
  
  // Swap Operations (SWAP_xxx)
  SWAP_QUOTE_FAILED = 'SWAP_QUOTE_FAILED',
  SWAP_BUILD_FAILED = 'SWAP_BUILD_FAILED',
  SWAP_EXECUTE_FAILED = 'SWAP_EXECUTE_FAILED',
  SWAP_CIRCUIT_OPEN = 'SWAP_CIRCUIT_OPEN',
  SWAP_ULTRA_TIMEOUT = 'SWAP_ULTRA_TIMEOUT',
  
  // Bot Operations (BOT_xxx)
  BOT_NOT_INITIALIZED = 'BOT_NOT_INITIALIZED',
  BOT_SEND_FAILED = 'BOT_SEND_FAILED',
  BOT_CALLBACK_FAILED = 'BOT_CALLBACK_FAILED',
  
  // Monitor Operations (MONITOR_xxx)
  MONITOR_ADD_FAILED = 'MONITOR_ADD_FAILED',
  MONITOR_CHECK_FAILED = 'MONITOR_CHECK_FAILED',
  MONITOR_ALERT_FAILED = 'MONITOR_ALERT_FAILED',
  
  // General (GENERAL_xxx)
  GENERAL_INVALID_INPUT = 'GENERAL_INVALID_INPUT',
  GENERAL_TIMEOUT = 'GENERAL_TIMEOUT',
  GENERAL_RATE_LIMITED = 'GENERAL_RATE_LIMITED',
  GENERAL_SERVICE_UNAVAILABLE = 'GENERAL_SERVICE_UNAVAILABLE',
  GENERAL_INTERNAL_ERROR = 'GENERAL_INTERNAL_ERROR',
}

export interface StructuredError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
  requestId?: string;
}

/**
 * Create a structured error response
 */
export function createError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string
): StructuredError {
  return {
    code,
    message,
    details,
    timestamp: new Date().toISOString(),
    requestId,
  };
}

/**
 * Map common error patterns to error codes
 */
export function classifyError(error: unknown): ErrorCode {
  if (!error) return ErrorCode.GENERAL_INTERNAL_ERROR;
  
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  
  // Timeout patterns
  if (msg.includes('timeout') || msg.includes('timed out')) {
    if (msg.includes('sign')) return ErrorCode.LP_SIGN_TIMEOUT;
    if (msg.includes('ultra')) return ErrorCode.SWAP_ULTRA_TIMEOUT;
    return ErrorCode.GENERAL_TIMEOUT;
  }
  
  // Balance patterns
  if (msg.includes('insufficient') || msg.includes('not enough balance')) {
    return ErrorCode.LP_INSUFFICIENT_BALANCE;
  }
  
  // Not found patterns
  if (msg.includes('pool not found')) return ErrorCode.LP_POOL_NOT_FOUND;
  if (msg.includes('position not found')) return ErrorCode.LP_POSITION_NOT_FOUND;
  if (msg.includes('wallet not found')) return ErrorCode.WALLET_NOT_FOUND;
  
  // Circuit breaker
  if (msg.includes('circuit') && msg.includes('open')) {
    return ErrorCode.SWAP_CIRCUIT_OPEN;
  }
  
  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('429')) {
    return ErrorCode.GENERAL_RATE_LIMITED;
  }
  
  // Slippage
  if (msg.includes('slippage')) {
    return ErrorCode.LP_SLIPPAGE_EXCEEDED;
  }
  
  // Privy/wallet
  if (msg.includes('privy')) {
    return ErrorCode.WALLET_PRIVY_ERROR;
  }
  
  // Oracle
  if (msg.includes('oracle') || msg.includes('price')) {
    if (msg.includes('stale')) return ErrorCode.ORACLE_PRICE_STALE;
    if (msg.includes('divergen')) return ErrorCode.ORACLE_PRICE_DIVERGENT;
    return ErrorCode.ORACLE_FETCH_FAILED;
  }
  
  return ErrorCode.GENERAL_INTERNAL_ERROR;
}

/**
 * Get HTTP status code for an error code
 */
export function getHttpStatus(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.LP_INSUFFICIENT_BALANCE:
    case ErrorCode.GENERAL_INVALID_INPUT:
      return 400;
    
    case ErrorCode.LP_POOL_NOT_FOUND:
    case ErrorCode.LP_POSITION_NOT_FOUND:
    case ErrorCode.WALLET_NOT_FOUND:
      return 404;
    
    case ErrorCode.GENERAL_RATE_LIMITED:
      return 429;
    
    case ErrorCode.SWAP_CIRCUIT_OPEN:
    case ErrorCode.GENERAL_SERVICE_UNAVAILABLE:
    case ErrorCode.BOT_NOT_INITIALIZED:
      return 503;
    
    case ErrorCode.GENERAL_TIMEOUT:
    case ErrorCode.LP_SIGN_TIMEOUT:
    case ErrorCode.SWAP_ULTRA_TIMEOUT:
      return 504;
    
    default:
      return 500;
  }
}

/**
 * Get user-friendly message for an error code
 */
export function getFriendlyMessage(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.LP_INSUFFICIENT_BALANCE:
      return 'Insufficient SOL balance. Please deposit more SOL and try again.';
    case ErrorCode.LP_POOL_NOT_FOUND:
      return 'Pool not found. Please check the address and try again.';
    case ErrorCode.LP_POSITION_NOT_FOUND:
      return 'Position not found. It may have been withdrawn.';
    case ErrorCode.LP_SIGN_TIMEOUT:
      return 'Wallet signing timed out. Please try again.';
    case ErrorCode.LP_BUNDLE_FAILED:
      return 'Transaction bundle failed. Please try again in a moment.';
    case ErrorCode.LP_SLIPPAGE_EXCEEDED:
      return 'Price moved too much. Try again with higher slippage.';
    case ErrorCode.WALLET_NOT_FOUND:
      return 'Wallet not found. Please create a wallet first.';
    case ErrorCode.SWAP_CIRCUIT_OPEN:
      return 'Swap service temporarily unavailable. Please try again in 30 seconds.';
    case ErrorCode.GENERAL_RATE_LIMITED:
      return 'Too many requests. Please wait a moment and try again.';
    case ErrorCode.GENERAL_TIMEOUT:
      return 'Request timed out. Please try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
