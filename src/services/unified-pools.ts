/**
 * Unified Pool Fetcher Service
 *
 * Aggregates liquidity pools from multiple DEXes (Meteora DLMM, Orca Whirlpools, Raydium CLMM)
 * into a unified format for the LP Agent Toolkit.
 *
 * Features:
 * - Unified pool interface across DEXes
 * - Risk-adjusted yield scoring
 * - Pair deduplication (keeps highest APR)
 * - Best pool discovery for any token pair
 */

import { STABLECOINS } from '../risk/index.js';

// ============ Types ============

export interface UnifiedPool {
  address: string;
  name: string;
  tokenA: { symbol: string; mint: string };
  tokenB: { symbol: string; mint: string };
  dex: 'meteora' | 'orca' | 'raydium';
  apr: number;
  tvl: number;
  volume24h: number;
  feeRate: number; // bps
  riskScore: number;
  dailyYieldPer100Usd: number; // e.g., 1.50 means "$1.50/day"
  binStep?: number; // Meteora DLMM
  tickSpacing?: number; // Orca Whirlpools / Raydium CLMM
}

export interface FetchUnifiedPoolsOptions {
  limit?: number;
  minTvl?: number;
  maxRiskScore?: number;
  dexFilter?: 'meteora' | 'orca' | 'raydium' | 'all';
  sortBy?: 'apr' | 'tvl' | 'riskAdjustedYield' | 'volume24h';
  tokenFilter?: string; // Only pools containing this token symbol
}

// ============ Constants ============

const METEORA_API = 'https://dlmm-api.meteora.ag/pair/all';
const ORCA_API = 'https://api.orca.so/v2/solana/pools';
const RAYDIUM_API = 'https://api-v3.raydium.io/pools/info/list';

// Tick spacing to fee rate mapping (bps) for Orca/Raydium
const TICK_SPACING_FEE: Record<number, number> = {
  1: 1, 2: 2, 4: 5, 8: 10, 16: 15, 32: 30, 64: 65, 128: 100, 256: 200,
};

// Cache configuration
const CACHE_TTL_MS = 60_000; // 1 minute

// ============ Cache ============

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

let _meteoraCache: CacheEntry<any[]> | null = null;
let _orcaCache: CacheEntry<any[]> | null = null;
let _raydiumCache: CacheEntry<any[]> | null = null;

// ============ Risk Scoring ============

/**
 * Calculate risk score (1-10) for a pool based on volatility and TVL
 * Uses simplified heuristics; can be enhanced with real volatility data
 */
function calculatePoolRiskScore(
  tokenASymbol: string,
  tokenBSymbol: string,
  tvl: number,
  volume24h: number,
): number {
  let score = 1;

  // Check for stablecoin pairs (lowest risk)
  const isStableA = STABLECOINS.has(tokenASymbol);
  const isStableB = STABLECOINS.has(tokenBSymbol);
  const isStablePair = isStableA && isStableB;
  const hasStable = isStableA || isStableB;

  if (isStablePair) {
    return 1; // Stable-stable is lowest risk
  }

  // Token volatility estimation based on known patterns
  const HIGH_VOL_TOKENS = new Set(['BONK', 'WIF', 'POPCAT', 'BOME', 'MEW', 'MYRO', 'SLERF']);
  const MED_VOL_TOKENS = new Set(['JUP', 'JTO', 'PYTH', 'W', 'TNSR', 'RAY']);
  const LOW_VOL_TOKENS = new Set(['SOL', 'mSOL', 'jitoSOL', 'bSOL', 'INF', 'jupSOL']);

  const tokenSymbols = [tokenASymbol, tokenBSymbol];
  let maxVolCategory = 0;

  for (const sym of tokenSymbols) {
    if (HIGH_VOL_TOKENS.has(sym)) maxVolCategory = Math.max(maxVolCategory, 3);
    else if (MED_VOL_TOKENS.has(sym)) maxVolCategory = Math.max(maxVolCategory, 2);
    else if (LOW_VOL_TOKENS.has(sym) || STABLECOINS.has(sym)) maxVolCategory = Math.max(maxVolCategory, 1);
    else maxVolCategory = Math.max(maxVolCategory, 2); // Unknown defaults to medium
  }

  // Volatility component (1-4 points)
  score += maxVolCategory;

  // TVL component (0-3 points) - lower TVL = higher risk
  if (tvl < 50_000) score += 3;
  else if (tvl < 200_000) score += 2;
  else if (tvl < 1_000_000) score += 1;

  // Volume/TVL ratio - very low volume can indicate dead pool
  const volumeRatio = tvl > 0 ? volume24h / tvl : 0;
  if (volumeRatio < 0.01) score += 1; // Low activity

  // Stable pair bonus
  if (hasStable) score = Math.max(1, score - 1);

  return Math.min(10, Math.max(1, score));
}

