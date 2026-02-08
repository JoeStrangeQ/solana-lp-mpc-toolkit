/**
 * LP Service - LP operation orchestration for routes and bot
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { buildAtomicLP } from '../lp/atomic.js';
import { buildAtomicWithdraw } from '../lp/atomicWithdraw.js';
import { executeRebalance } from '../lp/atomicRebalance.js';
import { sendBundle, waitForBundle, type TipSpeed } from '../jito/index.js';
import { discoverAllPositions } from '../utils/position-discovery.js';
import { resolveTokens, calculateHumanPriceRange, formatPriceRange, formatPrice } from '../utils/token-metadata.js';
import { config } from '../config/index.js';
import { Redis } from '@upstash/redis';
import { withRetry, isTransientError } from '../utils/resilience.js';

// Redis client for cache invalidation
let redis: Redis | null = null;
export function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  redis = new Redis({ url, token });
  return redis;
}

export async function invalidatePositionCache(walletId: string): Promise<void> {
  try {
    const r = getRedis();
    if (r) {
      await r.del(`positions:${walletId}`);
      console.log(`[LP Service] Invalidated position cache for wallet ${walletId}`);
    }
  } catch (e) {
    console.warn('[LP Service] Failed to invalidate position cache:', (e as Error).message);
  }
}

export interface LpExecuteParams {
  walletId: string;
  walletAddress: string;
  poolAddress: string;
  amountSol: number;
  minBinId: number;
  maxBinId: number;
  strategy: 'concentrated' | 'wide' | 'custom';
  shape: 'spot' | 'curve' | 'bidask';
  tipSpeed: TipSpeed;
  slippageBps: number;
  signTransaction: (tx: string) => Promise<string>;
  signAndSendTransaction?: (tx: string) => Promise<string>;
}

export async function executeLp(params: LpExecuteParams) {
  const {
    walletId, walletAddress, poolAddress, amountSol,
    minBinId, maxBinId, strategy, shape, tipSpeed, slippageBps,
    signTransaction, signAndSendTransaction,
  } = params;

  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const solMint = 'So11111111111111111111111111111111111111112';

  // Use direct RPC when signAndSendTransaction is available (bypasses Jito bundles)
  const useDirectRpc = !!signAndSendTransaction;

  const lpResult = await buildAtomicLP({
    walletAddress,
    poolAddress,
    collateralMint: solMint,
    collateralAmount: lamports,
    strategy,
    shape,
    minBinId,
    maxBinId,
    tipSpeed,
    slippageBps,
    skipTip: useDirectRpc,
  });

  if (useDirectRpc) {
    // Send each transaction individually via Privy RPC (more reliable than Jito bundles)
    const txHashes: string[] = [];
    for (let i = 0; i < lpResult.unsignedTransactions.length; i++) {
      console.log(`[LP Service] Signing+sending tx ${i + 1}/${lpResult.unsignedTransactions.length}...`);
      const txHash = await signAndSendTransaction(lpResult.unsignedTransactions[i]);
      console.log(`[LP Service] Tx ${i + 1} confirmed: ${txHash}`);
      txHashes.push(txHash);

      // Wait between transactions for state to propagate on-chain
      if (i < lpResult.unsignedTransactions.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    await invalidatePositionCache(walletId);
    return { lpResult, txHashes, status: 'sent' };
  }

  // Jito bundle path
  console.log(`[LP Service] Jito bundle path: ${lpResult.unsignedTransactions.length} transactions`);
  const signedTxs: string[] = [];
  for (let i = 0; i < lpResult.unsignedTransactions.length; i++) {
    const unsignedTx = lpResult.unsignedTransactions[i];
    console.log(`[LP Service] Signing tx ${i + 1}/${lpResult.unsignedTransactions.length}...`);
    const signedTx = await signTransaction(unsignedTx);
    if (!signedTx) {
      throw new Error(`signTransaction returned null/undefined for tx ${i + 1}`);
    }
    signedTxs.push(signedTx);
  }

  console.log(`[LP Service] Sending bundle with ${signedTxs.length} transactions...`);
  const { bundleId } = await withRetry(
    () => sendBundle(signedTxs),
    { maxRetries: 2, baseDelayMs: 2000, retryOn: isTransientError },
  );
  const status = await waitForBundle(bundleId, { timeoutMs: 60000 });

  await invalidatePositionCache(walletId);

  return { lpResult, bundleId, status };
}

export async function getPositionsForWallet(walletAddress: string) {
  const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
  return discoverAllPositions(conn, walletAddress);
}

export interface RebalanceParams {
  walletId: string;
  walletAddress: string;
  poolAddress: string;
  positionAddress: string;
  newMinBinOffset: number;
  newMaxBinOffset: number;
  strategy: 'concentrated' | 'wide';
  shape: 'spot' | 'curve' | 'bidask';
  tipSpeed: TipSpeed;
  slippageBps: number;
  signTransaction: (tx: string) => Promise<string>;
}

export async function executeRebalanceOperation(params: RebalanceParams) {
  const result = await executeRebalance({
    walletAddress: params.walletAddress,
    walletId: params.walletId,
    poolAddress: params.poolAddress,
    positionAddress: params.positionAddress,
    newMinBinOffset: params.newMinBinOffset,
    newMaxBinOffset: params.newMaxBinOffset,
    strategy: params.strategy,
    shape: params.shape,
    tipSpeed: params.tipSpeed,
    slippageBps: params.slippageBps,
    signTransaction: params.signTransaction,
  });

  await invalidatePositionCache(params.walletId);

  return result;
}
