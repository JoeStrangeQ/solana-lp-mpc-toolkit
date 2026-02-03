/**
 * MnM Leverage Service
 * Atomic leverage transactions for DLMM positions
 *
 * This service orchestrates the complete leverage loop:
 * 1. Flash borrow additional capital
 * 2. Create/add to DLMM position with total capital
 * 3. Deposit LP tokens as collateral
 * 4. Borrow against collateral to repay flash loan
 *
 * All steps happen atomically in a single transaction.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import BN from "bn.js";

// Import our services
import dlmmService, {
  createPosition,
  getPoolInfo,
  DLMM_POOLS,
  TOKEN_MINTS,
} from "./dlmmService";

import collateralService, {
  depositCollateral,
  borrow,
  calculateHealthFactor,
  calculateMaxBorrow,
  RISK_PARAMS,
} from "./collateralService";

// ============ Types ============

export interface LeverageParams {
  connection: Connection;
  user: Keypair;
  baseAsset: "SOL" | "USDC";
  baseAmount: number; // User's initial capital
  targetLeverage: number; // 2x-5x
  poolAddress: PublicKey;
  binRange?: number; // Default: 10 bins
  slippageTolerance?: number; // Default: 0.5%
}

export interface LeverageResult {
  transaction: Transaction;
  positionAddress: PublicKey;
  collateralPositionId: string;
  summary: {
    initialCapital: number;
    borrowedAmount: number;
    totalPositionSize: number;
    effectiveLeverage: number;
    estimatedHealthFactor: number;
    liquidationThreshold: number;
  };
}

export interface DeleverageParams {
  connection: Connection;
  user: Keypair;
  collateralPositionId: string;
  poolAddress: PublicKey;
  withdrawPercentage: number; // 0-100
}

export interface PositionStatus {
  positionAddress: PublicKey;
  collateralPositionId: string;
  poolPair: string;
  totalValueUSD: number;
  borrowedUSD: number;
  equityUSD: number;
  healthFactor: number;
  effectiveLeverage: number;
  status: "healthy" | "warning" | "danger" | "liquidatable";
  unrealizedPnL: number;
  pendingFees: number;
}

// ============ Flash Loan Sources ============

// Jupiter Flash Loan (placeholder)
const JUPITER_FLASH_LOAN_PROGRAM = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
);

// ============ Leverage Calculations ============

/**
 * Calculate amounts for leverage position
 */
export function calculateLeverageAmounts(
  baseAmount: number,
  targetLeverage: number,
  prices: { baseAssetPrice: number; quoteAssetPrice: number },
): {
  totalPositionSize: number;
  borrowRequired: number;
  tokenXAmount: number;
  tokenYAmount: number;
} {
  const totalPositionSize = baseAmount * targetLeverage;
  const borrowRequired = totalPositionSize - baseAmount;

  // For a balanced DLMM position, split 50/50 between tokens
  // In practice, this would be adjusted based on current bin/price
  const halfValue = totalPositionSize / 2;

  const tokenXAmount = halfValue / prices.baseAssetPrice;
  const tokenYAmount = halfValue / prices.quoteAssetPrice;

  return {
    totalPositionSize,
    borrowRequired,
    tokenXAmount,
    tokenYAmount,
  };
}

/**
 * Validate leverage parameters
 */
export function validateLeverageParams(
  targetLeverage: number,
  baseAmount: number,
): { valid: boolean; error?: string } {
  if (targetLeverage < 1.1) {
    return { valid: false, error: "Minimum leverage is 1.1x" };
  }

  // Max leverage based on LTV: 1 / (1 - LTV) = 1 / (1 - 0.8) = 5x
  const maxLeverage = 1 / (1 - RISK_PARAMS.MAX_LTV);
  if (targetLeverage > maxLeverage) {
    return {
      valid: false,
      error: `Maximum leverage is ${maxLeverage.toFixed(1)}x`,
    };
  }

  if (baseAmount <= 0) {
    return { valid: false, error: "Amount must be greater than 0" };
  }

  // Minimum position size (e.g., $10)
  const MIN_POSITION_USD = 10;
  if (baseAmount < MIN_POSITION_USD) {
    return {
      valid: false,
      error: `Minimum position size is $${MIN_POSITION_USD}`,
    };
  }

  return { valid: true };
}

/**
 * Calculate health factor after leverage
 */
export function estimatePostLeverageHealth(
  totalPositionValue: number,
  borrowedAmount: number,
): number {
  return calculateHealthFactor(totalPositionValue, borrowedAmount).healthFactor;
}

// ============ Leverage Operations ============

/**
 * Build atomic leverage transaction
 * This is the MAIN function that creates a leveraged DLMM position
 */
