/**
 * Agent-Friendly Error Handling
 * Provides actionable error messages for AI agents
 */

export interface AgentError {
  code: string;
  message: string;
  suggestion: string;
  retryable: boolean;
  context?: Record<string, any>;
}

export function createAgentError(
  code: string,
  message: string,
  suggestion: string,
  retryable: boolean = false,
  context?: Record<string, any>
): AgentError {
  return { code, message, suggestion, retryable, context };
}

// Common error types with helpful suggestions
export const ERRORS = {
  // Connection errors
  API_UNREACHABLE: (endpoint: string) => createAgentError(
    'API_UNREACHABLE',
    `Cannot reach ${endpoint}`,
    `The DEX API may be down. Try again in a few minutes or use a different venue.`,
    true,
    { endpoint }
  ),

  RPC_ERROR: (rpc: string, error: string) => createAgentError(
    'RPC_ERROR',
    `Solana RPC error: ${error}`,
    `The Solana RPC may be congested. Try using a different RPC endpoint or wait a moment.`,
    true,
    { rpc, originalError: error }
  ),

  // Input validation
  INVALID_PUBKEY: (value: string) => createAgentError(
    'INVALID_PUBKEY',
    `"${value}" is not a valid Solana public key`,
    `Provide a base58-encoded Solana public key (32-44 characters).`,
    false,
    { invalidValue: value }
  ),

  INVALID_TOKEN: (token: string) => createAgentError(
    'INVALID_TOKEN',
    `Token "${token}" not recognized`,
    `Use common symbols like SOL, USDC, USDT, or provide the token mint address.`,
    false,
    { token, supportedTokens: ['SOL', 'USDC', 'USDT', 'BONK', 'JTO', 'JUP', 'RAY'] }
  ),

  INVALID_AMOUNT: (amount: any) => createAgentError(
    'INVALID_AMOUNT',
    `Invalid amount: ${amount}`,
    `Provide a positive number. Examples: 100, 500.50, "1000"`,
    false,
    { amount }
  ),

  // Pool errors
  NO_POOLS_FOUND: (tokenA: string, tokenB: string) => createAgentError(
    'NO_POOLS_FOUND',
    `No pools found for ${tokenA}-${tokenB}`,
    `Try a more common pair like SOL-USDC, or check if the tokens exist on Solana.`,
    true,
    { tokenA, tokenB }
  ),

  POOL_NOT_FOUND: (address: string) => createAgentError(
    'POOL_NOT_FOUND',
    `Pool ${address} not found`,
    `The pool may have been closed or the address is incorrect. Try scanning for pools first.`,
    false,
    { address }
  ),

  INSUFFICIENT_LIQUIDITY: (pool: string, required: number, available: number) => createAgentError(
    'INSUFFICIENT_LIQUIDITY',
    `Pool has insufficient liquidity`,
    `The pool only has $${available.toLocaleString()} TVL. Your $${required.toLocaleString()} order may cause high slippage. Try a smaller amount or a different pool.`,
    false,
    { pool, required, available }
  ),

  // Position errors
  NO_POSITIONS: (wallet: string) => createAgentError(
    'NO_POSITIONS',
    `No LP positions found for wallet`,
    `This wallet has no active LP positions. Use /v1/pools/scan to find pools to add liquidity.`,
    false,
    { wallet: wallet.slice(0, 8) + '...' }
  ),

  POSITION_NOT_FOUND: (positionId: string) => createAgentError(
    'POSITION_NOT_FOUND',
    `Position ${positionId} not found`,
    `The position may have been closed or the ID is incorrect. Use /v1/positions/:wallet to list your positions.`,
    false,
    { positionId }
  ),

  // Transaction errors
  INSUFFICIENT_BALANCE: (token: string, required: number, available: number) => createAgentError(
    'INSUFFICIENT_BALANCE',
    `Insufficient ${token} balance`,
    `You have ${available} ${token} but need ${required}. Get more ${token} or reduce the amount.`,
    false,
    { token, required, available }
  ),

  SLIPPAGE_EXCEEDED: (expected: number, actual: number, maxSlippage: number) => createAgentError(
    'SLIPPAGE_EXCEEDED',
    `Slippage too high (${((actual - expected) / expected * 100).toFixed(2)}%)`,
    `The price moved more than your ${maxSlippage}% tolerance. Try again with higher slippage or smaller amount.`,
    true,
    { expected, actual, maxSlippage }
  ),

  TX_SIMULATION_FAILED: (error: string) => createAgentError(
    'TX_SIMULATION_FAILED',
    `Transaction simulation failed`,
    `The transaction would fail on-chain. Common causes: insufficient balance, pool state changed, or network congestion.`,
    true,
    { simulationError: error }
  ),

  // Encryption errors
  ENCRYPTION_FAILED: (reason: string) => createAgentError(
    'ENCRYPTION_FAILED',
    `Failed to encrypt strategy: ${reason}`,
    `Check that the Arcium devnet cluster is available. The MXE may be temporarily unavailable.`,
    true,
    { reason }
  ),

  // Rate limiting
  RATE_LIMITED: (retryAfter: number) => createAgentError(
    'RATE_LIMITED',
    `Rate limit exceeded`,
    `Too many requests. Wait ${retryAfter} seconds before trying again.`,
    true,
    { retryAfterSeconds: retryAfter }
  ),
};

/**
 * Format error for API response
 */
export function formatErrorResponse(error: AgentError, statusCode: number = 400) {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      suggestion: error.suggestion,
      retryable: error.retryable,
      ...(error.context && { context: error.context }),
    },
  };
}

/**
 * Parse and enhance unknown errors
 */
export function enhanceError(error: any): AgentError {
  const message = error.message || String(error);
  
  // Try to match known patterns
  if (message.includes('Account not found')) {
    return ERRORS.INVALID_PUBKEY(message);
  }
  if (message.includes('0x1') || message.includes('insufficient')) {
    return ERRORS.INSUFFICIENT_BALANCE('SOL', 0, 0);
  }
  if (message.includes('timeout') || message.includes('ECONNREFUSED')) {
    return ERRORS.API_UNREACHABLE('unknown');
  }
  
  // Generic error
  return createAgentError(
    'UNKNOWN_ERROR',
    message.slice(0, 200),
    'An unexpected error occurred. Check the error message for details or try again.',
    true
  );
}

export default ERRORS;
