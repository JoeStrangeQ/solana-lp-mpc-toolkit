/**
 * Risk Engine Integration
 * 
 * Uses volatility data and pool metrics to assess LP risk.
 * Inspired by Percolator's formally verified risk primitives.
 * 
 * Key metrics:
 * - IL Risk: Based on token volatility and correlation
 * - Position Health: % of range utilized, time out of range
 * - Risk-Adjusted Return: Sharpe-like ratio (APR / volatility)
 */

import { Redis } from '@upstash/redis';

// ============ Types ============

export interface PoolRiskAssessment {
  poolAddress: string;
  poolName: string;
  
  // From Meteora
  apr: number;
  tvl: number;
  binStep: number;
  volume24h: number;
  
  // Risk metrics (1-10 scale, 1=safest)
  riskScore: number;
  ilRisk: 'low' | 'medium' | 'high' | 'extreme';
  
  // Volatility (24h, in basis points)
  tokenXVolatility: number;
  tokenYVolatility: number;
  pairVolatility: number;
  
  // Risk-adjusted metrics
  sharpeRatio: number;  // APR / volatility (annualized)
  
  // Recommendations
  recommendedBins: number;
  recommendedStrategy: 'spot' | 'curve' | 'bid-ask';
  
  // Warnings
  warnings: string[];
  
  // Timestamp
  assessedAt: string;
}

export interface PositionRiskAssessment {
  positionAddress: string;
  poolAddress: string;
  poolName: string;
  
  // Position state
  inRange: boolean;
  rangeUtilization: number;  // 0-100%, how centered in range
  timeOutOfRange: number;    // seconds
  
  // Risk metrics
  healthScore: number;       // 0-100 (100=perfect)
  ilCurrent: number;         // Current IL in %
  ilProjected24h: number;    // Projected IL if out of range continues
  
  // Action recommendation
  action: 'hold' | 'monitor' | 'rebalance' | 'withdraw';
  actionReason: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface TokenVolatility {
  symbol: string;
  mint: string;
  volatility24h: number;     // in bps
  volatility7d: number;
  price: number;
  priceChange24h: number;    // in %
  updatedAt: string;
}

// ============ Constants ============

// Popular token mints
const TOKEN_MINTS: Record<string, string> = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  'mSOL': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  'JTO': 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
};

// Stablecoins (low volatility)
const STABLECOINS = new Set(['USDC', 'USDT', 'PYUSD', 'DAI', 'USDH']);

// Risk thresholds
const RISK_THRESHOLDS = {
  LOW_VOL_BPS: 100,       // <1% daily vol = low risk
  MEDIUM_VOL_BPS: 300,    // 1-3% = medium
  HIGH_VOL_BPS: 500,      // 3-5% = high
  // >5% = extreme
  
  IL_LOW: 1,              // <1% IL = low
  IL_MEDIUM: 3,           // 1-3% = medium
  IL_HIGH: 5,             // 3-5% = high
  
  HEALTH_CRITICAL: 20,    // <20 = critical
  HEALTH_LOW: 50,         // <50 = low
  HEALTH_MEDIUM: 75,      // <75 = medium
};

// ============ Redis Client ============

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) return null;
  
  redis = new Redis({ url, token });
  return redis;
}

// ============ Volatility Data ============

/**
 * Get token volatility from cached data or fetch fresh
 * Uses Birdeye/Jupiter price API for historical data
 */
