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
      throw new Error(`Ultra order failed (${resp.status}): ${body}`);
    }

    return (await resp.json()) as UltraOrder;
  } catch (err) {
    clearTimeout(timeout);
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
      throw new Error(`Ultra execute failed (${resp.status}): ${body}`);
    }

    return (await resp.json()) as UltraExecuteResult;
  } catch (err) {
    clearTimeout(timeout);
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