export async function buildLeverageTransaction(
  params: LeverageParams,
): Promise<LeverageResult> {
  const {
    connection,
    user,
    baseAsset,
    baseAmount,
    targetLeverage,
    poolAddress,
    binRange = 10,
    slippageTolerance = 0.5,
  } = params;

  // Validate parameters
  const validation = validateLeverageParams(targetLeverage, baseAmount);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Get pool info for pricing
  const poolInfo = await getPoolInfo(connection, poolAddress);

  // For this example, we'll assume base asset prices
  // In production, this would come from an oracle
  const prices = {
    baseAssetPrice: baseAsset === "SOL" ? 100 : 1, // SOL @ $100, USDC @ $1
    quoteAssetPrice: 1, // USDC @ $1
  };

  // Calculate amounts
  const amounts = calculateLeverageAmounts(baseAmount, targetLeverage, prices);

  // Convert to BN with proper decimals
  const tokenXDecimals = poolInfo.tokenX.decimals;
  const tokenYDecimals = poolInfo.tokenY.decimals;

  const tokenXAmountBN = new BN(
    Math.floor(amounts.tokenXAmount * Math.pow(10, tokenXDecimals)),
  );
  const tokenYAmountBN = new BN(
    Math.floor(amounts.tokenYAmount * Math.pow(10, tokenYDecimals)),
  );
  const borrowAmountBN = new BN(Math.floor(amounts.borrowRequired * 1e6)); // USDC decimals

  // Build the atomic transaction
  const transaction = new Transaction();

  // Add compute budget for complex transaction
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
  );

  // ============ STEP 1: Flash Borrow ============
  // In production, this would be a real flash loan instruction
  // For now, we'll use a placeholder that simulates the flow
  const flashBorrowIx = buildFlashBorrowInstruction(
    user.publicKey,
    borrowAmountBN,
    TOKEN_MINTS.USDC,
  );
  transaction.add(flashBorrowIx);

  // ============ STEP 2: Create DLMM Position ============
  const positionKeypair = new Keypair();
  const createPositionResult = await createPosition({
    connection,
    user,
    poolAddress,
    tokenXAmount: tokenXAmountBN,
    tokenYAmount: tokenYAmountBN,
    binRange,
  });

  // Add all instructions from create position
  transaction.add(...createPositionResult.transaction.instructions);

  // ============ STEP 3: Deposit LP as Collateral ============
  const depositResult = await depositCollateral({
    connection,
    user: user.publicKey,
    dlmmPoolAddress: poolAddress,
    dlmmPositionAddress: createPositionResult.positionAddress,
    prices: {
      tokenXPriceUSD: prices.baseAssetPrice,
      tokenYPriceUSD: prices.quoteAssetPrice,
    },
  });
  transaction.add(...depositResult.transaction.instructions);

  // ============ STEP 4: Borrow Against Collateral ============
  const borrowResult = await borrow({
    connection,
    user: user.publicKey,
    collateralPositionId: depositResult.collateralPositionAddress.toBase58(),
    borrowAmount: borrowAmountBN,
    borrowToken: TOKEN_MINTS.USDC,
  });
  transaction.add(...borrowResult.transaction.instructions);

  // ============ STEP 5: Repay Flash Loan ============
  const flashRepayIx = buildFlashRepayInstruction(
    user.publicKey,
    borrowAmountBN,
    TOKEN_MINTS.USDC,
  );
  transaction.add(flashRepayIx);

  // Set transaction metadata
  transaction.feePayer = user.publicKey;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  // Sign with position keypair
  transaction.partialSign(createPositionResult.positionKeypair);

  // Calculate summary
  const estimatedHealth = estimatePostLeverageHealth(
    amounts.totalPositionSize,
    amounts.borrowRequired,
  );

  const liquidationThreshold =
    amounts.borrowRequired / RISK_PARAMS.LIQUIDATION_THRESHOLD;

  return {
    transaction,
    positionAddress: createPositionResult.positionAddress,
    collateralPositionId: depositResult.collateralPositionAddress.toBase58(),
    summary: {
      initialCapital: baseAmount,
      borrowedAmount: amounts.borrowRequired,
      totalPositionSize: amounts.totalPositionSize,
      effectiveLeverage: targetLeverage,
      estimatedHealthFactor: estimatedHealth,
      liquidationThreshold,
    },
  };
}

/**
 * Build deleverage transaction
 * Reduces leverage by repaying debt and withdrawing collateral
 */
export async function buildDeleverageTransaction(
  params: DeleverageParams,
): Promise<Transaction> {
  const {
    connection,
    user,
    collateralPositionId,
    poolAddress,
    withdrawPercentage,
  } = params;

  if (withdrawPercentage < 0 || withdrawPercentage > 100) {
    throw new Error("Withdraw percentage must be between 0 and 100");
  }

  const transaction = new Transaction();

  // Add compute budget
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
  );

  // The deleverage flow would be:
  // 1. Remove liquidity from DLMM position (proportional to withdrawPercentage)
  // 2. Repay debt with removed liquidity
  // 3. If withdrawPercentage = 100, close collateral position

  // This is a placeholder - actual implementation would:
  // - Fetch current position state
  // - Calculate how much to repay
  // - Build remove liquidity instruction
  // - Build repay instruction
  // - Optionally close position

  console.log("Building deleverage transaction for:", {
    collateralPositionId,
    poolAddress: poolAddress.toBase58(),
    withdrawPercentage,
  });

  transaction.feePayer = user.publicKey;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  return transaction;
}