export async function getTokenVolatility(symbol: string): Promise<TokenVolatility | null> {
  const client = getRedis();
  const cacheKey = `risk:volatility:${symbol}`;
  
  // Check cache (5 min TTL)
  if (client) {
    const cached = await client.get<TokenVolatility>(cacheKey);
    if (cached) return cached;
  }
  
  // For stablecoins, return minimal volatility
  if (STABLECOINS.has(symbol)) {
    const stableVol: TokenVolatility = {
      symbol,
      mint: TOKEN_MINTS[symbol] || '',
      volatility24h: 10, // 0.1% for stables
      volatility7d: 20,
      price: 1.0,
      priceChange24h: 0,
      updatedAt: new Date().toISOString(),
    };
    
    if (client) {
      await client.set(cacheKey, stableVol, { ex: 300 });
    }
    return stableVol;
  }
  
  try {
    // Fetch from Jupiter Price API
    const mint = TOKEN_MINTS[symbol];
    if (!mint) return null;
    
    const response = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
    
    // If API fails or requires auth, return default volatility for known tokens
    if (!response.ok) {
      // Default volatility estimates for major tokens
      const DEFAULT_VOLATILITY: Record<string, number> = {
        'SOL': 200,   // ~2% daily
        'JUP': 300,   // ~3% daily
        'BONK': 500,  // ~5% daily (meme)
        'WIF': 600,   // ~6% daily (meme)
        'RAY': 250,   // ~2.5% daily
        'mSOL': 180,  // ~1.8% daily (LST)
        'JTO': 350,   // ~3.5% daily
      };
      
      if (DEFAULT_VOLATILITY[symbol]) {
        const defaultVol: TokenVolatility = {
          symbol,
          mint,
          volatility24h: DEFAULT_VOLATILITY[symbol],
          volatility7d: DEFAULT_VOLATILITY[symbol] * 1.5,
          price: 0,
          priceChange24h: 0,
          updatedAt: new Date().toISOString(),
        };
        
        if (client) {
          await client.set(cacheKey, defaultVol, { ex: 300 });
        }
        return defaultVol;
      }
      return null;
    }
    
    const data = await response.json() as any;
    const priceData = data.data?.[mint];
    
    if (!priceData) {
      // Fallback to defaults if no price data
      const DEFAULT_VOLATILITY: Record<string, number> = {
        'SOL': 200, 'JUP': 300, 'BONK': 500, 'WIF': 600, 'RAY': 250, 'mSOL': 180, 'JTO': 350,
      };
      
      if (DEFAULT_VOLATILITY[symbol]) {
        return {
          symbol,
          mint,
          volatility24h: DEFAULT_VOLATILITY[symbol],
          volatility7d: DEFAULT_VOLATILITY[symbol] * 1.5,
          price: 0,
          priceChange24h: 0,
          updatedAt: new Date().toISOString(),
        };
      }
      return null;
    }
    
    // Estimate volatility from price change (simplified)
    // In production, use historical OHLCV data
    const priceChange = Math.abs(priceData.priceChange24h || 0);
    const volatility24h = Math.round(priceChange * 100); // Convert % to bps
    
    const vol: TokenVolatility = {
      symbol,
      mint,
      volatility24h: Math.max(volatility24h, 50), // Min 0.5% for non-stables
      volatility7d: volatility24h * 2, // Rough estimate
      price: priceData.price || 0,
      priceChange24h: priceData.priceChange24h || 0,
      updatedAt: new Date().toISOString(),
    };
    
    if (client) {
      await client.set(cacheKey, vol, { ex: 300 });
    }
    
    return vol;
  } catch (e) {
    console.error(`Failed to get volatility for ${symbol}:`, e);
    return null;
  }
}

// ============ Pool Risk Assessment ============

/**
 * Calculate IL risk category based on volatility
 */
function getILRiskCategory(volatilityBps: number): 'low' | 'medium' | 'high' | 'extreme' {
  if (volatilityBps < RISK_THRESHOLDS.LOW_VOL_BPS) return 'low';
  if (volatilityBps < RISK_THRESHOLDS.MEDIUM_VOL_BPS) return 'medium';
  if (volatilityBps < RISK_THRESHOLDS.HIGH_VOL_BPS) return 'high';
  return 'extreme';
}

/**
 * Calculate overall risk score (1-10)
 */
function calculateRiskScore(
  volatilityBps: number,
  tvl: number,
  isStablePair: boolean
): number {
  let score = 1;
  
  // Volatility component (0-4 points)
  if (volatilityBps > 500) score += 4;
  else if (volatilityBps > 300) score += 3;
  else if (volatilityBps > 100) score += 2;
  else if (volatilityBps > 50) score += 1;
  
  // TVL component (0-2 points) - lower TVL = higher risk
  if (tvl < 100000) score += 2;
  else if (tvl < 500000) score += 1;
  
  // Stable pair bonus
  if (isStablePair) score = Math.max(1, score - 2);
  
  // Meme/low-cap penalty
  if (volatilityBps > 800) score = Math.min(10, score + 2);
  
  return Math.min(10, Math.max(1, score));
}

