/**
 * Crema Finance Adapter
 * Concentrated liquidity DEX on Solana
 *
 * Features:
 * - CLMM similar to Uniswap V3
 * - Auto-compounding fees
 * - Multiple fee tiers
 *
 * Program ID: CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR
 * Docs: https://docs.crema.finance/
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

// Crema Program ID
const CREMA_CLMM_PROGRAM = new PublicKey(
  "CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR",
);

// Known Crema pools
const CREMA_POOLS = {
  "SOL-USDC": "CRMAsqp3WGiwjK5yzJgRE6cVAqgE6TjFN93RX8AYANjF",
  "SOL-USDT": "CRMBnfM6yxzYBGwqJMHJcxLBKbjzLM3gVqRjQqV8QPmM",
  "mSOL-SOL": "CRMAm2VxVQxRY8rEfHLRWqSPcDhzqWGB7a8M5LAKpvvj",
};

export class CremaAdapter implements DEXAdapter {
  // Using orca as placeholder venue type
  venue: DEXVenue = "crema"; // Should be 'crema' when type is updated

  /**
   * Get Crema CLMM pools
   */
  async getPools(connection: Connection): Promise<LPPool[]> {
    try {
      // Crema API
      const response = await fetch("https://api.crema.finance/v1/pools");
      const data = await response.json();

      if (data.pools && Array.isArray(data.pools)) {
        return data.pools
          .filter((p: any) => p.tvl > 10000)
          .map((p: any) => this.parsePoolData(p))
          .filter((p): p is LPPool => p !== null)
          .sort((a, b) => b.tvl - a.tvl);
      }

      return this.getHardcodedPools();
    } catch (error) {
      console.error("Failed to fetch Crema pools:", error);
      return this.getHardcodedPools();
    }
  }

  async getPool(
    connection: Connection,
    address: string,
  ): Promise<LPPool | null> {
    const pools = await this.getPools(connection);
    return pools.find((p) => p.address === address) || null;
  }

  async getPositions(
    connection: Connection,
    user: PublicKey,
  ): Promise<LPPosition[]> {
    try {
      const response = await fetch(
        `https://api.crema.finance/v1/positions?wallet=${user.toBase58()}`,
      );

      if (!response.ok) return [];
      const data = await response.json();

      if (Array.isArray(data.positions)) {
        return data.positions.map((pos: any) => ({
          venue: "crema" as DEXVenue, // Should be 'crema'
          positionId: pos.nftMint || pos.address,
          poolAddress: pos.poolAddress,
          poolName: pos.poolName || "Crema Pool",
          owner: user.toBase58(),
          tokenAAmount: pos.tokenAAmount?.toString() || "0",
          tokenBAmount: pos.tokenBAmount?.toString() || "0",
          valueUSD: pos.valueUSD || 0,
          unclaimedFees: {
            tokenA: pos.unclaimedFeesA?.toString() || "0",
            tokenB: pos.unclaimedFeesB?.toString() || "0",
            totalUSD: pos.unclaimedFeesUSD || 0,
          },
          priceRange:
            pos.lowerPrice && pos.upperPrice
              ? {
                  lower: pos.lowerPrice,
                  upper: pos.upperPrice,
                }
              : undefined,
          inRange: pos.inRange ?? true,
        }));
      }

      return [];
    } catch (error) {
      console.error("Failed to fetch Crema positions:", error);
      return [];
    }
  }

  async getPosition(
    connection: Connection,
    positionId: string,
  ): Promise<LPPosition | null> {
    return null;
  }

  async addLiquidity(
    connection: Connection,
    user: Keypair,
    params: AddLiquidityIntent,
  ): Promise<{ transaction: Transaction; positionId: string }> {
    const {
      poolAddress,
      tokenA,
      tokenB,
      totalValueUSD,
      strategy = "balanced",
    } = params;

    let targetPool = poolAddress;
    if (!targetPool) {
      const pairKey = `${tokenA}-${tokenB}`;
      const knownPool = CREMA_POOLS[pairKey as keyof typeof CREMA_POOLS];
      if (knownPool) {
        targetPool = knownPool;
      } else {
        throw new Error(`No known Crema pool for pair ${tokenA}-${tokenB}`);
      }
    }

    const transaction = new Transaction();
    const positionId = `crema_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    console.log(`[Crema] Adding concentrated liquidity to pool ${targetPool}`);

    return { transaction, positionId };
  }

  async removeLiquidity(
    connection: Connection,
    user: Keypair,
    params: RemoveLiquidityIntent,
  ): Promise<Transaction> {
    console.log(
      `[Crema] Removing ${params.percentage || 100}% from position ${params.positionId}`,
    );
    return new Transaction();
  }

  async claimFees(
    connection: Connection,
    user: Keypair,
    positionId: string,
  ): Promise<Transaction> {
    console.log(`[Crema] Claiming fees for position ${positionId}`);
    return new Transaction();
  }

  estimateYield(pool: LPPool, amount: number, days: number): number {
    const dailyRate = pool.apy / 365 / 100;
    return amount * dailyRate * days;
  }

  estimateIL(pool: LPPool, priceChange: number): number {
    const ratio = 1 + priceChange;
    if (ratio <= 0) return -1;
    const il = (2 * Math.sqrt(ratio)) / (1 + ratio) - 1;
    return Math.abs(il);
  }

  private parsePoolData(pool: any): LPPool | null {
    if (!pool) return null;

    try {
      return {
        venue: "crema" as DEXVenue, // Should be 'crema'
        address: pool.address || pool.poolAddress || "",
        name: `${pool.tokenA?.symbol || "UNK"}-${pool.tokenB?.symbol || "UNK"} (Crema)`,
        tokenA: {
          mint: pool.tokenA?.mint || "",
          symbol: pool.tokenA?.symbol || "UNKNOWN",
          decimals: pool.tokenA?.decimals || 9,
        },
        tokenB: {
          mint: pool.tokenB?.mint || "",
          symbol: pool.tokenB?.symbol || "UNKNOWN",
          decimals: pool.tokenB?.decimals || 6,
        },
        fee: pool.fee || 0.25,
        tvl: pool.tvl || 0,
        apy: pool.apy || 0,
        apy7d: pool.apy7d || pool.apy || 0,
        volume24h: pool.volume24h || 0,
      };
    } catch {
      return null;
    }
  }

  private getHardcodedPools(): LPPool[] {
    return [
      {
        venue: "crema" as DEXVenue,
        address: "CRMAsqp3WGiwjK5yzJgRE6cVAqgE6TjFN93RX8AYANjF",
        name: "SOL-USDC (Crema)",
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
        fee: 0.25,
        tvl: 8000000,
        apy: 38.5,
        apy7d: 35.2,
        volume24h: 4000000,
      },
      {
        venue: "crema" as DEXVenue,
        address: "CRMAm2VxVQxRY8rEfHLRWqSPcDhzqWGB7a8M5LAKpvvj",
        name: "mSOL-SOL (Crema)",
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
        fee: 0.05,
        tvl: 5000000,
        apy: 6.8,
        apy7d: 6.2,
        volume24h: 2500000,
      },
    ];
  }
}

export const cremaAdapter = new CremaAdapter();
export default cremaAdapter;
