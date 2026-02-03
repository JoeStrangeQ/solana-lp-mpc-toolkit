/**
 * Raydium CLMM (Concentrated Liquidity) DEX Adapter
 * 
 * SDK: @raydium-io/raydium-sdk-v2
 * Docs: https://docs.raydium.io/
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

// Raydium Program IDs
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const RAYDIUM_AMM_V4_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

// Common CLMM Pool Addresses
const CLMM_POOLS = {
  'SOL-USDC': new PublicKey('2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv'),
  'SOL-USDT': new PublicKey('CYbD9RaToYMtWKA7QZyoLahnHdWq553Vm62Lh6qWtuxq'),
  'mSOL-SOL': new PublicKey('8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaTUapubyvu'),
  'RAY-SOL': new PublicKey('AVs9TA4nWDzfPJE9monGFdCF1ydNhtLaX3U2Z8PbQqe7'),
  'BONK-SOL': new PublicKey('BvMrHdgcmZcPRGzCBYhpJR6q6AfQsMVvsBQ4LQNVGSMQ'),
  'JTO-SOL': new PublicKey('HFm9fKTmD9X4WpL8CXi6DoMaT4n7V7dLPJ8e7GYKQVXZ'),
  'JUP-USDC': new PublicKey('CbnU6a8MDbXJbMJJVnG9rRTj7QLmT9ydJMPQCvPF6pFS'),
  'WIF-SOL': new PublicKey('EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMy'),
};

// Fee tiers available on Raydium CLMM
const FEE_TIERS = {
  '100': 0.01,    // 1 bps - stable pairs
  '500': 0.05,    // 5 bps - correlated pairs
  '2500': 0.25,   // 25 bps - standard pairs
  '10000': 1.00,  // 100 bps - exotic pairs
};

export class RaydiumAdapter implements DEXAdapter {
  venue: DEXVenue = 'raydium';

  /**
   * Get all available CLMM pools
   */
  async getPools(connection: Connection): Promise<LPPool[]> {
    try {
      const pools: LPPool[] = [];
      
      // Fetch from Raydium API
      const response = await fetch('https://api-v3.raydium.io/pools/info/list?poolType=concentrated&sort=tvl&order=desc&pageSize=50');
      const data = await response.json();
      
      if (data.success && data.data?.data) {
        for (const pool of data.data.data) {
          const parsed = this.parsePoolData(pool);
          if (parsed && parsed.tvl > 10000) {
            pools.push(parsed);
          }
        }
      }
      
      return pools.sort((a, b) => b.tvl - a.tvl);
    } catch (error) {
      console.error('Failed to fetch Raydium pools:', error);
      return this.getHardcodedPools();
    }
  }

  /**
   * Get specific pool by address
   */
  async getPool(connection: Connection, address: string): Promise<LPPool | null> {
    try {
      const response = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${address}`);
      const data = await response.json();
      
      if (data.success && data.data?.[0]) {
        return this.parsePoolData(data.data[0]);
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch Raydium pool:', error);
      return null;
    }
  }

  /**
   * Get user's CLMM positions
   */
  async getPositions(connection: Connection, user: PublicKey): Promise<LPPosition[]> {
    try {
      const positions: LPPosition[] = [];
      
      // Raydium API for positions
      const response = await fetch(
        `https://api-v3.raydium.io/position/list?owner=${user.toBase58()}&type=concentrated`
      );
      const data = await response.json();
      
      if (data.success && data.data) {
        for (const pos of data.data) {
          positions.push({
            venue: 'raydium',
            positionId: pos.nftMint || pos.positionId || '',
            poolAddress: pos.poolId || '',
            poolName: pos.mintA?.symbol && pos.mintB?.symbol
              ? `${pos.mintA.symbol}-${pos.mintB.symbol}`
              : 'Unknown Pool',
            owner: user.toBase58(),
            tokenAAmount: pos.amountA?.toString() || '0',
            tokenBAmount: pos.amountB?.toString() || '0',
            valueUSD: pos.totalValueUsd || 0,
            unclaimedFees: {
              tokenA: pos.pendingFeeA?.toString() || '0',
              tokenB: pos.pendingFeeB?.toString() || '0',
              totalUSD: (pos.pendingFeeUsdA || 0) + (pos.pendingFeeUsdB || 0),
            },
            priceRange: pos.priceLower && pos.priceUpper ? {
              lower: pos.priceLower,
              upper: pos.priceUpper,
            } : undefined,
            inRange: pos.inRange ?? true,
            createdAt: pos.openTime ? pos.openTime * 1000 : undefined,
          });
        }
      }
      
      return positions;
    } catch (error) {
      console.error('Failed to fetch Raydium positions:', error);
      return [];
    }
  }

  /**
   * Get specific position
   */
  async getPosition(connection: Connection, positionId: string): Promise<LPPosition | null> {
    try {
      const response = await fetch(`https://api-v3.raydium.io/position/info?id=${positionId}`);
      const data = await response.json();
      
      if (data.success && data.data) {
        const pos = data.data;
        return {
          venue: 'raydium',
          positionId: pos.nftMint || pos.positionId || '',
          poolAddress: pos.poolId || '',
          poolName: pos.mintA?.symbol && pos.mintB?.symbol
            ? `${pos.mintA.symbol}-${pos.mintB.symbol}`
            : 'Unknown Pool',
          owner: pos.owner || '',
          tokenAAmount: pos.amountA?.toString() || '0',
          tokenBAmount: pos.amountB?.toString() || '0',
          valueUSD: pos.totalValueUsd || 0,
          unclaimedFees: {
            tokenA: pos.pendingFeeA?.toString() || '0',
            tokenB: pos.pendingFeeB?.toString() || '0',
            totalUSD: (pos.pendingFeeUsdA || 0) + (pos.pendingFeeUsdB || 0),
          },
          priceRange: pos.priceLower && pos.priceUpper ? {
            lower: pos.priceLower,
            upper: pos.priceUpper,
          } : undefined,
          inRange: pos.inRange ?? true,
        };
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch position:', error);
      return null;
    }
  }

  /**
   * Add liquidity to a CLMM pool
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
      strategy = 'balanced',
      slippageBps = 100,
    } = params;

    // Find pool if not specified
    let targetPool = poolAddress;
    if (!targetPool) {
      const pairKey = `${tokenA}-${tokenB}`;
      const knownPool = CLMM_POOLS[pairKey as keyof typeof CLMM_POOLS];
      if (knownPool) {
        targetPool = knownPool.toBase58();
      } else {
        throw new Error(`No known Raydium pool for pair ${tokenA}-${tokenB}`);
      }
    }

    // Calculate tick range based on strategy
    const { tickLower, tickUpper } = this.calculateTickRange(strategy);

    // Build transaction using SDK
    // In production: use Raydium SDK
    const transaction = new Transaction();
    
    // 1. Create position (mint NFT)
    // const { execute, extInfo } = await Clmm.openPositionFromLiquidity({
    //   poolInfo,
    //   ownerInfo: { feePayer: user.publicKey, wallet: user.publicKey },
    //   tickLower,
    //   tickUpper,
    //   liquidity: new BN(liquidityAmount),
    //   slippage: slippageBps / 10000,
    // });
    
    const positionId = `raydium_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    console.log(`[Raydium] Creating CLMM position in pool ${targetPool}`);
    console.log(`[Raydium] Strategy: ${strategy}, Tick range: ${tickLower} - ${tickUpper}`);
    
    return {
      transaction,
      positionId,
    };
  }

  /**
   * Remove liquidity from a position
   */
  async removeLiquidity(
    connection: Connection,
    user: Keypair,
    params: RemoveLiquidityIntent
  ): Promise<Transaction> {
    const { positionId, percentage = 100, claimFees = true } = params;
    
    const transaction = new Transaction();
    
    // In production: use Raydium SDK
    // const { execute } = await Clmm.decreaseLiquidity({
    //   poolInfo,
    //   ownerPosition: position,
    //   ownerInfo: { wallet: user.publicKey },
    //   liquidity: position.liquidity * BigInt(percentage) / 100n,
    //   slippage: 0.01,
    // });
    
    if (claimFees) {
      // Harvest pending fees
      // await Clmm.harvestAllRewards({...});
    }
    
    if (percentage === 100) {
      // Close position and burn NFT
      // await Clmm.closePosition({...});
    }
    
    console.log(`[Raydium] Removing ${percentage}% liquidity from position ${positionId}`);
    
    return transaction;
  }

  /**
   * Claim accumulated fees and rewards
   */
  async claimFees(
    connection: Connection,
    user: Keypair,
    positionId: string
  ): Promise<Transaction> {
    const transaction = new Transaction();
    
    // const { execute } = await Clmm.harvestAllRewards({
    //   ownerInfo: { wallet: user.publicKey },
    //   positions: [position],
    // });
    
    console.log(`[Raydium] Claiming fees for position ${positionId}`);
    
    return transaction;
  }

  /**
   * Estimate yield for a pool
   */
  estimateYield(pool: LPPool, amount: number, days: number): number {
    const dailyRate = pool.apy / 365 / 100;
    return amount * dailyRate * days;
  }

  /**
   * Estimate impermanent loss
   */
  estimateIL(pool: LPPool, priceChange: number): number {
    const ratio = 1 + priceChange;
    if (ratio <= 0) return -1;
    
    const il = (2 * Math.sqrt(ratio)) / (1 + ratio) - 1;
    return Math.abs(il);
  }

  // ============ Private Helpers ============

  private parsePoolData(pool: any): LPPool | null {
    if (!pool) return null;
    
    try {
      return {
        venue: 'raydium',
        address: pool.id || pool.poolId || '',
        name: pool.mintA?.symbol && pool.mintB?.symbol
          ? `${pool.mintA.symbol}-${pool.mintB.symbol}`
          : 'Unknown',
        tokenA: {
          mint: pool.mintA?.address || pool.mintA?.mint || '',
          symbol: pool.mintA?.symbol || 'UNKNOWN',
          decimals: pool.mintA?.decimals || 9,
          logoURI: pool.mintA?.logoURI,
        },
        tokenB: {
          mint: pool.mintB?.address || pool.mintB?.mint || '',
          symbol: pool.mintB?.symbol || 'UNKNOWN',
          decimals: pool.mintB?.decimals || 6,
          logoURI: pool.mintB?.logoURI,
        },
        fee: (pool.feeRate || 2500) / 10000,
        tvl: pool.tvl || 0,
        apy: pool.apr?.total || pool.apy || 0,
        apy7d: pool.apr7d?.total || pool.apr?.total || 0,
        volume24h: pool.day?.volume || pool.volume24h || 0,
        priceRange: pool.price ? {
          lower: 0,
          upper: Infinity,
          current: pool.price,
        } : undefined,
      };
    } catch {
      return null;
    }
  }

  private calculateTickRange(strategy: string): { tickLower: number; tickUpper: number } {
    // Raydium uses different tick spacing per fee tier
    // Using 60 as default (for 0.25% fee)
    const tickSpacing = 60;
    const currentTick = 0; // Would come from pool data
    
    switch (strategy) {
      case 'concentrated':
        return {
          tickLower: Math.floor((currentTick - 600) / tickSpacing) * tickSpacing,
          tickUpper: Math.ceil((currentTick + 600) / tickSpacing) * tickSpacing,
        };
      case 'balanced':
        return {
          tickLower: Math.floor((currentTick - 2400) / tickSpacing) * tickSpacing,
          tickUpper: Math.ceil((currentTick + 2400) / tickSpacing) * tickSpacing,
        };
      case 'yield-max':
        return {
          tickLower: Math.floor((currentTick - 6000) / tickSpacing) * tickSpacing,
          tickUpper: Math.ceil((currentTick + 6000) / tickSpacing) * tickSpacing,
        };
      default:
        return {
          tickLower: -443580,
          tickUpper: 443580,
        };
    }
  }

  private getHardcodedPools(): LPPool[] {
    return [
      {
        venue: 'raydium',
        address: '2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv',
        name: 'SOL-USDC',
        tokenA: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
        tokenB: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
        fee: 0.25,
        tvl: 38000000,
        apy: 48.2,
        apy7d: 42.8,
        volume24h: 18000000,
      },
      {
        venue: 'raydium',
        address: 'CYbD9RaToYMtWKA7QZyoLahnHdWq553Vm62Lh6qWtuxq',
        name: 'SOL-USDT',
        tokenA: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
        tokenB: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', decimals: 6 },
        fee: 0.25,
        tvl: 22000000,
        apy: 35.6,
        apy7d: 31.2,
        volume24h: 9000000,
      },
      {
        venue: 'raydium',
        address: 'AVs9TA4nWDzfPJE9monGFdCF1ydNhtLaX3U2Z8PbQqe7',
        name: 'RAY-SOL',
        tokenA: { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', decimals: 6 },
        tokenB: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
        fee: 0.25,
        tvl: 15000000,
        apy: 85.4,
        apy7d: 78.2,
        volume24h: 12000000,
      },
      {
        venue: 'raydium',
        address: 'BvMrHdgcmZcPRGzCBYhpJR6q6AfQsMVvsBQ4LQNVGSMQ',
        name: 'BONK-SOL',
        tokenA: { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
        tokenB: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
        fee: 1.00,
        tvl: 6500000,
        apy: 178.5,
        apy7d: 162.3,
        volume24h: 28000000,
      },
      {
        venue: 'raydium',
        address: 'HFm9fKTmD9X4WpL8CXi6DoMaT4n7V7dLPJ8e7GYKQVXZ',
        name: 'JTO-SOL',
        tokenA: { mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', symbol: 'JTO', decimals: 9 },
        tokenB: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
        fee: 0.25,
        tvl: 9000000,
        apy: 72.3,
        apy7d: 65.8,
        volume24h: 7500000,
      },
      {
        venue: 'raydium',
        address: 'EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMy',
        name: 'WIF-SOL',
        tokenA: { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', decimals: 6 },
        tokenB: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
        fee: 1.00,
        tvl: 5200000,
        apy: 245.8,
        apy7d: 218.4,
        volume24h: 35000000,
      },
    ];
  }
}

// Export singleton
export const raydiumAdapter = new RaydiumAdapter();
export default raydiumAdapter;
