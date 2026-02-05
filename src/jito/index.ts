/**
 * Jito Bundle Service
 * 
 * Enables atomic transaction bundles via Jito block engine.
 * Swap + LP happens atomically - either all succeed or all fail.
 */

import { 
  PublicKey, 
  SystemProgram, 
  TransactionMessage, 
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf';
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

export type TipSpeed = 'low' | 'medium' | 'fast' | 'extraFast';

const TIP_LAMPORTS: Record<TipSpeed, number> = {
  low: Math.round(0.0005 * LAMPORTS_PER_SOL),      // 0.0005 SOL
  medium: Math.round(0.001 * LAMPORTS_PER_SOL),    // 0.001 SOL
  fast: Math.round(0.0025 * LAMPORTS_PER_SOL),     // 0.0025 SOL
  extraFast: Math.round(0.005 * LAMPORTS_PER_SOL), // 0.005 SOL
};

function getRandomTipAccount(): string {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

/**
 * Build a Jito tip transaction
 */
export function buildTipTransaction(params: {
  payerAddress: string;
  recentBlockhash: string;
  speed?: TipSpeed;
}): { transaction: VersionedTransaction; tipLamports: number } {
  const { payerAddress, recentBlockhash, speed = 'fast' } = params;
  const tipLamports = TIP_LAMPORTS[speed];
  const tipAccount = new PublicKey(getRandomTipAccount());
  const payer = new PublicKey(payerAddress);

  const instruction = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: tipAccount,
    lamports: tipLamports,
  });

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash,
    instructions: [instruction],
  }).compileToV0Message();

  return {
    transaction: new VersionedTransaction(message),
    tipLamports,
  };
}

/**
 * Send a bundle of transactions via Jito block engine
 * All transactions execute atomically - either all succeed or all fail
 */
export async function sendBundle(
  signedTransactions: string[], // Base64 encoded signed transactions
  authToken?: string
): Promise<{ bundleId: string }> {
  if (signedTransactions.length > 5) {
    throw new Error('Jito bundle cannot contain more than 5 transactions');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (authToken) {
    headers['x-jito-auth'] = authToken;
  }

  const response = await fetch(`${JITO_BLOCK_ENGINE_URL}/api/v1/bundles`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [signedTransactions, { encoding: 'base64' }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jito sendBundle failed: ${response.status} - ${text}`);
  }

  const json = await response.json() as { result?: string; error?: { message?: string } };
  
  if (json.error) {
    throw new Error(`Jito error: ${json.error.message || JSON.stringify(json.error)}`);
  }

  return { bundleId: json.result as string };
}

/**
 * Check bundle status
 */
export async function getBundleStatus(bundleId: string, authToken?: string): Promise<{
  found: boolean;
  status?: 'Pending' | 'Landed' | 'Failed' | 'Invalid' | 'not_found';
  slot?: number;
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
  error?: string;
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (authToken) {
    headers['x-jito-auth'] = authToken;
  }

  // Check inflight status first
  const inflightResponse = await fetch(`${JITO_BLOCK_ENGINE_URL}/api/v1/getInflightBundleStatuses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getInflightBundleStatuses',
      params: [[bundleId]],
    }),
  });

  if (inflightResponse.ok) {
    const inflightJson = await inflightResponse.json() as { result?: { value?: Array<{ status: string; landed_slot?: number }> } };
    const bundle = inflightJson.result?.value?.[0];
    
    if (bundle) {
      if (bundle.status === 'Landed') {
        return {
          found: true,
          status: 'Landed',
          slot: bundle.landed_slot,
        };
      } else if (bundle.status === 'Failed') {
        return {
          found: true,
          status: 'Failed',
          error: 'Bundle failed before landing',
        };
      } else if (bundle.status === 'Pending') {
        return {
          found: true,
          status: 'Pending',
        };
      }
    }
  }

  // Fallback to getBundleStatuses for finalized status
  const response = await fetch(`${JITO_BLOCK_ENGINE_URL}/api/v1/getBundleStatuses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBundleStatuses',
      params: [[bundleId]],
    }),
  });

  if (!response.ok) {
    return { found: false, status: 'not_found' };
  }

  const json = await response.json() as { result?: { value?: Array<{ slot: number; confirmation_status: 'processed' | 'confirmed' | 'finalized' }> } };
  const bundles = json.result?.value;

  if (!bundles || bundles.length === 0) {
    return { found: false, status: 'not_found' };
  }

  const bundle = bundles[0];
  return {
    found: true,
    status: 'Landed',
    slot: bundle.slot,
    confirmationStatus: bundle.confirmation_status,
  };
}

/**
 * Wait for bundle to land
 */
export async function waitForBundle(
  bundleId: string,
  options?: {
    authToken?: string;
    timeoutMs?: number;
    intervalMs?: number;
  }
): Promise<{ landed: boolean; slot?: number; error?: string }> {
  const { authToken, timeoutMs = 30000, intervalMs = 1000 } = options || {};
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await getBundleStatus(bundleId, authToken);

    if (status.status === 'Landed') {
      console.log(`✅ Bundle ${bundleId} landed in slot ${status.slot}`);
      return { landed: true, slot: status.slot };
    }

    if (status.status === 'Failed') {
      console.log(`❌ Bundle ${bundleId} failed`);
      return { landed: false, error: status.error || 'Bundle failed' };
    }

    if (status.status === 'Invalid') {
      return { landed: false, error: 'Bundle is invalid' };
    }

    console.log(`⏳ Bundle ${bundleId} status: ${status.status || 'checking'}...`);
    await new Promise(r => setTimeout(r, intervalMs));
  }

  return { landed: false, error: `Timeout after ${timeoutMs}ms` };
}

export default {
  buildTipTransaction,
  sendBundle,
  getBundleStatus,
  waitForBundle,
};
