/**
 * Priority Fee Estimation & Compute Budget Optimization
 *
 * Provides dynamic priority fee estimation based on recent network fees
 * and simulation-driven compute unit limits for LP transactions.
 */

import {
  Connection,
  VersionedTransaction,
  ComputeBudgetProgram,
  TransactionMessage,
  PublicKey,
} from '@solana/web3.js';

export type FeeUrgency = 'low' | 'medium' | 'high' | 'critical';

const MIN_PRIORITY_FEE = 1_000; // microLamports floor
const DEFAULT_CU_LIMIT = 400_000;
const CU_MARGIN = 1.3; // 30% headroom above simulated usage

const URGENCY_PERCENTILE: Record<FeeUrgency, number> = {
  low: 25,
  medium: 50,
  high: 75,
  critical: 90,
};

/**
 * Extract writable account keys from a VersionedTransaction.
 */
function getWritableAccounts(tx: VersionedTransaction): PublicKey[] {
  const msg = tx.message;
  const keys = msg.getAccountKeys();
  const writableKeys: PublicKey[] = [];

  for (let i = 0; i < keys.length; i++) {
    if (msg.isAccountWritable(i)) {
      writableKeys.push(keys.get(i)!);
    }
  }

  return writableKeys;
}

/**
 * Get the fee at a given percentile from an array of fee values.
 */
function percentile(values: number[], pct: number): number {
  if (values.length === 0) return MIN_PRIORITY_FEE;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    Math.floor((pct / 100) * sorted.length),
    sorted.length - 1,
  );
  return sorted[idx];
}

/**
 * Estimate an appropriate priority fee for a transaction based on
 * recent prioritization fees scoped to the transaction's writable accounts.
 */
export async function estimatePriorityFee(
  connection: Connection,
  transaction: VersionedTransaction,
  urgency: FeeUrgency = 'medium',
): Promise<number> {
  try {
    const writableAccounts = getWritableAccounts(transaction);
    // Limit to 128 accounts (RPC limit)
    const accountKeys = writableAccounts.slice(0, 128).map((k) => k.toBase58());

    if (accountKeys.length === 0) {
      return MIN_PRIORITY_FEE;
    }

    const recentFees = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: writableAccounts.slice(0, 128),
    });

    const feeValues = recentFees
      .map((f) => f.prioritizationFee)
      .filter((f) => f > 0);

    if (feeValues.length === 0) {
      return MIN_PRIORITY_FEE;
    }

    const pct = URGENCY_PERCENTILE[urgency];
    const estimated = percentile(feeValues, pct);
    return Math.max(estimated, MIN_PRIORITY_FEE);
  } catch (error) {
    console.warn('[PriorityFees] Failed to estimate, using minimum:', error);
    return MIN_PRIORITY_FEE;
  }
}

export interface ComputeBudgetEstimate {
  computeUnits: number;
  priorityFee: number;
}

/**
 * Optimize compute budget by simulating the transaction and estimating priority fees.
 * Returns the recommended CU limit (simulated * 1.3) and priority fee.
 * Falls back to defaults if simulation fails.
 */
export async function optimizeComputeBudget(
  connection: Connection,
  transaction: VersionedTransaction,
  urgency: FeeUrgency = 'medium',
): Promise<ComputeBudgetEstimate> {
  const priorityFee = await estimatePriorityFee(connection, transaction, urgency);

  try {
    const simResult = await connection.simulateTransaction(transaction, {
      replaceRecentBlockhash: true,
      sigVerify: false,
    });

    if (simResult.value.err) {
      console.warn('[ComputeBudget] Simulation returned error, using default CU:', simResult.value.err);
      return { computeUnits: DEFAULT_CU_LIMIT, priorityFee };
    }

    const unitsConsumed = simResult.value.unitsConsumed;
    if (unitsConsumed && unitsConsumed > 0) {
      const optimized = Math.ceil(unitsConsumed * CU_MARGIN);
      // Cap at 1.4M CU (Solana max) and floor at 50k
      const clamped = Math.max(50_000, Math.min(optimized, 1_400_000));
      return { computeUnits: clamped, priorityFee };
    }

    return { computeUnits: DEFAULT_CU_LIMIT, priorityFee };
  } catch (error) {
    console.warn('[ComputeBudget] Simulation failed, using default CU:', error);
    return { computeUnits: DEFAULT_CU_LIMIT, priorityFee };
  }
}

/**
 * Build compute budget instructions for a given estimate.
 */
export function buildComputeBudgetInstructions(estimate: ComputeBudgetEstimate) {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: estimate.computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: estimate.priorityFee }),
  ];
}
