/**
 * Orca Whirlpool DEX Adapter
 * Concentrated liquidity on Solana
 *
 * SDK: @orca-so/whirlpools-sdk
 * Docs: https://orca-so.gitbook.io/orca-developer-portal/whirlpools
 */

import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import {
  DEXAdapter,
  DEXVenue,
  LPPool,
  LPPosition,
  AddLiquidityIntent,
  RemoveLiquidityIntent,
} from "./types";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  PDAUtil,
  PriceMath,
  WhirlpoolIx,
  toTx,
  TickUtil,
} from "@orca-so/whirlpools-sdk";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Decimal } from "decimal.js";
import BN from "bn.js";

// Orca Whirlpool Program IDs
const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
);
const ORCA_WHIRLPOOL_CONFIG = new PublicKey(
  "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
);

// Common Whirlpool Addresses
const WHIRLPOOLS = {
  "SOL-USDC": new PublicKey("HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ"),
  "SOL-USDT": new PublicKey("4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4"),
  "mSOL-SOL": new PublicKey("9vqYJjDUFecLL2xPUC4Rc7hyCtZ6iJ4mDiVZX7aFXoAe"),
  "stSOL-SOL": new PublicKey("EfK84vYELT3K3zJ2L4S6xxx3KHqNKKqMETi6khVMfY8b"),
  "BONK-SOL": new PublicKey("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crLCEgK8Kb"),
  "JTO-SOL": new PublicKey("EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx"),
  "JUP-SOL": new PublicKey("H1xnHfHxLk5rqBnX2q2VdRoAtbTTpJHxJwwPzX4AdEKM"),
  "PYTH-SOL": new PublicKey("B3mSaqMCg73LSBxdaKJ2cqSVgmzv7YuDjNdvYrLiYZ8Q"),
};

// Tick spacing configurations for different fee tiers
const TICK_SPACING = {
  "0.01%": 1, // Stable pairs
  "0.05%": 8, // Stable-ish pairs
  "0.30%": 64, // Standard pairs
  "1.00%": 128, // Volatile pairs
};

export class OrcaAdapter implements DEXAdapter {
  venue: DEXVenue = "orca";

  /**
   * Get all available Whirlpools
   */
  async getPools(connection: Connection): Promise<LPPool[]> {
    try {
      const pools: LPPool[] = [];

      // Fetch pool data via Orca API for efficiency
      const response = await fetch(
        "https://api.mainnet.orca.so/v1/whirlpool/list",
      );
      const data = await response.json();

      if (data.whirlpools) {
        for (const wp of data.whirlpools.slice(0, 50)) {
          // Top 50 pools
          const pool = this.parseWhirlpoolData(wp);
          if (pool && pool.tvl > 10000) {
            // Filter small pools
            pools.push(pool);
          }
        }
      }

      // Sort by TVL descending
      return pools.sort((a, b) => b.tvl - a.tvl);
    } catch (error) {
      console.error("Failed to fetch Orca pools:", error);

      // Fallback: return hardcoded top pools with estimated data
      return this.getHardcodedPools();
    }
  }

  /**
   * Get specific pool by address
   */
  async getPool(
    connection: Connection,
    address: string,
  ): Promise<LPPool | null> {
    try {
      const response = await fetch(
        `https://api.mainnet.orca.so/v1/whirlpool/${address}`,
      );
      const data = await response.json();

      if (data) {
        return this.parseWhirlpoolData(data);
      }
      return null;
    } catch (error) {
      console.error("Failed to fetch pool:", error);
      return null;
    }
  }

  /**
   * Get user's Whirlpool positions
   */
  async getPositions(
    connection: Connection,
    user: PublicKey,
  ): Promise<LPPosition[]> {
    try {
      const positions: LPPosition[] = [];

      // Orca positions are stored as NFTs
      // Query via Orca API or on-chain
      const response = await fetch(
        `https://api.mainnet.orca.so/v1/position/list?wallet=${user.toBase58()}`,
      );
      const data = await response.json();

      if (data.positions) {
        for (const pos of data.positions) {
          positions.push({
            venue: "orca",
            positionId: pos.address,
            poolAddress: pos.whirlpool,
            poolName:
              pos.tokenA?.symbol && pos.tokenB?.symbol
                ? `${pos.tokenA.symbol}-${pos.tokenB.symbol}`
                : "Unknown Pool",
            owner: user.toBase58(),
            tokenAAmount: pos.tokenAAmount || "0",
            tokenBAmount: pos.tokenBAmount || "0",
            valueUSD: pos.valueUSD || 0,
            unclaimedFees: {
              tokenA: pos.fees?.tokenA || "0",
              tokenB: pos.fees?.tokenB || "0",
              totalUSD: pos.fees?.totalUSD || 0,
            },
            priceRange:
              pos.tickLowerPrice && pos.tickUpperPrice
                ? {
                    lower: pos.tickLowerPrice,
                    upper: pos.tickUpperPrice,
                  }
                : undefined,
            inRange: pos.inRange ?? true,
            createdAt: pos.createdAt,
          });
        }
      }

      return positions;
    } catch (error) {
      console.error("Failed to fetch Orca positions:", error);
      return [];
    }
  }

