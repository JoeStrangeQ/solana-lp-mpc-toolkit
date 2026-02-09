/**
 * Raydium CLMM Service
 * 
 * Provides high-level LP operations for Raydium CLMM pools.
 * Handles transaction building, signing via Privy, and Jito bundle submission.
 */

import { VersionedTransaction } from '@solana/web3.js';
import { buildRaydiumAtomicLP, buildRaydiumWithdraw, buildRaydiumClaimFees } from '../raydium/index.js';
import { fetchRaydiumPositions, fetchRaydiumPosition } from '../raydium/index.js';
import { sendBundle } from '../jito/index.js';
import { loadWalletById } from './wallet-service.js';
import { getConnection } from './connection-pool.js';
import type { TipSpeed } from '../jito/index.js';

export interface RaydiumLpExecuteParams {
  walletId: string;
  walletAddress: string;
  poolAddress: string;
  amountSol: number;
  strategy: 'tight' | 'balanced' | 'wide';
  tipSpeed?: TipSpeed;
  slippageBps?: number;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}

export interface RaydiumLpResult {
  success: boolean;
  txHashes: string[];
  bundleId?: string;
  positionMint?: string;
  tickRange?: { lower: number; upper: number };
  status?: { landed?: boolean; error?: string };
}

/**
 * Execute Raydium CLMM LP position creation
 */
export async function executeRaydiumLp(params: RaydiumLpExecuteParams): Promise<RaydiumLpResult> {
  const {
    walletId,
    walletAddress,
    poolAddress,
    amountSol,
    strategy,
    tipSpeed = 'fast',
    slippageBps = 300,
    signTransaction,
  } = params;

  console.log(`[RaydiumService] Building LP for pool ${poolAddress}, amount ${amountSol} SOL, strategy ${strategy}`);

  // Build unsigned transactions
  const built = await buildRaydiumAtomicLP({
    walletAddress,
    poolAddress,
    amountSol,
    strategy,
    slippageBps,
    tipSpeed,
  });

  console.log(`[RaydiumService] Built ${built.unsignedTransactions.length} transactions, position mint: ${built.positionMint}`);

  // Deserialize and sign each transaction
  const signedTxs: VersionedTransaction[] = [];
  
  for (const txB64 of built.unsignedTransactions) {
    const txBuffer = Buffer.from(txB64, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);
    const signed = await signTransaction(tx);
    signedTxs.push(signed);
  }

  // Submit as Jito bundle
  const signedB64s = signedTxs.map(tx => Buffer.from(tx.serialize()).toString('base64'));
  const bundleResult = await sendBundle(signedB64s);

  console.log(`[RaydiumService] Bundle submitted: ${bundleResult.bundleId}`);

  return {
    success: true,
    txHashes: [],
    bundleId: bundleResult.bundleId,
    positionMint: built.positionMint,
    tickRange: built.tickRange,
    status: { landed: true },
  };
}

/**
 * Execute Raydium position withdrawal
 */
export async function executeRaydiumWithdraw(params: {
  walletId: string;
  walletAddress: string;
  positionMint: string;
  tipSpeed?: TipSpeed;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}): Promise<RaydiumLpResult> {
  const {
    walletAddress,
    positionMint,
    tipSpeed = 'fast',
    signTransaction,
  } = params;

  console.log(`[RaydiumService] Building withdraw for position ${positionMint}`);

  // Build unsigned transactions
  const built = await buildRaydiumWithdraw({
    walletAddress,
    positionMint,
    closePosition: true,
    tipSpeed,
  });

  console.log(`[RaydiumService] Built ${built.unsignedTransactions.length} withdraw transactions`);

  // Sign each transaction
  const signedTxs: VersionedTransaction[] = [];
  
  for (const txB64 of built.unsignedTransactions) {
    const txBuffer = Buffer.from(txB64, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);
    const signed = await signTransaction(tx);
    signedTxs.push(signed);
  }

  // Submit as Jito bundle
  const signedB64s = signedTxs.map(tx => Buffer.from(tx.serialize()).toString('base64'));
  const bundleResult = await sendBundle(signedB64s);

  return {
    success: true,
    txHashes: [],
    bundleId: bundleResult.bundleId,
    status: { landed: true },
  };
}

/**
 * Execute Raydium fee claim
 */
export async function executeRaydiumClaimFees(params: {
  walletId: string;
  walletAddress: string;
  positionMint: string;
  tipSpeed?: TipSpeed;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}): Promise<RaydiumLpResult> {
  const {
    walletAddress,
    positionMint,
    tipSpeed = 'fast',
    signTransaction,
  } = params;

  console.log(`[RaydiumService] Building claim fees for position ${positionMint}`);

  // Build unsigned transactions
  const built = await buildRaydiumClaimFees({
    walletAddress,
    positionMint,
    tipSpeed,
  });

  console.log(`[RaydiumService] Built ${built.unsignedTransactions.length} claim transactions`);

  // Sign each transaction
  const signedTxs: VersionedTransaction[] = [];
  
  for (const txB64 of built.unsignedTransactions) {
    const txBuffer = Buffer.from(txB64, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);
    const signed = await signTransaction(tx);
    signedTxs.push(signed);
  }

  // Submit as Jito bundle
  const signedB64s = signedTxs.map(tx => Buffer.from(tx.serialize()).toString('base64'));
  const bundleResult = await sendBundle(signedB64s);

  return {
    success: true,
    txHashes: [],
    bundleId: bundleResult.bundleId,
    status: { landed: true },
  };
}

// Re-export position functions for convenience
export { fetchRaydiumPositions, fetchRaydiumPosition };
