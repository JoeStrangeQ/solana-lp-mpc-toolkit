/**
 * Pool Service - Pool discovery and info for routes and bot
 */
import { assessPoolRisk, type PoolRiskAssessment } from '../risk/index.js';
import { withRetry, CircuitBreaker, isTransientError } from '../utils/resilience.js';

const meteoraCircuitBreaker = new CircuitBreaker({
  name: 'meteora-api',
  failureThreshold: 5,
  resetTimeMs: 30000,
});

export const SAMPLE_POOLS = [
  {
    address: 'BVRbyLjjfSBcoyiYFUxFjLYrKnPYS9DbYEoHSdniRLsE',
    name: 'SOL-USDC',
    dex: 'meteora',
    tokens: ['SOL', 'USDC'],
    tvl: 4800000,
    apy: 42.5,
    volume24h: 1250000,
    binStep: 4,
  },
  {
    address: 'ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq',
    name: 'SOL-USDC',
    dex: 'meteora',
    tokens: ['SOL', 'USDC'],
    tvl: 2100000,
    apy: 38.2,
    volume24h: 890000,
    binStep: 2,
  },
];

export const TOKENS: Record<string, string> = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
};

export const FEE_CONFIG = {
  FEE_BPS: 10, // 0.1%
  TREASURY: 'fAihKpm56DA9v8KU7dSifA1Qh4ZXCjgp6xF5apVaoPt',
  MIN_FEE_LAMPORTS: 10000,
  EXEMPT_THRESHOLD_USD: 1,
};

export interface TopPoolsOptions {
  limit: number;
  riskMax: number;
  minTvl: number;
  sortBy: string;
}

export async function getTopPools(options: TopPoolsOptions): Promise<{ pools: PoolRiskAssessment[]; count: number }> {
  const { limit, riskMax, minTvl, sortBy } = options;

  const data = await meteoraCircuitBreaker.execute(() =>
    withRetry(
      async () => {
        const response = await fetch('https://dlmm-api.meteora.ag/pair/all_with_pagination?limit=100&offset=0');
        if (!response.ok) {
          throw new Error(`Failed to fetch pools from Meteora (HTTP ${response.status})`);
        }
        return response.json() as Promise<any>;
      },
      { maxRetries: 3, baseDelayMs: 1000, retryOn: isTransientError },
    ),
  );
  const pools = data.pairs || data.data || [];

  const assessedPools: PoolRiskAssessment[] = [];

  for (const pool of pools) {
    const tvl = parseFloat(pool.liquidity || pool.tvl || '0');
    if (tvl < minTvl) continue;
    if (pool.is_blacklisted || pool.hide) continue;

    const nameParts = (pool.name || '').split('-');
    const tokenX = nameParts[0] || 'UNKNOWN';
    const tokenY = nameParts[1] || 'UNKNOWN';

    const rawApr = parseFloat(pool.apr || pool.apy || '0');
    const apr = rawApr * 100;
    const volume24h = parseFloat(pool.trade_volume_24h || pool.volume24h || '0');
    const binStep = parseInt(pool.bin_step || pool.binStep || '10');

    const assessment = await assessPoolRisk(
      pool.address,
      pool.name || `${tokenX}-${tokenY}`,
      apr,
      tvl,
      binStep,
      volume24h,
      tokenX,
      tokenY
    );

    if (assessment.riskScore <= riskMax) {
      assessedPools.push(assessment);
    }

    if (assessedPools.length >= limit * 2) break;
  }

  assessedPools.sort((a, b) => {
    switch (sortBy) {
      case 'apr': return b.apr - a.apr;
      case 'tvl': return b.tvl - a.tvl;
      case 'risk': return a.riskScore - b.riskScore;
      case 'sharpe':
      default:
        return b.sharpeRatio - a.sharpeRatio;
    }
  });

  return {
    pools: assessedPools.slice(0, limit),
    count: Math.min(limit, assessedPools.length),
  };
}