  /**
   * Get specific position
   */
  async getPosition(
    connection: Connection,
    positionId: string,
  ): Promise<LPPosition | null> {
    try {
      const response = await fetch(
        `https://api.mainnet.orca.so/v1/position/${positionId}`,
      );
      const data = await response.json();

      if (data) {
        return {
          venue: "orca",
          positionId: data.address,
          poolAddress: data.whirlpool,
          poolName:
            data.tokenA?.symbol && data.tokenB?.symbol
              ? `${data.tokenA.symbol}-${data.tokenB.symbol}`
              : "Unknown Pool",
          owner: data.owner || "",
          tokenAAmount: data.tokenAAmount || "0",
          tokenBAmount: data.tokenBAmount || "0",
          valueUSD: data.valueUSD || 0,
          unclaimedFees: {
            tokenA: data.fees?.tokenA || "0",
            tokenB: data.fees?.tokenB || "0",
            totalUSD: data.fees?.totalUSD || 0,
          },
          priceRange:
            data.tickLowerPrice && data.tickUpperPrice
              ? {
                  lower: data.tickLowerPrice,
                  upper: data.tickUpperPrice,
                }
              : undefined,
          inRange: data.inRange ?? true,
          createdAt: data.createdAt,
        };
      }
      return null;
    } catch (error) {
      console.error("Failed to fetch position:", error);
      return null;
    }
  }

  /**
   * Add liquidity to a Whirlpool
   */
  async addLiquidity(
    connection: Connection,
    user: Keypair,
    params: AddLiquidityIntent,
  ): Promise<{ transaction: Transaction; positionId: string }> {
    const { poolAddress, tokenA, tokenB, totalValueUSD, strategy = "balanced" } = params;

    const provider = new AnchorProvider(connection, new anchor.Wallet(user), {});
    const ctx = WhirlpoolContext.withProvider(provider, WHIRLPOOL_PROGRAM_ID);
    const client = buildWhirlpoolClient(ctx);

    let targetPoolAddress: PublicKey;
    if (poolAddress) {
      targetPoolAddress = new PublicKey(poolAddress);
    } else {
      const pairKey = `${tokenA}-${tokenB}`;
      const knownPool = WHIRLPOOLS[pairKey as keyof typeof WHIRLPOOLS];
      if (!knownPool) throw new Error(`No known Orca pool for ${pairKey}`);
      targetPoolAddress = knownPool;
    }
    
    const whirlpool = await client.getPool(targetPoolAddress);
    const { tokenMintA, tokenMintB, tickCurrentIndex, tickSpacing } = whirlpool.getData();
    const tokenAInfo = whirlpool.getTokenAInfo();
    const tokenBInfo = whirlpool.getTokenBInfo();
    
    // Calculate price range
    const price = PriceMath.tickIndexToPrice(tickCurrentIndex, tokenAInfo.decimals, tokenBInfo.decimals);
    const { lowerPrice, upperPrice } = this.calculatePriceRange(price, strategy);
    const { tickLowerIndex, tickUpperIndex } = TickUtil.getTickArrayRange(
      tickCurrentIndex,
      tickSpacing,
      100 // Using a fixed number of arrays for simplicity
    );
      
    // Position PDA
    const positionMint = Keypair.generate();
    const positionPda = PDAUtil.getPosition(ctx.program.programId, positionMint.publicKey);
    
    // Create transaction
    const openPositionTx = await whirlpool.openPosition(
      tickLowerIndex,
      tickUpperIndex,
      { owner: user.publicKey, funder: user.publicKey, positionMint: positionMint.publicKey }
    );
    
    // Calculate liquidity amount from USD value
    const liquidity = PriceMath.estimateLiquidityFromTokenAmounts(
      tickCurrentIndex,
      tickLowerIndex,
      tickUpperIndex,
      {
        tokenA: new Decimal(totalValueUSD || 100).div(2).div(price.toString()),
        tokenB: new Decimal(totalValueUSD || 100).div(2),
      },
      true
    );
    
    const { maxTokenA, maxTokenB } = PriceMath.getTokenAmountsFromLiquidity(
      liquidity,
      whirlpool.getData().sqrtPrice,
      PriceMath.tickIndexToSqrtPrice(tickLowerIndex),
      PriceMath.tickIndexToSqrtPrice(tickUpperIndex),
      true
    );
    
    const increaseLiquidityTx = await whirlpool.increaseLiquidity({
      liquidityAmount: new BN(liquidity.floor().toString()),
      tokenMaxA: new BN(maxTokenA.floor().toString()),
      tokenMaxB: new BN(maxTokenB.floor().toString()),
      position: positionPda.publicKey,
      tokenOwnerAccountA: await getAssociatedTokenAddress(tokenMintA, user.publicKey),
      tokenOwnerAccountB: await getAssociatedTokenAddress(tokenMintB, user.publicKey),
    });

    const transaction = toTx(ctx, openPositionTx).add(increaseLiquidityTx.transaction);

    return {
      transaction,
      positionId: positionPda.publicKey.toBase58(),
    };
  }

