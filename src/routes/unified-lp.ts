/**
 * Unified LP API Routes
 * 
 * DEX-agnostic LP operations - we pick the best pool automatically
 */

import { Hono } from 'hono';
import { fetchUnifiedPools, findBestPool, type UnifiedPool } from '../services/unified-pools.js';

const app = new Hono();

interface AddLpRequest {
  walletId: string;
  pair?: string;           // e.g., "SOL-USDC" - we find best pool
  poolAddress?: string;    // or specify exact pool
  amountSol: number;
  strategy?: 'concentrated' | 'wide';
  riskTolerance?: 'low' | 'medium' | 'high';
}

/**
 * GET /unified/pools
 * 
 * Returns top pools across all DEXes, sorted by risk-adjusted yield
 */
app.get('/pools', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '10');
    const minTvl = parseFloat(c.req.query('minTvl') || '50000');
    const maxRisk = parseInt(c.req.query('maxRisk') || '7');
    const dex = c.req.query('dex') as 'meteora' | 'orca' | 'all' | undefined || 'all';
    const sortBy = c.req.query('sortBy') as 'apr' | 'tvl' | 'riskAdjustedYield' | 'volume24h' | undefined || 'riskAdjustedYield';
    const tokenFilter = c.req.query('token');

    const pools = await fetchUnifiedPools({
      limit,
      minTvl,
      maxRiskScore: maxRisk,
      dexFilter: dex,
      sortBy,
      tokenFilter,
    });

    return c.json({
      success: true,
      count: pools.length,
      filters: { limit, minTvl, maxRisk, dex, sortBy, tokenFilter },
      pools: pools.map(p => ({
        ...p,
        humanYield: `$${p.dailyYieldPer100Usd.toFixed(2)}/day per $100`,
      })),
    });
  } catch (error: any) {
    console.error('[Unified LP] GET /pools error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /unified/pools/best
 * 
 * Find best pool for a token pair
 */
app.get('/pools/best', async (c) => {
  try {
    const tokenA = c.req.query('tokenA');
    const tokenB = c.req.query('tokenB');
    
    if (!tokenA || !tokenB) {
      return c.json({
        success: false,
        error: 'Missing tokenA or tokenB query params',
        example: '/unified/pools/best?tokenA=SOL&tokenB=USDC',
      }, 400);
    }

    const bestPool = await findBestPool(tokenA, tokenB);
    
    if (!bestPool) {
      return c.json({
        success: false,
        pair: `${tokenA}-${tokenB}`,
        error: `No pool found for ${tokenA}-${tokenB}`,
      }, 404);
    }

    return c.json({
      success: true,
      pair: `${tokenA}-${tokenB}`,
      bestPool: {
        ...bestPool,
        humanYield: `$${bestPool.dailyYieldPer100Usd.toFixed(2)}/day per $100`,
        reason: `Highest APR (${bestPool.apr.toFixed(1)}%) on ${bestPool.dex}`,
      },
    });
  } catch (error: any) {
    console.error('[Unified LP] GET /pools/best error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /unified/lp/add
 * 
 * Add LP to best pool for a pair (or specified pool)
 * This is the main agent-facing endpoint
 */
app.post('/lp/add', async (c) => {
  try {
    const body = await c.req.json() as AddLpRequest;
    const { walletId, pair, poolAddress, amountSol, strategy = 'concentrated', riskTolerance = 'medium' } = body;

    if (!walletId) {
      return c.json({ success: false, error: 'walletId required' }, 400);
    }
    if (!pair && !poolAddress) {
      return c.json({ success: false, error: 'Either pair or poolAddress required' }, 400);
    }
    if (!amountSol || amountSol <= 0) {
      return c.json({ success: false, error: 'amountSol must be positive' }, 400);
    }

    // TODO: Implement once unified-pools and unified-wizard are ready
    // 1. If pair provided, find best pool via findBestPool()
    // 2. Load wallet via loadWalletById()
    // 3. Route to correct DEX executor based on pool.dex
    // 4. Return transaction result

    return c.json({
      success: false,
      error: 'Unified LP execution in progress - use Telegram bot for now',
      params: { walletId, pair, poolAddress, amountSol, strategy, riskTolerance },
    });
  } catch (error: any) {
    console.error('[Unified LP] POST /lp/add error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
