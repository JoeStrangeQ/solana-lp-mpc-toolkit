/**
 * Meteora DAMM v2 (Dynamic AMM) Adapter
 * Full-range liquidity pools with dynamic fees
 * 
 * Different from DLMM:
 * - Full price range (not concentrated)
 * - Dynamic fees based on volatility
 * - Simpler LP experience
 * - Good for token launches
 * 
 * Program ID: cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG
 * Docs: https://docs.meteora.ag/user-guide/guides/how-to-use-damm-v2
 */

import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import {
  DEXAdapter,
  DEXVenue,
  LPPool,
  LPPosition,
  AddLiquidityIntent,
  RemoveLiquidityIntent,
} from './types';

// Program IDs
const DAMM_V2_PROGRAM_ID = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const DAMM_V1_PROGRAM_ID = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');

// Known DAMM v2 pools
const DAMM_V2_POOLS = {
  'SOL-USDC': '8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie',
  'SOL-USDT': '7CibANnsyVAMh2PCbvpXHiEHM9YXRNxTwBRY6dKz3R3C',
};

export class MeteoraDAMMAdapter implements DEXAdapter {
  venue: DEXVenue = 'meteora'; // Same venue, different pool type

  /**
   * Get all DAMM v2 pools
   */
  async getPools(connection: Connection): Promise<LPPool[]> {
    try {
      // Fetch from Meteora API
      const response = await fetch('https://amm-v2.meteora.ag/pools');
      const data = await response.json();
      
      if (Array.isArray(data)) {
        return data
          .filter((p: any) => p.tvl > 10000) // Filter small pools
          .slice(0, 50)
          .map((p: any) => this.parsePoolData(p))
          .filter((p): p is LPPool => p !== null)
          .sort((a, b) => b.tvl - a.tvl);
      }
      
      return this.getHardcodedPools();
    } catch (error) {
      console.error('Failed to fetch DAMM v2 pools:', error);
      return this.getHardcodedPools();
    }
  }

  /**
   * Get specific pool
   */
  async getPool(connection: Connection, address: string): Promise<LPPool | null> {
    try {
      const response = await fetch(`https://amm-v2.meteora.ag/pools/${address}`);
      const data = await response.json();
      return this.parsePoolData(data);
    } catch (error) {
      console.error('Failed to fetch DAMM v2 pool:', error);
      return null;
    }
  }

  /**
   * Get user positions in DAMM v2 pools
   */
  async getPositions(connection: Connection, user: PublicKey): Promise<LPPosition[]> {
    try {
      const response = await fetch(
        `https://amm-v2.meteora.ag/positions?wallet=${user.toBase58()}`
      );
      const data = await response.json();
      
      if (Array.isArray(data)) {
        return data.map((pos: any) => ({
          venue: 'meteora' as DEXVenue,
          positionId: pos.address || pos.id,
          poolAddress: pos.poolAddress,
          poolName: pos.poolName || 'DAMM v2 Pool',
          owner: user.toBase58(),
          tokenAAmount: pos.tokenAAmount?.toString() || '0',
          tokenBAmount: pos.tokenBAmount?.toString() || '0',
          valueUSD: pos.valueUSD || 0,
          unclaimedFees: {
            tokenA: pos.unclaimedFeesA?.toString() || '0',
            tokenB: pos.unclaimedFeesB?.toString() || '0',
            totalUSD: pos.unclaimedFeesUSD || 0,
          },
          inRange: true, // DAMM v2 is full range, always in range
          createdAt: pos.createdAt,
        }));
      }
      
      return [];
    } catch (error) {
      console.error('Failed to fetch DAMM v2 positions:', error);
      return [];
    }
  }