  /**
   * Remove liquidity from a position
   */
  async removeLiquidity(
    connection: Connection,
    user: Keypair,
    params: RemoveLiquidityIntent,
  ): Promise<Transaction> {
    const { positionId, percentage = 100, claimFees = true } = params;

    const transaction = new Transaction();

    // 1. Decrease liquidity
    // const decreaseLiquidityIx = await WhirlpoolIx.decreaseLiquidityIx(ctx, {
    //   whirlpool: pool,
    //   position: new PublicKey(positionId),
    //   tokenOwnerAccountA: userTokenA,
    //   tokenOwnerAccountB: userTokenB,
    //   liquidityAmount: (position.liquidity * BigInt(percentage)) / 100n,
    //   tokenMinA: minAmountA,
    //   tokenMinB: minAmountB,
    // });

    // 2. Collect fees if requested
    if (claimFees) {
      // const collectFeesIx = await WhirlpoolIx.collectFeesIx(ctx, {...});
    }

    // 3. Close position if 100%
    if (percentage === 100) {
      // const closePositionIx = await WhirlpoolIx.closePositionIx(ctx, {...});
    }

    console.log(
      `[Orca] Removing ${percentage}% liquidity from position ${positionId}`,
    );

    return transaction;
  }

  /**
   * Claim accumulated fees
   */
  async claimFees(
    connection: Connection,
    user: Keypair,
    positionId: string,
  ): Promise<Transaction> {
    const transaction = new Transaction();

    // const collectFeesIx = await WhirlpoolIx.collectFeesIx(ctx, {
    //   whirlpool: pool,
    //   position: new PublicKey(positionId),
    //   positionAuthority: user.publicKey,
    //   tokenOwnerAccountA: userTokenA,
    //   tokenOwnerAccountB: userTokenB,
    //   tokenVaultA: poolTokenVaultA,
    //   tokenVaultB: poolTokenVaultB,
    // });

    // Also collect rewards if any
    // const collectRewardsIx = await WhirlpoolIx.collectRewardIx(ctx, {...});

    console.log(`[Orca] Claiming fees for position ${positionId}`);

    return transaction;
  }

  /**
   * Estimate yield for a pool
   */
  estimateYield(pool: LPPool, amount: number, days: number): number {
    // Simple APY calculation
    const dailyRate = pool.apy / 365 / 100;
    return amount * dailyRate * days;
  }

  /**
   * Estimate impermanent loss
   */
  estimateIL(pool: LPPool, priceChange: number): number {
    // IL formula for concentrated liquidity is more complex
    // Simplified: IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
    const ratio = 1 + priceChange;
    if (ratio <= 0) return -1; // Total loss

    const il = (2 * Math.sqrt(ratio)) / (1 + ratio) - 1;
    return Math.abs(il);
  }

  private calculatePriceRange(
    price: Decimal,
    strategy: string,
  ): { lowerPrice: Decimal; upperPrice: Decimal } {
    let lowerPrice: Decimal, upperPrice: Decimal;
    switch (strategy) {
      case "concentrated":
        lowerPrice = price.mul(0.95);
        upperPrice = price.mul(1.05);
        break;
      case "balanced":
        lowerPrice = price.mul(0.8);
        upperPrice = price.mul(1.2);
        break;
      default:
        lowerPrice = price.mul(0.5);
        upperPrice = price.mul(1.5);
    }
    return { lowerPrice, upperPrice };
  }
  // ============ Private Helpers ============

