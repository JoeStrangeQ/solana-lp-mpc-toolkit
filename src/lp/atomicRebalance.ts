/**
 * Resilient Rebalance - Two-Phase with Recovery
 * 
 * Phase 1: Withdraw position via Jito bundle
 * Phase 2: Re-enter with new range via Jito bundle
 * 
 * If Phase 1 succeeds but Phase 2 fails, tokens are safe in wallet.
 * The endpoint returns clear status so the agent can retry Phase 2.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import BN from 'bn.js';
import { config } from '../config/index.js';
import { arciumPrivacy } from '../privacy/index.js';
import { buildAtomicWithdraw } from './atomicWithdraw.js';
import { buildAtomicLP } from './atomic.js';
import { sendBundle, waitForBundle, TipSpeed } from '../jito/index.js';
import { FEE_CONFIG } from '../fees/index.js';
import { getCachedDLMM, invalidatePoolCache } from '../services/pool-cache.js';

export interface RebalanceParams {
  walletAddress: string;
  walletId: string;
  poolAddress: string;
  positionAddress: string;
  newMinBinOffset?: number;
  newMaxBinOffset?: number;
  strategy?: 'concentrated' | 'wide';
  shape?: 'spot' | 'curve' | 'bidask';
  tipSpeed?: TipSpeed;
  slippageBps?: number;
  // Privy client for signing
  signTransaction: (tx: string) => Promise<string>;
}

export interface RebalanceResult {
  success: boolean;
  phase1: {
    status: 'success' | 'failed' | 'skipped';
    bundleId?: string;
    slot?: number;
    error?: string;
  };
  phase2: {
    status: 'success' | 'failed' | 'skipped';
    bundleId?: string;
    slot?: number;
    newPositionAddress?: string;
    error?: string;
  };
  oldPosition: {
    address: string;
    binRange: { lower: number; upper: number };
  };
  newPosition?: {
    binRange: { lower: number; upper: number };
    priceRange: { lower: number; upper: number };
  };
  tokensInWallet?: {
    tokenX: string;
    tokenY: string;
  };
  recoveryHint?: string;
}

/**
 * Execute resilient rebalance with clear phase tracking
 */
