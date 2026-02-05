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
const JITO_API_KEY = process.env.JITO_API_KEY || '';
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
 */
export async function sendBundle(
  signedTransactions: string[] // Base64 encoded signed transactions
): Promise<{ bundleId: string }> {
  if (signedTransactions.length > 5) {
    throw new Error('Jito bundle cannot contain more than 5 transactions');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (JITO_API_KEY) {
    headers['x-jito-auth'] = JITO_API_KEY;
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

  if (!json.result) {
    throw new Error('Jito sendBundle returned no result');
  }

  return { bundleId: json.result };
}

/**
 * Wait for bundle to land
 */
export async function waitForBundle(
  bundleId: string,
  options?: { timeoutMs?: number; intervalMs?: number; }
): Promise<{ landed: boolean; slot?: number; error?: string }> {
  const { timeoutMs = 30000, intervalMs = 1000 } = options || {};
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const statusHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (JITO_API_KEY) {
      statusHeaders['x-jito-auth'] = JITO_API_KEY;
    }

    const response = await fetch(`${JITO_BLOCK_ENGINE_URL}/api/v1/getBundleStatuses`, {
      method: 'POST',
      headers: statusHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[bundleId]],
      }),
    });

    if (response.ok) {
      const json = await response.json() as { result?: { value?: Array<{ slot: number; confirmation_status: string; err?: any }> } };
      const bundle = json.result?.value?.[0];

      if (bundle) {
        // Check confirmation status first
        if (bundle.confirmation_status === 'finalized' || bundle.confirmation_status === 'confirmed') {
          // {"Ok": null} is Solana success - not an error
          const isSuccess = !bundle.err || (bundle.err && 'Ok' in bundle.err);
          if (isSuccess) {
            return { landed: true, slot: bundle.slot };
          }
        }
        // Only treat as error if err exists and is NOT {"Ok": null}
        if (bundle.err && !('Ok' in bundle.err)) {
          return { landed: false, error: JSON.stringify(bundle.err) };
        }
      }
    }
    
    console.log(`⏳ Bundle ${bundleId} status: checking...`);
    await new Promise(r => setTimeout(r, intervalMs));
  }

  return { landed: false, error: `Timeout after ${timeoutMs}ms` };
}

export default {
  buildTipTransaction,
  sendBundle,
  waitForBundle,
};