/**
 * Calculate daily yield per $100 USD deposited
 */
function calculateDailyYield(apr: number): number {
  // APR is annual, divide by 365 for daily
  // For $100: (apr / 100) * 100 / 365 = apr / 365
  return Number((apr / 365).toFixed(2));
}

/**
 * Calculate risk-adjusted yield (Sharpe-like ratio)
 */
function calculateRiskAdjustedYield(apr: number, riskScore: number): number {
  // Higher is better: APR / riskScore
  return riskScore > 0 ? apr / riskScore : 0;
}

// ============ Meteora Fetching ============

/**
 * Fetch top Meteora DLMM pools
 */
export async function fetchMeteoraTopPools(limit: number = 20): Promise<UnifiedPool[]> {
  // Check cache
  if (_meteoraCache && Date.now() - _meteoraCache.fetchedAt < CACHE_TTL_MS) {
    return _meteoraCache.data.slice(0, limit).map(transformMeteoraPool);
  }

  try {
    const resp = await fetch(METEORA_API);
    if (!resp.ok) throw new Error(`Meteora API failed: ${resp.status}`);

    const rawPools = (await resp.json()) as any[];
    
    // Filter and sort
    const validPools = rawPools
      .filter(p => !p.is_blacklisted && !p.hide && parseFloat(p.liquidity || '0') > 10_000)
      .sort((a, b) => parseFloat(b.liquidity || '0') - parseFloat(a.liquidity || '0'));

    _meteoraCache = { data: validPools, fetchedAt: Date.now() };

    return validPools.slice(0, limit).map(transformMeteoraPool);
  } catch (error) {
    console.error('[UnifiedPools] Meteora fetch error:', error);
    return [];
  }
}

function transformMeteoraPool(p: any): UnifiedPool {
  const name = p.name || 'Unknown';
  const [tokenASymbol, tokenBSymbol] = name.split('-').map((s: string) => s.trim());
  const apr = parseFloat(p.apr || '0') * 100; // Convert decimal to percentage
  const tvl = parseFloat(p.liquidity || '0');
  const volume24h = parseFloat(p.trade_volume_24h || '0');
  const binStep = parseInt(p.bin_step || '10');

  const riskScore = calculatePoolRiskScore(tokenASymbol, tokenBSymbol, tvl, volume24h);

  return {
    address: p.address,
    name,
    tokenA: { symbol: tokenASymbol || 'UNKNOWN', mint: p.mint_x || '' },
    tokenB: { symbol: tokenBSymbol || 'UNKNOWN', mint: p.mint_y || '' },
    dex: 'meteora',
    apr,
    tvl,
    volume24h,
    feeRate: binStep, // In Meteora DLMM, binStep approximates fee structure
    riskScore,
    dailyYieldPer100Usd: calculateDailyYield(apr),
    binStep,
  };
}

// ============ Orca Fetching ============

/**
 * Fetch top Orca Whirlpool pools
 */
