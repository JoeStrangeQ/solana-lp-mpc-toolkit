/**
 * Fee Collector for LP Toolkit
 *
 * Business Model:
 * - 0.1% fee on LP transactions executed through toolkit
 * - Paid by calling agent/bot
 * - Collected in USDC to protocol treasury
 * - Split: 70% treasury, 30% referrer (if any)
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createTransferInstruction,
} from "@solana/spl-token";

// ============ Constants ============

// Protocol fee: 0.1% = 10 basis points
export const PROTOCOL_FEE_BPS = 10;

// Fee split
export const TREASURY_SPLIT = 70; // 70%
export const REFERRER_SPLIT = 30; // 30%

// Treasury addresses (placeholder - would be real addresses in production)
export const TREASURY_WALLET = new PublicKey(
  "GZctHpWXmsZC1YHACTGGcHhYxjdRqQvTpYkb9LMvxDib",
);

// USDC mint on Solana mainnet
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

// Minimum fee to collect (avoid dust)
export const MIN_FEE_USD = 0.01;

// ============ Types ============

export interface FeeCalculation {
  transactionValueUSD: number;
  feeAmountUSD: number;
  feeAmountRaw: bigint; // In USDC smallest unit (6 decimals)
  treasuryAmount: bigint;
  referrerAmount: bigint;
  referrerWallet?: PublicKey;
}

export interface FeeReceipt {
  id: string;
  timestamp: number;
  transactionValueUSD: number;
  feeAmountUSD: number;
  operation: "add_liquidity" | "remove_liquidity" | "claim_fees" | "rebalance";
  venue: string;
  poolName: string;
  payer: string;
  referrer?: string;
  txSignature?: string;
  status: "pending" | "collected" | "failed";
}

// ============ Fee Calculator ============

/**
 * Calculate fee for a transaction
 */
export function calculateFee(
  transactionValueUSD: number,
  referrerWallet?: PublicKey,
): FeeCalculation {
  // Calculate fee in USD
  const feeAmountUSD = (transactionValueUSD * PROTOCOL_FEE_BPS) / 10000;

  // Convert to USDC raw amount (6 decimals)
  const feeAmountRaw = BigInt(Math.floor(feeAmountUSD * 1_000_000));

  // Calculate splits
  const treasuryAmount = (feeAmountRaw * BigInt(TREASURY_SPLIT)) / BigInt(100);
  const referrerAmount = referrerWallet
    ? (feeAmountRaw * BigInt(REFERRER_SPLIT)) / BigInt(100)
    : BigInt(0);

  return {
    transactionValueUSD,
    feeAmountUSD,
    feeAmountRaw,
    treasuryAmount: referrerWallet ? treasuryAmount : feeAmountRaw,
    referrerAmount,
    referrerWallet,
  };
}

/**
 * Check if fee is worth collecting
 */
export function shouldCollectFee(feeAmountUSD: number): boolean {
  return feeAmountUSD >= MIN_FEE_USD;
}

// ============ Fee Collection ============

/**
 * Create fee collection instruction(s)
 */
export async function createFeeCollectionIx(
  connection: Connection,
  payer: PublicKey,
  feeCalc: FeeCalculation,
): Promise<Transaction> {
  const tx = new Transaction();

  if (!shouldCollectFee(feeCalc.feeAmountUSD)) {
    // Fee too small, skip
    return tx;
  }

  // Get payer's USDC token account
  const payerUsdcAccount = await getAssociatedTokenAddress(USDC_MINT, payer);

  // Get treasury USDC token account
  const treasuryUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    TREASURY_WALLET,
  );

  // Transfer to treasury
  tx.add(
    createTransferInstruction(
      payerUsdcAccount,
      treasuryUsdcAccount,
      payer,
      feeCalc.treasuryAmount,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  // Transfer to referrer if applicable
  if (feeCalc.referrerWallet && feeCalc.referrerAmount > BigInt(0)) {
    const referrerUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      feeCalc.referrerWallet,
    );

    tx.add(
      createTransferInstruction(
        payerUsdcAccount,
        referrerUsdcAccount,
        payer,
        feeCalc.referrerAmount,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  return tx;
}

// ============ Fee Tracking ============

/**
 * Create a fee receipt for logging
 */
export function createFeeReceipt(
  operation: FeeReceipt["operation"],
  venue: string,
  poolName: string,
  payer: PublicKey,
  feeCalc: FeeCalculation,
  txSignature?: string,
): FeeReceipt {
  return {
    id: generateReceiptId(),
    timestamp: Date.now(),
    transactionValueUSD: feeCalc.transactionValueUSD,
    feeAmountUSD: feeCalc.feeAmountUSD,
    operation,
    venue,
    poolName,
    payer: payer.toBase58(),
    referrer: feeCalc.referrerWallet?.toBase58(),
    txSignature,
    status: txSignature ? "collected" : "pending",
  };
}

/**
 * Generate unique receipt ID
 */
function generateReceiptId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `fee_${timestamp}_${random}`;
}

// ============ Fee Service Class ============

export class FeeCollector {
  private connection: Connection;
  private referrerWallet?: PublicKey;
  private receipts: FeeReceipt[] = [];

  constructor(connection: Connection, referrerWallet?: PublicKey) {
    this.connection = connection;
    this.referrerWallet = referrerWallet;
  }

  /**
   * Calculate and optionally collect fee for an operation
   */
  async processOperation(
    payer: PublicKey,
    operation: FeeReceipt["operation"],
    venue: string,
    poolName: string,
    transactionValueUSD: number,
    collectNow: boolean = false,
  ): Promise<{
    feeCalc: FeeCalculation;
    receipt: FeeReceipt;
    collectIx?: Transaction;
  }> {
    const feeCalc = calculateFee(transactionValueUSD, this.referrerWallet);

    let collectIx: Transaction | undefined;
    if (collectNow && shouldCollectFee(feeCalc.feeAmountUSD)) {
      collectIx = await createFeeCollectionIx(this.connection, payer, feeCalc);
    }

    const receipt = createFeeReceipt(
      operation,
      venue,
      poolName,
      payer,
      feeCalc,
    );

    this.receipts.push(receipt);

    return { feeCalc, receipt, collectIx };
  }

  /**
   * Get all receipts
   */
  getReceipts(): FeeReceipt[] {
    return [...this.receipts];
  }

  /**
   * Get total fees collected
   */
  getTotalFeesUSD(): number {
    return this.receipts
      .filter((r) => r.status === "collected")
      .reduce((sum, r) => sum + r.feeAmountUSD, 0);
  }

  /**
   * Get pending fees
   */
  getPendingFeesUSD(): number {
    return this.receipts
      .filter((r) => r.status === "pending")
      .reduce((sum, r) => sum + r.feeAmountUSD, 0);
  }

  /**
   * Update receipt status
   */
  updateReceiptStatus(
    receiptId: string,
    status: FeeReceipt["status"],
    txSignature?: string,
  ): void {
    const receipt = this.receipts.find((r) => r.id === receiptId);
    if (receipt) {
      receipt.status = status;
      if (txSignature) receipt.txSignature = txSignature;
    }
  }
}

// ============ Exports ============

export default {
  PROTOCOL_FEE_BPS,
  TREASURY_SPLIT,
  REFERRER_SPLIT,
  calculateFee,
  shouldCollectFee,
  createFeeCollectionIx,
  createFeeReceipt,
  FeeCollector,
};
