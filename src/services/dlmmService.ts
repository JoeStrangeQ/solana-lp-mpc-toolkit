/**
 * MnM DLMM Service
 * Meteora DLMM integration for creating and managing LP positions
 *
 * INSTALLATION REQUIRED:
 * pnpm add @meteora-ag/dlmm @solana/web3.js bn.js
 */

import DLMM, { StrategyType } from "@meteora-ag/dlmm";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";

// ============ Pool Addresses (Mainnet) ============

export const DLMM_POOLS = {
  // SOL/USDC - Most liquid
  SOL_USDC: new PublicKey("5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6"),
  // USDC/USDT - Stablecoin pair
  USDC_USDT: new PublicKey("ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq"),
  // SOL/USDT
  SOL_USDT: new PublicKey("Gf8YTgnugSZgdGBYYMpMi6v1bPgjCgX7BrrLzH6FNCvz"),
};

// Token mints
export const TOKEN_MINTS = {
  SOL: new PublicKey("So11111111111111111111111111111111111111112"),
  USDC: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  USDT: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
};

// ============ Types ============

export interface DLMMPoolInfo {
  address: PublicKey;
  tokenX: {
    mint: PublicKey;
    symbol: string;
    decimals: number;
  };
  tokenY: {
    mint: PublicKey;
    symbol: string;
    decimals: number;
  };
  activeBin: {
    binId: number;
    price: number;
  };
  binStep: number;
  liquidity: BN;
  feeRate: number;
}

export interface DLMMPosition {
  publicKey: PublicKey;
  owner: PublicKey;
  poolAddress: PublicKey;
  lowerBinId: number;
  upperBinId: number;
  liquidityShares: BN;
  tokenXAmount: BN;
  tokenYAmount: BN;
  unclaimedFees: {
    tokenX: BN;
    tokenY: BN;
  };
}

export interface CreatePositionParams {
  connection: Connection;
  user: Keypair;
  poolAddress: PublicKey;
  tokenXAmount: BN;
  tokenYAmount: BN;
  binRange: number; // Number of bins on each side of active bin
  strategyType?: StrategyType;
}

export interface LPTokenValue {
  totalValueUSD: number;
  tokenXAmount: BN;
  tokenYAmount: BN;
  tokenXValueUSD: number;
  tokenYValueUSD: number;
  positionRange: {
    lowerPrice: number;
    upperPrice: number;
  };
}

// ============ Pool Management ============

/**
 * Create a DLMM pool instance
 */
export async function createDLMMPool(
  connection: Connection,
  poolAddress: PublicKey,
): Promise<DLMM> {
  return await DLMM.create(connection, poolAddress);
}

/**
 * Get pool information
 */
export async function getPoolInfo(
  connection: Connection,
  poolAddress: PublicKey,
): Promise<DLMMPoolInfo> {
  const dlmmPool = await DLMM.create(connection, poolAddress);
  const activeBin = await dlmmPool.getActiveBin();

  return {
    address: poolAddress,
    tokenX: {
      mint: dlmmPool.tokenX.publicKey,
      symbol: dlmmPool.tokenX.publicKey.equals(TOKEN_MINTS.SOL)
        ? "SOL"
        : dlmmPool.tokenX.publicKey.equals(TOKEN_MINTS.USDC)
          ? "USDC"
          : "USDT",
      decimals: dlmmPool.tokenX.decimal,
    },
    tokenY: {
      mint: dlmmPool.tokenY.publicKey,
      symbol: dlmmPool.tokenY.publicKey.equals(TOKEN_MINTS.SOL)
        ? "SOL"
        : dlmmPool.tokenY.publicKey.equals(TOKEN_MINTS.USDC)
          ? "USDC"
          : "USDT",
      decimals: dlmmPool.tokenY.decimal,
    },
    activeBin: {
      binId: activeBin.binId,
      price: Number(activeBin.price),
    },
    binStep: dlmmPool.lbPair.binStep,
    liquidity: new BN(activeBin.xAmount).add(new BN(activeBin.yAmount)),
    feeRate: dlmmPool.lbPair.baseFactorBps / 10000, // Convert bps to decimal
  };
}

/**
 * Get all available DLMM pools
 */
export async function getAvailablePools(): Promise<
  {
    name: string;
    address: PublicKey;
    pair: string;
  }[]
> {
  return [
    { name: "SOL/USDC", address: DLMM_POOLS.SOL_USDC, pair: "SOL-USDC" },
    { name: "USDC/USDT", address: DLMM_POOLS.USDC_USDT, pair: "USDC-USDT" },
    { name: "SOL/USDT", address: DLMM_POOLS.SOL_USDT, pair: "SOL-USDT" },
  ];
}

// ============ Position Management ============

/**
 * Create a new DLMM position
 * This is the core function for opening a position on Meteora
 */