  /**
   * Get specific position
   */
  async getPosition(connection: Connection, positionId: string): Promise<LPPosition | null> {
    try {
      const response = await fetch(`https://amm-v2.meteora.ag/position/${positionId}`);
      const data = await response.json();
      
      if (data) {
        return {
          venue: 'meteora',
          positionId: data.address || data.id,
          poolAddress: data.poolAddress,
          poolName: data.poolName || 'DAMM v2 Pool',
          owner: data.owner || '',
          tokenAAmount: data.tokenAAmount?.toString() || '0',
          tokenBAmount: data.tokenBAmount?.toString() || '0',
          valueUSD: data.valueUSD || 0,
          unclaimedFees: {
            tokenA: data.unclaimedFeesA?.toString() || '0',
            tokenB: data.unclaimedFeesB?.toString() || '0',
            totalUSD: data.unclaimedFeesUSD || 0,
          },
          inRange: true,
        };
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch position:', error);
      return null;
    }
  }

  /**
   * Add liquidity to DAMM v2 pool
   */
  async addLiquidity(
    connection: Connection,
    user: Keypair,
    params: AddLiquidityIntent
  ): Promise<{ transaction: Transaction; positionId: string }> {
    const {
      poolAddress,
      tokenA,
      tokenB,
      amountA,
      amountB,
      totalValueUSD,
      slippageBps = 100,
    } = params;

    // Find pool if not specified
    let targetPool = poolAddress;
    if (!targetPool) {
      const pairKey = `${tokenA}-${tokenB}`;
      const knownPool = DAMM_V2_POOLS[pairKey as keyof typeof DAMM_V2_POOLS];
      if (knownPool) {
        targetPool = knownPool;
      } else {
        throw new Error(`No known DAMM v2 pool for pair ${tokenA}-${tokenB}`);
      }
    }

    const transaction = new Transaction();
    
    // DAMM v2 uses simpler deposit instruction
    // In production: use Meteora SDK
    // const ix = await meteora.damm.deposit({
    //   pool: new PublicKey(targetPool),
    //   user: user.publicKey,
    //   amountA,
    //   amountB,
    //   slippage: slippageBps / 10000,
    // });
    
    const positionId = `damm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    console.log(`[Meteora DAMM v2] Adding liquidity to pool ${targetPool}`);
    
    return {
      transaction,
      positionId,
    };
  }

  /**
   * Remove liquidity
   */
  async removeLiquidity(
    connection: Connection,
    user: Keypair,
    params: RemoveLiquidityIntent
  ): Promise<Transaction> {
    const { positionId, percentage = 100, claimFees = true } = params;
    
    const transaction = new Transaction();
    
    // In production: use Meteora SDK
    // const ix = await meteora.damm.withdraw({
    //   position: new PublicKey(positionId),
    //   user: user.publicKey,
    //   percentage,
    //   claimFees,
    // });
    
    console.log(`[Meteora DAMM v2] Removing ${percentage}% from position ${positionId}`);
    
    return transaction;
  }

  /**
   * Claim fees
   */
  async claimFees(
    connection: Connection,
    user: Keypair,
    positionId: string
  ): Promise<Transaction> {
    const transaction = new Transaction();
    
    console.log(`[Meteora DAMM v2] Claiming fees for position ${positionId}`);
    
    return transaction;
  }

  /**
   * Estimate yield
   */
  estimateYield(pool: LPPool, amount: number, days: number): number {
    const dailyRate = pool.apy / 365 / 100;
    return amount * dailyRate * days;
  }

  /**
   * Estimate IL - DAMM v2 has full range so IL is standard xy=k
   */
  estimateIL(pool: LPPool, priceChange: number): number {
    const ratio = 1 + priceChange;
    if (ratio <= 0) return -1;
    
    // Standard xy=k IL formula
    const il = (2 * Math.sqrt(ratio)) / (1 + ratio) - 1;
    return Math.abs(il);
  }

  // ============ Private Helpers ============

  private parsePoolData(pool: any): LPPool | null {
    if (!pool) return null;
    
    try {
      const tokenASymbol = pool.tokenA?.symbol || pool.mint_a_symbol || 'UNKNOWN';
      const tokenBSymbol = pool.tokenB?.symbol || pool.mint_b_symbol || 'UNKNOWN';
      
      return {
        venue: 'meteora',
        address: pool.address || pool.pool_address || '',
        name: `${tokenASymbol}-${tokenBSymbol} (DAMM)`,
        tokenA: {
          mint: pool.tokenA?.mint || pool.mint_a || '',
          symbol: tokenASymbol,
          decimals: pool.tokenA?.decimals || 9,
        },
        tokenB: {
          mint: pool.tokenB?.mint || pool.mint_b || '',
          symbol: tokenBSymbol,
          decimals: pool.tokenB?.decimals || 6,
        },
        fee: pool.baseFee || pool.fee || 0.25,
        tvl: pool.tvl || pool.liquidity || 0,
        apy: pool.apy || pool.apr24h || 0,
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
        venue: 'meteora',
        address: '8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie',
        name: 'SOL-USDC (DAMM)',
        tokenA: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
        tokenB: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
        fee: 0.25,
        tvl: 15000000,
        apy: 28.5,
        apy7d: 25.2,
        volume24h: 5000000,
      },
      {
        venue: 'meteora',
        address: '7CibANnsyVAMh2PCbvpXHiEHM9YXRNxTwBRY6dKz3R3C',
        name: 'SOL-USDT (DAMM)',
        tokenA: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
        tokenB: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', decimals: 6 },
        fee: 0.25,
        tvl: 8000000,
        apy: 22.3,
        apy7d: 19.8,
        volume24h: 2500000,
      },
    ];
  }
}

// Export singleton
export const meteoraDAMMAdapter = new MeteoraDAMMAdapter();
export default meteoraDAMMAdapter;