export async function fetchOrcaTopPools(limit: number = 20): Promise<UnifiedPool[]> {
  // Check cache
  if (_orcaCache && Date.now() - _orcaCache.fetchedAt < CACHE_TTL_MS) {
    return _orcaCache.data.slice(0, limit).map(transformOrcaPool);
  }

  try {
    const url = `${ORCA_API}?sortBy=tvl&sortDirection=desc&size=${Math.min(limit * 2, 100)}&minTvl=50000`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Orca API failed: ${resp.status}`);

    const data = (await resp.json()) as any;
    const rawPools = data.data || [];

    _orcaCache = { data: rawPools, fetchedAt: Date.now() };

    return rawPools.slice(0, limit).map(transformOrcaPool);
  } catch (error) {
    console.error('[UnifiedPools] Orca fetch error:', error);
    return [];
  }
}

function transformOrcaPool(p: any): UnifiedPool {
  const tokenASymbol = p.tokenA?.symbol || 'UNKNOWN';
  const tokenBSymbol = p.tokenB?.symbol || 'UNKNOWN';
  const name = `${tokenASymbol}-${tokenBSymbol}`;
  const tickSpacing = p.tickSpacing || 64;
  const feeRate = TICK_SPACING_FEE[tickSpacing] || 65;
  
  // Orca API may have TVL in different places, or it may be null
  let tvl = p.tvl || 0;
  
  // Extract volume from stats['24h'].volume or fallback
  const stats24h = p.stats?.['24h'] || {};
  const volume24h = parseFloat(stats24h.volume) || p.stats?.volume24h || p.volume?.day || 0;
  
  // If TVL is null/0 but we have yieldOverTvl, estimate TVL from fees
  // yieldOverTvl = dailyFees / TVL, so TVL = dailyFees / yieldOverTvl
  const yieldOverTvl = parseFloat(stats24h.yieldOverTvl) || 0;
  const dailyFees = parseFloat(stats24h.fees) || 0;
  if (tvl === 0 && yieldOverTvl > 0 && dailyFees > 0) {
    tvl = dailyFees / yieldOverTvl;
  }
  
  // Calculate APR from yieldOverTvl (daily rate * 365)
  // yieldOverTvl is the daily yield rate (fees/tvl for that day)
  const apr = yieldOverTvl > 0 ? yieldOverTvl * 365 * 100 : 0;

  const riskScore = calculatePoolRiskScore(tokenASymbol, tokenBSymbol, tvl, volume24h);

  return {
    address: p.address,
    name,
    tokenA: { symbol: tokenASymbol, mint: p.tokenA?.mint || '' },
    tokenB: { symbol: tokenBSymbol, mint: p.tokenB?.mint || '' },
    dex: 'orca',
    apr,
    tvl,
    volume24h,
    feeRate,
    riskScore,
    dailyYieldPer100Usd: calculateDailyYield(apr),
    tickSpacing,
  };
}

// ============ Raydium Fetching ============

/**
 * Fetch top Raydium CLMM pools
 */
export async function fetchRaydiumTopPools(limit: number = 20): Promise<UnifiedPool[]> {
  // Check cache
  if (_raydiumCache && Date.now() - _raydiumCache.fetchedAt < CACHE_TTL_MS) {
    return _raydiumCache.data.slice(0, limit).map(transformRaydiumPool);
  }

  try {
    const url = `${RAYDIUM_API}?poolType=concentrated&poolSortField=liquidity&sortType=desc&page=1&pageSize=${Math.min(limit * 2, 100)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Raydium API failed: ${resp.status}`);

    const data = (await resp.json()) as any;
    if (!data.success) throw new Error('Raydium API returned error');

    const rawPools = data.data?.data || [];

    _raydiumCache = { data: rawPools, fetchedAt: Date.now() };

    return rawPools.slice(0, limit).map(transformRaydiumPool);
  } catch (error) {
    console.error('[UnifiedPools] Raydium fetch error:', error);
    return [];
  }
}

function transformRaydiumPool(p: any): UnifiedPool {
  const tokenASymbol = p.mintA?.symbol || 'UNKNOWN';
  const tokenBSymbol = p.mintB?.symbol || 'UNKNOWN';
  const name = `${tokenASymbol}-${tokenBSymbol}`;
  const tickSpacing = p.config?.tickSpacing || 64;
  const feeRate = Math.round((p.feeRate || 0.0025) * 10000); // Convert to bps
  
  const tvl = p.tvl || 0;
  const volume24h = p.day?.volume || 0;
  
  // Raydium provides APR directly (already percentage)
  const apr = p.day?.apr || 0;

  const riskScore = calculatePoolRiskScore(tokenASymbol, tokenBSymbol, tvl, volume24h);

  return {
    address: p.id,
    name,
    tokenA: { symbol: tokenASymbol, mint: p.mintA?.address || '' },
    tokenB: { symbol: tokenBSymbol, mint: p.mintB?.address || '' },
    dex: 'raydium',
    apr,
    tvl,
    volume24h,
    feeRate,
    riskScore,
    dailyYieldPer100Usd: calculateDailyYield(apr),
    tickSpacing,
  };
}

// ============ Unified Fetching ============

/**
 * Fetch pools from all DEXes with unified format
 * Deduplicates same pairs (keeps higher APR), sorts by risk-adjusted yield
 */
export async function fetchUnifiedPools(
  options: FetchUnifiedPoolsOptions = {}
): Promise<UnifiedPool[]> {
  const {
    limit = 20,
    minTvl = 50_000,
    maxRiskScore = 10,
    dexFilter = 'all',
    sortBy = 'riskAdjustedYield',
    tokenFilter,
  } = options;

  // Fetch from all DEXes in parallel
  const [meteoraPools, orcaPools, raydiumPools] = await Promise.all([
    dexFilter === 'orca' || dexFilter === 'raydium' ? [] : fetchMeteoraTopPools(limit * 2),
    dexFilter === 'meteora' || dexFilter === 'raydium' ? [] : fetchOrcaTopPools(limit * 2),
    dexFilter === 'meteora' || dexFilter === 'orca' ? [] : fetchRaydiumTopPools(limit * 2),
  ]);

  let allPools = [...meteoraPools, ...orcaPools, ...raydiumPools];

  // Apply filters
  allPools = allPools.filter(pool => {
    if (pool.tvl < minTvl) return false;
    if (pool.riskScore > maxRiskScore) return false;
    if (tokenFilter) {
      const filter = tokenFilter.toUpperCase();
      if (pool.tokenA.symbol.toUpperCase() !== filter && 
          pool.tokenB.symbol.toUpperCase() !== filter) {
        return false;
      }
    }
    return true;
  });

  // Deduplicate: keep the pool with higher APR for same token pair
  const pairMap = new Map<string, UnifiedPool>();
  for (const pool of allPools) {
    // Normalize pair key (alphabetical order)
    const tokens = [pool.tokenA.symbol, pool.tokenB.symbol].sort();
    const pairKey = tokens.join('-');

    const existing = pairMap.get(pairKey);
    if (!existing || pool.apr > existing.apr) {
      pairMap.set(pairKey, pool);
    }
  }

  let dedupedPools = Array.from(pairMap.values());

  // Sort
  switch (sortBy) {
    case 'apr':
      dedupedPools.sort((a, b) => b.apr - a.apr);
      break;
    case 'tvl':
      dedupedPools.sort((a, b) => b.tvl - a.tvl);
      break;
    case 'volume24h':
      dedupedPools.sort((a, b) => b.volume24h - a.volume24h);
      break;
    case 'riskAdjustedYield':
    default:
      dedupedPools.sort((a, b) => 
        calculateRiskAdjustedYield(b.apr, b.riskScore) - 
        calculateRiskAdjustedYield(a.apr, a.riskScore)
      );
      break;
  }

  return dedupedPools.slice(0, limit);
}

// ============ Best Pool Discovery ============

/**
 * Find the best pool for a given token pair across all DEXes
 * Returns the pool with highest APR for the pair
 */
export async function findBestPool(
  tokenA: string,
  tokenB: string
): Promise<UnifiedPool | null> {
  const tokenAUpper = tokenA.toUpperCase();
  const tokenBUpper = tokenB.toUpperCase();

  // Fetch all pools from all DEXes
  const [meteoraPools, orcaPools, raydiumPools] = await Promise.all([
    fetchMeteoraTopPools(100),
    fetchOrcaTopPools(100),
    fetchRaydiumTopPools(100),
  ]);

  const allPools = [...meteoraPools, ...orcaPools, ...raydiumPools];

  // Find matching pools
  const matchingPools = allPools.filter(pool => {
    const poolTokens = new Set([
      pool.tokenA.symbol.toUpperCase(),
      pool.tokenB.symbol.toUpperCase(),
    ]);
    return poolTokens.has(tokenAUpper) && poolTokens.has(tokenBUpper);
  });

  if (matchingPools.length === 0) {
    return null;
  }

  // Sort by APR and return best
  matchingPools.sort((a, b) => b.apr - a.apr);
  return matchingPools[0];
}

/**
 * Find pools by token symbol (in either position)
 */
export async function findPoolsByToken(
  tokenSymbol: string,
  options: { limit?: number; minTvl?: number } = {}
): Promise<UnifiedPool[]> {
  return fetchUnifiedPools({
    limit: options.limit || 10,
    minTvl: options.minTvl || 50_000,
    tokenFilter: tokenSymbol,
    sortBy: 'riskAdjustedYield',
  });
}

// ============ Utility Functions ============

/**
 * Format pool for display
 */
export function formatPoolDisplay(pool: UnifiedPool): string {
  const dexBadge = pool.dex === 'meteora' ? '🌙' : pool.dex === 'orca' ? '🐋' : '⚡'; // Raydium = lightning
  const tvlStr = pool.tvl >= 1_000_000 
    ? `$${(pool.tvl / 1_000_000).toFixed(1)}M`
    : pool.tvl >= 1_000 
      ? `$${(pool.tvl / 1_000).toFixed(0)}K`
      : `$${pool.tvl.toFixed(0)}`;
  
  const riskEmoji = pool.riskScore <= 3 ? '🟢' : pool.riskScore <= 6 ? '🟡' : '🔴';

  return [
    `${dexBadge} **${pool.name}** (${pool.dex})`,
    `   APR: ${pool.apr.toFixed(1)}% | TVL: ${tvlStr}`,
    `   Daily yield per $100: $${pool.dailyYieldPer100Usd.toFixed(2)}`,
    `   Risk: ${riskEmoji} ${pool.riskScore}/10`,
  ].join('\n');
}

/**
 * Clear pool cache (for testing)
 */
export function clearUnifiedPoolsCache(): void {
  _meteoraCache = null;
  _orcaCache = null;
  _raydiumCache = null;
}

// ============ Exports ============

export {
  calculatePoolRiskScore,
  calculateDailyYield,
  calculateRiskAdjustedYield,
};

// ============ CLI Test ============

// Test function - call manually or via: npx tsx src/services/unified-pools.ts
export async function testUnifiedPools(): Promise<void> {
  console.log('🔍 Testing Unified Pool Fetcher...\n');

  // Test Meteora
  console.log('=== Meteora Top Pools ===');
  const meteoraPools = await fetchMeteoraTopPools(5);
  meteoraPools.forEach(p => console.log(formatPoolDisplay(p) + '\n'));

  // Test Orca
  console.log('\n=== Orca Top Pools ===');
  const orcaPools = await fetchOrcaTopPools(5);
  orcaPools.forEach(p => console.log(formatPoolDisplay(p) + '\n'));

  // Test Raydium
  console.log('\n=== Raydium Top Pools ===');
  const raydiumPools = await fetchRaydiumTopPools(5);
  raydiumPools.forEach(p => console.log(formatPoolDisplay(p) + '\n'));

  // Test unified
  console.log('\n=== Unified Pools (Risk-Adjusted) ===');
  const unified = await fetchUnifiedPools({ limit: 10, sortBy: 'riskAdjustedYield' });
  unified.forEach(p => console.log(formatPoolDisplay(p) + '\n'));

  // Test findBestPool
  console.log('\n=== Best SOL-USDC Pool ===');
  const bestSolUsdc = await findBestPool('SOL', 'USDC');
  if (bestSolUsdc) {
    console.log(formatPoolDisplay(bestSolUsdc));
  } else {
    console.log('No SOL-USDC pool found');
  }

  // Test findPoolsByToken
  console.log('\n=== Pools with JUP ===');
  const jupPools = await findPoolsByToken('JUP', { limit: 3 });
  jupPools.forEach(p => console.log(formatPoolDisplay(p) + '\n'));

  console.log('\n✅ Unified Pool Fetcher test complete!');
}

// To test: npx tsx -e "import { testUnifiedPools } from './src/services/unified-pools.js'; testUnifiedPools()"
