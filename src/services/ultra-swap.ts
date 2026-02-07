/**
 * Jupiter Ultra V3 MEV-Protected Swap Service
 *
 * Uses Jupiter's Ultra API for MEV-protected swap execution.
 * Ultra V3 routes swaps through private mempools to prevent
 * sandwich attacks and front-running.
 *
 * Flow: POST /ultra/v1/order -> POST /ultra/v1/execute
 */

import { config } from '../config/index.js';

const ULTRA_BASE = 'https://api.jup.ag/ultra/v1';
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Circuit Breaker for Jupiter Ultra API
// ---------------------------------------------------------------------------

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

const CIRCUIT_FAILURE_THRESHOLD = 3;      // Open after 3 consecutive failures
const CIRCUIT_RESET_TIMEOUT_MS = 30_000;  // Try again after 30 seconds

const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailure: 0,
  state: 'closed',
};

function checkCircuit(): void {
  if (circuitBreaker.state === 'open') {
    const timeSinceFailure = Date.now() - circuitBreaker.lastFailure;
    if (timeSinceFailure >= CIRCUIT_RESET_TIMEOUT_MS) {
      console.log('[UltraSwap] Circuit breaker: half-open (attempting recovery)');
      circuitBreaker.state = 'half-open';
    } else {
      const waitTime = Math.ceil((CIRCUIT_RESET_TIMEOUT_MS - timeSinceFailure) / 1000);
      throw new Error(`Jupiter Ultra API circuit open (retry in ${waitTime}s)`);
    }
  }
}

function recordSuccess(): void {
  if (circuitBreaker.state !== 'closed') {
    console.log('[UltraSwap] Circuit breaker: closed (recovered)');
  }
  circuitBreaker.failures = 0;
  circuitBreaker.state = 'closed';
}

function recordFailure(): void {
  circuitBreaker.failures++;
  circuitBreaker.lastFailure = Date.now();
  
  if (circuitBreaker.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    console.warn(`[UltraSwap] Circuit breaker: open (${circuitBreaker.failures} consecutive failures)`);
    circuitBreaker.state = 'open';
  }
}

/**
 * Get current circuit breaker status
 */
export function getCircuitBreakerStatus(): { state: string; failures: number; lastFailure: number } {
  return {
    state: circuitBreaker.state,
    failures: circuitBreaker.failures,
    lastFailure: circuitBreaker.lastFailure,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UltraOrderParams {
  inputMint: string;
  outputMint: string;
  amount: number;       // In base units (lamports for SOL)
  taker: string;        // Wallet address
  slippageBps?: number; // Default 100 (1%)
}

export interface UltraOrder {
  requestId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
  transaction: string;  // Base64 encoded transaction to sign
  expiresAt: number;    // Unix timestamp
}

export interface UltraExecuteResult {
  signature: string;
  status: 'confirmed' | 'failed';
  inputAmount: string;
  outputAmount: string;
}

// ---------------------------------------------------------------------------
// API Helpers
// ---------------------------------------------------------------------------

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (config.jupiter?.apiKey) {
    headers['x-api-key'] = config.jupiter.apiKey;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Request a MEV-protected swap order from Jupiter Ultra.
 * Returns an unsigned transaction to be signed by the taker.
 */
export async function createUltraOrder(params: UltraOrderParams): Promise<UltraOrder> {
  // Check circuit breaker before making request
  checkCircuit();
  
  const { inputMint, outputMint, amount, taker, slippageBps = 100 } = params;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(`${ULTRA_BASE}/order`, {
      method: 'POST',
      headers: buildHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        inputMint,
        outputMint,
        amount: amount.toString(),
        taker,
        slippageBps,
      }),
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const body = await resp.text();
      recordFailure();
      throw new Error(`Ultra order failed (${resp.status}): ${body}`);
    }

    const result = (await resp.json()) as UltraOrder;
    recordSuccess();
    return result;
  } catch (err) {
    clearTimeout(timeout);
    // Only record failure for network/timeout errors (not circuit breaker errors)
    if (err instanceof Error && !err.message.includes('circuit open')) {
      recordFailure();
    }
    throw err;
  }
}

/**
 * Execute a signed Ultra order.
 * The signedTransaction should be the base64-encoded transaction
 * after the taker has signed the order's transaction.
 */
export async function executeUltraOrder(params: {
  requestId: string;
  signedTransaction: string;
}): Promise<UltraExecuteResult> {
  // Check circuit breaker before making request
  checkCircuit();
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(`${ULTRA_BASE}/execute`, {
      method: 'POST',
      headers: buildHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        requestId: params.requestId,
        signedTransaction: params.signedTransaction,
      }),
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const body = await resp.text();
      recordFailure();
      throw new Error(`Ultra execute failed (${resp.status}): ${body}`);
    }

    const result = (await resp.json()) as UltraExecuteResult;
    recordSuccess();
    return result;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && !err.message.includes('circuit open')) {
      recordFailure();
    }
    throw err;
  }
}

/**
 * Full Ultra swap flow: create order -> return unsigned tx for signing.
 * Caller is responsible for signing and calling executeUltraOrder.
 */
export async function prepareUltraSwap(params: UltraOrderParams): Promise<{
  order: UltraOrder;
  unsignedTransaction: string;
  expiresAt: number;
}> {
  const order = await createUltraOrder(params);
  return {
    order,
    unsignedTransaction: order.transaction,
    expiresAt: order.expiresAt,
  };
}