/**
 * Recommend bin count based on volatility
 */
function recommendBins(volatilityBps: number, binStep: number): number {
  // Higher volatility = wider range needed
  // binStep affects granularity
  
  if (volatilityBps < 100) {
    // Low vol: tight range (15-25 bins)
    return Math.round(20 / (binStep / 10));
  } else if (volatilityBps < 300) {
    // Medium: moderate range (30-50 bins)
    return Math.round(40 / (binStep / 10));
  } else if (volatilityBps < 500) {
    // High: wide range (50-80 bins)
    return Math.round(60 / (binStep / 10));
  } else {
    // Extreme: very wide (80-120 bins)
    return Math.round(100 / (binStep / 10));
  }
}

/**
 * Recommend strategy based on pool characteristics
 */
function recommendStrategy(
  volatilityBps: number,
  isStablePair: boolean
): 'spot' | 'curve' | 'bid-ask' {
  if (isStablePair) {
    return 'curve'; // Concentrated around peg
  }
  
  if (volatilityBps < 200) {
    return 'spot'; // Tight, symmetric
  }
  
  if (volatilityBps > 400) {
    return 'bid-ask'; // Wider, asymmetric possible
  }
  
  return 'curve'; // Default: balanced curve
}

/**
 * Assess risk for a pool
 */
export async function assessPoolRisk(
  poolAddress: string,
  poolName: string,
  apr: number,
  tvl: number,
  binStep: number,
  volume24h: number,
  tokenXSymbol: string,
  tokenYSymbol: string
): Promise<PoolRiskAssessment> {
  const warnings: string[] = [];
  
  // Get volatility for both tokens
  const volX = await getTokenVolatility(tokenXSymbol);
  const volY = await getTokenVolatility(tokenYSymbol);
  
  const tokenXVol = volX?.volatility24h || 200; // Default 2%
  const tokenYVol = volY?.volatility24h || 200;
  
  // Pair volatility (simplified: max of both, could use correlation)
  const pairVolatility = Math.max(tokenXVol, tokenYVol);
  
  // Check if stable pair
  const isStablePair = STABLECOINS.has(tokenXSymbol) && STABLECOINS.has(tokenYSymbol);
  const hasStable = STABLECOINS.has(tokenXSymbol) || STABLECOINS.has(tokenYSymbol);
  
  // Calculate risk metrics
  const ilRisk = getILRiskCategory(pairVolatility);
  const riskScore = calculateRiskScore(pairVolatility, tvl, isStablePair);
  
  // Sharpe-like ratio (APR / annualized vol)
  const annualizedVol = pairVolatility * Math.sqrt(365) / 100; // Convert bps to %
  const sharpeRatio = annualizedVol > 0 ? apr / annualizedVol : 0;
  
  // Recommendations
  const recommendedBins = recommendBins(pairVolatility, binStep);
  const recommendedStrategy = recommendStrategy(pairVolatility, isStablePair);
  
  // Generate warnings
  if (riskScore >= 8) {
    warnings.push('⚠️ High risk pool - significant IL exposure');
  }
  if (tvl < 100000) {
    warnings.push('⚠️ Low liquidity - may have slippage issues');
  }
  if (pairVolatility > 500 && !hasStable) {
    warnings.push('⚠️ Both tokens volatile - extreme IL risk');
  }
  if (apr > 500 && tvl < 500000) {
    warnings.push('⚠️ High APR + low TVL often means high risk');
  }
  if (volume24h < tvl * 0.01) {
    warnings.push('ℹ️ Low volume - may take time to earn fees');
  }
  
  return {
    poolAddress,
    poolName,
    apr,
    tvl,
    binStep,
    volume24h,
    riskScore,
    ilRisk,
    tokenXVolatility: tokenXVol,
    tokenYVolatility: tokenYVol,
    pairVolatility,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    recommendedBins,
    recommendedStrategy,
    warnings,
    assessedAt: new Date().toISOString(),
  };
}