export async function createPosition(params: CreatePositionParams): Promise<{
  transaction: Transaction;
  positionKeypair: Keypair;
  positionAddress: PublicKey;
}> {
  const {
    connection,
    user,
    poolAddress,
    tokenXAmount,
    tokenYAmount,
    binRange,
    strategyType = StrategyType.Spot,
  } = params;

  // Create DLMM pool instance
  const dlmmPool = await DLMM.create(connection, poolAddress);

  // Get active bin to center the position
  const activeBin = await dlmmPool.getActiveBin();

  // Calculate bin range
  const minBinId = activeBin.binId - binRange;
  const maxBinId = activeBin.binId + binRange;

  // Generate new position keypair
  const positionKeypair = new Keypair();

  // Create position and add liquidity
  const createPositionTx =
    await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      user: user.publicKey,
      totalXAmount: tokenXAmount,
      totalYAmount: tokenYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType,
      },
    });

  return {
    transaction: createPositionTx,
    positionKeypair,
    positionAddress: positionKeypair.publicKey,
  };
}

/**
 * Get user's positions in a specific pool
 */
export async function getUserPositions(
  connection: Connection,
  poolAddress: PublicKey,
  userAddress: PublicKey,
): Promise<DLMMPosition[]> {
  const dlmmPool = await DLMM.create(connection, poolAddress);
  const positions = await dlmmPool.getPositionsByUserAndLbPair(userAddress);

  return positions.userPositions.map((pos) => ({
    publicKey: pos.publicKey,
    owner: userAddress,
    poolAddress,
    lowerBinId: pos.positionData.lowerBinId,
    upperBinId: pos.positionData.upperBinId,
    liquidityShares: new BN(pos.positionData.totalClaimedFeeXAmount || 0), // Simplified
    tokenXAmount: new BN(0), // Would need to calculate from bin data
    tokenYAmount: new BN(0),
    unclaimedFees: {
      tokenX: new BN(pos.positionData.feeX || 0),
      tokenY: new BN(pos.positionData.feeY || 0),
    },
  }));
}

/**
 * Get all user positions across all supported pools
 */
export async function getAllUserPositions(
  connection: Connection,
  userAddress: PublicKey,
): Promise<DLMMPosition[]> {
  const allPositions: DLMMPosition[] = [];

  for (const [, poolAddress] of Object.entries(DLMM_POOLS)) {
    try {
      const positions = await getUserPositions(
        connection,
        poolAddress,
        userAddress,
      );
      allPositions.push(...positions);
    } catch (e) {
      // Pool might not have any positions, continue
      console.log(`No positions found in pool ${poolAddress.toBase58()}`);
    }
  }

  return allPositions;
}

// ============ LP Token Valuation ============

/**
 * Calculate the value of a DLMM position / LP tokens
 * This is CRITICAL for collateral valuation
 */
export async function getPositionValue(
  connection: Connection,
  poolAddress: PublicKey,
  positionAddress: PublicKey,
  prices: { tokenXPriceUSD: number; tokenYPriceUSD: number },
): Promise<LPTokenValue> {
  const dlmmPool = await DLMM.create(connection, poolAddress);

  // Get position bin data
  const positions = await dlmmPool.getPosition(positionAddress);

  if (!positions) {
    throw new Error("Position not found");
  }

  // Calculate token amounts from position bins
  // This is simplified - actual implementation would iterate through bins
  const positionData = positions.positionData;

  // Get the bin array for this position's range
  const binData = await dlmmPool.getBinsBetweenLowerAndUpperBound(
    positionData.lowerBinId,
    positionData.upperBinId,
  );

  let totalTokenX = new BN(0);
  let totalTokenY = new BN(0);

  // Sum up liquidity across bins (simplified)
  for (const bin of binData) {
    totalTokenX = totalTokenX.add(new BN(bin.xAmount));
    totalTokenY = totalTokenY.add(new BN(bin.yAmount));
  }

  // Convert to decimals for USD calculation
  const tokenXDecimals = dlmmPool.tokenX.decimal;
  const tokenYDecimals = dlmmPool.tokenY.decimal;

  const tokenXAmountDecimal =
    totalTokenX.toNumber() / Math.pow(10, tokenXDecimals);
  const tokenYAmountDecimal =
    totalTokenY.toNumber() / Math.pow(10, tokenYDecimals);

  const tokenXValueUSD = tokenXAmountDecimal * prices.tokenXPriceUSD;
  const tokenYValueUSD = tokenYAmountDecimal * prices.tokenYPriceUSD;
  const totalValueUSD = tokenXValueUSD + tokenYValueUSD;

  // Calculate price range
  const lowerPrice = dlmmPool.fromPricePerLamport(positionData.lowerBinId);
  const upperPrice = dlmmPool.fromPricePerLamport(positionData.upperBinId);

  return {
    totalValueUSD,
    tokenXAmount: totalTokenX,
    tokenYAmount: totalTokenY,
    tokenXValueUSD,
    tokenYValueUSD,
    positionRange: {
      lowerPrice: Number(lowerPrice),
      upperPrice: Number(upperPrice),
    },
  };
}

