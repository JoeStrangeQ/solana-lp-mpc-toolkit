/**
 * Unified Yield Scanner
 * Aggregates LP opportunities across all DEX venues
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAllAdapters, getAdapter } from '../adapters';
import { LPPool, LPPosition, DEXVenue, YieldScanResult } from '../adapters/types';

// ============ Types ============

export interface ScanOptions {
  venues?: DEXVenue[];      // Filter by specific venues
  tokenA?: string;          // Filter by token (symbol or mint)
  tokenB?: string;          // Filter by token pair
  minApy?: number;          // Minimum APY threshold
  minTvl?: number;          // Minimum TVL in USD
  maxFee?: number;          // Maximum fee percentage
  limit?: number;           // Max results per venue
  sortBy?: 'apy' | 'tvl' | 'volume' | 'fee';
}

export interface AggregatedPositions {
  positions: LPPosition[];
  totalValueUSD: number;
  totalUnclaimedUSD: number;
  byVenue: Record<DEXVenue, {
    count: number;
    valueUSD: number;
    unclaimedUSD: number;
  }>;
}

// ============ Scanner Class ============

export class YieldScanner {
  private connection: Connection;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTimeout = 60000; // 1 minute

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Scan all venues for LP opportunities
   */
  async scanPools(options: ScanOptions = {}): Promise<YieldScanResult> {
    const {
      venues = ['meteora', 'orca', 'raydium'],
      tokenA,
      tokenB,
      minApy = 0,
      minTvl = 10000,
      maxFee = 100,
      limit = 20,
      sortBy = 'apy',
    } = options;

    const allPools: LPPool[] = [];

    // Fetch from each venue
    for (const venue of venues) {
      try {
        const pools = await this.fetchPoolsForVenue(venue, tokenA, tokenB);
        allPools.push(...pools);
      } catch (error) {
        console.error(`Failed to fetch ${venue} pools:`, error);
      }
    }

    // Apply filters
    let filtered = allPools.filter(pool => 
      pool.apy >= minApy &&
      pool.tvl >= minTvl &&
      pool.fee <= maxFee
    );

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'tvl': return b.tvl - a.tvl;
        case 'volume': return b.volume24h - a.volume24h;
        case 'fee': return a.fee - b.fee;
        default: return b.apy - a.apy;
      }
    });

    // Limit results
    filtered = filtered.slice(0, limit);

    // Determine recommendation
    const recommended = filtered.length > 0 ? filtered[0] : null;
    const reasoning = this.generateRecommendationReasoning(recommended, options);

    return {
      pools: filtered,
      recommended,
      reasoning,
      timestamp: Date.now(),
    };
  }

  /**
   * Fetch pools from a specific venue using unified adapters
   */
  private async fetchPoolsForVenue(
    venue: DEXVenue, 
    tokenA?: string, 
    tokenB?: string
  ): Promise<LPPool[]> {
    const cacheKey = `pools:${venue}:${tokenA || ''}:${tokenB || ''}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    const adapter = getAdapter(venue);
    if (!adapter) {
      console.warn(`No adapter available for ${venue}`);
      return [];
    }

    let pools: LPPool[] = [];
    
    try {
      pools = await adapter.getPools(this.connection);
      
      // Filter by tokens if specified
      if (tokenA || tokenB) {
        pools = pools.filter(p => {
          const matchA = !tokenA || 
            p.tokenA.symbol.toUpperCase().includes(tokenA.toUpperCase()) ||
            p.tokenB.symbol.toUpperCase().includes(tokenA.toUpperCase());
          const matchB = !tokenB || 
            p.tokenA.symbol.toUpperCase().includes(tokenB.toUpperCase()) ||
            p.tokenB.symbol.toUpperCase().includes(tokenB.toUpperCase());
          return matchA && matchB;
        });
      }
    } catch (error) {
      console.error(`Failed to fetch ${venue} pools:`, error);
    }

    this.cache.set(cacheKey, { data: pools, timestamp: Date.now() });
    return pools;
  }

  /**
   * Quick helper: Find the best pool for a token pair
   */
  async findBestPool(tokenA: string, tokenB: string): Promise<LPPool | null> {
    const result = await this.scanPools({
      tokenA,
      tokenB,
      limit: 1,
      sortBy: 'apy',
      minTvl: 50000, // Only consider pools with decent liquidity
    });
    return result.recommended;
  }

  /**
   * Calculate estimated daily earnings for an amount
   */
  estimateDailyEarnings(pool: LPPool, amountUSD: number): number {
    const dailyRate = pool.apy / 365 / 100;
    return amountUSD * dailyRate;
  }

  /**
   * Format pool for chat display (agent-native output)
   */
  formatPoolForChat(pool: LPPool, amountUSD?: number): string {
    const daily = amountUSD ? this.estimateDailyEarnings(pool, amountUSD) : null;
    const dailyStr = daily ? ` (~$${daily.toFixed(2)}/day)` : '';
    
    return `${pool.name} [${pool.venue}] - ${pool.apy.toFixed(1)}% APY${dailyStr}`;
  }

  /**
   * Get all positions for a user across all venues
   */
  async getAggregatedPositions(userPubkey: PublicKey): Promise<AggregatedPositions> {
    const positions: LPPosition[] = [];
    const byVenue: AggregatedPositions['byVenue'] = {
      meteora: { count: 0, valueUSD: 0, unclaimedUSD: 0 },
      orca: { count: 0, valueUSD: 0, unclaimedUSD: 0 },
      raydium: { count: 0, valueUSD: 0, unclaimedUSD: 0 },
      phoenix: { count: 0, valueUSD: 0, unclaimedUSD: 0 },
    };

    // Fetch positions from all adapters in parallel
    const adapters = getAllAdapters();
    const fetchPromises = adapters.map(async (adapter) => {
      try {
        const venuePositions = await adapter.getPositions(this.connection, userPubkey);
        return { venue: adapter.venue, positions: venuePositions };
      } catch (error) {
        console.error(`Failed to fetch ${adapter.venue} positions:`, error);
        return { venue: adapter.venue, positions: [] };
      }
    });

    const results = await Promise.all(fetchPromises);

    // Aggregate results
    for (const { venue, positions: venuePositions } of results) {
      for (const pos of venuePositions) {
        positions.push(pos);
        byVenue[venue].count++;
        byVenue[venue].valueUSD += pos.valueUSD;
        byVenue[venue].unclaimedUSD += pos.unclaimedFees.totalUSD;
      }
    }

    const totalValueUSD = positions.reduce((sum, p) => sum + p.valueUSD, 0);
    const totalUnclaimedUSD = positions.reduce((sum, p) => sum + p.unclaimedFees.totalUSD, 0);

    return {
      positions,
      totalValueUSD,
      totalUnclaimedUSD,
      byVenue,
    };
  }

  /**
   * Generate reasoning for pool recommendation
   */
  private generateRecommendationReasoning(pool: LPPool | null, options: ScanOptions): string {
    if (!pool) {
      return 'No pools found matching your criteria.';
    }

    const reasons: string[] = [];

    if (pool.apy > 50) {
      reasons.push(`High APY of ${pool.apy.toFixed(1)}%`);
    } else if (pool.apy > 20) {
      reasons.push(`Solid APY of ${pool.apy.toFixed(1)}%`);
    }

    if (pool.tvl > 10000000) {
      reasons.push(`Deep liquidity ($${(pool.tvl / 1e6).toFixed(1)}M TVL)`);
    }

    if (pool.volume24h > 1000000) {
      reasons.push(`Active trading ($${(pool.volume24h / 1e6).toFixed(1)}M 24h volume)`);
    }

    if (pool.fee < 0.3) {
      reasons.push(`Low fee (${pool.fee}%)`);
    }

    return reasons.length > 0 
      ? `Recommended: ${reasons.join(', ')}`
      : 'Best match for your criteria.';
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Export singleton factory
export function createYieldScanner(connection: Connection): YieldScanner {
  return new YieldScanner(connection);
}

export default YieldScanner;
