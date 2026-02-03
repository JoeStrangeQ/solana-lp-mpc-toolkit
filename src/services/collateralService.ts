/**
 * MnM Collateral Service
 * Manages LP tokens as collateral for borrowing
 *
 * This service handles:
 * - Depositing DLMM LP positions as collateral
 * - Tracking collateral value
 * - Managing health factors and liquidation thresholds
 * - Withdrawing collateral
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import BN from "bn.js";
import { getPositionValue, LPTokenValue } from "./dlmmService";

// ============ Program Constants ============

// MnM Collateral Vault Program ID (to be deployed)
export const COLLATERAL_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111",
); // PLACEHOLDER

// Risk Parameters
export const RISK_PARAMS = {
  MAX_LTV: 0.8, // 80% max loan-to-value
  LIQUIDATION_THRESHOLD: 0.85, // 85% - position liquidated above this
  LIQUIDATION_PENALTY: 0.05, // 5% penalty on liquidation
  MIN_HEALTH_FACTOR: 1.0, // Below 1.0 = liquidatable
  HEALTH_WARNING: 1.2, // Warning threshold
  HEALTH_SAFE: 1.5, // Considered safe above this
};

// ============ Types ============

export interface CollateralPosition {
  id: string;
  owner: PublicKey;
  dlmmPoolAddress: PublicKey;
  dlmmPositionAddress: PublicKey;
  depositedAt: number;
  collateralValueUSD: number;
  borrowedAmountUSD: number;
  healthFactor: number;
  status: "active" | "warning" | "liquidatable" | "liquidated";
}

export interface CollateralVault {
  address: PublicKey;
  totalCollateralUSD: number;
  totalBorrowedUSD: number;
  utilizationRate: number;
  availableToBorrow: number;
}

export interface DepositCollateralParams {
  connection: Connection;
  user: PublicKey;
  dlmmPoolAddress: PublicKey;
  dlmmPositionAddress: PublicKey;
  prices: { tokenXPriceUSD: number; tokenYPriceUSD: number };
}

export interface BorrowParams {
  connection: Connection;
  user: PublicKey;
  collateralPositionId: string;
  borrowAmount: BN;
  borrowToken: PublicKey; // USDC or SOL
}

export interface HealthFactorResult {
  healthFactor: number;
  status: "safe" | "warning" | "danger" | "liquidatable";
  collateralValueUSD: number;
  borrowedAmountUSD: number;
  maxBorrowableUSD: number;
  availableToBorrowUSD: number;
}

// ============ PDA Derivation ============

/**
 * Derive the collateral vault PDA
 */
export function deriveCollateralVaultPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault")],
    COLLATERAL_PROGRAM_ID,
  );
}

/**
 * Derive user's collateral position PDA
 */
export function deriveCollateralPositionPDA(
  user: PublicKey,
  dlmmPosition: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("collateral_position"),
      user.toBuffer(),
      dlmmPosition.toBuffer(),
    ],
    COLLATERAL_PROGRAM_ID,
  );
}

/**
 * Derive user's loan PDA
 */
export function deriveLoanPDA(
  user: PublicKey,
  collateralPosition: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("loan"), user.toBuffer(), collateralPosition.toBuffer()],
    COLLATERAL_PROGRAM_ID,
  );
}

// ============ Health Factor Calculations ============

/**
 * Calculate health factor for a collateral position
 * Health Factor = (Collateral Value * Liquidation Threshold) / Borrowed Amount
 * HF > 1 = Safe, HF < 1 = Liquidatable
 */
