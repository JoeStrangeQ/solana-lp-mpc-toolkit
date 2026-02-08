/**
 * Raydium CLMM pool discovery via REST API
 */

import type { RaydiumPoolInfo, RaydiumApiResponse, RaydiumApiPool } from './types.js';

const RAYDIUM_API = 'https://api-v3.raydium.io';

let _poolCache: { data: RaydiumPoolInfo[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * Transform Raydium API pool to our RaydiumPoolInfo format
 */
function transformApiPool(pool: RaydiumApiPool): RaydiumPoolInfo {
  return {
    address: pool.id,
    name: `${pool.mintA.symbol}-${pool.mintB.symbol}`,
    tokenA: {
      mint: pool.mintA.address,
      symbol: pool.mintA.symbol,
      decimals: pool.mintA.decimals,
    },
    tokenB: {
      mint: pool.mintB.address,
      symbol: pool.mintB.symbol,
      decimals: pool.mintB.decimals,
    },
    tickSpacing: pool.config.tickSpacing,
    feeRate: pool.feeRate,
    tvl: pool.tvl,
    volume24h: pool.day?.volume || 0,
    price: pool.price,
    apr24h: pool.day?.apr || 0,
    config: pool.config,
  };
}

/**
 * Fetch top Raydium CLMM pools sorted by liquidity
 */
export async function fetchRaydiumPools(
  limit = 20,
  sortBy: 'liquidity' | 'volume_24h' | 'apr_24h' = 'liquidity',
): Promise<RaydiumPoolInfo[]> {
  // Check cache
  if (_poolCache && Date.now() - _poolCache.fetchedAt < CACHE_TTL_MS) {
    return _poolCache.data.slice(0, limit);
  }

  try {
    const url = `${RAYDIUM_API}/pools/info/list?poolType=concentrated&poolSortField=${sortBy}&sortType=desc&page=1&pageSize=${Math.min(limit * 2, 100)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Raydium API failed: ${resp.status}`);

    const data = (await resp.json()) as RaydiumApiResponse;
    if (!data.success) {
      throw new Error(`Raydium API error: ${JSON.stringify(data)}`);
    }

    const pools: RaydiumPoolInfo[] = data.data.data.map(transformApiPool);

    _poolCache = { data: pools, fetchedAt: Date.now() };
    return pools.slice(0, limit);
  } catch (error) {
    console.error('[Raydium] Pool fetch error:', error);
    return [];
  }
}

/**
 * Fetch Raydium pool by address
 */
export async function fetchRaydiumPoolByAddress(address: string): Promise<RaydiumPoolInfo | null> {
  // Try cache first
  if (_poolCache) {
    const cached = _poolCache.data.find(p => p.address === address);
    if (cached) return cached;
  }

  try {
    const url = `${RAYDIUM_API}/pools/info/ids?ids=${address}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;

    const data = await resp.json() as { success: boolean; data: RaydiumApiPool[] };
    if (!data.success || !data.data?.length) return null;

    return transformApiPool(data.data[0]);
  } catch {
    return null;
  }
}

/**
 * Search Raydium pools by token pair
 */
export async function searchRaydiumPools(
  tokenA?: string,
  tokenB?: string,
  limit = 10,
): Promise<RaydiumPoolInfo[]> {
  try {
    let url = `${RAYDIUM_API}/pools/info/list?poolType=concentrated&poolSortField=liquidity&sortType=desc&page=1&pageSize=100`;
    
    // Add mint filters if provided
    if (tokenA) url += `&mint1=${tokenA}`;
    if (tokenB) url += `&mint2=${tokenB}`;

    const resp = await fetch(url);
    if (!resp.ok) return [];

    const data = (await resp.json()) as RaydiumApiResponse;
    if (!data.success) return [];

    return data.data.data.slice(0, limit).map(transformApiPool);
  } catch (error) {
    console.error('[Raydium] Pool search error:', error);
    return [];
  }
}

/**
 * Clear pool cache (for testing)
 */
export function clearRaydiumPoolCache(): void {
  _poolCache = null;
}
