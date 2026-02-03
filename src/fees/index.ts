/**
 * Fee Collection Service
 * 
 * 1% revenue model on every transaction executed through the API
 * Fees are collected in the transaction's output token
 */

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

// Protocol fee configuration
export const FEE_CONFIG = {
  // 1% fee on every transaction
  FEE_BPS: 100, // 100 basis points = 1%
  
  // Protocol treasury (receives fees)
  TREASURY_ADDRESS: new PublicKey('BNQnCszvPwYfjBMUmFgmCooMSRrdkC7LncMQBExDakLp'),
  
  // Minimum fee to avoid dust (in lamports for SOL, or token units)
  MIN_FEE_LAMPORTS: 10000, // 0.00001 SOL
  
  // Fee exemption threshold (small txs below this don't pay fees)
  EXEMPT_THRESHOLD_USD: 1,
};

export interface FeeCalculation {
  /** Original amount */
  grossAmount: number;
  /** Fee amount (1%) */
  feeAmount: number;
  /** Amount after fee deduction */
  netAmount: number;
  /** Fee in basis points */
  feeBps: number;
  /** Fee recipient */
  treasury: string;
}

/**
 * Calculate the 1% protocol fee for a transaction amount
 */
export function calculateFee(amount: number): FeeCalculation {
  const feeAmount = Math.floor(amount * FEE_CONFIG.FEE_BPS / 10000);
  const netAmount = amount - feeAmount;
  
  return {
    grossAmount: amount,
    feeAmount: Math.max(feeAmount, 0),
    netAmount,
    feeBps: FEE_CONFIG.FEE_BPS,
    treasury: FEE_CONFIG.TREASURY_ADDRESS.toBase58(),
  };
}

/**
 * Create fee transfer instruction for SOL
 */
export function createSolFeeInstruction(
  payer: PublicKey,
  amount: number
): TransactionInstruction | null {
  const fee = calculateFee(amount);
  
  if (fee.feeAmount < FEE_CONFIG.MIN_FEE_LAMPORTS) {
    return null; // Below minimum, skip fee
  }
  
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: FEE_CONFIG.TREASURY_ADDRESS,
    lamports: fee.feeAmount,
  });
}

/**
 * Create fee transfer instruction for SPL tokens
 */
export async function createTokenFeeInstruction(
  payer: PublicKey,
  tokenMint: PublicKey,
  amount: number
): Promise<TransactionInstruction | null> {
  const fee = calculateFee(amount);
  
  if (fee.feeAmount === 0) {
    return null;
  }
  
  const payerAta = await getAssociatedTokenAddress(tokenMint, payer);
  const treasuryAta = await getAssociatedTokenAddress(tokenMint, FEE_CONFIG.TREASURY_ADDRESS);
  
  return createTransferInstruction(
    payerAta,
    treasuryAta,
    payer,
    fee.feeAmount,
    [],
    TOKEN_PROGRAM_ID
  );
}

/**
 * Format fee for display
 */
export function formatFee(fee: FeeCalculation, symbol: string = ''): string {
  const feeStr = fee.feeAmount.toLocaleString();
  const pct = (fee.feeBps / 100).toFixed(2);
  return `${feeStr} ${symbol} (${pct}% protocol fee)`.trim();
}

/**
 * Fee breakdown for API responses
 */
export interface FeeBreakdown {
  protocol: {
    bps: number;
    amount: number;
    recipient: string;
  };
  network: {
    estimatedLamports: number;
  };
  total: {
    grossAmount: number;
    netAmount: number;
  };
}

export function createFeeBreakdown(
  amount: number,
  estimatedNetworkFee: number = 5000
): FeeBreakdown {
  const fee = calculateFee(amount);
  
  return {
    protocol: {
      bps: fee.feeBps,
      amount: fee.feeAmount,
      recipient: fee.treasury,
    },
    network: {
      estimatedLamports: estimatedNetworkFee,
    },
    total: {
      grossAmount: fee.grossAmount,
      netAmount: fee.netAmount,
    },
  };
}

export default {
  calculateFee,
  createSolFeeInstruction,
  createTokenFeeInstruction,
  formatFee,
  createFeeBreakdown,
  FEE_CONFIG,
};