export async function executeRebalance(params: RebalanceParams): Promise<RebalanceResult> {
  const {
    walletAddress,
    poolAddress,
    positionAddress,
    newMinBinOffset = -5,
    newMaxBinOffset = 5,
    strategy = 'concentrated',
    shape = 'spot',
    tipSpeed = 'fast',
    slippageBps = 300,
    signTransaction,
  } = params;

  const connection = new Connection(config.solana.rpc);
  const walletPubkey = new PublicKey(walletAddress);

  console.log(`[Rebalance] Starting resilient rebalance for ${positionAddress}...`);

  // Load pool and position info (cached DLMM instance)
  const pool = await getCachedDLMM(connection, poolAddress);
  const activeBin = await pool.getActiveBin();
  
  const { userPositions } = await pool.getPositionsByUserAndLbPair(walletPubkey);
  const position = userPositions.find(p => p.publicKey.toBase58() === positionAddress);
  
  if (!position) {
    throw new Error(`Position ${positionAddress} not found`);
  }

  const positionData = position.positionData;
  const lowerBinId = positionData.lowerBinId;
  const upperBinId = positionData.upperBinId;

  // Calculate new position details upfront
  const newLowerBin = activeBin.binId + newMinBinOffset;
  const newUpperBin = activeBin.binId + newMaxBinOffset;
  const binStep = pool.lbPair.binStep;
  const newLowerPrice = Math.pow(1 + binStep / 10000, newLowerBin);
  const newUpperPrice = Math.pow(1 + binStep / 10000, newUpperBin);

  const result: RebalanceResult = {
    success: false,
    phase1: { status: 'skipped' },
    phase2: { status: 'skipped' },
    oldPosition: {
      address: positionAddress,
      binRange: { lower: lowerBinId, upper: upperBinId },
    },
    newPosition: {
      binRange: { lower: newLowerBin, upper: newUpperBin },
      priceRange: { lower: newLowerPrice, upper: newUpperPrice },
    },
  };

  // ============ PHASE 1: WITHDRAW ============
  console.log(`[Rebalance] Phase 1: Building withdrawal...`);
  
  try {
    const withdrawResult = await buildAtomicWithdraw({
      walletAddress,
      poolAddress,
      positionAddress,
      tipSpeed,
    });

    // Sign withdrawal transactions
    const signedWithdrawTxs: string[] = [];
    for (const unsignedTx of withdrawResult.unsignedTransactions) {
      try {
        const signedTx = await signTransaction(unsignedTx);
        signedWithdrawTxs.push(signedTx);
      } catch (e) {
        // May already be signed with position keypair
        signedWithdrawTxs.push(unsignedTx);
      }
    }

    // Submit withdrawal bundle
    console.log(`[Rebalance] Phase 1: Submitting ${signedWithdrawTxs.length} txs...`);
    const { bundleId } = await sendBundle(signedWithdrawTxs);
    
    // Wait for withdrawal
    const withdrawStatus = await waitForBundle(bundleId, { timeoutMs: 60000 });

    if (!withdrawStatus.landed) {
      result.phase1 = {
        status: 'failed',
        bundleId,
        error: withdrawStatus.error || 'Bundle did not land',
      };
      result.recoveryHint = 'Withdrawal failed. Position unchanged. Try again.';
      return result;
    }

    result.phase1 = {
      status: 'success',
      bundleId,
      slot: withdrawStatus.slot,
    };
    result.tokensInWallet = {
      tokenX: withdrawResult.estimatedWithdraw.tokenX.amount,
      tokenY: withdrawResult.estimatedWithdraw.tokenY.amount,
    };

    console.log(`[Rebalance] Phase 1 complete! Tokens in wallet.`);

  } catch (error: any) {
    result.phase1 = {
      status: 'failed',
      error: error.message,
    };
    result.recoveryHint = 'Withdrawal failed. Position unchanged. Try again.';
    return result;
  }

  // ============ PHASE 2: RE-ENTER ============
  console.log(`[Rebalance] Phase 2: Building LP entry...`);

  // Small delay to let state propagate
  await new Promise(r => setTimeout(r, 2000));

  try {
    // Get fresh wallet balances
    const tokenXMint = pool.tokenX.publicKey.toBase58();
    const tokenYMint = pool.tokenY.publicKey.toBase58();
    
    // Use Y token as collateral (usually USDC/stablecoin)
    const collateralMint = tokenYMint;
    
    // Get token balance from wallet
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPubkey,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );
    
    const yAccount = tokenAccounts.value.find(
      a => a.account.data.parsed.info.mint === tokenYMint
    );
    
    const availableY = yAccount 
      ? parseInt(yAccount.account.data.parsed.info.tokenAmount.amount)
      : 0;

    if (availableY < 1000) {
      result.phase2 = {
        status: 'failed',
        error: 'Insufficient Y token balance for re-entry',
      };
      result.recoveryHint = 'Withdrawal succeeded but LP entry failed. Tokens safe in wallet. Call POST /lp/execute to manually re-enter.';
      return result;
    }

    // Use 95% of available balance (keep some for fees)
    const lpAmount = Math.floor(availableY * 0.95);

    const lpResult = await buildAtomicLP({
      walletAddress,
      poolAddress,
      collateralMint,
      collateralAmount: lpAmount,
      strategy: strategy as any,
      shape: shape as any,
      minBinId: newMinBinOffset,
      maxBinId: newMaxBinOffset,
      tipSpeed,
      slippageBps,
    });

    // Sign LP transactions
    const signedLpTxs: string[] = [];
    for (const unsignedTx of lpResult.unsignedTransactions) {
      try {
        const signedTx = await signTransaction(unsignedTx);
        signedLpTxs.push(signedTx);
      } catch (e) {
        signedLpTxs.push(unsignedTx);
      }
    }

    // Submit LP bundle
    console.log(`[Rebalance] Phase 2: Submitting ${signedLpTxs.length} txs...`);
    const lpBundle = await sendBundle(signedLpTxs);
    
    // Wait for LP
    const lpStatus = await waitForBundle(lpBundle.bundleId, { timeoutMs: 60000 });

    if (!lpStatus.landed) {
      result.phase2 = {
        status: 'failed',
        bundleId: lpBundle.bundleId,
        error: lpStatus.error || 'LP bundle did not land',
      };
      result.recoveryHint = 'Withdrawal succeeded but LP entry failed. Tokens safe in wallet. Call POST /lp/execute to manually re-enter.';
      return result;
    }

    result.phase2 = {
      status: 'success',
      bundleId: lpBundle.bundleId,
      slot: lpStatus.slot,
      newPositionAddress: 'Created new position',
    };

    result.success = true;
    console.log(`[Rebalance] Phase 2 complete! Rebalance successful.`);

  } catch (error: any) {
    result.phase2 = {
      status: 'failed',
      error: error.message,
    };
    result.recoveryHint = 'Withdrawal succeeded but LP entry failed. Tokens safe in wallet. Call POST /lp/execute to manually re-enter.';
  }

  return result;
}

// Keep the interface for backwards compatibility
export interface BuiltAtomicRebalance {
  unsignedTransactions: string[];
  newPositionKeypair: string;
  oldPosition: {
    address: string;
    binRange: { lower: number; upper: number };
    amounts: { tokenX: string; tokenY: string };
  };
  newPosition: {
    binRange: { lower: number; upper: number };
    priceRange: { lower: number; upper: number; display: string };
  };
  fee: {
    bps: number;
    tokenX: string;
    tokenY: string;
  };
  encryptedStrategy?: { ciphertext: string };
}

// Stub for backwards compatibility - use executeRebalance instead
export async function buildAtomicRebalance(params: any): Promise<BuiltAtomicRebalance> {
  throw new Error('Use executeRebalance() instead for resilient two-phase rebalancing');
}