export function calculateHealthFactor(
  collateralValueUSD: number,
  borrowedAmountUSD: number,
): HealthFactorResult {
  if (borrowedAmountUSD === 0) {
    return {
      healthFactor: Infinity,
      status: "safe",
      collateralValueUSD,
      borrowedAmountUSD,
      maxBorrowableUSD: collateralValueUSD * RISK_PARAMS.MAX_LTV,
      availableToBorrowUSD: collateralValueUSD * RISK_PARAMS.MAX_LTV,
    };
  }

  const healthFactor =
    (collateralValueUSD * RISK_PARAMS.LIQUIDATION_THRESHOLD) /
    borrowedAmountUSD;
  const maxBorrowableUSD = collateralValueUSD * RISK_PARAMS.MAX_LTV;
  const availableToBorrowUSD = Math.max(
    0,
    maxBorrowableUSD - borrowedAmountUSD,
  );

  let status: "safe" | "warning" | "danger" | "liquidatable";
  if (healthFactor < RISK_PARAMS.MIN_HEALTH_FACTOR) {
    status = "liquidatable";
  } else if (healthFactor < RISK_PARAMS.HEALTH_WARNING) {
    status = "danger";
  } else if (healthFactor < RISK_PARAMS.HEALTH_SAFE) {
    status = "warning";
  } else {
    status = "safe";
  }

  return {
    healthFactor,
    status,
    collateralValueUSD,
    borrowedAmountUSD,
    maxBorrowableUSD,
    availableToBorrowUSD,
  };
}

/**
 * Calculate maximum borrowable amount based on collateral
 */
export function calculateMaxBorrow(collateralValueUSD: number): number {
  return collateralValueUSD * RISK_PARAMS.MAX_LTV;
}

/**
 * Calculate liquidation price for a position
 * Returns the LP value threshold at which position becomes liquidatable
 */
export function calculateLiquidationThreshold(
  borrowedAmountUSD: number,
): number {
  return borrowedAmountUSD / RISK_PARAMS.LIQUIDATION_THRESHOLD;
}

// ============ Collateral Operations ============

/**
 * Deposit a DLMM position as collateral
 * This transfers ownership of the position to the collateral vault
 */
export async function depositCollateral(
  params: DepositCollateralParams,
): Promise<{
  transaction: Transaction;
  collateralPositionAddress: PublicKey;
  collateralValueUSD: number;
}> {
  const { connection, user, dlmmPoolAddress, dlmmPositionAddress, prices } =
    params;

  // Calculate the value of the LP position
  const lpValue = await getPositionValue(
    connection,
    dlmmPoolAddress,
    dlmmPositionAddress,
    prices,
  );

  // Derive PDAs
  const [collateralVault] = deriveCollateralVaultPDA();
  const [collateralPosition] = deriveCollateralPositionPDA(
    user,
    dlmmPositionAddress,
  );

  // Build instruction to deposit LP position as collateral
  // This would transfer the DLMM position NFT/token to the vault
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: dlmmPositionAddress, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: collateralPosition, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: COLLATERAL_PROGRAM_ID,
    data: Buffer.from([0]), // Instruction discriminator for deposit
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  return {
    transaction,
    collateralPositionAddress: collateralPosition,
    collateralValueUSD: lpValue.totalValueUSD,
  };
}

/**
 * Borrow against deposited collateral
 */
export async function borrow(params: BorrowParams): Promise<{
  transaction: Transaction;
  borrowedAmount: BN;
  newHealthFactor: number;
}> {
  const { connection, user, collateralPositionId, borrowAmount, borrowToken } =
    params;

  // Parse collateral position ID to get addresses
  const collateralPosition = new PublicKey(collateralPositionId);
  const [loan] = deriveLoanPDA(user, collateralPosition);
  const [collateralVault] = deriveCollateralVaultPDA();

  // Get user's token account for borrowed asset
  const userBorrowAccount = await getAssociatedTokenAddress(borrowToken, user);

  // Build borrow instruction
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: collateralPosition, isSigner: false, isWritable: true },
      { pubkey: loan, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: userBorrowAccount, isSigner: false, isWritable: true },
      { pubkey: borrowToken, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: COLLATERAL_PROGRAM_ID,
    data: Buffer.concat([
      Buffer.from([1]), // Instruction discriminator for borrow
      borrowAmount.toArrayLike(Buffer, "le", 8),
    ]),
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  // Note: newHealthFactor should be fetched from on-chain state after tx
  return {
    transaction,
    borrowedAmount,
    newHealthFactor: 0, // Would be calculated after execution
  };
}

/**
 * Repay borrowed amount
 */