/**
 * Get status of all leveraged positions for a user
 */
export async function getUserLeveragedPositions(
  connection: Connection,
  user: PublicKey,
  prices: { SOL: number; USDC: number; USDT: number },
): Promise<PositionStatus[]> {
  // Fetch all collateral positions
  const collateralPositions =
    await collateralService.getUserCollateralPositions(
      connection,
      user,
      prices,
    );

  const positions: PositionStatus[] = [];

  for (const pos of collateralPositions) {
    const healthResult = calculateHealthFactor(
      pos.collateralValueUSD,
      pos.borrowedAmountUSD,
    );

    const equityUSD = pos.collateralValueUSD - pos.borrowedAmountUSD;
    const effectiveLeverage = pos.collateralValueUSD / equityUSD;

    positions.push({
      positionAddress: pos.dlmmPositionAddress,
      collateralPositionId: pos.id,
      poolPair: "SOL/USDC", // Would be derived from pool address
      totalValueUSD: pos.collateralValueUSD,
      borrowedUSD: pos.borrowedAmountUSD,
      equityUSD,
      healthFactor: healthResult.healthFactor,
      effectiveLeverage,
      status: healthResult.status === "safe" ? "healthy" : healthResult.status,
      unrealizedPnL: 0, // Would calculate from entry price
      pendingFees: 0, // Would fetch from DLMM position
    });
  }

  return positions;
}

// ============ Flash Loan Helpers ============

/**
 * Build flash borrow instruction
 * Placeholder - would integrate with Jupiter or Solend flash loans
 */
function buildFlashBorrowInstruction(
  borrower: PublicKey,
  amount: BN,
  token: PublicKey,
): TransactionInstruction {
  // This would be replaced with actual Jupiter/Solend flash loan instruction
  return new TransactionInstruction({
    keys: [
      { pubkey: borrower, isSigner: true, isWritable: true },
      { pubkey: token, isSigner: false, isWritable: false },
    ],
    programId: JUPITER_FLASH_LOAN_PROGRAM,
    data: Buffer.concat([
      Buffer.from([0]), // Flash borrow discriminator
      amount.toArrayLike(Buffer, "le", 8),
    ]),
  });
}

/**
 * Build flash repay instruction
 */
function buildFlashRepayInstruction(
  borrower: PublicKey,
  amount: BN,
  token: PublicKey,
): TransactionInstruction {
  // This would be replaced with actual flash loan repay instruction
  // Includes fee (typically 0.09% for Jupiter)
  const fee = amount.muln(9).divn(10000); // 0.09%
  const totalRepay = amount.add(fee);

  return new TransactionInstruction({
    keys: [
      { pubkey: borrower, isSigner: true, isWritable: true },
      { pubkey: token, isSigner: false, isWritable: false },
    ],
    programId: JUPITER_FLASH_LOAN_PROGRAM,
    data: Buffer.concat([
      Buffer.from([1]), // Flash repay discriminator
      totalRepay.toArrayLike(Buffer, "le", 8),
    ]),
  });
}

// ============ Adjustment Operations ============

/**
 * Increase leverage on existing position
 */
export async function increaseLeverage(
  connection: Connection,
  user: Keypair,
  collateralPositionId: string,
  additionalLeverage: number,
): Promise<Transaction> {
  // This would:
  // 1. Flash borrow additional capital
  // 2. Add liquidity to existing DLMM position
  // 3. Increase borrow against higher collateral
  // 4. Repay flash loan

  console.log("Increasing leverage for:", {
    collateralPositionId,
    additionalLeverage,
  });

  return new Transaction();
}

/**
 * Decrease leverage on existing position
 */
export async function decreaseLeverage(
  connection: Connection,
  user: Keypair,
  collateralPositionId: string,
  targetLeverage: number,
): Promise<Transaction> {
  // This would:
  // 1. Calculate how much to deleverage
  // 2. Remove proportional liquidity
  // 3. Repay proportional debt

  console.log("Decreasing leverage for:", {
    collateralPositionId,
    targetLeverage,
  });

  return new Transaction();
}

// ============ Export ============

export default {
  // Main operations
  buildLeverageTransaction,
  buildDeleverageTransaction,
  increaseLeverage,
  decreaseLeverage,

  // Status
  getUserLeveragedPositions,

  // Calculations
  calculateLeverageAmounts,
  validateLeverageParams,
  estimatePostLeverageHealth,

  // Re-export services for convenience
  dlmmService,
  collateralService,
};