// ============ Position Risk Assessment ============

/**
 * Assess risk for an open position
 */
export async function assessPositionRisk(
  positionAddress: string,
  poolAddress: string,
  poolName: string,
  currentBin: number,
  lowerBin: number,
  upperBin: number,
  outOfRangeSince?: string,
  tokenXSymbol?: string,
  tokenYSymbol?: string
): Promise<PositionRiskAssessment> {
  const inRange = currentBin >= lowerBin && currentBin <= upperBin;
  const rangeSize = upperBin - lowerBin;
  
  // Calculate range utilization (how centered in range)
  let rangeUtilization = 0;
  if (inRange && rangeSize > 0) {
    const distanceFromCenter = Math.abs(currentBin - (lowerBin + rangeSize / 2));
    rangeUtilization = Math.max(0, 100 - (distanceFromCenter / (rangeSize / 2)) * 100);
  }
  
  // Time out of range
  let timeOutOfRange = 0;
  if (!inRange && outOfRangeSince) {
    timeOutOfRange = Math.floor((Date.now() - new Date(outOfRangeSince).getTime()) / 1000);
  }
  
  // Get volatility for IL estimation
  const vol = tokenXSymbol ? await getTokenVolatility(tokenXSymbol) : null;
  const volatilityBps = vol?.volatility24h || 200;
  
  // Estimate current IL (simplified)
  let ilCurrent = 0;
  if (!inRange) {
    // IL increases with distance from range
    const binsOutOfRange = inRange ? 0 : 
      currentBin < lowerBin ? lowerBin - currentBin : currentBin - upperBin;
    ilCurrent = Math.min(50, binsOutOfRange * 0.1); // Rough: 0.1% per bin
  }
  
  // Project 24h IL if out of range continues
  const ilProjected24h = ilCurrent + (volatilityBps / 100) * (inRange ? 0 : 1);
  
  // Calculate health score
  let healthScore = 100;
  
  if (!inRange) {
    healthScore -= 30; // Base penalty for out of range
    healthScore -= Math.min(40, timeOutOfRange / 3600); // -1 per hour, max -40
    healthScore -= Math.min(20, ilCurrent * 2); // IL penalty
  } else {
    // In range but check utilization
    if (rangeUtilization < 30) {
      healthScore -= 10; // Near edge of range
    }
  }
  
  healthScore = Math.max(0, Math.min(100, healthScore));
  
  // Determine action and urgency
  let action: 'hold' | 'monitor' | 'rebalance' | 'withdraw';
  let actionReason: string;
  let urgency: 'low' | 'medium' | 'high' | 'critical';
  
  if (healthScore >= 80) {
    action = 'hold';
    actionReason = 'Position healthy';
    urgency = 'low';
  } else if (healthScore >= 50) {
    action = 'monitor';
    actionReason = inRange ? 'Near range edge' : 'Recently went out of range';
    urgency = 'medium';
  } else if (healthScore >= 20) {
    action = 'rebalance';
    actionReason = `Out of range for ${Math.round(timeOutOfRange / 60)} min, IL at ${ilCurrent.toFixed(1)}%`;
    urgency = 'high';
  } else {
    action = 'withdraw';
    actionReason = `Extended out of range (${Math.round(timeOutOfRange / 3600)}h), consider withdrawing`;
    urgency = 'critical';
  }
  
  return {
    positionAddress,
    poolAddress,
    poolName,
    inRange,
    rangeUtilization: Math.round(rangeUtilization),
    timeOutOfRange,
    healthScore: Math.round(healthScore),
    ilCurrent: Math.round(ilCurrent * 100) / 100,
    ilProjected24h: Math.round(ilProjected24h * 100) / 100,
    action,
    actionReason,
    urgency,
  };
}

// ============ Exports ============

export {
  TOKEN_MINTS,
  STABLECOINS,
  RISK_THRESHOLDS,
};
