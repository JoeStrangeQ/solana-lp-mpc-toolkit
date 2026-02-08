/**
 * Jito Bundle Service
 * 
 * Enables atomic transaction bundles via Jito block engine.
 * Swap + LP happens atomically - either all succeed or all fail.
 */

import { 
  Connection,
  PublicKey, 
  SystemProgram, 
  TransactionMessage, 
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { config } from '../config/index.js';

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
 * Simulate transactions before sending to Jito
 * 
 * NOTE: For atomic bundles (swap→LP), later transactions depend on earlier ones.
 * We only hard-fail on the FIRST transaction. Subsequent tx failures are logged
 * but treated as "expected" since they may depend on prior tx outputs.
 */
export async function simulateTransactions(
  signedTransactions: string[]
): Promise<{ success: boolean; errors: string[] }> {
  const rpcUrl = config.solana?.rpc || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const errors: string[] = [];
  let firstTxFailed = false;

  for (let i = 0; i < signedTransactions.length; i++) {
    try {
      const txBuf = Buffer.from(signedTransactions[i], 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);
      
      const result = await connection.simulateTransaction(tx, {
        sigVerify: false, // Skip sig verify since some might be partial
        replaceRecentBlockhash: true, // Use latest blockhash for simulation
      });

      if (result.value.err) {
        const errStr = typeof result.value.err === 'string' 
          ? result.value.err 
          : JSON.stringify(result.value.err);
        
        // Check if this is an "insufficient funds" error that might be due to dependency
        const isInsufficientFunds = errStr.includes('Custom":1') || errStr.includes('insufficient');
        
        if (i === 0) {
          // First transaction failure is always a real error
          console.log(`[Jito] ❌ Tx ${i + 1} simulation failed: ${errStr}`);
          firstTxFailed = true;
          errors.push(`Tx ${i + 1}: ${errStr}`);
        } else if (isInsufficientFunds) {
          // Later txs failing with "insufficient funds" likely depend on prior swaps
          console.log(`[Jito] ⚠️ Tx ${i + 1} simulation failed (likely depends on prior tx): ${errStr}`);
          // Don't add to errors - this is expected for atomic bundles
        } else {
          // Other errors on later txs are still reported
          console.log(`[Jito] ❌ Tx ${i + 1} simulation failed: ${errStr}`);
          errors.push(`Tx ${i + 1}: ${errStr}`);
        }
        
        if (result.value.logs) {
          const relevantLogs = result.value.logs.filter(l => 
            l.includes('Error') || l.includes('failed') || l.includes('insufficient')
          );
          if (relevantLogs.length > 0) {
            console.log(`[Jito] Relevant logs: ${relevantLogs.join('\n')}`);
          }
        }
      } else {
        console.log(`[Jito] ✅ Tx ${i + 1} simulation passed`);
      }
    } catch (e: any) {
      console.log(`[Jito] ⚠️ Tx ${i + 1} simulation error: ${e.message}`);
      if (i === 0) {
        errors.push(`Tx ${i + 1}: ${e.message}`);
      }
    }
  }

  return { success: errors.length === 0, errors };
}

/**
 * Send bundle with pre-flight simulation
 */
export async function sendBundleWithSimulation(
  signedTransactions: string[]
): Promise<{ bundleId: string; simulated: boolean }> {
  // First simulate all transactions
  const simResult = await simulateTransactions(signedTransactions);
  
  if (!simResult.success) {
    throw new Error(`Bundle simulation failed:\n${simResult.errors.join('\n')}`);
  }

  // If simulation passes, send to Jito
  const result = await sendBundle(signedTransactions);
  return { ...result, simulated: true };
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

      // Log full response for debugging
      if (bundle) {
        console.log(`[Jito] Bundle ${bundleId.slice(0,8)}... status: ${bundle.confirmation_status || 'pending'}, slot: ${bundle.slot || 'N/A'}, err: ${JSON.stringify(bundle.err)}`);
      } else {
        // No bundle data yet - Jito hasn't processed it
        console.log(`[Jito] Bundle ${bundleId.slice(0,8)}... not yet in Jito's response (may have been dropped)`);
      }

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
          console.log(`[Jito] ❌ Bundle failed with error: ${JSON.stringify(bundle.err)}`);
          return { landed: false, error: JSON.stringify(bundle.err) };
        }
      }
    } else {
      console.log(`[Jito] getBundleStatuses request failed: ${response.status}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }

  return { landed: false, error: `Timeout after ${timeoutMs}ms` };
}

export default {
  buildTipTransaction,
  sendBundle,
  waitForBundle,
};