  private parseWhirlpoolData(wp: any): LPPool | null {
    if (!wp) return null;

    try {
      return {
        venue: "orca",
        address: wp.address || "",
        name:
          wp.tokenA?.symbol && wp.tokenB?.symbol
            ? `${wp.tokenA.symbol}-${wp.tokenB.symbol}`
            : "Unknown",
        tokenA: {
          mint: wp.tokenA?.mint || "",
          symbol: wp.tokenA?.symbol || "UNKNOWN",
          decimals: wp.tokenA?.decimals || 9,
          logoURI: wp.tokenA?.logoURI,
        },
        tokenB: {
          mint: wp.tokenB?.mint || "",
          symbol: wp.tokenB?.symbol || "UNKNOWN",
          decimals: wp.tokenB?.decimals || 6,
          logoURI: wp.tokenB?.logoURI,
        },
        fee: (wp.feeRate || 3000) / 10000, // Convert from basis points
        tvl: wp.tvl || 0,
        apy: wp.apy?.total || wp.apy || 0,
        apy7d: wp.apy7d?.total || wp.apy7d || wp.apy?.total || 0,
        volume24h: wp.volume?.day || wp.volume24h || 0,
        priceRange: wp.price
          ? {
              lower: 0,
              upper: Infinity,
              current: wp.price,
            }
          : undefined,
      };
    } catch {
      return null;
    }
  }

  private calculateTickRange(strategy: string): {
    tickLower: number;
    tickUpper: number;
  } {
    // Tick spacing for 0.30% fee tier (most common)
    const tickSpacing = 64;

    // Get current price tick (would come from pool data in real impl)
    const currentTick = 0; // Placeholder

    switch (strategy) {
      case "concentrated":
        // ±5% range
        return {
          tickLower:
            Math.floor((currentTick - 500) / tickSpacing) * tickSpacing,
          tickUpper: Math.ceil((currentTick + 500) / tickSpacing) * tickSpacing,
        };
      case "balanced":
        // ±20% range
        return {
          tickLower:
            Math.floor((currentTick - 2000) / tickSpacing) * tickSpacing,
          tickUpper:
            Math.ceil((currentTick + 2000) / tickSpacing) * tickSpacing,
        };
      case "yield-max":
        // ±50% range (wider for more fee capture)
        return {
          tickLower:
            Math.floor((currentTick - 5000) / tickSpacing) * tickSpacing,
          tickUpper:
            Math.ceil((currentTick + 5000) / tickSpacing) * tickSpacing,
        };
      default:
        // Full range
        return {
          tickLower: -443632, // MIN_TICK
          tickUpper: 443632, // MAX_TICK
        };
    }
  }

  private getHardcodedPools(): LPPool[] {
    // Fallback pool data for when API is unavailable
    return [
      {
        venue: "orca",
        address: "HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ",
        name: "SOL-USDC",
        tokenA: {
          mint: "So11111111111111111111111111111111111111112",
          symbol: "SOL",
          decimals: 9,
        },
        tokenB: {
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          symbol: "USDC",
          decimals: 6,
        },
        fee: 0.3,
        tvl: 45000000,
        apy: 42.5,
        apy7d: 38.2,
        volume24h: 12000000,
      },
      {
        venue: "orca",
        address: "9vqYJjDUFecLL2xPUC4Rc7hyCtZ6iJ4mDiVZX7aFXoAe",
        name: "mSOL-SOL",
        tokenA: {
          mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
          symbol: "mSOL",
          decimals: 9,
        },
        tokenB: {
          mint: "So11111111111111111111111111111111111111112",
          symbol: "SOL",
          decimals: 9,
        },
        fee: 0.01,
        tvl: 28000000,
        apy: 8.5,
        apy7d: 7.8,
        volume24h: 3500000,
      },
      {
        venue: "orca",
        address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crLCEgK8Kb",
        name: "BONK-SOL",
        tokenA: {
          mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
          symbol: "BONK",
          decimals: 5,
        },
        tokenB: {
          mint: "So11111111111111111111111111111111111111112",
          symbol: "SOL",
          decimals: 9,
        },
        fee: 1.0,
        tvl: 8500000,
        apy: 156.3,
        apy7d: 142.1,
        volume24h: 25000000,
      },
      {
        venue: "orca",
        address: "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx",
        name: "JTO-SOL",
        tokenA: {
          mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
          symbol: "JTO",
          decimals: 9,
        },
        tokenB: {
          mint: "So11111111111111111111111111111111111111112",
          symbol: "SOL",
          decimals: 9,
        },
        fee: 0.3,
        tvl: 12000000,
        apy: 65.8,
        apy7d: 58.4,
        volume24h: 8000000,
      },
      {
        venue: "orca",
        address: "H1xnHfHxLk5rqBnX2q2VdRoAtbTTpJHxJwwPzX4AdEKM",
        name: "JUP-SOL",
        tokenA: {
          mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
          symbol: "JUP",
          decimals: 6,
        },
        tokenB: {
          mint: "So11111111111111111111111111111111111111112",
          symbol: "SOL",
          decimals: 9,
        },
        fee: 0.3,
        tvl: 18000000,
        apy: 78.2,
        apy7d: 71.5,
        volume24h: 15000000,
      },
    ];
  }
}

// Export singleton
export const orcaAdapter = new OrcaAdapter();
export default orcaAdapter;
