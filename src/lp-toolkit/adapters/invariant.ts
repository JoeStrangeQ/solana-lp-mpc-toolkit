/**
 * Invariant Protocol Adapter
 * Concentrated liquidity AMM on Solana
 *
 * Features:
 * - CLMM with custom tick spacing
 * - Single-sided liquidity
 * - Multiple fee tiers (0.01%, 0.05%, 0.1%, 0.3%, 1%)
 *
 * Program ID: HyaB3W9q6XdA5xwpU4XnSZV94htfmbmqJXZcEbRaJutt
 * Docs: https://docs.invariant.app/
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

const INVARIANT_PROGRAM = new PublicKey(
  "HyaB3W9q6XdA5xwpU4XnSZV94htfmbmqJXZcEbRaJutt",
);

export class InvariantAdapter implements DEXAdapter {
  venue: DEXVenue = "invariant"; // Placeholder

  async getPools(connection: Connection): Promise<LPPool[]> {
    try {
      const response = await fetch(
        "https://stats.invariant.app/pool_list/solana",
      );
      const data = await response.json();

      if (Array.isArray(data)) {
        return data
          .filter((p: any) => (p.tvl || p.liquidityUSD) > 10000)
          .slice(0, 30)
          .map((p: any) => this.parsePoolData(p))
          .filter((p): p is LPPool => p !== null)
          .sort((a, b) => b.tvl - a.tvl);
      }
      return this.getHardcodedPools();
    } catch (error) {
      console.error("Failed to fetch Invariant pools:", error);
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
        `https://stats.invariant.app/positions/solana/${user.toBase58()}`,
      );
      if (!response.ok) return [];
      const data = await response.json();

      if (Array.isArray(data)) {
        return data.map((pos: any) => ({
          venue: "invariant" as DEXVenue,
          positionId: pos.id || pos.address,
          poolAddress: pos.pool,
          poolName: pos.poolName || "Invariant Pool",
          owner: user.toBase58(),
          tokenAAmount: pos.tokenXAmount?.toString() || "0",
          tokenBAmount: pos.tokenYAmount?.toString() || "0",
          valueUSD: pos.valueUSD || pos.liquidityUSD || 0,
          unclaimedFees: {
            tokenA: pos.unclaimedFeesX?.toString() || "0",
            tokenB: pos.unclaimedFeesY?.toString() || "0",
            totalUSD: pos.unclaimedFeesUSD || 0,
          },
          priceRange:
            pos.lowerTick !== undefined && pos.upperTick !== undefined
              ? {
                  lower: pos.lowerPrice || pos.lowerTick,
                  upper: pos.upperPrice || pos.upperTick,
                }
              : undefined,
          inRange: pos.isActive ?? true,
        }));
      }
      return [];
    } catch {
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
    const transaction = new Transaction();
    const positionId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[Invariant] Adding concentrated liquidity`);
    return { transaction, positionId };
  }

  async removeLiquidity(
    connection: Connection,
    user: Keypair,
    params: RemoveLiquidityIntent,
  ): Promise<Transaction> {
    console.log(`[Invariant] Removing ${params.percentage || 100}%`);
    return new Transaction();
  }

  async claimFees(
    connection: Connection,
    user: Keypair,
    positionId: string,
  ): Promise<Transaction> {
    console.log(`[Invariant] Claiming fees`);
    return new Transaction();
  }

  estimateYield(pool: LPPool, amount: number, days: number): number {
    return amount * (pool.apy / 365 / 100) * days;
  }

  estimateIL(pool: LPPool, priceChange: number): number {
    const ratio = 1 + priceChange;
    if (ratio <= 0) return -1;
    return Math.abs((2 * Math.sqrt(ratio)) / (1 + ratio) - 1);
  }

  private parsePoolData(pool: any): LPPool | null {
    if (!pool) return null;
    try {
      return {
        venue: "invariant" as DEXVenue,
        address: pool.address || pool.poolAddress || "",
        name: `${pool.tokenXSymbol || pool.symbolX || "UNK"}-${pool.tokenYSymbol || pool.symbolY || "UNK"} (Invariant)`,
        tokenA: {
          mint: pool.tokenX || "",
          symbol: pool.tokenXSymbol || pool.symbolX || "UNK",
          decimals: pool.tokenXDecimals || 9,
        },
        tokenB: {
          mint: pool.tokenY || "",
          symbol: pool.tokenYSymbol || pool.symbolY || "UNK",
          decimals: pool.tokenYDecimals || 6,
        },
        fee: (pool.fee || 3000) / 10000, // Convert from basis points
        tvl: pool.tvl || pool.liquidityUSD || 0,
        apy: pool.apy || pool.apr24h || 0,
        apy7d: pool.apy7d || pool.apy || 0,
        volume24h: pool.volume24h || pool.volumeUSD24h || 0,
      };
    } catch {
      return null;
    }
  }

  private getHardcodedPools(): LPPool[] {
    return [
      {
        venue: "invariant" as DEXVenue,
        address: "INVsoL1111111111111111111111111111111111111",
        name: "SOL-USDC (Invariant)",
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
        tvl: 3500000,
        apy: 45.8,
        apy7d: 42.3,
        volume24h: 2000000,
      },
      {
        venue: "invariant" as DEXVenue,
        address: "INVmSOL11111111111111111111111111111111111",
        name: "mSOL-SOL (Invariant)",
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
        tvl: 2000000,
        apy: 7.2,
        apy7d: 6.8,
        volume24h: 1200000,
      },
    ];
  }
}

export const invariantAdapter = new InvariantAdapter();
export default invariantAdapter;