// ============ Liquidity Operations ============

/**
 * Add liquidity to an existing position
 */
export async function addLiquidity(
  connection: Connection,
  user: Keypair,
  poolAddress: PublicKey,
  positionAddress: PublicKey,
  tokenXAmount: BN,
  tokenYAmount: BN,
): Promise<Transaction> {
  const dlmmPool = await DLMM.create(connection, poolAddress);
  const position = await dlmmPool.getPosition(positionAddress);

  if (!position) {
    throw new Error("Position not found");
  }

  // Add liquidity to existing position
  const addLiquidityTx = await dlmmPool.addLiquidityByStrategy({
    positionPubKey: positionAddress,
    user: user.publicKey,
    totalXAmount: tokenXAmount,
    totalYAmount: tokenYAmount,
    strategy: {
      maxBinId: position.positionData.upperBinId,
      minBinId: position.positionData.lowerBinId,
      strategyType: StrategyType.Spot,
    },
  });

  return addLiquidityTx;
}

/**
 * Remove liquidity from a position
 */
export async function removeLiquidity(
  connection: Connection,
  user: Keypair,
  poolAddress: PublicKey,
  positionAddress: PublicKey,
  bps: number, // Basis points to remove (10000 = 100%)
): Promise<Transaction> {
  const dlmmPool = await DLMM.create(connection, poolAddress);
  const position = await dlmmPool.getPosition(positionAddress);

  if (!position) {
    throw new Error("Position not found");
  }

  // Get bin IDs for this position
  const binIds = [];
  for (
    let i = position.positionData.lowerBinId;
    i <= position.positionData.upperBinId;
    i++
  ) {
    binIds.push(i);
  }

  // Remove liquidity
  const removeLiquidityTx = await dlmmPool.removeLiquidity({
    position: positionAddress,
    user: user.publicKey,
    binIds,
    bps: new BN(bps),
    shouldClaimAndClose: bps === 10000, // Close position if removing all
  });

  return removeLiquidityTx;
}

/**
 * Claim fees from a position
 */
export async function claimFees(
  connection: Connection,
  user: Keypair,
  poolAddress: PublicKey,
  positionAddress: PublicKey,
): Promise<Transaction> {
  const dlmmPool = await DLMM.create(connection, poolAddress);

  const claimFeeTx = await dlmmPool.claimSwapFee({
    owner: user.publicKey,
    position: positionAddress,
  });

  return claimFeeTx;
}

// ============ Helper Functions ============

/**
 * Calculate optimal bin range based on volatility
 */
export function calculateOptimalBinRange(
  volatility: "low" | "medium" | "high",
  binStep: number,
): number {
  // Returns number of bins on each side of active bin
  switch (volatility) {
    case "low":
      return Math.floor(50 / binStep); // ~5% range
    case "medium":
      return Math.floor(100 / binStep); // ~10% range
    case "high":
      return Math.floor(200 / binStep); // ~20% range
    default:
      return 10;
  }
}

/**
 * Estimate impermanent loss for a position
 */
export function estimateImpermanentLoss(
  entryPrice: number,
  currentPrice: number,
): number {
  const priceRatio = currentPrice / entryPrice;
  const sqrtPriceRatio = Math.sqrt(priceRatio);
  const il = (2 * sqrtPriceRatio) / (1 + priceRatio) - 1;
  return Math.abs(il) * 100; // Return as percentage
}

/**
 * Get recommended strategy type based on market conditions
 */
export function getRecommendedStrategy(
  marketCondition: "bullish" | "bearish" | "neutral",
): StrategyType {
  switch (marketCondition) {
    case "bullish":
      return StrategyType.BidAsk; // More liquidity on ask side
    case "bearish":
      return StrategyType.BidAsk; // More liquidity on bid side
    case "neutral":
    default:
      return StrategyType.Spot; // Balanced distribution
  }
}

// ============ Export all functions ============

export default {
  // Pool management
  createDLMMPool,
  getPoolInfo,
  getAvailablePools,

  // Position management
  createPosition,
  getUserPositions,
  getAllUserPositions,

  // Valuation
  getPositionValue,

  // Liquidity operations
  addLiquidity,
  removeLiquidity,
  claimFees,

  // Helpers
  calculateOptimalBinRange,
  estimateImpermanentLoss,
  getRecommendedStrategy,

  // Constants
  DLMM_POOLS,
  TOKEN_MINTS,
};