export async function repay(
  connection: Connection,
  user: PublicKey,
  collateralPositionId: string,
  repayAmount: BN,
  repayToken: PublicKey,
): Promise<Transaction> {
  const collateralPosition = new PublicKey(collateralPositionId);
  const [loan] = deriveLoanPDA(user, collateralPosition);
  const [collateralVault] = deriveCollateralVaultPDA();
  const userRepayAccount = await getAssociatedTokenAddress(repayToken, user);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: collateralPosition, isSigner: false, isWritable: true },
      { pubkey: loan, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: userRepayAccount, isSigner: false, isWritable: true },
      { pubkey: repayToken, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: COLLATERAL_PROGRAM_ID,
    data: Buffer.concat([
      Buffer.from([2]), // Instruction discriminator for repay
      repayAmount.toArrayLike(Buffer, "le", 8),
    ]),
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  return transaction;
}

/**
 * Withdraw collateral after repaying loan
 */
export async function withdrawCollateral(
  connection: Connection,
  user: PublicKey,
  collateralPositionId: string,
): Promise<Transaction> {
  const collateralPosition = new PublicKey(collateralPositionId);
  const [collateralVault] = deriveCollateralVaultPDA();

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: collateralPosition, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: COLLATERAL_PROGRAM_ID,
    data: Buffer.from([3]), // Instruction discriminator for withdraw
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  return transaction;
}

// ============ Position Monitoring ============

/**
 * Get all collateral positions for a user
 */
export async function getUserCollateralPositions(
  connection: Connection,
  user: PublicKey,
  prices: { SOL: number; USDC: number; USDT: number },
): Promise<CollateralPosition[]> {
  // This would fetch from on-chain state
  // For now, return empty array as placeholder
  console.log("Fetching collateral positions for:", user.toBase58());
  return [];
}

/**
 * Check if a position is liquidatable
 */
export function isLiquidatable(healthFactor: number): boolean {
  return healthFactor < RISK_PARAMS.MIN_HEALTH_FACTOR;
}

/**
 * Check if a position needs attention (warning state)
 */
export function needsAttention(healthFactor: number): boolean {
  return healthFactor < RISK_PARAMS.HEALTH_WARNING;
}

// ============ Liquidation ============

/**
 * Liquidate an unhealthy position
 * Returns the transaction for liquidators to execute
 */
export async function liquidate(
  connection: Connection,
  liquidator: PublicKey,
  collateralPositionId: string,
  repayAmount: BN,
  repayToken: PublicKey,
): Promise<{
  transaction: Transaction;
  expectedCollateral: BN;
  liquidationBonus: BN;
}> {
  const collateralPosition = new PublicKey(collateralPositionId);
  const [collateralVault] = deriveCollateralVaultPDA();
  const liquidatorRepayAccount = await getAssociatedTokenAddress(
    repayToken,
    liquidator,
  );

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: liquidator, isSigner: true, isWritable: true },
      { pubkey: collateralPosition, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: liquidatorRepayAccount, isSigner: false, isWritable: true },
      { pubkey: repayToken, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: COLLATERAL_PROGRAM_ID,
    data: Buffer.concat([
      Buffer.from([4]), // Instruction discriminator for liquidate
      repayAmount.toArrayLike(Buffer, "le", 8),
    ]),
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = liquidator;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  // Calculate expected collateral (includes liquidation bonus)
  const repayAmountNum = repayAmount.toNumber();
  const collateralAmount =
    repayAmountNum * (1 + RISK_PARAMS.LIQUIDATION_PENALTY);

  return {
    transaction,
    expectedCollateral: new BN(collateralAmount),
    liquidationBonus: new BN(repayAmountNum * RISK_PARAMS.LIQUIDATION_PENALTY),
  };
}

// ============ Export ============

export default {
  // PDAs
  deriveCollateralVaultPDA,
  deriveCollateralPositionPDA,
  deriveLoanPDA,

  // Calculations
  calculateHealthFactor,
  calculateMaxBorrow,
  calculateLiquidationThreshold,
  isLiquidatable,
  needsAttention,

  // Operations
  depositCollateral,
  borrow,
  repay,
  withdrawCollateral,
  liquidate,

  // Monitoring
  getUserCollateralPositions,

  // Constants
  RISK_PARAMS,
  COLLATERAL_PROGRAM_ID,
};
